const test = require('tap').test;

const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');

class MockWebSocket {
    constructor () {
        this.sent = [];
        MockWebSocket.instance = this;
    }

    send (message) {
        this.sent.push(JSON.parse(message));
    }

    open () {
        this.onopen();
    }

    respond (report, value) {
        this.onmessage({data: JSON.stringify({report, value})});
    }
}

test('Tinkibot commands wait for each response before sending the next command', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;

    const extension = new TinkibotBlocks({});
    const first = extension.move({DIRECTION: 'forward', DISTANCE: 10});
    const second = extension.rotate({ROTATION: 'left', DEGREES: 90});

    MockWebSocket.instance.open();
    await Promise.resolve();
    t.strictSame(MockWebSocket.instance.sent, [
        {command: 'move', direction: 'forward', distance: 10}
    ]);

    MockWebSocket.instance.respond('move', 'moved');
    t.equal(await first, 'moved');
    await Promise.resolve();
    t.strictSame(MockWebSocket.instance.sent, [
        {command: 'move', direction: 'forward', distance: 10},
        {command: 'rotate', rotation: 'left', degrees: 90}
    ]);

    MockWebSocket.instance.respond('rotate', 'rotated');
    t.equal(await second, 'rotated');

    delete global.window;
    delete global.WebSocket;
});

test('Tinkibot reporters return the response for their own request', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;

    const extension = new TinkibotBlocks({});
    const distance = extension.measure_distance();
    MockWebSocket.instance.open();
    await Promise.resolve();
    MockWebSocket.instance.respond('measure_distance', 42);

    t.equal(await distance, 42);

    delete global.window;
    delete global.WebSocket;
});
