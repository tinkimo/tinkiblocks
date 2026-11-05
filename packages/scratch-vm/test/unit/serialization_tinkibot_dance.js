const {test} = require('tap');
const {deserializeBlocks} = require('../../src/serialization/sb3');

test('saved robot dances load into Dance without changing other robot blocks', t => {
    for (const [saved, expected] of [
        ['tinkibotMovement_wiggle', 'tinkibotDance_wiggle'],
        ['tinkibotMovement_moonwalk', 'tinkibotDance_moonwalk'],
        ['tinkibotMovement_move', 'tinkibotMovement_move'],
        ['tinkibotDance_fade', 'tinkibotDance_fade']
    ]) {
        const blocks = {dance: {opcode: saved, inputs: {}, fields: {}, next: null, parent: null}};
        deserializeBlocks(blocks);
        t.equal(blocks.dance.opcode, expected);
        deserializeBlocks(blocks);
        t.equal(blocks.dance.opcode, expected);
    }
    t.end();
});
