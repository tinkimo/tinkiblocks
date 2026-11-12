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
    images.rename(first.id, 'my_picture');
    t.throws(() => images.rename(second.id, 'MY_PICTURE'), /already exists/);
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
    t.equal(encoded.length, 160 * 118 * 2);
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


test('image menus update from the current project without replacing built-in entries', t => {
    const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
    const runtime = {emit: () => {}, tinkibotImages: new ImageCollection()};
    const extension = new Tinkibot(runtime);
    extension.getInfos();
    t.ok(extension.getProjectImageOptions().includes('logo'));
    const image = runtime.tinkibotImages.create('rainbow');
    t.ok(extension.getProjectImageOptions().includes('rainbow'));
    t.ok(extension.getProjectPreloadImageOptions().includes('rainbow'));
    runtime.tinkibotImages.rename(image.id, 'sunshine');
    t.notOk(extension.getProjectImageOptions().includes('rainbow'));
    t.ok(extension.getProjectImageOptions().includes('sunshine'));
    t.end();
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
    manager.send = async line => {
        t.match(line, /^lime\.tfp:open [a-f0-9]{16} 512\n$/);
        manager.uploadChannel.text(`TFP1-MODEM ${line.split(' ')[1]} 244`);
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
    manager.send = async () => {
        throw new Error('Modem unavailable');
    };
    const before = wires.length;
    await t.rejects(upload(manager, {nickname: 'lime', botUuid: 'robot'}, 'image1.rgb565',
        new Uint8Array(300)), /Modem unavailable/);
    t.equal(wires.length, before, 'no binary is sent before positive modem negotiation');
    t.equal(manager.uploadChannel, null);
});
