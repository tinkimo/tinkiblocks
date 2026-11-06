const {test, beforeEach} = require('tap');

const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
const VirtualMachine = require('../../src/virtual-machine');
const Runtime = require('../../src/engine/runtime');
const RenderedTarget = require('../../src/sprites/rendered-target');
const Sprite = require('../../src/sprites/sprite');

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

// The extension opens a browser WebSocket on construction, including metadata tests.
beforeEach(t => {
    global.window = {};
    global.WebSocket = MockWebSocket;
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
    });
});

const makeRuntime = () => {
    const events = [];
    return {
        events,
        getTargetForStage: () => ({tempo: 60}),
        emit: (event, value) => events.push({event, value})
    };
};

const pairRobot = (extension, nickname = 'orange', botUuid = 'orange-robot-uuid') => {
    extension._setConnectedRobots([{nickname, 'bot-uuid': botUuid, 'blocks-uuid': extension._blocksUuid}]);
};

test('Tinkibot is loaded when the virtual machine starts', t => {
    const vm = new VirtualMachine();

    t.equal(vm.extensionManager.isExtensionLoaded('tinkibot'), true);
    t.equal(vm.extensionManager.isExtensionLoaded('tinkibotMovement'), true);
    t.equal(vm.extensionManager.isExtensionLoaded('tinkibotInteraction'), true);
    t.equal(vm.extensionManager.isExtensionLoaded('tinkibotSensors'), true);
    t.equal(vm.extensionManager.isExtensionLoaded('tinkibotSounds'), true);
    t.equal(vm.extensionManager.isExtensionLoaded('tinkibotDisplay'), true);
    t.equal(vm.extensionManager.isExtensionLoaded('tinkibotDance'), true);
    const categoryBlocks = Object.fromEntries(vm.runtime.getBlocksXML().map(category => [category.id, category.xml]));
    t.match(categoryBlocks.tinkibotMovement, /name="Movement"/);
    t.match(categoryBlocks.tinkibotDance, /name="Dance"/);
    t.match(categoryBlocks.tinkibotInteraction, /name="Interaction"/);
    t.match(categoryBlocks.tinkibotSensors, /name="Sensors"/);
    t.match(categoryBlocks.tinkibotSounds, /name="Sounds"/);
    t.match(categoryBlocks.tinkibotDisplay, /name="Display"/);
    t.end();
});

test('Tinkibot blocks are grouped into focused categories', t => {
    const extension = new TinkibotBlocks(makeRuntime());
    const infos = extension.getInfos();
    const categories = Object.fromEntries(infos.map(info => [info.name, info.blocks.map(block => block.opcode)]));

    t.strictSame(categories, {
        Movement: ['measure_left_encoder_count', 'measure_right_encoder_count', 'drive', 'stop', 'brake', 'move',
            'rotate', 'arc'],
        Dance: ['wiggle', 'moonwalk', 'fade'],
        Interaction: ['read_button', 'when_button_event', 'button_led'],
        Sensors: ['measure_line_sensor', 'measure_distance', 'measure_voltage'],
        Sounds: ['playNoteForBeats', 'playDrumForBeats', 'restForBeats', 'setTempo', 'changeTempo',
            'volume', 'play_sound', 'preload_audio'],
        Display: ['display_image', 'display_letter', 'display_number', 'mosaic', 'write_text', 'text_colour',
            'background_colour', 'backlight', 'preload_image', 'clear']
    });
    t.strictSame(infos.map(info => info.color1), ['#B832D0', '#A52A50', '#007F96', '#12833A', '#7950E8', '#AD5E00']);
    for (const [index, info] of infos.entries()) {
        const channels = info.color1.match(/[a-f\d]{2}/gi).map(channel => parseInt(channel, 16) / 255)
            .map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
        const luminance = (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
        t.equal(info.blockIconURI, info.menuIconURI);
        t.match(decodeURIComponent(info.menuIconURI), new RegExp(info.color1, 'i'));
        t.match(decodeURIComponent(info.menuIconURI), new RegExp(`<title>${info.name}</title>`));
        t.not(info.menuIconURI, infos[(index + 1) % infos.length].menuIconURI);
        t.ok(1.05 / (luminance + 0.05) >= 4.5, `${info.name} remains legible with white text`);
    }
    t.end();
});

test('Every Tinkibot block is assigned to exactly one category', t => {
    const extension = new TinkibotBlocks(makeRuntime());
    const allOpcodes = extension._getCombinedInfo().blocks
        .filter(block => block !== '---')
        .map(block => block.opcode)
        .sort();
    const categorizedOpcodes = extension.getInfos()
        .flatMap(info => info.blocks.map(block => block.opcode))
        .sort();

    t.strictSame(categorizedOpcodes, allOpcodes);
    t.end();
});

test('Tinkibot backlight is a Display command with a numeric input defaulting to 80', t => {
    const extension = new TinkibotBlocks(makeRuntime());
    const display = extension.getInfos().find(info => info.id === 'tinkibotDisplay');
    const block = display.blocks.find(info => info.opcode === 'backlight');

    t.match(block, {
        blockType: 'command',
        text: 'Set backlight to [INTENSITY]',
        arguments: {INTENSITY: {type: 'number', defaultValue: 80}}
    });
    const vm = new VirtualMachine();
    const category = vm.runtime.getBlocksXML().find(info => info.id === 'tinkibotDisplay');
    t.match(category.xml, /type="tinkibotDisplay_backlight"/);
    t.match(category.xml, /<value name="INTENSITY"><shadow type="math_number"><field name="NUM">80<\/field>/);
    t.end();
});

test('Tinkibot backlight clamps numeric and variable values and waits for the set response', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
    });

    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    MockWebSocket.instance.open();
    const cases = [[80, 80], ['42', 42], [0, 0], [100, 100], [-10, 0], [120, 100], [37.5, 37.5], ['invalid', 0]];
    for (const [input, expected] of cases) {
        const result = extension.backlight({INTENSITY: input});
        await new Promise(resolve => setImmediate(resolve));
        t.strictSame(MockWebSocket.instance.sent.at(-1), {
            'command': 'set',
            'backlight': expected,
            'nickname': 'orange',
            'bot-uuid': 'orange-robot-uuid',
            'blocks-uuid': extension._blocksUuid
        });
        MockWebSocket.instance.respond('set', 'OK');
        t.equal(await result, 'OK');
    }
});

test('Tinkibot commands wait for each response before sending the next command', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;

    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    const first = extension.move({DIRECTION: 'forward', DISTANCE: 10});
    const second = extension.rotate({ROTATION: 'left', DEGREES: 90});

    MockWebSocket.instance.open();
    await new Promise(resolve => setImmediate(resolve));
    t.strictSame(MockWebSocket.instance.sent, [
        {command: 'move', direction: 'forward', distance: 10, nickname: 'orange',
            'bot-uuid': 'orange-robot-uuid', 'blocks-uuid': extension._blocksUuid}
    ]);

    MockWebSocket.instance.respond('move', 'moved');
    t.equal(await first, 'moved');
    await new Promise(resolve => setImmediate(resolve));
    t.strictSame(MockWebSocket.instance.sent, [
        {command: 'move', direction: 'forward', distance: 10, nickname: 'orange',
            'bot-uuid': 'orange-robot-uuid', 'blocks-uuid': extension._blocksUuid},
        {command: 'rotate', rotation: 'left', degrees: 90, nickname: 'orange',
            'bot-uuid': 'orange-robot-uuid', 'blocks-uuid': extension._blocksUuid}
    ]);

    MockWebSocket.instance.respond('rotate', 'rotated');
    t.equal(await second, 'rotated');

    delete global.window;
    delete global.WebSocket;
});

test('Tinkibot reporters return the response for their own request', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;

    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    const distance = extension.measure_distance();
    MockWebSocket.instance.open();
    await new Promise(resolve => setImmediate(resolve));
    MockWebSocket.instance.respond('measure_distance', 42);

    t.equal(await distance, 42);

    delete global.window;
    delete global.WebSocket;
});

test('consecutive notes ignore delayed completions from another request', async t => {
    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    const first = extension.playNoteForBeats({NOTE: 69, BEATS: 0.1});
    const second = extension.playNoteForBeats({NOTE: 69, BEATS: 0.1});
    const socket = MockWebSocket.instance;
    socket.open();
    await new Promise(resolve => setImmediate(resolve));
    const firstId = socket.sent[0].requestId;
    t.type(firstId, 'string');
    const reply = (requestId, value = 'OK play') => socket.onmessage({
        data: JSON.stringify({report: 'play_note', requestId, value})
    });
    reply('old-request');
    await new Promise(resolve => setImmediate(resolve));
    t.equal(socket.sent.length, 1, 'a stale completion does not release the command queue');
    reply(firstId);
    t.equal(typeof (await first), 'undefined', 'commands do not open reporter bubbles on the canvas');
    await new Promise(resolve => setImmediate(resolve));
    const secondId = socket.sent[1].requestId;
    t.not(firstId, secondId);
    let finished = false;
    second.then(() => {
        finished = true;
    });
    reply(firstId);
    await new Promise(resolve => setImmediate(resolve));
    t.equal(finished, false, 'a duplicate completion cannot finish the next identical note');
    reply(secondId);
    await second;
});

test('drums and notes share the correlated playback queue, including zero-beat hits', async t => {
    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    const drum = extension.playDrumForBeats({DRUM: 1, BEATS: 0});
    const note = extension.playNoteForBeats({NOTE: 60, BEATS: 0.25});
    const socket = MockWebSocket.instance;
    socket.open();
    await new Promise(resolve => setImmediate(resolve));
    t.equal(socket.sent.length, 1);
    t.match(socket.sent[0], {command: 'play_drum', drum: 1, duration: 0, requestId: String});
    socket.onmessage({data: JSON.stringify({
        report: 'play_note', value: 'OK play', requestId: socket.sent[0].requestId
    })});
    await new Promise(resolve => setImmediate(resolve));
    t.equal(socket.sent.length, 1, 'a note reply cannot finish a drum wait');
    socket.onmessage({data: JSON.stringify({
        report: 'play_drum', value: 'OK drum', requestId: socket.sent[0].requestId
    })});
    await drum;
    await new Promise(resolve => setImmediate(resolve));
    t.match(socket.sent[1], {command: 'play_note', note: 60});
    socket.onmessage({data: JSON.stringify({
        report: 'play_note', value: 'OK play', requestId: socket.sent[1].requestId
    })});
    await note;
});

test('a busy note fails and stops the originating script instead of skipping notes', async t => {
    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    const alerts = [];
    global.alert = message => alerts.push(message);
    t.teardown(() => {
        delete global.alert;
    });
    let stopped = false;
    const thread = {};
    const sequencer = {retireThread: target => {
        stopped = target === thread;
    }};
    const note = extension.playNoteForBeats({NOTE: 67, BEATS: 0.4}, {thread, sequencer});
    const rejected = t.rejects(note, {message: 'ERR busy'});
    const socket = MockWebSocket.instance;
    socket.open();
    await new Promise(resolve => setImmediate(resolve));
    socket.onmessage({data: JSON.stringify({
        report: 'play_note', value: 'ERR busy', requestId: socket.sent[0].requestId
    })});
    await rejected;
    t.equal(stopped, true);
    t.match(alerts, ['Tinkibot command failed: ERR busy']);
});

test('VM redraw steps wait for note completion and retire a tune after a robot error', async t => {
    const runtime = new Runtime();
    runtime.currentStepTime = 1000 / 30;
    const target = new RenderedTarget(new Sprite(null, runtime), runtime);
    runtime.targets.push(target);
    const extension = new TinkibotBlocks(runtime);
    pairRobot(extension);
    const socket = MockWebSocket.instance;
    socket.open();
    global.alert = () => {};
    t.teardown(() => {
        delete global.alert;
    });
    let finished = false;
    runtime._primitives.test_note = (args, util) => extension.playNoteForBeats({NOTE: 69, BEATS: 0.1}, util);
    runtime._primitives.test_finished = () => {
        finished = true;
    };
    for (const [id, opcode, next] of [
        ['first', 'test_note', 'second'], ['second', 'test_note', 'finished'],
        ['finished', 'test_finished', null]
    ]) {
        target.blocks.createBlock({id, opcode, next, parent: null, inputs: {}, fields: {}, topLevel: id === 'first'});
    }
    runtime._pushThread('first', target);
    for (let frame = 0; frame < 20; frame++) {
        target.blocks.resetCache();
        runtime.sequencer.stepThreads();
        await new Promise(resolve => setImmediate(resolve));
    }
    t.equal(socket.sent.length, 1, 'canvas/cache refreshes cannot enqueue another note');
    socket.onmessage({data: JSON.stringify({
        report: 'play_note', value: 'OK play', requestId: socket.sent[0].requestId
    })});
    await new Promise(resolve => setImmediate(resolve));
    runtime.sequencer.stepThreads();
    await new Promise(resolve => setImmediate(resolve));
    t.equal(socket.sent.length, 2, 'the next note starts after playback completion');
    socket.onmessage({data: JSON.stringify({
        report: 'play_note', value: 'ERR busy', requestId: socket.sent[1].requestId
    })});
    await new Promise(resolve => setImmediate(resolve));
    runtime.sequencer.stepThreads();
    t.equal(finished, false, 'a failed note cannot advance the tune');
    t.equal(runtime.threads.length, 0);
});

test('Tinkibot tracks robot connection events', t => {
    global.window = {
        localStorage: {
            getItem: () => 'student-environment-id',
            setItem: () => {}
        }
    };
    global.WebSocket = MockWebSocket;
    const alerts = [];
    global.alert = message => alerts.push(message);
    const runtime = makeRuntime();
    const extension = new TinkibotBlocks(runtime);
    t.equal(extension.runtime, runtime);

    MockWebSocket.instance.onmessage({
        data: JSON.stringify({
            event: 'connected_robots',
            nicknames: [
                {nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'},
                {
                    nickname: 'blue',
                    'bot-uuid': 'blue-robot-uuid',
                    'blocks-uuid': 'another-environment-id'
                },
                {nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'}
            ]
        })
    });
    t.strictSame(runtime.tinkibotConnectedRobots, [
        {nickname: 'orange', botUuid: 'orange-robot-uuid', claimedBy: null, claimState: 'free'},
        {
            nickname: 'blue',
            botUuid: 'blue-robot-uuid',
            claimedBy: 'another-environment-id',
            claimState: 'claimed'
        }
    ]);
    t.strictSame(alerts, [], 'the initial list does not produce a series of pop-ups');
    runtime.releaseTinkibotRobot('blue-robot-uuid');
    t.strictSame(MockWebSocket.instance.sent, [], 'a robot claimed by someone else cannot be released');

    MockWebSocket.instance.onmessage({
        data: JSON.stringify({event: 'robot_connected', nickname: 'green', 'bot-uuid': 'green-robot-uuid'})
    });
    t.strictSame(runtime.tinkibotConnectedRobots, [
        {nickname: 'orange', botUuid: 'orange-robot-uuid', claimedBy: null, claimState: 'free'},
        {
            nickname: 'blue',
            botUuid: 'blue-robot-uuid',
            claimedBy: 'another-environment-id',
            claimState: 'claimed'
        },
        {nickname: 'green', botUuid: 'green-robot-uuid', claimedBy: null, claimState: 'free'}
    ]);
    t.strictSame(alerts, [], 'connecting a robot does not open an alert');

    MockWebSocket.instance.onmessage({
        data: JSON.stringify({event: 'robot_disconnected', nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'})
    });
    t.strictSame(runtime.tinkibotConnectedRobots, [
        {
            nickname: 'blue',
            botUuid: 'blue-robot-uuid',
            claimedBy: 'another-environment-id',
            claimState: 'claimed'
        },
        {nickname: 'green', botUuid: 'green-robot-uuid', claimedBy: null, claimState: 'free'}
    ]);
    t.strictSame(alerts, ['orange has disconnected.']);
    t.equal(
        runtime.events.filter(({event}) => event === 'TINKIBOT_ROBOT_CONNECTION_CHANGED').length,
        2
    );

    delete global.alert;
    delete global.window;
    delete global.WebSocket;
    t.end();
});

test('Tinkibot claims and releases a robot with the persistent blocks UUID', async t => {
    const storedValues = new Map();
    const alerts = [];
    global.window = {
        localStorage: {
            getItem: key => storedValues.get(key) || null,
            setItem: (key, value) => storedValues.set(key, value)
        }
    };
    global.WebSocket = MockWebSocket;
    global.alert = message => alerts.push(message);
    const runtime = makeRuntime();
    const extension = new TinkibotBlocks(runtime);
    t.equal(extension.runtime, runtime);
    MockWebSocket.instance.open();
    MockWebSocket.instance.onmessage({data: JSON.stringify({
        event: 'connected_robots',
        nicknames: [{nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'}]
    })});

    await runtime.claimTinkibotRobot('orange-robot-uuid');
    const blocksUuid = storedValues.get('tinkiblocks.blocksUuid');
    t.match(blocksUuid, /^[0-9a-f-]{36}$/);
    t.strictSame(MockWebSocket.instance.sent, [{
        command: 'claim',
        nickname: 'orange',
        'bot-uuid': 'orange-robot-uuid',
        'blocks-uuid': blocksUuid
    }]);

    MockWebSocket.instance.onmessage({data: JSON.stringify({
        event: 'claim_accepted',
        nickname: 'orange',
        'bot-uuid': 'orange-robot-uuid',
        'blocks-uuid': 'different-blocks-uuid'
    })});
    t.equal(runtime.tinkibotConnectedRobots[0].claimState, 'free', 'mismatched claims are ignored');

    MockWebSocket.instance.onmessage({data: JSON.stringify({
        event: 'claim_accepted',
        nickname: 'orange',
        'bot-uuid': 'orange-robot-uuid',
        'blocks-uuid': blocksUuid
    })});
    t.strictSame(runtime.tinkibotConnectedRobots, [{
        nickname: 'orange',
        botUuid: 'orange-robot-uuid',
        claimedBy: blocksUuid,
        claimState: 'paired'
    }]);

    await runtime.releaseTinkibotRobot('orange-robot-uuid');
    t.strictSame(MockWebSocket.instance.sent[1], {
        command: 'unclaim',
        nickname: 'orange',
        'bot-uuid': 'orange-robot-uuid',
        'blocks-uuid': blocksUuid
    });
    t.strictSame(runtime.tinkibotConnectedRobots, [{
        nickname: 'orange',
        botUuid: 'orange-robot-uuid',
        claimedBy: null,
        claimState: 'free'
    }]);

    await runtime.claimTinkibotRobot('orange-robot-uuid');
    MockWebSocket.instance.onmessage({data: JSON.stringify({
        event: 'claim_rejected',
        nickname: 'orange',
        'bot-uuid': 'orange-robot-uuid',
        'blocks-uuid': blocksUuid
    })});
    t.equal(runtime.tinkibotConnectedRobots[0].claimState, 'free');

    await runtime.claimTinkibotRobot('orange-robot-uuid');
    MockWebSocket.instance.onmessage({data: JSON.stringify({
        report: 'claim',
        value: 'The robot has been claimed by another user',
        nickname: 'orange',
        'bot-uuid': 'orange-robot-uuid',
        'blocks-uuid': blocksUuid,
        timestamp: 1788206612195
    })});
    t.equal(runtime.tinkibotConnectedRobots[0].claimState, 'claimed');
    t.strictSame(alerts, [
        'orange could not be claimed because another user has already claimed it.'
    ]);

    delete global.alert;
    delete global.window;
    delete global.WebSocket;
    t.end();
});

test('Tinkibot allows only one robot claim at a time', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;
    const runtime = makeRuntime();
    const extension = new TinkibotBlocks(runtime);
    MockWebSocket.instance.open();
    extension._setConnectedRobots([
        {nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'},
        {nickname: 'blue', 'bot-uuid': 'blue-robot-uuid'}
    ]);

    await runtime.claimTinkibotRobot('orange-robot-uuid');
    await runtime.claimTinkibotRobot('blue-robot-uuid');
    t.equal(MockWebSocket.instance.sent.length, 1, 'a pending claim prevents another claim');

    MockWebSocket.instance.onmessage({data: JSON.stringify({
        event: 'claim_accepted', nickname: 'orange', 'bot-uuid': 'orange-robot-uuid',
        'blocks-uuid': extension._blocksUuid
    })});
    await runtime.claimTinkibotRobot('blue-robot-uuid');
    t.equal(MockWebSocket.instance.sent.length, 1, 'a paired robot prevents another claim');

    delete global.window;
    delete global.WebSocket;
    t.end();
});

test('Tinkibot blocks require a claimed robot', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;
    const alerts = [];
    global.alert = message => alerts.push(message);
    const extension = new TinkibotBlocks(makeRuntime());

    await t.rejects(extension.measure_voltage(), {message: 'No Tinkibot robot is claimed'});
    t.strictSame(MockWebSocket.instance.sent, []);
    t.strictSame(alerts, ['Claim a robot from the Connections tab before using Tinkibot blocks.']);

    delete global.alert;
    delete global.window;
    delete global.WebSocket;
});

test('Tinkibot volume command accepts the proxy response and releases the queue', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;

    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    const volume = extension.volume({VALUE: 5});
    const distance = extension.measure_distance();

    MockWebSocket.instance.open();
    await new Promise(resolve => setImmediate(resolve));
    t.match(MockWebSocket.instance.sent, [{command: 'set', volume: 5, nickname: 'orange',
        'bot-uuid': 'orange-robot-uuid', 'blocks-uuid': extension._blocksUuid}]);

    MockWebSocket.instance.respond('set', 'OK set volume 5');
    t.equal(await volume, 'OK set volume 5');
    await new Promise(resolve => setImmediate(resolve));
    t.match(MockWebSocket.instance.sent, [
        {command: 'set', volume: 5, nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'},
        {command: 'measure_distance', nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'}
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

    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    const sound = extension.play_sound({SOUND: 'startup'});
    const distance = extension.measure_distance();

    MockWebSocket.instance.open();
    await new Promise(resolve => setImmediate(resolve));
    MockWebSocket.instance.respond('error', 'command_failed:no_robots_connected');
    await t.rejects(sound, {message: 'command_failed:no_robots_connected'});
    await new Promise(resolve => setImmediate(resolve));
    t.match(MockWebSocket.instance.sent, [
        {command: 'play_sound', sound: 'startup', nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'},
        {command: 'measure_distance', nickname: 'orange', 'bot-uuid': 'orange-robot-uuid'}
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
    const interaction = extension.getInfos().find(info => info.id === 'tinkibotInteraction');
    const eventBlock = interaction.blocks.find(block => block.opcode === 'when_button_event');

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
    t.strictSame(startedHats, ['tinkibotInteraction_when_button_event']);
    t.equal(extension.when_button_event({BUTTON: 'bottom-left', STATE: 'released'}), false);

    delete global.window;
    delete global.WebSocket;
    t.end();
});

test('Tinkibot preload blocks provide combined media menus', t => {
    const infos = new TinkibotBlocks(makeRuntime()).getInfos();
    const display = infos.find(info => info.id === 'tinkibotDisplay');
    const sounds = infos.find(info => info.id === 'tinkibotSounds');
    t.match(display.blocks.find(block => block.opcode === 'preload_image'), {
        blockType: 'command',
        text: 'preload [IMAGE] for use',
        arguments: {IMAGE: {type: 'string', menu: 'preload_image_options'}}
    });
    t.match(sounds.blocks.find(block => block.opcode === 'preload_audio'), {
        blockType: 'command',
        text: 'preload [AUDIO] for use',
        arguments: {AUDIO: {type: 'string', menu: 'sound_options'}}
    });
    const menus = display.menus;
    t.strictSame(menus.preload_image_options.items, [...new Set([
        ...menus.image_options.items, ...menus.letter_options.items,
        ...menus.number_options.items, ...menus.mosaic_options.items
    ])]);
    const vm = new VirtualMachine();
    const categories = Object.fromEntries(vm.runtime.getBlocksXML().map(info => [info.id, info.xml]));
    t.match(categories.tinkibotDisplay, /type="tinkibotDisplay_preload_image"/);
    t.match(categories.tinkibotSounds, /type="tinkibotSounds_preload_audio"/);
    t.end();
});

test('Tinkibot preloads media through the proxy and waits for its response', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
    });
    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    MockWebSocket.instance.open();
    for (const [method, argument, media, name] of [
        ['preload_image', 'IMAGE', 'image', 'happy'],
        ['preload_image', 'IMAGE', 'image', 'robot_logo'],
        ['preload_audio', 'AUDIO', 'audio', 'beep'],
        ['preload_audio', 'AUDIO', 'audio', 'dance']
    ]) {
        const command = `preload:${media}`;
        const result = extension[method]({[argument]: name});
        await new Promise(resolve => setImmediate(resolve));
        t.strictSame(MockWebSocket.instance.sent.at(-1), {
            'command': command,
            'file': name,
            'nickname': 'orange',
            'bot-uuid': 'orange-robot-uuid',
            'blocks-uuid': extension._blocksUuid
        });
        MockWebSocket.instance.respond('unrelated', 'ignore');
        t.equal(extension._pendingResponse.command, command);
        MockWebSocket.instance.respond(command, 'OK');
        t.equal(await result, 'OK');
    }
});


test('Dance fade uses dropdowns and the standard correlated command payload', async t => {
    global.window = {};
    global.WebSocket = MockWebSocket;
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
    });
    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    MockWebSocket.instance.open();
    const dance = extension.getInfos().find(info => info.id === 'tinkibotDance');
    t.ok(dance);
    const block = dance.blocks.find(info => info.opcode === 'fade');
    t.equal(block.text, 'fade [TARGET] [DIRECTION] [SPEED]');
    t.strictSame(dance.menus.fade_speed, {acceptReporters: true, items: ['slow', 'medium', 'fast']});
    t.equal(block.arguments.SPEED.defaultValue, 'medium');
    t.strictSame(dance.menus.fade_target.items, ['LEDs', 'display']);
    t.strictSame(dance.menus.fade_direction.items, ['in', 'out']);
    for (const target of ['LEDs', 'display']) {
        for (const direction of ['in', 'out']) {
            const result = extension.fade({TARGET: target, DIRECTION: direction});
            await new Promise(resolve => setImmediate(resolve));
            t.strictSame(MockWebSocket.instance.sent.at(-1), {
                'command': 'fade',
                'speed': 'medium',
                target,
                direction,
                'nickname': 'orange',
                'bot-uuid': 'orange-robot-uuid',
                'blocks-uuid': extension._blocksUuid
            });
            MockWebSocket.instance.respond('fade', 'OK fade');
            t.equal(await result, 'OK fade');
        }
    }
});


test('Fade forwards preset and numeric reporter values without losing the input', async t => {
    const extension = new TinkibotBlocks(makeRuntime());
    pairRobot(extension);
    MockWebSocket.instance.open();
    for (const speed of ['slow', 'medium', 'fast', 0.75, '2', 'custom']) {
        const result = extension.fade({TARGET: 'LEDs', DIRECTION: 'in', SPEED: speed});
        await new Promise(resolve => setImmediate(resolve));
        t.equal(MockWebSocket.instance.sent.at(-1).speed, speed);
        MockWebSocket.instance.respond('fade', 'OK fade');
        t.equal(await result, 'OK fade');
    }
});
