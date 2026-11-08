// Keep the scheduling suites' compact expectations while retaining public frames.
const numeric = new Set(['distance', 'degrees', 'note', 'duration', 'drum', 'radius', 'speed',
    'time', 'steps', 'x', 'y', 'volume', 'backlight', 'sensor']);
const legacy = value => {
    const result = {...value};
    if (['forward', 'reverse'].includes(value.command)) {
        result.direction = value.command;
        result.command = 'move';
    } else if (value.command === 'rotate') {
        result.rotation = Number(value.angle) < 0 ? 'anticlockwise' : 'clockwise';
        result.degrees = Math.abs(Number(value.angle));
        delete result.angle;
    } else if (value.command === 'display') result.command = 'display_image';
    for (const key of Object.keys(result)) {
        if (numeric.has(key) && result[key] !== '' && Number.isFinite(Number(result[key]))) {
            result[key] = Number(result[key]);
        }
    }
    return result;
};
const templates = {
    'forward': v => `forward:${v.distance}`,
    'reverse': v => `reverse:${v.distance}`,
    'rotate': v => `rotate:${v.angle}`,
    'display': v => `display:${v.image}`,
    'play_sound': v => `play:${v.sound}`,
    'play_note': v => `play:${v.note} ${v.duration}`,
    'play_drum': v => `drum:${v.drum} ${v.duration}`,
    'clear': () => 'clear',
    'drive': v => `drive:${v.motor} ${v.speed}`,
    'stop': v => `stop:${v.motor}`,
    'brake': v => `brake:${v.motor}`,
    'fade': v => `fade:${v.target.toLowerCase() === 'leds' ? 'LEDs' : v.target} ${v.direction} ${v.speed}`,
    'arc': v => `arc:${v.direction} ${v.radius} ${v.degrees}`,
    'wiggle': v => `wiggle:${v.time}`,
    'moonwalk': v => `moonwalk:${v.steps}`,
    'set': v => typeof v.volume === 'undefined' ? `set:backlight ${v.backlight}` : `set:volume ${v.volume}`,
    'write_text': v => `write:${v.x} ${v.y} "${v.message}"`,
    'text_colour': v => `text-colour:${v.colour}`,
    'background_colour': v => `background:${v.colour}`,
    'mosaic': v => `mosiac:${v.image}`,
    'button_led': v => `set:led ${v.button} ${v.state}`,
    'preload:audio': v => `preload:audio ${v.file}`,
    'preload:image': v => `preload:image ${v.file}`
};
const view = frame => {
    const result = legacy(frame);
    if (frame.cmds || ['play_note', 'play_drum'].includes(frame.command)) {
        result.requestId = frame['request-id'];
    }
    delete result['request-id'];
    if (frame.cmds) result.cmds = frame.cmds.map(item => ({cmd: `${frame.nickname}.${templates[item.command](item)}`}));
    return result;
};
const reply = (value, frames) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    if (value.event || value.status || value['request-id']) return value;
    const frame = frames.find(item => item['request-id'] === value.requestId) || frames[frames.length - 1];
    if (!frame) return value;
    const result = {...value,
        'request-id': value.requestId || frame['request-id'],
        'client-uuid': frame['client-uuid'],
        'bot-uuid': value['bot-uuid'] || frame['bot-uuid'],
        'status': value.error || value.report === 'error' ||
            value.value === 'The robot has been claimed by another user' || /^ERR/.test(value.value || '') ?
            'ERROR' : 'OK'};
    if (Array.isArray(value.rsp)) {
        const commands = view(frame).cmds || [];
        result.rsp = value.rsp.map((item, i) => item && ({...((frame.cmds || [])[i]),
            command: commands[i] && commands[i].cmd === item.cmd ? frame.cmds[i].command : 'mismatched',
            status: item.status,
            message: item.msg}));
        if (value.rsp.some(item => item && item.status !== 'OK')) result.status = 'ERROR';
    } else {
        result.command = frame.command;
        if (value.report && value.report !== 'error' && value.report !== legacy(frame).command) {
            result['request-id'] = 'unrelated-report';
        }
        result.message = value.error ? value.error.msg : value.value;
    }
    return result;
};
module.exports = {view, reply};
