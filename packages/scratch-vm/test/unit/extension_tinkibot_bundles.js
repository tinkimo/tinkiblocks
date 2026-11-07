const {test, beforeEach} = require('tap');
const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
const Runtime = require('../../src/engine/runtime');
const RenderedTarget = require('../../src/sprites/rendered-target');
const Sprite = require('../../src/sprites/sprite');

class Socket {
    constructor () {
        this.sent = [];
        Socket.instance = this;
    }
    send (value) {
        this.sent.push(JSON.parse(value));
    }
    respond (value) {
        this.onmessage({data: typeof value === 'string' ? value : JSON.stringify(value)});
    }
}

beforeEach(t => {
    global.window = {};
    global.WebSocket = Socket;
    global.alert = () => {};
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
        delete global.alert;
    });
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const setup = () => {
    const runtime = new Runtime();
    runtime.currentStepTime = 1000 / 30;
    const target = new RenderedTarget(new Sprite(null, runtime), runtime);
    target.isStage = true;
    target.tempo = 60;
    runtime.targets.push(target);
    const extension = new Tinkibot(runtime);
    extension._setConnectedRobots([{
        'nickname': 'lime', 'bot-uuid': 'robot-lime', 'blocks-uuid': extension._blocksUuid
    }]);
    Socket.instance.onopen();
    for (const info of extension.getInfos()) {
        for (const block of info.blocks) {
            runtime._primitives[`${info.id}_${block.opcode}`] = (args, util) =>
                extension[block.opcode](args, util);
        }
    }
    const action = (id, opcode, args = {}, next = null, parent = null) => {
        target.blocks.createBlock({
            id,
            opcode,
            next,
            parent,
            topLevel: !parent,
            shadow: false,
            inputs: {},
            fields: Object.fromEntries(Object.entries(args).map(([name, value]) =>
                [name, {name, value}]))
        });
    };
    const step = async () => {
        runtime.redrawRequested = false;
        runtime.sequencer.stepThreads();
        await tick();
    };
    return {runtime, target, extension, action, step, socket: Socket.instance};
};

const succeed = request => ({requestId: request.requestId,
    rsp: request.cmds.map(({cmd}) => ({cmd, status: 'OK', msg: 'OK original\n'}))});

test('four contiguous robot actions send one envelope and execute exactly once', async t => {
    const h = setup();
    h.action('sound', 'tinkibotSounds_play_sound', {SOUND: 'startup'}, 'move');
    h.action('move', 'tinkibotMovement_move', {DIRECTION: 'forward', DISTANCE: 100}, 'image', 'sound');
    h.action('image', 'tinkibotDisplay_display_image', {IMAGE: 'happy'}, 'turn', 'move');
    h.action('turn', 'tinkibotMovement_rotate', {ROTATION: 'clockwise', DEGREES: 90}, 'end', 'image');
    h.action('end', 'test_end', {}, null, 'turn');
    let ended = false;
    h.runtime._primitives.test_end = () => {
        ended = true;
    };
    h.runtime._pushThread('sound', h.target);
    await h.step();
    t.equal(h.socket.sent.length, 1);
    t.same(h.socket.sent[0].cmds, [
        {cmd: 'lime.play:startup'}, {cmd: 'lime.forward:100'},
        {cmd: 'lime.display:happy'}, {cmd: 'lime.rotate:90'}
    ]);
    if (!h.socket.sent[0].cmds) return;
    t.notOk(ended);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.ok(ended);
    t.equal(h.socket.sent.length, 1, 'normal VM traversal does not resend bundled actions');
    t.equal(h.runtime.threads.length, 0);
});

const pair = (h, prefix, next = null, parent = null) => {
    h.action(`${prefix}move`, 'tinkibotMovement_move', {DIRECTION: 'forward', DISTANCE: 10},
        `${prefix}turn`, parent);
    h.action(`${prefix}turn`, 'tinkibotMovement_rotate', {ROTATION: 'clockwise', DEGREES: 90},
        next, `${prefix}move`);
};
const respondLegacy = (h, report, value = 'OK') => {
    h.socket.respond({report, value});
};
const input = (h, blockId, name, opcode, fields = {}, shadow = false) => {
    const id = `${blockId}-${name}`;
    h.target.blocks.createBlock({id,
        opcode,
        next: null,
        parent: blockId,
        topLevel: false,
        shadow,
        inputs: {},
        fields});
    const block = h.target.blocks.getBlock(blockId);
    delete block.fields[name];
    block.inputs[name] = {name, block: id, shadow: shadow ? id : null};
    h.target.blocks.resetCache();
    return id;
};

test('a single action keeps the existing individual request and completion path', async t => {
    const h = setup();
    h.action('single', 'tinkibotMovement_move', {DIRECTION: 'forward', DISTANCE: 30});
    h.runtime._pushThread('single', h.target);
    await h.step();
    t.match(h.socket.sent[0], {command: 'move', direction: 'forward', distance: 30, nickname: 'lime'});
    respondLegacy(h, 'move');
    await tick();
    await h.step();
    t.equal(h.runtime.threads.length, 0);
});

test('a robot reporter separates action bundles and completes before the second bundle', async t => {
    const h = setup();
    pair(h, 'a', 'report');
    h.action('report', 'test_report', {}, 'bmove', 'aturn');
    pair(h, 'b', null, 'report');
    let distance;
    h.runtime._primitives.test_report = () => h.extension.measure_distance().then(value => {
        distance = value;
    });
    h.runtime._pushThread('amove', h.target);
    await h.step();
    t.equal(h.socket.sent.length, 1);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.match(h.socket.sent[1], {command: 'measure_distance'});
    for (let i = 0; i < 3; i++) await h.step();
    t.equal(h.socket.sent.length, 2);
    respondLegacy(h, 'measure_distance', 123);
    await tick();
    await h.step();
    t.equal(distance, 123);
    t.same(h.socket.sent[2].cmds, [{cmd: 'lime.forward:10'}, {cmd: 'lime.rotate:90'}]);
    h.socket.respond(succeed(h.socket.sent[2]));
    await tick();
    await h.step();
    t.equal(h.runtime.threads.length, 0);
});

test('Scratch wait separates two bundles and keeps its normal yield', async t => {
    const h = setup();
    pair(h, 'a', 'wait');
    h.action('wait', 'control_wait', {DURATION: 0}, 'bmove', 'aturn');
    pair(h, 'b', null, 'wait');
    h.runtime._pushThread('amove', h.target);
    await h.step();
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.equal(h.socket.sent.length, 1, 'the wait still yields rather than joining either bundle');
    await h.step();
    t.equal(h.socket.sent.length, 2);
    h.socket.respond(succeed(h.socket.sent[1]));
    await tick();
    await h.step();
    t.equal(h.runtime.threads.length, 0);
});

test('repeat sends one bundle per iteration instead of flattening the loop', async t => {
    const h = setup();
    h.action('repeat', 'control_repeat', {TIMES: 3});
    pair(h, 'loop', null, 'repeat');
    h.target.blocks.getBlock('repeat').inputs.SUBSTACK = {name: 'SUBSTACK', block: 'loopmove', shadow: null};
    h.runtime._pushThread('repeat', h.target);
    for (let iteration = 0; iteration < 3; iteration++) {
        await h.step();
        t.equal(h.socket.sent.length, iteration + 1);
        t.same(h.socket.sent[iteration].cmds, [{cmd: 'lime.forward:10'}, {cmd: 'lime.rotate:90'}]);
        h.socket.respond(succeed(h.socket.sent[iteration]));
        await tick();
        await h.step();
    }
    await h.step();
    t.equal(h.runtime.threads.length, 0);
    t.equal(h.socket.sent.length, 3);
});

test('dynamic variables are evaluated after preceding robot completion', async t => {
    const h = setup();
    pair(h, 'a', 'dynamic');
    h.action('dynamic', 'tinkibotMovement_move', {DIRECTION: 'forward'}, 'bmove', 'aturn');
    pair(h, 'b', null, 'dynamic');
    h.target.createVariable('distance', 'distance', '');
    h.target.lookupVariableById('distance').value = 5;
    input(h, 'dynamic', 'DISTANCE', 'data_variable', {VARIABLE: {name: 'VARIABLE', id: 'distance', value: 'distance'}});
    h.runtime._pushThread('amove', h.target);
    await h.step();
    t.equal(h.socket.sent[0].cmds.length, 2);
    h.target.lookupVariableById('distance').value = 77;
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.match(h.socket.sent[1], {command: 'move', distance: 77});
    respondLegacy(h, 'move');
    await tick();
    await h.step();
    t.equal(h.socket.sent[2].cmds.length, 2);
    h.socket.respond(succeed(h.socket.sent[2]));
    await tick();
    await h.step();
    t.equal(h.socket.sent.length, 3);
});

test('an embedded robot reporter runs normally and is never pre-evaluated', async t => {
    const h = setup();
    pair(h, 'a', 'dynamic');
    h.action('dynamic', 'tinkibotMovement_move', {DIRECTION: 'forward'}, 'bmove', 'aturn');
    pair(h, 'b', null, 'dynamic');
    input(h, 'dynamic', 'DISTANCE', 'tinkibotSensors_measure_distance');
    h.runtime._pushThread('amove', h.target);
    await h.step();
    t.equal(h.socket.sent.length, 1);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.match(h.socket.sent[1], {command: 'measure_distance'});
    respondLegacy(h, 'measure_distance', 42);
    await tick();
    await h.step();
    t.match(h.socket.sent[2], {command: 'move', distance: 42});
    t.equal(h.socket.sent.length, 3, 'later static actions wait for the dynamic action');
    respondLegacy(h, 'move');
    await tick();
    await h.step();
    t.equal(h.socket.sent[3].cmds.length, 2);
    h.socket.respond(succeed(h.socket.sent[3]));
    await tick();
    await h.step();
    t.equal(h.runtime.threads.length, 0);
});

test('literal shadow values use the same values as VM argument evaluation', async t => {
    const h = setup();
    pair(h, 'a');
    input(h, 'amove', 'DISTANCE', 'math_number', {NUM: {name: 'NUM', value: '12.5'}}, true);
    h.runtime._pushThread('amove', h.target);
    await h.step();
    t.same(h.socket.sent[0].cmds, [{cmd: 'lime.forward:12.5'}, {cmd: 'lime.rotate:90'}]);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
});

test('simultaneous scripts keep their individual queue ordering and are never combined', async t => {
    const h = setup();
    pair(h, 'a');
    pair(h, 'b');
    h.runtime._pushThread('amove', h.target);
    h.runtime._pushThread('bmove', h.target);
    await h.step();
    for (let i = 0; i < 4; i++) {
        t.notOk(h.socket.sent[i].cmds);
        respondLegacy(h, h.socket.sent[i].command);
        await tick();
        await h.step();
    }
    t.same(h.socket.sent.map(value => value.command), ['move', 'move', 'rotate', 'rotate']);
    t.equal(h.runtime.threads.length, 0);
});

test('an inactive second hat prevents eager bundling across future script events', async t => {
    const h = setup();
    pair(h, 'a');
    h.action('other', 'event_whenflagclicked');
    h.runtime._pushThread('amove', h.target);
    await h.step();
    t.equal(h.socket.sent[0].command, 'move');
    respondLegacy(h, 'move');
    await tick();
    await h.step();
    t.equal(h.socket.sent[1].command, 'rotate');
    respondLegacy(h, 'rotate');
    await tick();
    await h.step();
});

const protocol = require('../../src/extensions/tinkimo_tinkibot/bundles/protocol');
const actions = require('../../src/extensions/tinkimo_tinkibot/bundles/actions');
const directBundle = async h => {
    const plan = [
        {id: 'first', opcode: 'move', payload: actions.move.payload({DIRECTION: 'forward', DISTANCE: 10})},
        {id: 'second', opcode: 'rotate', payload: actions.rotate.payload({ROTATION: 'clockwise', DEGREES: 90})}
    ];
    const promise = h.extension._sendBundle(plan);
    await tick();
    return {promise, request: h.socket.sent.at(-1)};
};

test('bundle responses require ordered, complete results and surface every failure status', async t => {
    const cases = [
        ['ERROR', 'OK'], ['OK', 'ERROR'], ['OK', 'NOT_EXECUTED'], ['ERROR', 'NOT_EXECUTED']
    ];
    for (const statuses of cases) {
        const h = setup();
        const {promise, request} = await directBundle(h);
        const rejected = t.rejects(promise, /ERROR|NOT_EXECUTED/);
        h.socket.respond({requestId: request.requestId,
            rsp: request.cmds.map(({cmd}, i) =>
                ({cmd, status: statuses[i], msg: statuses[i] === 'ERROR' ? 'ERR original' : 'OK'}))});
        await rejected;
        t.equal(h.extension._pendingResponse, null);
        t.equal(h.socket.sent.length, 1, 'failures do not retry physical commands');
    }
});

test('malformed, missing and reordered responses reject safely and release the queue', async t => {
    const cases = [
        request => ({requestId: request.requestId}),
        request => ({requestId: request.requestId, rsp: []}),
        request => ({...succeed(request), rsp: succeed(request).rsp.reverse()}),
        request => ({...succeed(request), rsp: [null, null]}),
        request => ({requestId: request.requestId, rsp: [], error: {status: 'ERROR', msg: 'invalid-array'}}),
        () => '{', () => 'null', () => '[]'
    ];
    for (const makeResponse of cases) {
        const h = setup();
        const {promise, request} = await directBundle(h);
        const rejected = t.rejects(promise, /Invalid|Incomplete|invalid-array/);
        h.socket.respond(makeResponse(request));
        await rejected;
        t.equal(h.extension._pendingResponse, null);
        const following = h.extension.measure_voltage();
        await tick();
        t.equal(h.socket.sent[1].command, 'measure_voltage');
        respondLegacy(h, 'measure_voltage', 4.2);
        t.equal(await following, 4.2);
    }
});

test('bundle correlation ignores unrelated events and stale replies', async t => {
    const h = setup();
    const {promise, request} = await directBundle(h);
    let complete = false;
    promise.then(() => {
        complete = true;
    });
    h.socket.respond({event: 'connected_robots',
        robots: [{'nickname': 'lime',
            'bot-uuid': 'robot-lime',
            'blocks-uuid': h.extension._blocksUuid}]});
    h.socket.respond({...succeed(request), requestId: 'old-request'});
    await tick();
    t.notOk(complete);
    h.socket.respond(succeed(request));
    const results = await promise;
    t.same(results.map(item => item.msg), ['OK original\n', 'OK original\n']);
    t.equal(h.socket.sent.length, 1);
});

test('socket close and robot disconnect reject in-flight bundles instead of suspending Scratch', async t => {
    for (const event of ['socket', 'robot', 'error']) {
        const h = setup();
        const {promise} = await directBundle(h);
        const rejected = t.rejects(promise, /disconnect|connection failed/i);
        if (event === 'socket') h.socket.onclose();
        else if (event === 'error') h.socket.onerror();
        else h.socket.respond({'event': 'robot_disconnected', 'nickname': 'lime', 'bot-uuid': 'robot-lime'});
        await rejected;
        t.equal(h.extension._pendingResponse, null);
        t.equal(h.socket.sent.length, 1);
    }
});

const fakeBundleTimers = t => {
    const timers = [];
    const set = global.setTimeout;
    const clear = global.clearTimeout;
    global.setTimeout = (callback, delay, ...args) => {
        if (delay !== protocol.TIMEOUT_MS) return set(callback, delay, ...args);
        const timer = {callback, cleared: false};
        timers.push(timer);
        return timer;
    };
    global.clearTimeout = timer => {
        if (timers.includes(timer)) timer.cleared = true;
        else clear(timer);
    };
    t.teardown(() => {
        global.setTimeout = set;
        global.clearTimeout = clear;
    });
    return timers;
};

test('a bundle timeout rejects, clears pending state and never retries movement', async t => {
    const timers = fakeBundleTimers(t);
    const h = setup();
    const {promise, request} = await directBundle(h);
    const rejected = t.rejects(promise, /response timed out/);
    timers[0].callback();
    await rejected;
    t.ok(timers[0].cleared);
    t.equal(h.extension._pendingResponse, null);
    const following = h.extension.measure_voltage();
    await tick();
    h.socket.respond(succeed(request));
    t.equal(h.extension._pendingResponse.command, 'measure_voltage', 'late completion does not claim a reporter');
    respondLegacy(h, 'measure_voltage', 4);
    await following;
    t.equal(h.socket.sent.length, 2);
});

test('connection establishment has a bounded wait and late opening cannot dispatch a timed-out bundle', async t => {
    const timers = fakeBundleTimers(t);
    const h = setup();
    h.extension._connected = false;
    h.extension._connectionPromise = null;
    const {promise} = await directBundle(h);
    const rejected = t.rejects(promise, /connection timed out/);
    timers[0].callback();
    await rejected;
    Socket.instance.onopen();
    await tick();
    t.equal(Socket.instance.sent.length, 0);
});

test('operators and even shadow-shaped executable reporters keep normal VM evaluation', async t => {
    const h = setup();
    pair(h, 'a', 'dynamic');
    h.action('dynamic', 'tinkibotMovement_move', {DIRECTION: 'forward'}, 'turn', 'aturn');
    h.action('turn', 'tinkibotMovement_rotate', {ROTATION: 'clockwise', DEGREES: 90}, null, 'dynamic');
    let evaluations = 0;
    h.runtime._primitives.test_operator = () => {
        evaluations++; return 12;
    };
    input(h, 'dynamic', 'DISTANCE', 'test_operator', {VALUE: {name: 'VALUE', value: 99}}, true);
    h.runtime._pushThread('amove', h.target);
    await h.step();
    t.equal(evaluations, 0);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.equal(evaluations, 1);
    t.match(h.socket.sent[1], {command: 'move', distance: 12});
    respondLegacy(h, 'move');
    await tick();
    await h.step();
    respondLegacy(h, 'rotate');
    await tick();
    await h.step();
    t.equal(h.socket.sent.length, 3);
});

test('protocol preserves mixed robot addressing, duplicate commands and original response text', t => {
    const commands = ['all.play:startup', 'lime.forward:10', 'orange.rotate:90', 'lime.forward:10'];
    t.same(protocol.request(commands), {cmds: commands.map(cmd => ({cmd}))});
    const rsp = commands.map(cmd => ({cmd, status: 'OK', msg: 'current response\n'}));
    t.same(protocol.response({rsp}, commands), rsp);
    t.throws(() => protocol.request(['lime.write:' + '\u2665'.repeat(1500)]), /4096/);
    t.throws(() => protocol.request(Array(33).fill('lime.clear')), /size/);
    t.throws(() => protocol.request(['lime.forward:1\norange.forward:2']), /Invalid/);
    t.end();
});

test('bundle declarations exclude local timing blocks, hats and every reporter', t => {
    const h = setup();
    const metadata = h.extension.getInfos().flatMap(info => info.blocks);
    for (const info of metadata) {
        t.equal(info.supportsBundling, Boolean(actions[info.opcode]));
        if (info.supportsBundling) t.equal(info.blockType, 'command');
    }
    t.notOk(metadata.find(info => info.opcode === 'restForBeats').supportsBundling);
    t.notOk(metadata.find(info => info.opcode === 'setTempo').supportsBundling);
    t.end();
});

test('32-command cap splits long contiguous stacks without omission or duplication', async t => {
    const h = setup();
    for (let i = 0; i < 34; i++) {
        h.action(`b${i}`, 'tinkibotDisplay_clear', {}, i === 33 ? null : `b${i + 1}`, i === 0 ? null : `b${i - 1}`);
    }
    h.runtime._pushThread('b0', h.target);
    await h.step();
    t.equal(h.socket.sent[0].cmds.length, 32);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.equal(h.socket.sent[1].cmds.length, 2);
    h.socket.respond(succeed(h.socket.sent[1]));
    await tick();
    await h.step();
    t.equal(h.socket.sent.length, 2);
    t.equal(h.runtime.threads.length, 0);
});

test('if/else selects a branch before bundling and never includes the other branch', async t => {
    const h = setup();
    h.action('if', 'control_if_else', {CONDITION: false});
    pair(h, 'yes', null, 'if');
    pair(h, 'no', null, 'if');
    h.target.blocks.getBlock('nomove').fields.DISTANCE.value = 21;
    h.target.blocks.getBlock('if').inputs = {
        SUBSTACK: {name: 'SUBSTACK', block: 'yesmove', shadow: null},
        SUBSTACK2: {name: 'SUBSTACK2', block: 'nomove', shadow: null}
    };
    h.runtime._pushThread('if', h.target);
    await h.step();
    t.same(h.socket.sent[0].cmds, [{cmd: 'lime.forward:21'}, {cmd: 'lime.rotate:90'}]);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.equal(h.socket.sent.length, 1);
    t.equal(h.runtime.threads.length, 0);
});

test('a failed bundled note retains its existing originating-thread retirement behavior', async t => {
    const h = setup();
    h.action('move', 'tinkibotMovement_move', {DIRECTION: 'forward', DISTANCE: 10}, 'note');
    h.action('note', 'tinkibotSounds_playNoteForBeats', {NOTE: 60, BEATS: 1}, 'end', 'move');
    h.action('end', 'test_end', {}, null, 'note');
    let ended = false;
    h.runtime._primitives.test_end = () => {
        ended = true;
    };
    h.runtime._pushThread('move', h.target);
    await h.step();
    const request = h.socket.sent[0];
    h.socket.respond({requestId: request.requestId,
        rsp: [
            {cmd: request.cmds[0].cmd, status: 'OK', msg: 'OK forward'},
            {cmd: request.cmds[1].cmd, status: 'ERROR', msg: 'ERR busy'}
        ]});
    await tick();
    await h.step();
    t.notOk(ended);
    t.equal(h.runtime.threads.length, 0);
    t.equal(h.socket.sent.length, 1);
});

test('cache refreshes while waiting cannot enqueue duplicate bundles', async t => {
    const h = setup();
    pair(h, 'a');
    h.runtime._pushThread('amove', h.target);
    await h.step();
    for (let i = 0; i < 5; i++) {
        h.target.blocks.resetCache();
        await h.step();
    }
    t.equal(h.socket.sent.length, 1);
    h.socket.respond(succeed(h.socket.sent[0]));
    await tick();
    await h.step();
    t.equal(h.socket.sent.length, 1);
    t.equal(h.runtime.threads.length, 0);
});

test('failed bundles do not leave skip markers for a later loop iteration', async t => {
    const h = setup();
    h.action('repeat', 'control_repeat', {TIMES: 2});
    pair(h, 'loop', null, 'repeat');
    h.target.blocks.getBlock('repeat').inputs.SUBSTACK = {name: 'SUBSTACK', block: 'loopmove', shadow: null};
    h.runtime._pushThread('repeat', h.target);
    await h.step();
    const request = h.socket.sent[0];
    h.socket.respond({requestId: request.requestId,
        rsp: [
            {cmd: request.cmds[0].cmd, status: 'ERROR', msg: 'ERR original'},
            {cmd: request.cmds[1].cmd, status: 'OK', msg: 'OK rotate'}
        ]});
    await tick();
    h.action('other-hat', 'event_whenflagclicked');
    await h.step();
    t.match(h.socket.sent[1], {command: 'move'});
    respondLegacy(h, 'move');
    await tick();
    await h.step();
    t.match(h.socket.sent[2], {command: 'rotate'});
    respondLegacy(h, 'rotate');
    await tick();
    await h.step();
    t.equal(h.runtime.threads.length, 0);
});
