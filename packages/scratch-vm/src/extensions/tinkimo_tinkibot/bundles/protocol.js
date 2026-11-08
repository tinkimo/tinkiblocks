const MAX_COMMANDS = 32;
const MAX_BYTES = 4096;
const TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Build the firmware envelope without changing command strings or addressing.
 * @param {Array<string>} commands ordered targeted robot commands
 * @returns {object} firmware-compatible envelope
 */
const request = commands => {
    if (!commands.length || commands.length > MAX_COMMANDS) throw new Error('Invalid Tinkibot bundle size');
    if (commands.some(cmd => typeof cmd !== 'string' || !/^[^.\s]+\..+/.test(cmd) || /[\r\n]/.test(cmd))) {
        throw new Error('Invalid Tinkibot bundle command');
    }
    const value = {cmds: commands.map(cmd => ({cmd}))};
    // The proxy adds one 36-character request UUID (52 JSON bytes).
    if (new TextEncoder().encode(JSON.stringify(value)).length + 52 > MAX_BYTES) {
        throw new Error('Tinkibot bundle exceeds 4096 bytes');
    }
    return value;
};

/**
 * Validate all command results before surfacing any reported failure.
 * @param {object} value decoded external response
 * @param {Array<string>} commands original targeted commands
 * @returns {Array<object>} validated command responses, including original messages
 */
const response = (value, commands) => {
    if (!value || typeof value !== 'object' || !Array.isArray(value.rsp)) {
        throw new Error('Invalid Tinkibot bundle response');
    }
    if (value.error) {
        if (value.error.status !== 'ERROR' || typeof value.error.msg !== 'string') {
            throw new Error('Invalid Tinkibot bundle error');
        }
        throw new Error(value.error.msg);
    }
    if (value.rsp.length !== commands.length) throw new Error('Incomplete Tinkibot bundle response');
    for (let i = 0; i < commands.length; i++) {
        const item = value.rsp[i];
        if (!item || item.cmd !== commands[i] || !['OK', 'ERROR', 'NOT_EXECUTED'].includes(item.status) ||
            (item.status !== 'NOT_EXECUTED' && typeof item.msg !== 'string') ||
            (typeof item.msg !== 'undefined' && typeof item.msg !== 'string')) {
            throw new Error(`Invalid Tinkibot bundle result at command ${i + 1}`);
        }
    }
    const failed = value.rsp.find(item => item.status !== 'OK');
    if (failed) {
        const error = new Error(`${failed.cmd}: ${failed.status}${failed.msg ? ` ${failed.msg}` : ''}`);
        error.commandIndex = value.rsp.indexOf(failed);
        throw error;
    }
    return value.rsp;
};

/**
 * Keep declared music time outside the transport's response margin.
 * @param {Array<object>} plan collected action declarations and payloads
 * @returns {number} bounded response wait in milliseconds
 */
const responseTimeout = plan => {
    if (plan.length && plan.every(item => ['play_note', 'play_drum'].includes(item.payload.command))) {
        return 10000 + plan.reduce((ms, item) => ms + ((item.payload.duration + 5) * 1000), 0);
    }
    return TIMEOUT_MS + (plan.reduce((seconds, item) => {
        const duration = item.payload.duration;
        return seconds + (Number.isFinite(duration) && duration > 0 ? duration : 0);
    }, 0) * 1000);
};

module.exports = {MAX_COMMANDS, MAX_BYTES, TIMEOUT_MS, request, response, responseTimeout};
