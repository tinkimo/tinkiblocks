const {test} = require('tap');
const Tinkibot = require('../../src/extensions/tinkimo_tinkibot');
const api = require('../../src/extensions/tinkimo_tinkibot/api');
const tick = () => new Promise(resolve => setImmediate(resolve));
const bot = 'c1c4bd43-16cc-4f99-9297-186614d4e33f';

test('public command mapping has descriptive names and string parameters', t => {
    t.same(api.command({command: 'move', direction: 'forward', distance: 10}),
        {command: 'forward', distance: '10'});
    t.same(api.command({command: 'rotate', rotation: 'anticlockwise', degrees: 90}),
        {command: 'rotate', angle: '-90'});
    t.same(api.command({command: 'display_image', image: 'happy'}), {command: 'display', image: 'happy'});
    t.same(api.command({command: 'play_drum', drum: 1, duration: 0.15}),
        {command: 'play_drum', drum: '1', duration: '0.15'});
    t.end();
});

test('real editor frames use UUIDs and correlate both single and bundle replies', async t => {
    const frames = [];
    global.window = {};
    global.alert = () => {};
    global.WebSocket = class {
        constructor () {
            this.send = value => frames.push(JSON.parse(value));
        }
    };
    t.teardown(() => {
        delete global.window;
        delete global.WebSocket;
        delete global.alert;
    });
    const extension = new Tinkibot({getTargetForStage: () => ({tempo: 100}), emit: () => {}});
    global.window.socket.onopen();
    extension._setConnectedRobots([{'bot-uuid': bot, 'nickname': 'lime', 'client-uuid': extension._clientUuid}]);
    const single = extension.measure_voltage();
    await tick();
    t.match(frames[0], {'command': 'measure_voltage', 'client-uuid': extension._clientUuid, 'bot-uuid': bot});
    t.match(frames[0]['request-id'], /^[a-f0-9-]{36}$/);
    t.notOk('requestId' in frames[0]);
    t.notOk('blocks-uuid' in frames[0]);
    const reply = {...frames[0], status: 'OK', result: '4.2'};
    global.window.socket.onmessage({data: JSON.stringify({...reply, 'request-id': 'stale'})});
    t.ok(extension._pendingResponse, 'stale request is ignored');
    global.window.socket.onmessage({data: JSON.stringify(reply)});
    t.equal(await single, '4.2');
    const bundle = extension._sendBundle([
        {opcode: 'move', payload: {command: 'move', direction: 'forward', distance: 10}},
        {opcode: 'rotate', payload: {command: 'rotate', rotation: 'clockwise', degrees: 90}}
    ]);
    await tick();
    t.same(frames[1].cmds, [{command: 'forward', distance: '10'}, {command: 'rotate', angle: '90'}]);
    t.not(frames[1]['request-id'], frames[0]['request-id']);
    global.window.socket.onmessage({data: JSON.stringify({
        'request-id': frames[1]['request-id'],
        'client-uuid': extension._clientUuid,
        'bot-uuid': bot,
        'status': 'OK',
        'rsp': frames[1].cmds.map(item => ({...item, status: 'OK'}))
    })});
    t.equal((await bundle).length, 2);
    t.equal(extension._pendingResponse, null);
});

test('public replies reject a mismatched robot, client or command result', t => {
    const pending = {botUuid: bot, publicCommands: [{command: 'clear'}], bundleCommands: ['lime.clear']};
    const value = {'client-uuid': 'client',
        'bot-uuid': bot,
        'status': 'OK',
        'rsp': [{command: 'clear', status: 'OK', message: 'OK clear'}]};
    t.throws(() => api.response({...value, 'bot-uuid': 'other'}, pending, 'client'), /identity/);
    t.throws(() => api.response(value, pending, 'other'), /identity/);
    t.throws(() => api.response({...value, rsp: [{command: 'stop', status: 'OK'}]}, pending, 'client'), /command 1/);
    t.end();
});


test('bundle byte limit reserves the proxy transaction envelope overhead', t => {
    const protocol = require('../../src/extensions/tinkimo_tinkibot/bundles/protocol');
    const prefix = 'lime.write:';
    const overhead = new TextEncoder().encode(JSON.stringify({cmds: [{cmd: prefix}]})).length;
    const command = prefix + 'x'.repeat(protocol.MAX_BYTES - overhead - 52);
    t.doesNotThrow(() => protocol.request([command]));
    t.throws(() => protocol.request([`${command}x`]), /4096/);
    t.end();
});


test('successful music needs no message and successful reporters use result', t => {
    const value = {'client-uuid': 'client', 'bot-uuid': bot, 'status': 'OK', 'command': 'play_drum'};
    const pending = {botUuid: bot, publicCommands: [{command: 'play_drum'}]};
    t.equal(api.response(value, pending, 'client'), '');
    t.equal(api.response({...value, command: 'measure_voltage', result: '4.2'},
        {botUuid: bot, publicCommands: [{command: 'measure_voltage'}]}, 'client'), '4.2');
    t.end();
});


test('transport deadlines preserve long generated-music and mixed bundle budgets', t => {
    const melody = {cmds: Array.from({length: 32}, () => ({command: 'play_note', note: '60', duration: '300'}))};
    t.equal(api.timeout(melody), (32 * 305000) + 5000);
    t.equal(api.timeout({cmds: [{command: 'forward', distance: '10'},
        {command: 'play_drum', drum: '1', duration: '300'}]}), 2105000);
    t.equal(api.timeout({command: 'claim'}), 30000);
    t.end();
});
