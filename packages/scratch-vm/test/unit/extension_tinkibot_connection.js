const {test, beforeEach} = require('tap');
const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
const VirtualMachine = require('../../src/virtual-machine');

let logs;
let sockets;
beforeEach(t => {
    logs = [];
    sockets = [];
    const capturedLogs = logs;
    for (const level of ['info', 'warn', 'debug']) {
        const original = console[level];
        console[level] = (event, context) => capturedLogs.push({level, event, context});
        t.teardown(() => {
            console[level] = original;
        });
    }
    global.window = {
        location: {origin: 'https://tinkimo.com'},
        isSecureContext: true,
        document: {readyState: 'loading', visibilityState: 'visible'}
    };
    global.window.top = {};
    global.alert = () => {};
    global.WebSocket = class {
        constructor (...args) {
            this.args = args;
            this.readyState = 0;
            sockets.push(this);
        }
        open () {
            this.readyState = 1;
            this.onopen();
        }
        close () {
            this.readyState = 3;
            this.onclose({code: 1006, reason: '', wasClean: false});
        }
    };
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
        delete global.alert;
    });
});
const createExtension = () => new Tinkibot({getTargetForStage: () => ({tempo: 60}), emit: () => {}});
const event = name => logs.filter(entry => entry.event === `Tinkibot WebSocket: ${name}`);

test('initial connection records document context and uses the manual connection parameters', async t => {
    const extension = createExtension();
    t.same(sockets[0].args, ['ws://127.0.0.1:9006']);
    t.match(event('attempt started')[0], {context: {
        origin: 'https://tinkimo.com',
        secureContext: true,
        framed: true,
        documentReadyState: 'loading',
        state: 'CONNECTING'
    }});
    sockets[0].open();
    await extension.connect();
    t.match(event('opened')[0], {context: {state: 'OPEN'}});
    t.equal(event('opened')[0].context.attempt, event('attempt started')[0].context.attempt);
});

test('simultaneous requests share a handshake and report a duplicate only once', async t => {
    const extension = createExtension();
    const first = extension.connect();
    t.equal(extension.connect(), first);
    t.equal(sockets.length, 1);
    t.equal(event('duplicate attempt prevented').length, 1);
    sockets[0].open();
    await first;
});

test('failure and close before open record the same attempt, state and close details', t => {
    createExtension();
    sockets[0].onerror({type: 'error'});
    sockets[0].close();
    t.match(event('failed')[0], {context: {state: 'CONNECTING'}});
    t.match(event('closed')[0], {context: {state: 'CLOSED',
        code: 1006,
        reason: '',
        wasClean: false,
        opened: false}});
    t.equal(event('failed')[0].context.attempt, event('closed')[0].context.attempt);
    t.end();
});

test('unexpected close and subsequent explicit retry have distinct attempt IDs', async t => {
    const extension = createExtension();
    sockets[0].open();
    sockets[0].close();
    t.match(event('closed')[0], {context: {opened: true}});
    const retry = extension.connect();
    t.equal(sockets.length, 2);
    t.not(event('attempt started')[0].context.attempt, event('attempt started')[1].context.attempt);
    sockets[1].open();
    await retry;
});

test('VM reinitialisation exposes concurrent sockets and keeps event attribution', t => {
    const first = new VirtualMachine();
    const second = new VirtualMachine();
    t.teardown(() => {
        first.quit(); second.quit();
    });
    t.equal(sockets.length, 2);
    t.match(event('attempt started')[1], {context: {previousSocketState: 'CONNECTING'}});
    t.not(event('attempt started')[0].context.instance, event('attempt started')[1].context.instance);
    sockets[0].open();
    t.equal(event('opened')[0].context.instance, event('attempt started')[0].context.instance);
    t.match(event('opened')[0], {context: {isCurrentSocket: false}});
    t.end();
});

test('synchronous browser rejection is logged and retains its exception', t => {
    const error = new Error('Blocked by browser policy');
    error.name = 'SecurityError';
    global.WebSocket = class {
        constructor () {
            throw error;
        }
    };
    t.throws(createExtension, error);
    t.match(event('failed')[0], {context: {errorName: 'SecurityError', phase: 'constructor'}});
    t.end();
});

test('duplicate attribution follows its own socket after another instance replaces the global', t => {
    const first = createExtension();
    createExtension();
    first.connect();
    t.match(event('duplicate attempt prevented')[0], {context: {
        instance: event('attempt started')[0].context.instance,
        state: 'CONNECTING',
        isCurrentSocket: false
    }});
    t.end();
});

test('diagnostics report a closing socket without changing its state', t => {
    createExtension();
    sockets[0].readyState = 2;
    sockets[0].onerror();
    t.match(event('failed')[0], {context: {state: 'CLOSING'}});
    t.equal(sockets[0].readyState, 2);
    t.end();
});
