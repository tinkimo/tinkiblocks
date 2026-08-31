const test = require('tap').test;

const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
const VirtualMachine = require('../../src/virtual-machine');

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

test('Tinkibot is loaded when the virtual machine starts', t => {
    const vm = new VirtualMachine();

    t.equal(vm.extensionManager.isExtensionLoaded('tinkibot'), true);
    t.end();
});

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

test('Tinkibot volume command accepts the proxy response and releases the queue', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;

    const extension = new TinkibotBlocks({});
    const volume = extension.volume({VALUE: 5});
    const distance = extension.measure_distance();

    MockWebSocket.instance.open();
    await Promise.resolve();
    t.strictSame(MockWebSocket.instance.sent, [{command: 'set', volume: 5}]);

    MockWebSocket.instance.respond('set', 'OK set volume 5');
    t.equal(await volume, 'OK set volume 5');
    await Promise.resolve();
    t.strictSame(MockWebSocket.instance.sent, [
        {command: 'set', volume: 5},
        {command: 'measure_distance'}
    ]);

    MockWebSocket.instance.respond('measure_distance', 42);
    t.equal(await distance, 42);

    delete global.window;
    delete global.WebSocket;
});

test('Tinkibot command errors warn the user and release the queue', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;
    global.alert = message => t.equal(
        message,
        'No Tinkibot robots are connected.'
    );

    const extension = new TinkibotBlocks({});
    const sound = extension.play_sound({SOUND: 'startup'});
    const distance = extension.measure_distance();

    MockWebSocket.instance.open();
    await Promise.resolve();
    MockWebSocket.instance.respond('error', 'command_failed:no_robots_connected');
    await t.rejects(sound, {message: 'command_failed:no_robots_connected'});
    await Promise.resolve();
    t.strictSame(MockWebSocket.instance.sent, [
        {command: 'play_sound', sound: 'startup'},
        {command: 'measure_distance'}
    ]);

    MockWebSocket.instance.respond('measure_distance', 42);
    t.equal(await distance, 42);

    delete global.alert;
    delete global.window;
    delete global.WebSocket;
});

test('Tinkibot button events start event hats and filter by their menus', t => {
    global.window = {};
    global.WebSocket = MockWebSocket;

    const startedHats = [];
    const extension = new TinkibotBlocks({
        startHats: opcode => {
            startedHats.push(opcode);
            t.equal(extension.when_button_event({BUTTON: 'top-right', STATE: 'pressed'}), false);
            t.equal(extension.when_button_event({BUTTON: 'bottom-left', STATE: 'released'}), true);
        }
    });
    const eventBlock = extension.getInfo().blocks.find(block => block.opcode === 'when_button_event');

    t.equal(eventBlock.blockType, 'hat');
    t.equal(eventBlock.isEdgeActivated, false);
    t.strictSame(eventBlock.arguments.BUTTON, {
        type: 'string',
        defaultValue: 'top-left',
        menu: 'button_options'
    });
    t.strictSame(eventBlock.arguments.STATE, {
        type: 'string',
        defaultValue: 'pressed',
        menu: 'button_state_options'
    });

    MockWebSocket.instance.respond('unrelated', 'response');
    MockWebSocket.instance.onmessage({
        data: JSON.stringify({nickname: 'orange', event: 'button', button: 'bottom-left', state: 'released'})
    });
    t.strictSame(startedHats, ['tinkibot_when_button_event']);
    t.equal(extension.when_button_event({BUTTON: 'bottom-left', STATE: 'released'}), false);

    delete global.window;
    delete global.WebSocket;
    t.end();
});
