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
    serial.ports[0].robots = [{'bot-uuid': ID2, 'nickname': 'lime', 'connected': true, 'claim-status': 'free'}];
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
    const manager = extension.connectionManager;
    await manager.start();
    const proxy = {sent: []};
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

// These cases use the public policy entry points and real stream framing.
test('Auto defaults to a fully validated authorised USB modem without asking permission', async t => {
    const {manager, serial, calls} = makeManager(t);
    const port = new Port();
    serial.ports = [port];
    serial.requestPort = () => t.fail('automatic permission prompt');
    t.equal(manager.snapshot().preference, 'auto');
    await manager.start();
    t.equal(manager.snapshot().activeTransport, 'web-serial');
    t.equal(manager.snapshot().phase, 'usb-connected');
    t.notOk(calls.includes('connect'));
    t.same(port.sent.slice(0, 2).map(text => text.startsWith('{') ? JSON.parse(text).command : text),
        ['identify\n', 'register']);
});

test('Auto closes incompatible authorised ports before trying the next one', async t => {
    const {manager, serial} = makeManager(t);
    const wrong = new Port();
    wrong.oldFirmware = true;
    const good = new Port();
    good.open = async options => {
        t.equal(wrong.closed, 1, 'failed candidate is closed before next open');
        await Port.prototype.open.call(good, options);
    };
    serial.ports = [wrong, good];
    await manager.start();
    t.equal(manager.transport.port, good);
    await manager.activate();
    t.equal(wrong.closed, 1, 'working link is not probed again');
});

test('Auto bounds an unresponsive handshake and then connects the next port', async t => {
    const clock = FakeTimers.install();
    const {manager, serial} = makeManager(t);
    serial.ports = [new Port(false), new Port()];
    const pending = manager.start();
    await clock.tickAsync(3100);
    await pending;
    t.equal(serial.ports[0].closed, 1);
    t.equal(serial.ports[0].sent.length, 3);
    t.equal(manager.transport.port, serial.ports[1]);
    await manager.dispose();
    clock.uninstall();
});

test('Auto with no authorised modem falls back to proxy', async t => {
    const {manager, calls} = makeManager(t);
    await manager.start();
    t.ok(calls.includes('connect'));
    t.equal(manager.snapshot().preference, 'auto');
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
});

test('Unavailable proxy has bounded timeouts, three fast retries, then slow background checks', async t => {
    const clock = FakeTimers.install();
    const {manager, calls} = makeManager(t);
    manager.proxy.connect = () => {
        calls.push('connect');
        return new Promise(() => {});
    };
    const start = manager.start();
    await clock.tickAsync(2501);
    await start;
    t.equal(manager.snapshot().phase, 'retrying');
    t.match(manager.snapshot().error, /timed out/);
    await clock.tickAsync(30000);
    t.equal(calls.filter(call => call === 'connect').length, 4);
    t.equal(manager.retryCount, 3);
    await clock.tickAsync(60000);
    t.equal(calls.filter(call => call === 'connect').length, 6, 'background checks are spaced by 30 seconds');
    await manager.dispose();
    clock.uninstall();
});

test('Manual Modem never falls back to proxy', async t => {
    const {manager, calls} = makeManager(t);
    await manager.selectPreference('modem');
    t.equal(manager.snapshot().phase, 'retrying');
    t.notOk(calls.includes('connect'));
});

test('Manual Proxy never enumerates or opens serial ports', async t => {
    const {manager, serial, calls} = makeManager(t);
    serial.getPorts = () => t.fail('proxy must not probe serial');
    await manager.selectPreference('proxy');
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    t.ok(calls.includes('connect'));
    t.equal(serial.listenerCount('connect'), 0);
});

test('Manual port selection pins Auto to that port until preference changes', async t => {
    const {manager, serial, calls} = makeManager(t);
    const other = new Port();
    const selected = new Port();
    selected.oldFirmware = true;
    serial.ports = [other, selected];
    manager.selectPort(selected);
    await manager.start();
    t.same(other.sent, []);
    t.ok(calls.includes('connect'), 'Auto can fall back while keeping the preferred USB selection');
    await manager.selectPreference('auto');
    t.equal(manager.transport.port, other);
});

test('Cancelling Add USB Device preserves a working proxy', async t => {
    const {manager, serial} = makeManager(t);
    await manager.start();
    serial.cancel = true;
    await manager.addPort();
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    t.equal(manager.snapshot().error, '');
});

test('USB loss rejects outstanding work, recovers to proxy and reattaches', async t => {
    const clock = FakeTimers.install();
    const {manager, serial} = makeManager(t);
    const port = new Port();
    serial.ports = [port];
    await manager.start();
    const pending = manager.sendRequest({'request-id': ID1,
        'client-uuid': ID1,
        'bot-uuid': ID2,
        'command': 'forward'});
    const rejected = t.rejects(pending, /disconnected/);
    serial.ports = [];
    serial.emit('disconnect', {type: 'disconnect', port});
    await clock.tickAsync(1001);
    await rejected;
    t.equal(port.closed, 1);
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    serial.ports = [port];
    serial.emit('connect', {type: 'connect', port});
    await clock.tickAsync(1);
    if (manager.policyTask) await manager.policyTask;
    t.equal(manager.snapshot().activeTransport, 'web-serial');
    await manager.dispose();
    clock.uninstall();
});

test('Proxy loss marks offline and recovers according to the preference', async t => {
    const clock = FakeTimers.install();
    const {manager, calls} = makeManager(t);
    let offline = 0;
    manager.on('disconnected', () => offline++);
    await manager.start();
    manager.reportProxy('disconnected');
    t.equal(manager.snapshot().activeTransport, null);
    t.equal(offline, 1);
    await clock.tickAsync(1001);
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    t.equal(calls.filter(call => call === 'connect').length, 2);
    await manager.dispose();
    clock.uninstall();
});

test('Manual disconnect pauses automatic recovery until Retry', async t => {
    const {manager, calls} = makeManager(t);
    await manager.start();
    await manager.disconnect();
    const count = calls.length;
    await manager.activate();
    t.equal(calls.length, count);
    t.equal(manager.snapshot().activeTransport, null);
    await manager.retry();
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
});

test('Unrelated USB device never interrupts the working proxy or gets repeatedly probed', async t => {
    const {manager, serial, calls} = makeManager(t);
    await manager.start();
    const wrong = new Port();
    wrong.oldFirmware = true;
    serial.ports = [wrong];
    const count = calls.filter(call => call === 'disconnect').length;
    await manager.activate();
    await manager.activate();
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    t.equal(wrong.closed, 1);
    t.equal(calls.filter(call => call === 'disconnect').length, count);
});

test('Compatible USB waits for active command or claim before replacing proxy', async t => {
    const {manager, serial, calls} = makeManager(t);
    await manager.start();
    const port = new Port();
    serial.ports = [port];
    manager.proxy.isBusy = () => true;
    const count = calls.length;
    await manager.activate();
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    t.equal(manager.snapshot().upgradePending, true);
    t.equal(calls.length, count, 'proxy was retained');
    t.equal(port.closed, 1, 'candidate resources and session released');
    manager.proxy.isBusy = () => false;
    await manager.retry();
    t.equal(manager.snapshot().activeTransport, 'web-serial');
    t.equal(manager.snapshot().upgradePending, false);
});

test('Preference change cancels a pending probe before opening the proxy', async t => {
    const {manager, serial} = makeManager(t);
    const port = new Port(false);
    serial.ports = [port];
    const detecting = manager.start();
    await flush();
    const changing = manager.selectPreference('proxy');
    await Promise.all([detecting, changing]);
    t.equal(port.closed, 1);
    t.equal(manager.snapshot().preference, 'proxy');
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
});

test('Visibility resume retries detection, and disposal removes lifecycle listeners', async t => {
    const {manager, serial} = makeManager(t);
    const doc = new EventEmitter();
    doc.addEventListener = doc.on.bind(doc);
    doc.removeEventListener = doc.off.bind(doc);
    doc.visibilityState = 'visible';
    manager.document = doc;
    await manager.start();
    serial.ports = [new Port()];
    doc.emit('visibilitychange');
    await flush();
    if (manager.policyTask) await manager.policyTask;
    t.equal(manager.snapshot().activeTransport, 'web-serial');
    await manager.dispose();
    t.equal(doc.listenerCount('visibilitychange'), 0);
    t.equal(serial.listenerCount('connect'), 0);
});

test('Discovery refresh tolerates one missed response, never overlaps, then reconciles', async t => {
    const clock = FakeTimers.install();
    const {manager, serial} = makeManager(t);
    const port = new Port();
    port.robots = [{'bot-uuid': ID2, 'nickname': 'lime', 'connected': true, 'client-uuid': ID1}];
    serial.ports = [port];
    await manager.start();
    // Drop just the next register response at the protocol boundary.
    const reply = port.reply.bind(port);
    let drop = true;
    port.reply = (request, value) => {
        if (request.command === 'register' && drop) {
            drop = false; return;
        }
        reply(request, value);
    };
    await clock.tickAsync(10001);
    t.equal(manager.snapshot().activeTransport, 'web-serial');
    t.equal(manager.snapshot().robots[0]['client-uuid'], ID1);
    t.equal(port.sent.filter(text => text.startsWith('{') && JSON.parse(text).command === 'register').length, 2);
    port.robots[0] = {...port.robots[0], nickname: 'new lime'};
    await clock.tickAsync(5000);
    t.equal(manager.snapshot().robots[0].nickname, 'new lime');
    t.equal(manager.refreshFailures, 0);
    await manager.dispose();
    clock.uninstall();
});

test('Unchanged UUID snapshots do not emit discovery changes or flicker', async t => {
    const {manager} = makeManager(t);
    const changes = [];
    manager.on('message', message => changes.push(message));
    const a = {'bot-uuid': ID1, 'nickname': 'a'};
    const b = {'bot-uuid': ID2, 'nickname': 'b'};
    manager.acceptRobots([a, b]);
    manager.acceptRobots([{...b}, {...a}]);
    t.equal(changes.length, 1);
});

test('Live serial events reach the robot registry for join, expiry, reconnect, rename and ownership', async t => {
    const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
    const events = [];
    const extension = new TinkibotBlocks({emit: (...args) => events.push(args)});
    const manager = extension.connectionManager;
    t.teardown(() => manager.dispose());
    manager.method = 'web-serial';
    manager.apiReady = true;
    const receive = value => manager.receive({kind: 'text', text: JSON.stringify(value)});
    const robot = {'bot-uuid': ID2, 'nickname': 'lime', 'client-uuid': extension._clientUuid};
    receive({event: 'robot_connected', ...robot});
    t.equal(extension._connectedRobots[0].nickname, 'lime');
    receive({'event': 'robot_disconnected', 'bot-uuid': ID2});
    t.equal(extension._connectedRobots[0].connected, false);
    t.equal(extension._connectedRobots[0].claimedBy, extension._clientUuid, 'offline retains owner');
    receive({event: 'robot_connected', ...robot, nickname: 'renamed'});
    t.equal(extension._connectedRobots[0].nickname, 'renamed');
    t.not(extension._connectedRobots[0].connected, false);
    receive({'event': 'robot_connected', ...robot, 'client-uuid': null});
    t.equal(extension._connectedRobots[0].claimState, 'free', 'explicit null clears stale ownership');
    const count = events.filter(event => event[0] === 'TINKIBOT_CONNECTED_ROBOTS_CHANGED').length;
    receive({event: 'connected_robots', robots: [{...robot, 'client-uuid': null}]});
    const afterFirst = events.length;
    receive({event: 'connected_robots', robots: [{...robot, 'client-uuid': null}]});
    t.equal(events.length, afterFirst, 'identical snapshots leave UI alone');
    t.ok(count >= 4);
});

test('Diagnostics survive preference switches and include proxy outgoing traffic', async t => {
    const {manager} = makeManager(t);
    manager.proxy.send = () => {};
    manager.setVerbose(true);
    await manager.start();
    await manager.sendRequest({'command': 'claim', 'request-id': ID1});
    await manager.selectPreference('modem');
    t.ok(manager.snapshot().logs.some(entry => entry.kind === 'tx' && entry.value.includes('claim')));
    await manager.selectPreference('proxy');
    t.ok(manager.snapshot().logs.some(entry => entry.kind === 'tx' && entry.value.includes('claim')));
});

test('An omitted reservation stays offline until explicit Remove; reconnect preserves the UUID row', async t => {
    const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
    const extension = new TinkibotBlocks({emit: () => {}});
    t.teardown(() => extension.connectionManager.dispose());
    const robot = {'bot-uuid': ID2, 'nickname': 'lime', 'client-uuid': extension._clientUuid};
    extension._handleRobotMessage({event: 'connected_robots', robots: [robot]});
    extension._handleRobotMessage({event: 'connected_robots', robots: []});
    t.equal(extension._connectedRobots.length, 1);
    t.equal(extension._connectedRobots[0].connected, false);
    t.equal(extension._connectedRobots[0].claimedBy, extension._clientUuid);
    extension._handleRobotMessage({event: 'connected_robots', robots: [{...robot, nickname: 'renamed'}]});
    t.equal(extension._connectedRobots.length, 1);
    t.equal(extension._connectedRobots[0].nickname, 'renamed');
    extension._handleRobotMessage({'event': 'robot_removed', 'bot-uuid': ID2});
    t.equal(extension._connectedRobots.length, 0);
});

test('Proxy connection can be cancelled immediately by a preference change', async t => {
    const {manager} = makeManager(t);
    manager.proxy.connect = () => new Promise(() => {});
    const detecting = manager.start();
    await flush();
    await manager.selectPreference('modem');
    await detecting;
    t.equal(manager.snapshot().preference, 'modem');
    t.equal(manager.cancelProxyAttempt, null);
    t.equal(manager.snapshot().activeTransport, null);
});

test('Rejected release notifies UI completion even when ownership remains unchanged', async t => {
    const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
    const events = [];
    const extension = new TinkibotBlocks({emit: (...args) => events.push(args)});
    t.teardown(() => extension.connectionManager.dispose());
    extension._notifyCommandError = () => {};
    extension._setConnectedRobots([{'bot-uuid': ID2, 'nickname': 'lime', 'client-uuid': extension._clientUuid}]);
    extension._pendingReleases.set(ID2, ID1);
    const count = events.length;
    extension._handleRobotMessage({'command': 'unclaim',
        'status': 'ERROR',
        'request-id': ID1,
        'bot-uuid': ID2,
        'client-uuid': extension._clientUuid});
    t.equal(extension._connectedRobots[0].claimState, 'paired');
    t.equal(extension._pendingReleases.size, 0);
    t.equal(events.length, count + 1, 'controls can retry without rebuilding unchanged periodic snapshots');
});

test('Auto falls back to proxy after the manually selected USB modem is removed', async t => {
    const {manager, serial, calls} = makeManager(t);
    const port = new Port();
    serial.ports = [port];
    manager.selectPort(port);
    await manager.start();
    t.equal(manager.snapshot().activeTransport, 'web-serial');
    serial.ports = [];
    port.inUse = true;
    await manager.fail(new Error('USB modem stopped'));
    await manager.retry();
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    t.ok(calls.includes('connect'));
    t.equal(manager.manualPort, port, 'selected modem stays preferred when it returns');
});

test('Proxy started after the initial retry budget is discovered by a slow background check', async t => {
    const clock = FakeTimers.install();
    const {manager} = makeManager(t);
    let available = false;
    manager.proxy.connect = () => available ? Promise.resolve() : Promise.reject(new Error('Proxy not running'));
    await manager.selectPreference('proxy');
    await clock.tickAsync(15000);
    t.equal(manager.snapshot().activeTransport, null);
    available = true;
    await clock.tickAsync(30001);
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    await manager.disconnect();
    available = false;
    await clock.tickAsync(60000);
    t.equal(manager.snapshot().activeTransport, null, 'manual disconnect pauses background checks');
    await manager.dispose();
    clock.uninstall();
});

test('Real VM switches from USB to a fresh proxy socket and receives the proxy robot list', async t => {
    const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
    const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
    const serial = new Serial([new Port()]);
    global.window = {isSecureContext: true};
    Object.defineProperty(global, 'navigator', {configurable: true, value: {serial}});
    const sockets = [];
    global.WebSocket = class {
        constructor (url) {
            this.url = url;
            sockets.push(this);
        }
        close () {
            this.closed = true;
        }
    };
    const extension = new TinkibotBlocks({emit: () => {}});
    const manager = extension.connectionManager;
    t.teardown(async () => {
        await manager.dispose();
        delete global.window;
        delete global.WebSocket;
        if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
        else delete global.navigator;
    });
    await manager.start();
    t.equal(manager.snapshot().activeTransport, 'web-serial');
    await manager.disconnect();
    serial.ports = [];
    const switching = manager.selectPreference('proxy');
    await flush();
    t.equal(sockets.length, 1);
    t.equal(manager.snapshot().activeTransport, null, 'no green status before WebSocket opens');
    sockets[0].onopen();
    await switching;
    t.equal(manager.snapshot().activeTransport, 'local-proxy');
    t.equal(sockets[0].url, 'ws://127.0.0.1:9006');
    sockets[0].onmessage({data: JSON.stringify({event: 'connected_robots',
        robots: [{'bot-uuid': ID2, 'nickname': 'proxy pink'}]})});
    t.equal(extension._connectedRobots[0].nickname, 'proxy pink');
    // A stale shared ready flag must never impersonate an actual proxy socket.
    await extension._disconnectProxy();
    extension._connected = true;
    const reconnecting = extension._connectProxy();
    t.equal(sockets.length, 2, 'a real socket is required even if USB left a ready flag');
    sockets[1].onopen();
    await reconnecting;
});
