const protocol = require('./bundles/protocol');

/**
 * Convert internal Scratch payloads at one public API boundary.
 * @param {object} payload internal command and block arguments
 * @returns {object} public command with string parameters
 */
const command = payload => {
    const value = {...payload};
    if (value.command === 'move') {
        value.command = value.direction === 'reverse' ? 'reverse' : 'forward';
        delete value.direction;
    } else if (value.command === 'rotate') {
        value.angle = (value.rotation === 'anticlockwise' ? -1 : 1) * Number(value.degrees);
        delete value.rotation;
        delete value.degrees;
    } else if (value.command === 'display_image') {
        value.command = 'display';
    }
    for (const key of Object.keys(value)) value[key] = String(value[key]);
    return value;
};

/**
 * Verify a public reply before adapting it to Scratch's existing result handling.
 * @param {object} value decoded public response
 * @param {object} pending originating command metadata
 * @param {string} clientUuid local client identity
 * @returns {string|number|Array<object>} command result or ordered bundle results
 */
const response = (value, pending, clientUuid) => {
    if (value['client-uuid'] !== clientUuid || value['bot-uuid'] !== pending.botUuid ||
        !['OK', 'ERROR'].includes(value.status)) throw new Error('Invalid Tinkibot response identity/status');
    if (pending.bundleCommands) {
        if (!Array.isArray(value.rsp)) throw new Error(value.message || 'Invalid Tinkibot bundle response');
        if (value.rsp.length !== pending.publicCommands.length) throw new Error('Incomplete Tinkibot bundle response');
        const rsp = value.rsp.map((item, i) => {
            const expected = pending.publicCommands[i];
            if (!item || Object.keys(expected).some(key => item[key] !== expected[key])) {
                throw new Error(`Invalid Tinkibot result at command ${i + 1}`);
            }
            return {cmd: pending.bundleCommands[i], status: item.status, msg: item.message};
        });
        const results = protocol.response({rsp}, pending.bundleCommands);
        if (value.status !== 'OK') throw new Error(value.message || 'Tinkibot bundle failed');
        return results;
    }
    if (value.status === 'ERROR') throw new Error(value.message || 'Tinkibot command failed');
    if (value.command !== pending.publicCommands[0].command) throw new Error('Invalid Tinkibot command response');
    const result = typeof value.value === 'undefined' ? value.message : value.value;
    const expected = {play_note: 'OK play', play_drum: 'OK drum'}[value.command];
    if (expected && result !== expected) throw new Error(result || 'Incomplete music response');
    return result;
};

module.exports = {command, response};
