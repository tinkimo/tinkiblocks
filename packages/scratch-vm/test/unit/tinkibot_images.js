const {test} = require('tap');
const JSZip = require('jszip');
const {webcrypto} = require('crypto');
const {ImageCollection, BYTE_LENGTH} = require('../../src/tinkibot-images/collection');
const {encode: rgb565} = require('../../src/tinkibot-images/rgb565');
const {encode, decode, FileSender} = require('../../src/tinkibot-images/tfp');
const VM = require('../../src/virtual-machine');
const {ScratchStorage} = require('scratch-storage');
const fs = require('fs');
const path = require('path');
if (!global.crypto) global.crypto = webcrypto;

test('portrait images match the unchanged robot application viewport', t => {
    const images = new ImageCollection();
    const image = images.create();
    t.equal(image.pixels.length, 128 * 140 * 3);
    t.same([images.serialize().images[0].width, images.serialize().images[0].height], [128, 140]);
    t.equal(rgb565(image.pixels).length, 40960);
    t.end();
});
test('landscape draft projects migrate upright and retain IDs and selection', t => {
    const image = new ImageCollection().create('top');
    const pixels = Buffer.alloc(160 * 118 * 3);
    for (let y = 0; y < 118; y++) {
        for (let x = 0; x < 160; x++) pixels.set(y < 59 ? [255, 0, 0] : [0, 0, 255], (y * 160 + x) * 3);
    }
    const restored = ImageCollection.restore({version: 1, selectedId: image.id,
        images: [{id: image.id, name: image.name, width: 160, height: 118, rgb: pixels.toString('base64')}]});
    t.equal(restored.selectedId, image.id);
    t.equal(restored.get().id, image.id);
    t.equal(restored.get().pixels.length, 128 * 140 * 3);
    t.same(Array.from(restored.get().pixels.slice(23 * 128 * 3, 23 * 128 * 3 + 3)), [255, 0, 0]);
    t.same(Array.from(restored.get().pixels.slice(116 * 128 * 3, 116 * 128 * 3 + 3)), [0, 0, 255]);
    t.end();
});
test('image CRUD keeps stable IDs, unique names and independent buffers', t => {
    let changes = 0;
    const images = new ImageCollection(() => changes++);
    const first = images.create();
    const second = images.create(null, first.pixels);
    t.equal(first.name, 'image1');
    t.equal(second.name, 'image2');
    t.not(first.id, second.id);
    second.pixels[0] = 13;
    t.equal(first.pixels[0], 255);
    images.rename(first.id, 'my-picture');
    t.throws(() => images.rename(second.id, 'my-picture'), /already exists/);
    t.throws(() => images.rename(second.id, '../escape'), /letters/);
    images.select(first.id);
    const restored = ImageCollection.restore(images.serialize());
    t.same(restored.serialize(), images.serialize());
    images.remove(first.id);
    t.equal(images.selectedId, second.id);
    t.equal(restored.images.length, 2);
    t.ok(changes >= 5);
    t.end();
});
test('metadata rejects invalid dimensions, duplicate IDs and malformed data', t => {
    const images = new ImageCollection();
    images.create();
    const data = images.serialize();
    t.throws(() => ImageCollection.restore({...data, version: 2}));
    t.throws(() => ImageCollection.restore({...data, images: [{...data.images[0], width: 320}]}));
    t.throws(() => ImageCollection.restore({...data, images: [data.images[0], data.images[0]]}));
    const invalid = {...data.images[0], rgb: '!'.repeat(BYTE_LENGTH * 4 / 3)};
    t.throws(() => ImageCollection.restore({...data, images: [invalid]}));
    t.end();
});
test('images round-trip through real sb3 and JSON autosave without changing Scratch data', async t => {
    const vm = new VM();
    const reopened = new VM();
    vm.attachStorage(new ScratchStorage());
    reopened.attachStorage(new ScratchStorage());
    t.teardown(() => {
        vm.clear(); reopened.clear();
    });
    const input = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, '../fixtures/comments.sb3')));
    const project = JSON.parse(await input.file('project.json').async('string'));
    // PNG costumes keep this persistence test independent of SVG import sanitization.
    const pngName = Object.keys(input.files).find(name => name.endsWith('.png'));
    for (const target of project.targets) {
        for (const costume of target.costumes) {
            costume.assetId = pngName.slice(0, -4);
            costume.dataFormat = 'png';
            costume.md5ext = pngName;
        }
    }
    input.file('project.json', JSON.stringify(project));
    const source = await input.generateAsync({type: 'nodebuffer'});
    await vm.loadProject(source);
    const original = JSON.parse(vm.toJSON());
    const baselineBlob = await vm.saveProjectSb3();
    const originalZip = await JSZip.loadAsync(await baselineBlob.arrayBuffer());
    let changed = 0;
    vm.on('PROJECT_CHANGED', () => changed++);
    const pixels = Uint8Array.from({length: BYTE_LENGTH}, (_, index) => (index * 31) % 256);
    const first = vm.projectImages.create('rainbow', pixels);
    vm.projectImages.create('white');
    vm.projectImages.select(first.id);
    const expected = vm.projectImages.serialize();
    const saved = await vm.saveProjectSb3();
    const archive = await saved.arrayBuffer();
    const zip = await JSZip.loadAsync(archive);
    const json = JSON.parse(await zip.file('project.json').async('string'));
    t.same(json.meta.tinkibotImages, expected);
    t.same(json.targets, original.targets, 'blocks, costumes, sprites and sounds remain intact');
    for (const name of Object.keys(originalZip.files).filter(filePath => filePath !== 'project.json' &&
        !originalZip.files[filePath].dir)) {
        t.same(await zip.file(name).async('uint8array'), await originalZip.file(name).async('uint8array'),
            `Scratch asset ${name} is unchanged`);
    }
    await reopened.loadProject(new Uint8Array(archive));
    t.same(reopened.projectImages.serialize(), expected, 'exact RGB values and selection restored');
    t.same(JSON.parse(reopened.toJSON()).targets, original.targets);
    // JSON autosave fetches ordinary Scratch assets from the server separately.
    const assetStore = new Map(vm.assets.map(asset => [asset.assetId, asset]));
    reopened.runtime.storage.addHelper({
        load: (type, id) => assetStore.has(id) ? Promise.resolve(assetStore.get(id)) : null
    }, 1);
    await reopened.loadProject(vm.toJSON());
    t.same(reopened.projectImages.serialize(), expected, 'JSON autosave is self-contained');
    await reopened.loadProject(source);
    t.equal(reopened.projectImages.images.length, 0, 'old projects reset the gallery');
    vm.clear();
    t.equal(vm.projectImages.images.length, 0, 'new project clears images');
    t.ok(changed >= 3);
});
test('RGB565 matches big-endian firmware words without changing original RGB', t => {
    const pixels = new Uint8Array(BYTE_LENGTH);
    pixels.set([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const encoded = rgb565(pixels);
    t.equal(encoded.length, 128 * 160 * 2);
    t.ok(encoded.slice(128 * 140 * 2).every(value => value === 0), 'unused trailing rows are padded');
    t.same(Array.from(encoded.slice(0, 8)), [248, 0, 7, 224, 0, 31, 255, 255]);
    t.equal(pixels[0], 255);
    t.end();
});
const makeChannel = options => {
    const packets = [];
    const queued = [];
    const channel = {capacity: 244,
        send: async wire => {
            const packet = decode(wire.slice(1, -1));
            packets.push(packet);
            if (packet.kind === 1) {
                if (options.pending && packets.length === 1) {
                    queued.push({kind: 3, id: packet.id, offset: 0, payload: new Uint8Array()});
                }
                queued.push({kind: 2, id: packet.id, offset: 0, payload: new Uint8Array([128, 0])});
            } else if (packet.kind === 4) {
                queued.push({kind: options.failure ? 8 : 5,
                    id: packet.id,
                    offset: packet.offset + packet.payload.length,
                    payload: options.failure ? new Uint8Array([1, 4, 70, 97, 105, 108]) : new Uint8Array()});
            } else if (packet.kind === 6) {
                queued.push({kind: 7, id: packet.id, offset: packet.offset, payload: new Uint8Array()});
            }
        },
        receive: async () => {
            if (!queued.length) throw new Error('TFP response timed out');
            return queued.shift();
        }};
    return {channel, packets};
};
test('TFP integrity, successful upload and robot overwrite acceptance', async t => {
    const packet = encode(4, 123, 64, new Uint8Array([0, 255, 1]));
    t.equal(Buffer.from(packet).toString('hex'), '000554460104027b01010240010102030107ff012965d70600',
        'wire bytes match Python transfer.protocol.encode');
    t.same(decode(packet.slice(1, -1)), {kind: 4, id: 123, offset: 64, payload: new Uint8Array([0, 255, 1])});
    const corrupted = new Uint8Array(packet);
    corrupted[10] ^= 1;
    t.throws(() => decode(corrupted.slice(1, -1)));
    const {channel, packets} = makeChannel({pending: true});
    const progress = [];
    await new FileSender(channel).upload('image1.rgb565', new Uint8Array(300), value => progress.push(value));
    t.same(packets.map(item => item.kind), [1, 4, 4, 4, 6]);
    t.same(packets.filter(item => item.kind === 4).map(item => item.offset), [0, 128, 256]);
    t.equal(progress[0], 0);
    t.equal(progress[progress.length - 1], 100);
});
test('TFP errors cancel the transfer and never report success', async t => {
    const {channel, packets} = makeChannel({failure: true});
    const progress = [];
    await t.rejects(new FileSender(channel).upload('image1.rgb565', new Uint8Array(300),
        value => progress.push(value)), /Fail/);
    t.equal(packets[packets.length - 1].kind, 9);
    t.notOk(progress.includes(100));
});


const prepareImageUploads = async vm => {
    const runtime = vm.runtime;
    runtime.resetTinkibotImages = async () => {};
    runtime.uploadTinkibotImage = async () => {};
    runtime.tinkibotConnectedRobots = [{botUuid: 'robot', nickname: 'lime', claimState: 'paired'}];
    runtime.emit('PROJECT_LOADED');
    await vm.imageSync.wait();
};

test('manual uploads confirm the sent snapshot only after success', async t => {
    const vm = new VM();
    t.teardown(() => vm.clear());
    await prepareImageUploads(vm);
    const image = vm.projectImages.create('picture');
    let begin;
    let release;
    const started = new Promise(resolve => { begin = resolve; });
    vm.runtime.uploadTinkibotImage = async snapshot => {
        t.not(snapshot.pixels, image.pixels, 'upload data is an independent snapshot');
        begin();
        await new Promise(resolve => { release = resolve; });
    };
    const upload = vm.uploadProjectImage(image.id);
    await started;
    t.same(vm.imageSync.uploadedNames(), [], 'an upload in flight is not available');
    vm.projectImages.update(image.id, new Uint8Array(BYTE_LENGTH));
    release();
    await upload;
    t.same(vm.imageSync.uploadedNames(), [], 'editing during upload still needs another upload');
    vm.runtime.uploadTinkibotImage = async () => { throw new Error('transfer failed'); };
    await t.rejects(vm.uploadProjectImage(image.id), /transfer failed/);
    t.same(vm.imageSync.uploadedNames(), []);
    vm.runtime.uploadTinkibotImage = async () => {};
    await vm.uploadProjectImage(image.id);
    t.same(vm.imageSync.uploadedNames(), ['picture']);
    t.same(vm.imageSync.pendingImages(), []);
});

test('user image menus only offer uploaded current versions', async t => {
    const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
    const vm = new VM();
    t.teardown(() => vm.clear());
    const runtime = vm.runtime;
    const extension = new Tinkibot(runtime);
    await prepareImageUploads(vm);
    const block = () => extension.getInfos().find(info => info.id === 'tinkibotDisplay')
        .blocks.find(info => info.opcode === 'display_user_image');
    t.equal(block().disabled, true);
    t.same(extension.getUserImageOptions(), [{text: 'no images', value: '__no_images__'}]);
    t.ok(extension.getProjectImageOptions().includes('logo'));
    const image = vm.projectImages.create('rainbow');
    t.equal(block().disabled, true, 'creating an image does not upload it');
    await vm.uploadProjectImage(image.id);
    t.equal(block().disabled, false);
    t.same(extension.getUserImageOptions(), ['rainbow']);
    t.notOk(extension.getProjectImageOptions().includes('rainbow'));
    t.ok(extension.getProjectPreloadImageOptions().includes('rainbow'));
    vm.projectImages.rename(image.id, 'sunshine');
    t.same(extension.getUserImageNames(), []);
    t.notOk(extension.getProjectPreloadImageOptions().includes('sunshine'));
    await vm.uploadProjectImage(image.id);
    t.same(extension.getUserImageOptions(), ['sunshine']);
    vm.projectImages.update(image.id, new Uint8Array(BYTE_LENGTH));
    t.same(extension.getUserImageNames(), [], 'editing removes the uploaded version from the menu');
    vm.projectImages.remove(image.id);
    t.equal(block().disabled, true);
    t.equal(block().arguments.IMAGE.defaultValue, '__no_images__');
});

test('user image commands cannot send empty, unuploaded, edited or deleted values', async t => {
    const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
    const vm = new VM();
    t.teardown(() => vm.clear());
    const extension = new Tinkibot(vm.runtime);
    await prepareImageUploads(vm);
    const commands = [];
    extension._sendCommand = command => { commands.push(command); return Promise.resolve(); };
    await extension.display_user_image({IMAGE: '__no_images__'});
    const image = vm.projectImages.create('my-picture');
    await extension.display_user_image({IMAGE: image.name});
    await extension.preload_image({IMAGE: image.name});
    t.equal(commands.length, 0);
    await vm.uploadProjectImage(image.id);
    await extension.display_user_image({IMAGE: image.name});
    t.same(commands, [{command: 'display_image', image: 'my-picture'}]);
    vm.projectImages.update(image.id, new Uint8Array(BYTE_LENGTH));
    await extension.display_user_image({IMAGE: image.name});
    await extension.preload_image({IMAGE: image.name});
    t.equal(commands.length, 1);
    vm.projectImages.remove(image.id);
    await extension.display_user_image({IMAGE: 'my-picture'});
    t.equal(commands.length, 1);
});

test('a superseded project load cannot restore another project image collection', async t => {
    const vm = new VM();
    t.teardown(() => vm.clear());
    const source = fs.readFileSync(path.join(__dirname, '../fixtures/comments.sb3'));
    const first = vm.loadProject(source);
    const second = vm.loadProject(source);
    const results = await Promise.allSettled([first, second]);
    t.equal(results[0].status, 'rejected');
    t.equal(results[1].status, 'fulfilled');
    t.equal(vm.projectImages.images.length, 0);
});

test('USB upload negotiates one existing modem route and streams TFP acknowledgements', async t => {
    const EventEmitter = require('events');
    const {upload} = require('../../src/tinkibot-images/serial-upload');
    const manager = new EventEmitter();
    manager.apiReady = true;
    manager.method = 'web-serial';
    manager.log = () => {};
    const wires = [];
    let supportCompression = false;
    manager.send = async line => {
        t.match(line, /^lime\.tfp:open [a-f0-9]{16} 512 rgb565-rle1\n$/);
        manager.uploadChannel.text(`TFP1-MODEM ${line.split(' ')[1]} 244${supportCompression ? ' rgb565-rle1' : ''}`);
    };
    manager.transport = {write: async frame => {
        wires.push(frame);
        const packet = decode(frame.slice(1, -1));
        const kind = {1: 2, 4: 5, 6: 7}[packet.kind];
        const offset = packet.kind === 4 ? packet.offset + packet.payload.length : packet.offset;
        const payload = packet.kind === 1 ? new Uint8Array([128, 0]) : new Uint8Array();
        manager.uploadChannel.feed(encode(kind, packet.id, offset, payload).slice(1, -1));
    }};
    const progress = [];
    await upload(manager, {nickname: 'lime', botUuid: 'robot'}, 'image1.rgb565', new Uint8Array(300),
        value => progress.push(value));
    t.equal(progress[progress.length - 1], 100);
    t.ok(wires.every(wire => wire.length <= 244));
    t.equal(manager.uploadChannel, null);
    t.equal(manager.listenerCount('disconnected'), 0);
    supportCompression = true;
    const compressedStart = wires.length;
    await upload(manager, {nickname: 'lime', botUuid: 'robot'}, 'image1.rgb565', new Uint8Array(40960));
    const packed = Buffer.concat(wires.slice(compressedStart).map(frame => decode(frame.slice(1, -1)))
        .filter(packet => packet.kind === 4).map(packet => Buffer.from(packet.payload)));
    t.equal(packed.length, 516, 'confirmed capability enables smaller serial transfer');
    t.same(packed, Buffer.from(await require('../../src/tinkibot-images/compression').compress(new Uint8Array(40960))));
    t.equal(manager.uploadChannel, null);
    const quietStart = wires.length;
    await upload(manager, {nickname: 'lime', botUuid: 'robot'}, 'image1.rgb565', new Uint8Array(40960),
        () => {}, {valid: () => true, showComplete: false});
    const metadata = decode(wires[quietStart].slice(1, -1)).payload;
    t.equal(metadata.length, 38 + metadata[0]);
    t.equal(metadata[metadata.length - 1], 1, 'intermediate file requests no completion screen');
    manager.send = async () => {
        throw new Error('Modem unavailable');
    };
    const before = wires.length;
    await t.rejects(upload(manager, {nickname: 'lime', botUuid: 'robot'}, 'image1.rgb565',
        new Uint8Array(300)), /Modem unavailable/);
    t.equal(wires.length, before, 'no binary is sent before positive modem negotiation');
    t.equal(manager.uploadChannel, null);
});


test('filenames use lowercase letters, numbers and hyphens; restored images keep their pixels', t => {
    const images = new ImageCollection();
    t.equal(images.normalizeName('My Picture_2.PNG!'), 'my-picture-2png');
    for (const name of ['Upper', 'under_score', '-leading', 'has space', 'x.png', '']) {
        t.throws(() => images.rename(images.create().id, name), /lowercase/);
    }
    const first = images.create('sunny-day');
    const second = images.create('other');
    const saved = images.serialize();
    saved.images.find(image => image.id === first.id).name = 'Sunny_Day';
    saved.images.find(image => image.id === second.id).name = 'sunny-day';
    const restored = ImageCollection.restore(saved);
    t.equal(restored.get(first.id).name, 'sunny-day');
    t.equal(restored.get(second.id).name, 'sunny-day-2');
    t.same(restored.get(first.id).pixels, first.pixels);
    t.equal(restored.selectedId, saved.selectedId);
    t.end();
});

test('the toolbox disables the empty user image block and refreshes its default', async t => {
    const vm = new VM();
    t.teardown(() => vm.clear());
    await vm.extensionManager.loadExtensionURL('tinkibot');
    const xml = () => vm.runtime.getBlocksXML().find(category => category.id === 'tinkibotDisplay').xml;
    t.match(xml(), /<block type="tinkibotDisplay_display_user_image" disabled="true">/);
    t.match(xml(), /<field name="IMAGE">__no_images__<\/field>/);
    await prepareImageUploads(vm);
    const image = vm.projectImages.create('my-picture');
    await vm.extensionManager.refreshBlocks();
    t.match(xml(), /<block type="tinkibotDisplay_display_user_image" disabled="true">/);
    await vm.uploadProjectImage(image.id);
    await vm.extensionManager.refreshBlocks();
    t.notMatch(xml(), /<block type="tinkibotDisplay_display_user_image" disabled="true">/);
    t.match(xml(), /<field name="IMAGE">my-picture<\/field>/);
    vm.projectImages.remove(image.id);
    await vm.extensionManager.refreshBlocks();
    t.match(xml(), /<block type="tinkibotDisplay_display_user_image" disabled="true">/);
});

test('toolbox refreshes when robot image availability changes', async t => {
    const vm = new VM();
    await prepareImageUploads(vm);
    let updates = 0;
    vm.runtime.on('TOOLBOX_EXTENSIONS_NEED_UPDATE', () => updates++);
    const image = vm.projectImages.create('first');
    vm.projectImages.update(image.id, new Uint8Array(BYTE_LENGTH));
    vm.projectImages.rename(image.id, 'second');
    t.equal(updates, 0, 'editing a local draft does not rebuild robot blocks');
    await vm.uploadProjectImage(image.id);
    t.equal(updates, 1);
    vm.projectImages.remove(image.id);
    t.equal(updates, 2);
    vm.clear();
});

test('old literal user-image blocks migrate while built-ins and reporter inputs stay intact', t => {
    const migrate = require('../../src/tinkibot-images/migrate-blocks');
    const block = {opcode: 'tinkibotDisplay_display_image', next: 'next', parent: null,
        inputs: {IMAGE: [1, 'menu']}, fields: {}, topLevel: true, x: 30, y: 40};
    const menu = {opcode: 'tinkibotDisplay_menu_image_options', parent: 'display', shadow: true,
        fields: {image_options: ['my-picture', null]}};
    const project = {targets: [{blocks: {display: block, menu,
        builtin: {...block, inputs: {IMAGE: [1, 'builtinMenu']}},
        builtinMenu: {...menu, parent: 'builtin', fields: {image_options: ['logo', null]}},
        reporter: {...block, inputs: {IMAGE: [3, 'reporter-id', 'reporterMenu']}},
        reporterMenu: {...menu, parent: 'reporter'}}}]};
    migrate(project, ['my-picture']);
    t.equal(block.opcode, 'tinkibotDisplay_display_user_image');
    t.same(block.fields, {IMAGE: ['my-picture', null]});
    t.same(block.inputs, {});
    t.equal(block.next, 'next');
    t.same([block.x, block.y], [30, 40]);
    t.notOk(project.targets[0].blocks.menu);
    t.equal(project.targets[0].blocks.builtin.opcode, 'tinkibotDisplay_display_image');
    t.equal(project.targets[0].blocks.reporter.opcode, 'tinkibotDisplay_display_image');
    t.ok(project.targets[0].blocks.reporterMenu);
    t.end();
});


test('modal restoration blocks image mutations, project controls and green flag until terminal', async t => {
    const vm = new VM();
    t.teardown(() => vm.clear());
    let release;
    vm.runtime.resetTinkibotImages = async () => new Promise(resolve => { release = resolve; });
    vm.runtime.uploadTinkibotImage = async () => {};
    const image = vm.projectImages.create('saved');
    vm.runtime.tinkibotConnectedRobots = [{botUuid: 'robot', nickname: 'lime', claimState: 'paired'}];
    vm.runtime.emit('PROJECT_LOADED');
    t.throws(() => vm.projectImages.create('late'), /uploading/);
    t.throws(() => vm.projectImages.update(image.id, new Uint8Array(BYTE_LENGTH)), /uploading/);
    t.throws(() => vm.projectImages.rename(image.id, 'late'), /uploading/);
    t.throws(() => vm.projectImages.remove(image.id), /uploading/);
    t.throws(() => vm.greenFlag(), /uploading/);
    await t.rejects(vm.loadProject('{}'), /uploading/);
    await t.rejects(vm.saveProjectSb3(), /uploading/);
    release();
    await vm.imageSync.wait();
    t.doesNotThrow(() => vm.projectImages.create('after'));
});

test('normal robot requests cannot dispatch when a project restore starts during connection', async t => {
    const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
    const vm = new VM();
    t.teardown(() => vm.clear());
    const extension = new Tinkibot(vm.runtime);
    extension._connectedRobots = [{botUuid: 'robot', nickname: 'lime', claimState: 'paired'}];
    vm.runtime.tinkibotConnectedRobots = extension._connectedRobots;
    vm.projectImages.create('saved');
    let connect;
    let began;
    const connecting = new Promise(resolve => { began = resolve; });
    extension.connect = async () => {
        began();
        await new Promise(resolve => { connect = resolve; });
    };
    let sent = 0;
    extension._sendRobotRequest = () => { sent++; };
    const command = extension._sendCommand({command: 'forward', distance: 10});
    await connecting;
    let restore;
    vm.runtime.resetTinkibotImages = async () => new Promise(resolve => { restore = resolve; });
    vm.runtime.uploadTinkibotImage = async () => {};
    vm.runtime.emit('PROJECT_LOADED');
    connect();
    await t.rejects(command, /uploading/);
    await t.rejects(extension.claimRobot('other'), /uploading/);
    await t.rejects(extension.releaseRobot('robot'), /uploading/);
    await t.rejects(extension.removeRobot('robot'), /uploading/);
    restore();
    await vm.imageSync.wait();
    t.equal(sent, 0);
});


test('RGB565 compression matches desktop vectors and never expands data', async t => {
    const {compress} = require('../../src/tinkibot-images/compression');
    const {createHash} = require('crypto');
    const vectors = require('../fixtures/image-compression.json');
    for (const vector of vectors) {
        const pattern = Buffer.from(vector.pattern, 'hex');
        const raw = new Uint8Array(40960);
        for (let index = 0; index < raw.length; index++) raw[index] = pattern[index % pattern.length];
        const packed = await compress(raw);
        t.equal(packed.length, vector.packedSize, vector.name);
        t.equal(createHash('sha256').update(packed).digest('hex'), vector.packedSha256);
        t.ok(packed.length <= raw.length);
    }
    const other = new Uint8Array(50);
    t.equal(await compress(other), other, 'other files remain untouched');
});


test('serial compression falls back with a fresh nonce and ignores late capability replies', async t => {
    const EventEmitter = require('events');
    const {upload} = require('../../src/tinkibot-images/serial-upload');
    const manager = new EventEmitter();
    Object.assign(manager, {apiReady: true, method: 'web-serial', log: () => {}});
    const opens = [];
    const received = [];
    manager.send = async line => {
        opens.push(line);
        if (opens.length === 1) return;
        t.not(line.split(' ')[1], opens[0].split(' ')[1], 'fallback owns a fresh negotiation');
        t.equal(manager.uploadChannel.text(`TFP1-MODEM ${opens[0].split(' ')[1]} 244 rgb565-rle1`),
            false, 'late capability cannot authorize compression on the fallback route');
        manager.uploadChannel.text(`TFP1-MODEM ${line.split(' ')[1]} 244`);
    };
    manager.transport = {write: async frame => {
        const packet = decode(frame.slice(1, -1));
        if (packet.kind === 4) received.push(...packet.payload);
        const kind = {1: 2, 4: 5, 6: 7}[packet.kind];
        const offset = packet.kind === 4 ? packet.offset + packet.payload.length : packet.offset;
        manager.uploadChannel.feed(encode(kind, packet.id, offset,
            packet.kind === 1 ? new Uint8Array([128, 0]) : new Uint8Array()).slice(1, -1));
    }};
    const result = upload(manager, {nickname: 'lime', botUuid: 'robot'}, 'image1.rgb565', new Uint8Array(40960));
    manager.uploadChannel.text('ERR tfp-invalid-tfp-open');
    await result;
    t.equal(opens.length, 2);
    t.equal(received.length, 40960, 'unsupported peer receives the original raw file');
    t.equal(manager.uploadChannel, null);
});

test('proxy image uploads suppress completion only when the batch context asks', async t => {
    const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
    const vm = new VM();
    t.teardown(() => vm.clear());
    const extension = new Tinkibot(vm.runtime);
    extension.connectionManager.method = 'local-proxy';
    const commands = [];
    extension._sendCommand = async command => { commands.push(command); };
    const image = vm.projectImages.create('picture');
    await extension._uploadImage(image, () => {}, {showComplete: false});
    await extension._uploadImage(image, () => {}, {showComplete: true});
    await extension._uploadImage(image, () => {}, {});
    t.equal(commands[0]['show-complete'], false);
    t.notOk(Object.hasOwn(commands[1], 'show-complete'));
    t.notOk(Object.hasOwn(commands[2], 'show-complete'));
    t.equal(commands[0].data, commands[1].data, 'completion UI does not change image bytes');
});
