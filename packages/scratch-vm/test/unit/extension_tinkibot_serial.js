const {test} = require('tap');
const {ReadableStream, WritableStream} = require('stream/web');
const EventEmitter = require('events');
const FakeTimers = require('@sinonjs/fake-timers');
const {SerialTransport, SerialFramer} = require('../../src/extensions/tinkimo_tinkibot/connection/serial-transport');
const ConnectionManager = require('../../src/extensions/tinkimo_tinkibot/connection/connection-manager');

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
            if (text === 'identify\n' && this.identify) this.receive('tinki', 'modem\r\n');
            if (text.startsWith('{')) {
                const request = JSON.parse(text);
                if (request.command === 'register') {
                    this.reply(request, {robots: this.robots || [],
                        firmware: '0.1.0',
                        capabilities: this.oldFirmware ? [] : ['robot-api-v1']});
                } else if (this.onRequest) this.onRequest(request);
            }
        }});
    }
    reply (request, value) {
        this.receive(`${JSON.stringify({'request-id': request['request-id'],
            'client-uuid': request['client-uuid'],
            ...(request['bot-uuid'] ? {'bot-uuid': request['bot-uuid']} : {}),
            'status': 'OK',
            ...value})}\n`);
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
    manager.clientUuid = ID1;
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
    t.notOk(manager.apiReady);
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


test('gateway capability handshake, JSON robots, correlated concurrent requests and cleanup', async t => {
    const {manager, serial, calls} = makeManager(t);
    await manager.selectMethod('web-serial');
    const port = new Port();
    port.robots = [{'bot-uuid': ID2, 'nickname': 'lime', 'connected': true}];
    serial.ports.push(port);
    await manager.refreshPorts();
    await manager.connect();
    t.equal(manager.snapshot().status, 'connected');
    t.equal(manager.snapshot().firmware, '0.1.0');
    t.equal(manager.snapshot().robots[0]['bot-uuid'], ID2);
    t.same(port.options, {baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none'});
    t.equal(port.sent[0], 'identify\n');
    t.equal(JSON.parse(port.sent[1]).command, 'register');
    const seen = [];
    manager.on('message', value => seen.push(value));
    const a = {'request-id': ID1, 'client-uuid': ID1, 'bot-uuid': ID2, 'command': 'measure_distance'};
    const b = {...a, 'request-id': ID2, 'command': 'measure_voltage'};
    const first = manager.sendRequest(a);
    const second = manager.sendRequest(b);
    await flush();
    port.reply(a, {'client-uuid': ID2, 'command': a.command, 'result': 'wrong identity'});
    await flush();
    t.equal(manager.pendingRequests.size, 2);
    port.reply(b, {command: b.command, result: '4.2'});
    port.reply(a, {command: a.command, result: '123'});
    t.equal((await second).result, '4.2');
    t.equal((await first).result, '123');
    t.equal(seen.length, 2);
    const outstanding = manager.sendRequest({...a, 'request-id': 'pending'});
    const rejected = t.rejects(outstanding, /disconnected/);
    await manager.selectMethod('local-proxy');
    await rejected;
    t.equal(manager.pendingRequests.size, 0);
    t.equal(serial.listenerCount('disconnect'), 0);
    t.equal(port.closed, 1);
    t.same(calls, ['disconnect', 'disconnect', 'connect']);
    t.ok(port.sent.some(text => text.startsWith('{') && JSON.parse(text).command === 'end-session'));
    await manager.selectMethod('web-serial');
    await manager.connect();
    t.equal(manager.snapshot().status, 'connected');
    serial.emit('disconnect', {type: 'disconnect', target: port});
    await flush();
    t.equal(manager.snapshot().status, 'error');
    t.ok(manager.snapshot().robots.every(robot => !robot.connected));
});

test('original modem cannot silently enable control without gateway capabilities', async t => {
    const {manager} = makeManager(t);
    await manager.selectMethod('web-serial');
    await manager.addPort();
    manager.snapshot().selectedPort.oldFirmware = true;
    await manager.connect();
    t.equal(manager.snapshot().status, 'error');
    t.match(manager.snapshot().error, /robot-api-v1/);
    await t.rejects(manager.ensureConnected(), /compatible USB gateway/);
    t.notOk(manager.transport.port);
});

test('serial request timeout and stale replies do not affect a new request', async t => {
    const clock = FakeTimers.install();
    t.teardown(() => clock.uninstall());
    const {manager} = makeManager(t);
    await manager.selectMethod('web-serial');
    await manager.addPort();
    await manager.connect();
    const payload = {'request-id': ID1, 'client-uuid': ID1, 'bot-uuid': ID2, 'command': 'claim'};
    const pending = manager.sendRequest(payload);
    const rejected = t.rejects(pending, /timed out/);
    await clock.tickAsync(30001);
    await rejected;
    t.equal(manager.pendingRequests.size, 0);
    const port = manager.snapshot().selectedPort;
    port.reply(payload, {command: 'claim'});
    await flush();
    t.equal(manager.pendingRequests.size, 0);
});

test('Scratch claims, actions, bundles, sensor reporters and release use the selected serial API', async t => {
    const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
    const serial = new Serial([new Port()]);
    const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
    global.window = {isSecureContext: true};
    Object.defineProperty(global, 'navigator', {configurable: true, value: {serial}});
    global.WebSocket = class {
        constructor () {
            this.sent = []; global.window.socket = this;
        }
        send (value) {
            this.sent.push(JSON.parse(value));
        }
        close () {}
    };
    global.alert = () => {};
    t.teardown(() => {
        delete global.window;
        if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
        else delete global.navigator;
        delete global.WebSocket;
        delete global.alert;
    });
    const extension = new TinkibotBlocks({emit: () => {}, getTargetForStage: () => ({tempo: 60})});
    const proxy = global.window.socket;
    proxy.onopen();
    const manager = extension.connectionManager;
    t.teardown(() => manager.dispose());
    await manager.selectMethod('web-serial');
    const port = serial.ports[0];
    port.robots = [{'bot-uuid': ID2, 'nickname': 'lime', 'connected': true, 'claim-status': 'free'}];
    await manager.refreshPorts();
    await manager.connect();
    let rejectRelease = true;
    port.onRequest = request => {
        if (request.command === 'claim') port.reply(request, {command: 'claim', completed: false});
        else if (request.command === 'unclaim') {
            port.reply(request, {command: 'unclaim',
                completed: !rejectRelease,
                status: rejectRelease ? 'ERROR' : 'OK',
                message: 'test release rejection'});
            rejectRelease = false;
        } else if (request.cmds) port.reply(request, {rsp: request.cmds.map(item => ({...item, status: 'OK'}))});
        else {
            port.reply(request, {command: request.command,
                ...(request.command === 'measure_distance' ? {result: '123'} : {})});
        }
    };
    await extension.claimRobot(ID2);
    await flush();
    t.equal(extension._connectedRobots[0].claimState, 'free', 'an immediate OK is not physical acceptance');
    port.receive(`${JSON.stringify({'event': 'claim_accepted',
        'nickname': 'lime',
        'bot-uuid': ID2,
        'client-uuid': extension._clientUuid})}\n`);
    await flush();
    t.equal(extension._connectedRobots[0].claimState, 'paired');
    t.equal(await extension.measure_distance(), '123');
    await extension._sendCommand({command: 'forward', distance: 10});
    const results = await extension._sendBundle([
        {opcode: 'move', payload: {command: 'move', direction: 'forward', distance: 10}},
        {opcode: 'rotate', payload: {command: 'rotate', rotation: 'clockwise', degrees: 90}}
    ]);
    t.equal(results.length, 2);
    t.equal(proxy.sent.length, 0, 'no robot path leaks to the inactive WebSocket');
    t.ok(port.sent.some(text => text.startsWith('{') && JSON.parse(text).cmds));
    port.receive(`${JSON.stringify({event: 'connected_robots',
        robots: [
            {'bot-uuid': ID2,
                'nickname': 'lime',
                'client-uuid': extension._clientUuid,
                'claim-status': 'uncertain',
                'connected': true}
        ]})}\n`);
    await flush();
    t.equal(extension._connectedRobots[0].claimState, 'reserved');
    await t.rejects(extension.measure_distance(), /No Tinkibot robot is claimed/);
    await extension.claimRobot(ID2);
    await flush();
    port.receive(`${JSON.stringify({'event': 'claim_accepted',
        'nickname': 'lime',
        'bot-uuid': ID2,
        'client-uuid': extension._clientUuid})}\n`);
    await flush();
    t.equal(extension._connectedRobots[0].claimState, 'paired');
    await extension.releaseRobot(ID2);
    await flush();
    t.equal(extension._connectedRobots[0].claimState, 'paired', 'failed release retains ownership');
    t.equal(extension._pendingReleases.size, 0);
    await extension.releaseRobot(ID2);
    await flush();
    t.equal(extension._connectedRobots[0].claimState, 'free');
    await manager.selectMethod('local-proxy');
    global.window.socket.onopen();
    t.not(global.window.socket, proxy);
});

test('explicit Local Proxy retry resets the adapter and cannot interrupt serial mode', async t => {
    const {manager, calls} = makeManager(t);
    await manager.reconnectProxy();
    t.same(calls, ['disconnect', 'connect']);
    await manager.selectMethod('web-serial');
    await manager.reconnectProxy();
    t.same(calls, ['disconnect', 'connect', 'disconnect']);
});
