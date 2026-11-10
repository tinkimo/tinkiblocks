const {test} = require('tap');
const {ReadableStream, WritableStream} = require('stream/web');
const EventEmitter = require('events');
const FakeTimers = require('@sinonjs/fake-timers');
const {SerialTransport, SerialFramer} = require('../../src/extensions/tinkimo_tinkibot/connection/serial-transport');
const ConnectionManager = require('../../src/extensions/tinkimo_tinkibot/connection/connection-manager');
const ModemDiscovery = require('../../src/extensions/tinkimo_tinkibot/connection/modem-discovery');

const ID1 = '01234567-89ab-cdef-0123-456789abcdef';
const ID2 = '11234567-89ab-cdef-0123-456789abcdef';
const bytes = text => new TextEncoder().encode(text);
const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
};
class Port {
    constructor (identify = true) {
        this.identify = identify;
        this.sent = [];
        this.closed = 0;
    }
    getInfo () {
        return {usbVendorId: 0x303a, usbProductId: 0x1001};
    }
    async open (options) {
        if (this.inUse) throw new Error('Port is already in use');
        this.options = options;
        this.readable = new ReadableStream({start: controller => {
            this.controller = controller;
        }});
        this.writable = new WritableStream({write: data => {
            const text = new TextDecoder().decode(data);
            this.sent.push(text);
            if (text === 'identify\n' && this.identify) this.receive('BLE: status\r\ntinki', 'modem\r\n');
        }});
    }
    receive (...parts) {
        for (const part of parts) this.controller.enqueue(bytes(part));
    }
    async close () {
        if (this.readable.locked || this.writable.locked) throw new Error('Stream lock leaked');
        this.closed++;
    }
}
class Serial extends EventEmitter {
    constructor (ports = []) {
        super();
        this.ports = ports;
    }
    addEventListener (...args) {
        this.on(...args);
    }
    removeEventListener (...args) {
        this.off(...args);
    }
    async getPorts () {
        return this.ports;
    }
    async requestPort () {
        if (this.cancel) {
            const error = new Error('Cancelled');
            error.name = 'NotFoundError';
            throw error;
        }
        const port = new Port();
        this.ports.push(port);
        return port;
    }
}
const makeManager = t => {
    const serial = new Serial();
    const calls = [];
    const storage = new Map();
    const manager = new ConnectionManager({connect: () => calls.push('connect'),
        disconnect: () => calls.push('disconnect')}, {serial,
        secure: true,
        storage: {getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value)}});
    t.teardown(() => manager.dispose());
    return {manager, serial, calls, storage};
};

test('unsupported and insecure browsers preserve the proxy path', async t => {
    for (const environment of [{serial: null, secure: true}, {serial: new Serial(), secure: false}]) {
        const manager = new ConnectionManager({disconnect: () => {}, connect: () => {}}, environment);
        t.equal(manager.snapshot().method, 'local-proxy');
        await manager.selectMethod('web-serial');
        t.equal(manager.snapshot().status, 'unsupported');
        await manager.connect();
        t.notOk(manager.transport.port);
        await manager.dispose();
    }
});

test('permission picker: empty, cancellation, selection, metadata and hotplug', async t => {
    const {manager, serial} = makeManager(t);
    await manager.selectMethod('web-serial');
    await manager.refreshPorts();
    t.same(manager.snapshot().ports, []);
    serial.cancel = true;
    await manager.addPort();
    t.equal(manager.snapshot().error, '');
    t.equal(manager.snapshot().selectedPort, null);
    serial.cancel = false;
    await manager.addPort();
    t.equal(manager.snapshot().ports.length, 1);
    t.same(manager.snapshot().selectedPort.getInfo(), {usbVendorId: 0x303a, usbProductId: 0x1001});
    serial.ports.push(new Port());
    serial.emit('connect', {type: 'connect'});
    await flush();
    t.equal(manager.snapshot().ports.length, 2);
});

test('connect, handshake, multiple robots, removal, switching and reconnect', async t => {
    const {manager, serial, calls, storage} = makeManager(t);
    await manager.selectMethod('web-serial');
    await manager.addPort();
    const port = manager.snapshot().selectedPort;
    await manager.connect();
    t.equal(manager.snapshot().status, 'connected');
    t.equal(manager.snapshot().modem, 'identified');
    t.same(port.options, {baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'});
    await flush();
    t.same(port.sent, ['identify\n', 'all.get:uuid\n']);
    port.receive(`+lime.OK get uuid ${ID1.slice(0, 10)}`, `${ID1.slice(10)}\r\n+blue.OK get uuid ${ID2}\n`,
        '+tinkimodem.OK get uuid 21234567-89ab-cdef-0123-456789abcdef\n',
        'garbage\n+lime.OK get nickname Lime\n');
    await flush();
    t.equal(manager.snapshot().robots.length, 2);
    t.equal(manager.snapshot().robots.find(robot => robot.botUuid === ID1).nickname, 'Lime');
    t.ok(port.sent.includes('lime.get:nickname\n'));
    t.ok(port.sent.includes('blue.get:nickname\n'));
    serial.emit('disconnect', {type: 'disconnect', target: port});
    await flush();
    t.equal(manager.snapshot().status, 'error');
    t.ok(manager.snapshot().robots.every(robot => !robot.connected));
    t.equal(port.closed, 1);
    await manager.connect();
    t.equal(manager.snapshot().status, 'connected');
    await manager.selectMethod('local-proxy');
    t.same(calls, ['disconnect', 'disconnect', 'connect']);
    t.equal(port.closed, 2);
    t.equal(serial.listenerCount('disconnect'), 0);
    t.equal(storage.get('tinkiblocks.communicationMethod'), 'local-proxy');
});

test('port in use surfaces an error and permits retry', async t => {
    const {manager} = makeManager(t);
    await manager.selectMethod('web-serial');
    await manager.addPort();
    const port = manager.snapshot().selectedPort;
    port.inUse = true;
    await manager.connect();
    t.match(manager.snapshot().error, /already in use/);
    t.notOk(manager.transport.port);
    port.inUse = false;
    await manager.connect();
    t.equal(manager.snapshot().status, 'connected');
});

test('handshake retries exactly three times then releases resources', async t => {
    const clock = FakeTimers.install();
    t.teardown(() => clock.uninstall());
    const {manager, serial} = makeManager(t);
    await manager.selectMethod('web-serial');
    serial.ports.push(new Port(false));
    await manager.refreshPorts();
    const connection = manager.connect();
    await clock.tickAsync(3100);
    await connection;
    t.same(serial.ports[0].sent, ['identify\n', 'identify\n', 'identify\n']);
    t.equal(manager.snapshot().status, 'error');
    t.match(manager.snapshot().error, /three identify attempts/);
    t.equal(serial.ports[0].closed, 1);
});

test('manual disconnect cancels a pending handshake', async t => {
    const {manager, serial} = makeManager(t);
    await manager.selectMethod('web-serial');
    serial.ports.push(new Port(false));
    await manager.refreshPorts();
    const pending = manager.connect();
    await flush();
    await manager.disconnect();
    await pending;
    t.notOk(manager.transport.port);
    t.notOk(manager.identifyDone);
    t.equal(manager.snapshot().status, 'disconnected');
    await manager.selectMethod('local-proxy');
    t.equal(serial.listenerCount('connect'), 0);
});

test('framing: fragmented UTF-8, multiple lines, binary and overflow recovery', t => {
    const framer = new SerialFramer();
    const text = bytes('+lime.OK get nickname Citroné\r\nsecond\n');
    const split = text.indexOf(0xc3) + 1;
    t.same(framer.feed(text.slice(0, split)), []);
    t.same(framer.feed(text.slice(split)), [
        {kind: 'text', text: '+lime.OK get nickname Citroné'}, {kind: 'text', text: 'second'}
    ]);
    t.same(framer.feed(new Uint8Array([0, 8, 10, 255, 0, 111, 107, 10])),
        [{kind: 'binary', bytes: 3}, {kind: 'text', text: 'ok'}]);
    t.same(framer.feed(bytes(`${'x'.repeat(25000)}\nvalid\n`)),
        [{kind: 'overflow'}, {kind: 'text', text: 'valid'}]);
    t.end();
});

test('writes are atomic; close releases stream locks and supports reopen', async t => {
    const received = [];
    const errors = [];
    const transport = new SerialTransport({onMessage: message => received.push(message),
        onError: error => errors.push(error)});
    const port = new Port(false);
    await transport.open(port);
    await Promise.all([transport.write('one\n'), transport.write('two\n'), transport.write('three\n')]);
    t.same(port.sent, ['one\n', 'two\n', 'three\n']);
    port.receive('answer\n');
    await flush();
    t.same(received, [{kind: 'text', text: 'answer'}]);
    await Promise.all([transport.close(), transport.close()]);
    t.equal(port.closed, 1);
    await transport.open(port);
    port.controller.error(new Error('USB removed'));
    await flush();
    t.match(errors[0].message, /USB removed/);
    await transport.close();
    t.equal(port.closed, 2);
});

test('discovery expires missing robots and ignores unrelated traffic', async t => {
    let now = 0;
    let robots;
    const discovery = new ModemDiscovery({send: async () => {},
        onRobots: value => {
            robots = value;
        },
        log: () => {},
        now: () => now});
    discovery.start();
    t.teardown(() => discovery.stop());
    discovery.receive(`+lime.OK get uuid ${ID1}`);
    discovery.receive('BLE: connected');
    discovery.receive('+blue.OK get uuid invalid');
    discovery.receive('+blue.event:button left pressed');
    t.equal(robots.length, 1);
    now = 15000;
    await discovery.poll();
    t.equal(robots[0].connected, false);
    discovery.receive(`+lime.OK get uuid ${ID1}`);
    t.equal(robots[0].connected, true);
    t.equal(robots.length, 1);
});

test('bounded diagnostics redact secrets, gate raw logs, and clear', async t => {
    const {manager} = makeManager(t);
    manager.log('rx', 'not retained');
    t.equal(manager.snapshot().logs.length, 0);
    manager.setVerbose(true);
    manager.log('rx', '{"password":"private", "api-key":"private"}');
    t.notMatch(manager.snapshot().logs[0].value, /private/);
    for (let i = 0; i < 300; i++) manager.log('rx', 'x'.repeat(1500));
    t.equal(manager.snapshot().logs.length, 200);
    t.ok(manager.snapshot().logs.every(entry => entry.value.length <= 1000));
    manager.clearLog();
    t.same(manager.snapshot().logs, []);
});

test('persisted Web Serial never starts a proxy and permission denial is visible', async t => {
    const serial = new Serial();
    const manager = new ConnectionManager({connect: () => t.fail('must not connect proxy'),
        disconnect: () => {}}, {serial, secure: true, storage: {getItem: () => 'web-serial'}});
    t.teardown(() => manager.dispose());
    t.equal(manager.method, 'web-serial');
    t.equal(serial.listenerCount('disconnect'), 1);
    serial.requestPort = () => Promise.reject(new Error('Permissions Policy blocks serial'));
    await manager.addPort();
    t.match(manager.snapshot().error, /Permissions Policy/);
});

test('extension switches the real WebSocket lifecycle without routing serial control', async t => {
    const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
    const sockets = [];
    global.window = {};
    global.WebSocket = class {
        constructor () {
            sockets.push(this);
        }
        close () {
            this.closed = true;
        }
    };
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
    });
    const runtime = {emit: () => {}};
    const extension = new TinkibotBlocks(runtime);
    sockets[0].onopen();
    extension._setConnectedRobots([{'nickname': 'lime', 'bot-uuid': ID1, 'client-uuid': extension._clientUuid}]);
    await extension.connectionManager.selectMethod('web-serial');
    t.ok(sockets[0].closed);
    t.equal(sockets[0].onmessage, null);
    t.equal(extension._connected, false);
    t.equal(extension._connectedRobots[0].connected, false);
    t.equal(extension._connectedRobots[0].claimState, 'paired', 'reservation retained');
    await t.rejects(extension.connect(), /discovery only/);
    await extension.connectionManager.selectMethod('local-proxy');
    t.equal(sockets.length, 2);
    sockets[1].onopen();
    sockets[1].onmessage({data: JSON.stringify({event: 'connected_robots',
        robots: [
            {'nickname': 'lime', 'bot-uuid': ID1, 'client-uuid': extension._clientUuid}
        ]})});
    t.equal(extension._connectedRobots[0].claimState, 'paired');
    t.not(extension._connectedRobots[0].connected, false);
    await extension.connectionManager.dispose();
});

test('disconnect during port.open cannot start a stale handshake', async t => {
    const {manager, serial} = makeManager(t);
    await manager.selectMethod('web-serial');
    const port = new Port();
    const open = port.open.bind(port);
    let release;
    port.open = async options => {
        await new Promise(resolve => {
            release = resolve;
        });
        await open(options);
    };
    serial.ports.push(port);
    await manager.refreshPorts();
    const connecting = manager.connect();
    await flush();
    const closing = manager.disconnect();
    release();
    await Promise.all([connecting, closing]);
    t.equal(manager.snapshot().status, 'disconnected');
    t.same(port.sent, []);
    t.equal(port.closed, 1);
    t.notOk(manager.discovery.active);
});

test('serial write failure takes the modem offline and releases locks', async t => {
    const {manager} = makeManager(t);
    await manager.selectMethod('web-serial');
    await manager.addPort();
    await manager.connect();
    await flush();
    const writer = manager.transport.writer;
    writer.write = () => Promise.reject(new Error('Serial output failed'));
    await t.rejects(manager.send('all.get:uuid\n'), /Serial output failed/);
    t.equal(manager.snapshot().status, 'error');
    t.notOk(manager.transport.port);
});


test('UUID discovery includes unnamed robots and routes nicknames containing spaces', async t => {
    const sent = [];
    let robots;
    const discovery = new ModemDiscovery({send: async text => sent.push(text),
        onRobots: value => {
            robots = value;
        },
        log: () => {}});
    discovery.start();
    t.teardown(() => discovery.stop());
    discovery.receive(`+.OK get uuid ${ID1}`);
    discovery.receive(`+two words.OK get uuid ${ID2}`);
    await flush();
    t.equal(robots.length, 2);
    t.equal(robots[0].nickname, '');
    t.same(sent, ['all.get:uuid\n', 'two words.get:nickname\n']);
});
