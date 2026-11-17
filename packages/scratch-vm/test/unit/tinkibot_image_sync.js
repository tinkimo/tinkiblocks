const {test} = require('tap');
const EventEmitter = require('events');
const {ImageCollection} = require('../../src/tinkibot-images/collection');
const ImageSync = require('../../src/tinkibot-images/sync');

const robot = id => ({botUuid: id, nickname: id, claimState: 'paired'});
const setup = () => {
    const runtime = new EventEmitter();
    runtime.stopAll = () => {};
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

test('only successfully uploaded current image versions are available', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('one')];
    const first = h.runtime.tinkibotImages.create('first');
    h.runtime.emit('PROJECT_LOADED');
    await h.sync.wait();
    t.same(h.sync.uploadedNames(), ['first'], 'restoration records confirmed uploads');
    const second = h.runtime.tinkibotImages.create('second');
    h.runtime.emit('TINKIBOT_PROJECT_IMAGES_CHANGED');
    t.same(h.sync.uploadedNames(), ['first'], 'new images stay out of the dropdown');
    t.same(h.sync.pendingImages().map(image => image.name), ['second']);
    const before = {...first};
    h.runtime.tinkibotImages.update(first.id, new Uint8Array(first.pixels));
    h.runtime.emit('TINKIBOT_PROJECT_IMAGES_CHANGED');
    t.same(h.sync.uploadedNames(), [], 'edits are tracked even when pixels happen to match');
    h.sync.recordUploaded(before, () => true);
    t.same(h.sync.uploadedNames(), [], 'an older upload cannot mark a newer edit uploaded');
    h.sync.recordUploaded({...first}, () => true);
    t.same(h.sync.uploadedNames(), ['first']);
    h.runtime.tinkibotImages.select(second.id);
    h.runtime.emit('TINKIBOT_PROJECT_IMAGES_CHANGED');
    t.same(h.sync.uploadedNames(), ['first'], 'selection alone does not require upload');
    h.runtime.tinkibotImages.rename(first.id, 'renamed');
    h.runtime.emit('TINKIBOT_PROJECT_IMAGES_CHANGED');
    t.same(h.sync.uploadedNames(), [], 'a new robot filename needs upload');
    h.sync.recordUploaded({...first}, () => false);
    t.same(h.sync.uploadedNames(), [], 'stale robot/project completion is ignored');
});

test('failed restoration only exposes images confirmed before the failure', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('one')];
    h.runtime.tinkibotImages.create('first');
    h.runtime.tinkibotImages.create('second');
    h.runtime.uploadTinkibotImage = async image => {
        if (image.name === 'second') throw new Error('transfer failed');
    };
    h.runtime.emit('PROJECT_LOADED');
    await t.rejects(h.sync.wait(), /transfer failed/);
    t.same(h.sync.uploadedNames(), ['first']);
    t.same(h.sync.pendingImages().map(image => image.name), ['second']);
    h.runtime.tinkibotConnectedRobots = [robot('other')];
    h.runtime.resetTinkibotImages = async () => {
        throw new Error('not ready');
    };
    h.runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED');
    await t.rejects(h.sync.wait(), /not ready/);
    t.same(h.sync.uploadedNames(), [], 'uploads to another robot cannot be reused');
});

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
    await Promise.resolve();
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

test('one operation uploads its fixed snapshot exactly once and ignores later images', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('one')];
    const first = h.runtime.tinkibotImages.create('first');
    h.runtime.tinkibotImages.create('second');
    let release;
    h.runtime.resetTinkibotImages = async () => new Promise(resolve => {
        release = resolve;
    });
    h.runtime.emit('PROJECT_LOADED');
    t.equal(h.sync.blocking, true);
    await Promise.resolve();
    h.runtime.tinkibotImages.update(first.id, new Uint8Array(first.pixels.length));
    h.runtime.tinkibotImages.rename(first.id, 'changed');
    h.runtime.tinkibotImages.create('late-image');
    h.runtime.emit('TINKIBOT_PROJECT_IMAGES_CHANGED');
    release();
    await h.sync.wait();
    t.same(h.calls, [['upload', 'one', 'first', 255], ['upload', 'one', 'second', 255]]);
    t.equal(h.runtime.tinkibotImageSync.total, 2);
    t.equal(h.runtime.tinkibotImageSync.completed, 2);
    t.equal(h.sync.blocking, false);
});

test('retry resumes the failed snapshot without clearing or uploading completed images again', async t => {
    const h = setup();
    h.runtime.tinkibotConnectedRobots = [robot('one')];
    h.runtime.tinkibotImages.create('first');
    h.runtime.tinkibotImages.create('second');
    let fail = true;
    let staleProgress;
    h.runtime.uploadTinkibotImage = async (image, progress) => {
        h.calls.push(image.name);
        if (image.name === 'second' && fail) {
            staleProgress = progress;
            throw new Error('storage full');
        }
    };
    h.runtime.emit('PROJECT_LOADED');
    await t.rejects(h.sync.wait(), /storage full/);
    t.equal(h.sync.blocking, true, 'failure stays modal until acknowledged');
    t.equal(h.runtime.tinkibotImageSync.filename, 'second.rgb565');
    t.equal(h.runtime.tinkibotImageSync.completed, 1);
    staleProgress(98);
    t.equal(h.runtime.tinkibotImageSync.phase, 'error', 'late progress cannot reopen a failed attempt');
    fail = false;
    h.sync.retry();
    staleProgress(99);
    t.equal(h.runtime.tinkibotImageSync.progress, 0, 'previous attempt callbacks cannot affect retry');
    await h.sync.wait();
    staleProgress(87);
    t.equal(h.runtime.tinkibotImageSync.phase, 'ready');
    t.same(h.calls, [['reset', 'one'], 'first', 'second', 'second']);
    t.equal(h.sync.blocking, false);
    t.equal(h.runtime.tinkibotImageSync.completed, 2);
});

test('disconnect and unmount wait for the active transfer to settle before unlocking', async t => {
    for (const disconnect of [true, false]) {
        const h = setup();
        h.runtime.tinkibotConnectedRobots = [robot('one')];
        h.runtime.tinkibotImages.create('first');
        h.runtime.tinkibotImages.create('second');
        let release;
        let begin;
        const began = new Promise(resolve => {
            begin = resolve;
        });
        h.runtime.uploadTinkibotImage = async image => {
            h.calls.push(image.name);
            begin();
            await new Promise(resolve => {
                release = resolve;
            });
        };
        h.runtime.emit('PROJECT_LOADED');
        await began;
        if (disconnect) {
            h.runtime.tinkibotConnectedRobots = [];
            h.runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED');
        } else h.sync.interrupt('Upload view closed');
        t.equal(h.sync.blocking, true);
        t.equal(h.sync.close(), false, 'cannot dismiss an active transfer');
        release();
        await h.sync.running;
        t.same(h.calls, [['reset', 'one'], 'first']);
        if (disconnect) {
            t.equal(h.runtime.tinkibotImageSync.phase, 'error');
            t.match(h.runtime.tinkibotImageSync.error, /disconnected/);
            t.equal(h.sync.close(), true);
        }
        t.equal(h.sync.blocking, false);
    }
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
