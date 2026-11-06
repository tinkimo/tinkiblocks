const {test, beforeEach} = require('tap');
const TinkibotBlocks = require('../../src/extensions/tinkimo_tinkibot');
const ArgumentType = require('../../src/extension-support/argument-type');

beforeEach(t => {
    const socket = global.WebSocket;
    delete global.WebSocket;
    t.teardown(() => {
        global.WebSocket = socket;
    });
});

const makeExtension = () => {
    const stage = {tempo: 60};
    return new TinkibotBlocks({getTargetForStage: () => stage});
};

test('music uses Scratch note input and project tempo', t => {
    const extension = makeExtension();
    const sounds = extension.getInfos().find(info => info.id === 'tinkibotSounds');
    const note = sounds.blocks.find(block => block.opcode === 'playNoteForBeats');
    t.equal(note.arguments.NOTE.type, ArgumentType.NOTE);
    t.equal(note.arguments.NOTE.defaultValue, 60);
    const commands = [];
    extension._sendCommand = command => commands.push(command);
    extension.setTempo({TEMPO: 120});
    extension.changeTempo({TEMPO: '30'});
    extension.playNoteForBeats({NOTE: 69, BEATS: 2});
    t.same(commands, [{command: 'play_note', note: 69, duration: 0.8}]);
    extension.playNoteForBeats({NOTE: 60, BEATS: 0});
    t.equal(commands.length, 1, 'zero beats sends no command');
    extension.setTempo({TEMPO: -1});
    t.equal(extension._music.getTempo(), 20);
    extension.changeTempo({TEMPO: 999});
    t.equal(extension._music.getTempo(), 500);
    t.equal(extension._music.note(-1), 0);
    t.equal(extension._music.note(999), 130);
    t.end();
});

test('rest yields for beats at the tempo captured when it starts', t => {
    const extension = makeExtension();
    let duration;
    let yields = 0;
    let finished = false;
    const util = {
        stackTimerNeedsInit: () => typeof duration === 'undefined',
        startStackTimer: value => {
            duration = value;
        },
        stackTimerFinished: () => finished,
        yield: () => {
            yields++;
        }
    };
    extension.setTempo({TEMPO: 120});
    extension.restForBeats({BEATS: 2}, util);
    t.equal(duration, 1000);
    extension.setTempo({TEMPO: 60});
    extension.restForBeats({BEATS: 2}, util);
    t.equal(duration, 1000);
    t.equal(yields, 2);
    finished = true;
    extension.restForBeats({BEATS: 2}, util);
    t.equal(yields, 2);
    t.end();
});
