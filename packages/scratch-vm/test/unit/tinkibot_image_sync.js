const {test} = require('tap');
const EventEmitter = require('events');
const {ImageCollection} = require('../../src/tinkibot-images/collection');
const ImageSync = require('../../src/tinkibot-images/sync');

const robot = id => ({botUuid: id, nickname: id, claimState: 'paired'});
const setup = () => {
    const runtime = new EventEmitter();
    runtime.tinkibotImages = new ImageCollection();
    runtime.tinkibotConnectedRobots = [];
    const calls = [];
    runtime.resetTinkibotImages = async (target, token, valid) => {
        if (valid()) calls.push(['reset', target.botUuid]);
    };
    runtime.uploadTinkibotImage = async (image, _progress, context) => {
        if (context.valid()) calls.push(['upload', context.botUuid, image.name, image.pixels[0]]);
    };
    const sync = new ImageSync(runtime);
    return {runtime, sync, calls};
};

test('loads project images after clearing and also clears empty projects on a claim', async t => {
    const h = setup();
    h.runtime.tinkibotImages.create('first');
    h.runtime.emit('PROJECT_LOADED');
    t.same(h.calls, [], 'discovery/unclaimed robots are untouched');
    h.runtime.tinkibotConnectedRobots = [robot('one')];
    h.runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED');
    await h.sync.wait();
    t.same(h.calls, [['reset', 'one'], ['upload', 'one', 'first', 255]]);
    h.runtime.emit('RUNTIME_DISPOSED');
    h.runtime.tinkibotImages = new ImageCollection();
    h.runtime.emit('PROJECT_LOADED');
    await h.sync.wait();
    t.same(h.calls[2], ['reset', 'one']);
    t.equal(h.calls.length, 3);
});

test('project and robot switches never continue a stale upload list', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('old')];
    h.runtime.tinkibotImages.create('old-first');
    h.runtime.tinkibotImages.create('old-second');
    let release;
    h.runtime.resetTinkibotImages = async target => {
        h.calls.push(['reset', target.botUuid]);
        if (target.botUuid === 'old') {
            await new Promise(resolve => {
                release = resolve;
            });
        }
    };
    h.runtime.emit('PROJECT_LOADED');
    h.runtime.emit('RUNTIME_DISPOSED');
    h.runtime.tinkibotImages = new ImageCollection();
    h.runtime.tinkibotImages.create('new-image');
    h.runtime.tinkibotConnectedRobots = [robot('new')];
    h.runtime.emit('PROJECT_LOADED');
    release();
    await h.sync.wait();
    t.same(h.calls, [['reset', 'old'], ['reset', 'new'], ['upload', 'new', 'new-image', 255]]);
});

test('disconnect and reconnect resync the same UUID; errors are visible and retryable', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('same')];
    h.runtime.emit('PROJECT_LOADED');
    await h.sync.wait();
    h.runtime.tinkibotConnectedRobots = [{...robot('same'), connected: false}];
    h.runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED');
    h.runtime.tinkibotConnectedRobots = [robot('same')];
    h.runtime.resetTinkibotImages = async () => {
        throw new Error('storage failure');
    };
    h.runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED');
    await t.rejects(h.sync.wait(), /storage failure/);
    t.equal(h.runtime.tinkibotImageSync.phase, 'error');
    h.runtime.resetTinkibotImages = async () => {};
    h.sync.retry();
    await h.sync.wait();
    t.equal(h.runtime.tinkibotImageSync.phase, 'ready');
});

test('an in-flight stale image settles before new-project cleanup and no old second image is sent', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('same')];
    h.runtime.tinkibotImages.create('old-first');
    h.runtime.tinkibotImages.create('old-second');
    let release;
    let began;
    const started = new Promise(resolve => {
        began = resolve;
    });
    h.runtime.uploadTinkibotImage = async image => {
        h.calls.push(['upload', image.name]);
        if (image.name === 'old-first') {
            began();
            await new Promise(resolve => {
                release = resolve;
            });
        }
    };
    h.runtime.emit('PROJECT_LOADED');
    await started;
    h.runtime.emit('RUNTIME_DISPOSED');
    h.runtime.tinkibotImages = new ImageCollection();
    h.runtime.tinkibotImages.create('new-image');
    h.runtime.emit('PROJECT_LOADED');
    release();
    await h.sync.wait();
    t.same(h.calls, [['reset', 'same'], ['upload', 'old-first'], ['reset', 'same'], ['upload', 'new-image']]);
});

test('edits made during sync restart from fresh pixels, but selection changes do not', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('one')];
    const image = h.runtime.tinkibotImages.create('picture');
    let release;
    let first = true;
    h.runtime.resetTinkibotImages = async () => {
        if (first) {
            first = false; await new Promise(resolve => {
                release = resolve;
            });
        }
    };
    h.runtime.emit('PROJECT_LOADED');
    const generation = h.sync.generation;
    h.runtime.tinkibotImages.select(image.id);
    h.runtime.emit('TINKIBOT_PROJECT_IMAGES_CHANGED');
    t.equal(h.sync.generation, generation);
    h.runtime.tinkibotImages.update(image.id, new Uint8Array(image.pixels.length));
    h.runtime.emit('TINKIBOT_PROJECT_IMAGES_CHANGED');
    t.ok(h.sync.generation > generation);
    release();
    await h.sync.wait();
    t.same(h.calls, [['upload', 'one', 'picture', 0]]);
});

test('reset polling preserves its token, handles busy, and rejects stale work', async t => {
    const {reset} = require('../../src/tinkibot-images/sync-reset');
    const token = '0123456789abcdef';
    const commands = [];
    const replies = ['BUSY', 'PENDING', 'OK'];
    const send = async command => {
        commands.push(command);
        return `${replies.shift()} file:image-reset ${token}`;
    };
    let now = 0;
    await reset(send, token, 'owner', () => true, {now: () => now,
        wait: async ms => {
            now += ms;
        }});
    t.equal(commands.length, 3);
    t.ok(commands.every(command => command.token === token && command.owner === 'owner'));
    await t.rejects(reset(send, token, 'owner', () => false), /superseded/);
    await t.rejects(reset(async () => `PENDING file:image-reset ${token}`, token, 'owner', () => true,
        {now: () => now,
            wait: async ms => {
                now += ms;
            },
            timeout: 100}), /timed out/);
});

test('a superseded serial upload sends cancellation but no more image data', async t => {
    const {upload} = require('../../src/tinkibot-images/serial-upload');
    const {encode, decode} = require('../../src/tinkibot-images/tfp');
    const {webcrypto} = require('crypto');
    if (!global.crypto) global.crypto = webcrypto;
    const manager = new EventEmitter();
    manager.apiReady = true;
    manager.method = 'web-serial';
    manager.log = () => {};
    let valid = true;
    const kinds = [];
    manager.send = async line => {
        manager.uploadChannel.text(`TFP1-MODEM ${line.split(' ')[1]} 244`);
    };
    manager.transport = {write: async frame => {
        const packet = decode(frame.slice(1, -1));
        kinds.push(packet.kind);
        if (packet.kind === 9) return;
        if (packet.kind === 4) valid = false;
        const kind = packet.kind === 1 ? 2 : 5;
        const offset = packet.kind === 4 ? packet.offset + packet.payload.length : 0;
        const payload = packet.kind === 1 ? new Uint8Array([128, 0]) : new Uint8Array();
        manager.uploadChannel.feed(encode(kind, packet.id, offset, payload).slice(1, -1));
    }};
    await t.rejects(upload(manager, robot('one'), 'picture.rgb565', new Uint8Array(300), () => {},
        {valid: () => valid}), /superseded/);
    t.same(kinds, [1, 4, 9]);
    t.equal(manager.uploadChannel, null);
    t.equal(manager.listenerCount('disconnected'), 0);
    t.equal(manager.listenerCount('message'), 0);
});
