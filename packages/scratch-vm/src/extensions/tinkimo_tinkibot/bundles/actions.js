const Cast = require('../../../util/cast');

// A declaration supplies both the existing single-command payload and its wire encoding.
// Local music timing operations, reporters and hats deliberately have no declaration.
const display = {
    payload: args => ({command: 'display_image', image: args.IMAGE}),
    encode: value => `display:${value.image}`
};
const musicNumber = value => Number(Number(value).toPrecision(6)).toString();

module.exports = {
    button_led: {
        payload: args => ({command: 'button_led', button: args.BUTTON, state: args.STATE}),
        encode: value => `set:led ${value.button} ${value.state}`
    },
    play_sound: {
        payload: args => ({command: 'play_sound', sound: args.SOUND}),
        encode: value => `play:${value.sound}`
    },
    playNoteForBeats: {
        payload: (args, extension) => {
            const duration = extension._music.duration(args.BEATS);
            return duration === 0 ? null :
                {command: 'play_note', note: extension._music.note(args.NOTE), duration};
        },
        encode: value => `play:${musicNumber(value.note)} ${musicNumber(value.duration)}`,
        music: true
    },
    playDrumForBeats: {
        payload: (args, extension) => ({
            command: 'play_drum', drum: Cast.toNumber(args.DRUM), duration: extension._music.duration(args.BEATS)
        }),
        encode: value => `drum:${musicNumber(value.drum)} ${musicNumber(value.duration)}`,
        music: true
    },
    preload_audio: {
        payload: args => ({command: 'preload:audio', file: args.AUDIO}),
        encode: value => `preload:audio ${value.file}`
    },
    preload_image: {
        payload: args => ({command: 'preload:image', file: args.IMAGE}),
        encode: value => `preload:image ${value.file}`
    },
    display_image: display,
    display_letter: display,
    display_number: display,
    write_text: {
        payload: args => ({command: 'write_text', x: args.X, y: args.Y, message: args.MESSAGE}),
        encode: value => `write:${value.x} ${value.y} "${value.message}"`
    },
    text_colour: {
        payload: args => ({command: 'text_colour', colour: args.COLOUR}),
        encode: value => `text-colour:${value.colour}`
    },
    background_colour: {
        payload: args => ({command: 'background_colour', colour: args.COLOUR}),
        encode: value => `background:${value.colour}`
    },
    clear: {
        payload: () => ({command: 'clear'}),
        encode: () => 'clear'
    },
    backlight: {
        payload: args => ({command: 'set', backlight: Math.max(0, Math.min(100, Cast.toNumber(args.INTENSITY)))}),
        encode: value => `set:backlight ${value.backlight}`
    },
    mosaic: {
        payload: args => ({command: 'mosaic', image: args.IMAGE}),
        encode: value => `mosiac:${value.image}`
    },
    move: {
        payload: args => ({command: 'move', direction: args.DIRECTION, distance: args.DISTANCE}),
        encode: value => `${value.direction === 'reverse' ? 'reverse' : 'forward'}:${value.distance}`
    },
    rotate: {
        payload: args => ({command: 'rotate', rotation: args.ROTATION, degrees: args.DEGREES}),
        encode: value => `rotate:${value.rotation === 'anticlockwise' ? '-' : ''}${value.degrees}`
    },
    arc: {
        payload: args => ({command: 'arc', direction: args.DIRECTION, degrees: args.DEGREES, radius: args.RADIUS}),
        encode: value => `arc:${value.direction} ${value.radius} ${value.degrees}`
    },
    volume: {
        payload: args => ({command: 'set', volume: args.VALUE}),
        encode: value => `set:volume ${value.volume}`
    },
    drive: {
        payload: args => ({command: 'drive', motor: args.MOTOR, speed: args.SPEED}),
        encode: value => `drive:${value.motor} ${value.speed}`
    },
    stop: {
        payload: args => ({command: 'stop', motor: args.MOTOR}),
        encode: value => `stop:${value.motor}`
    },
    brake: {
        payload: args => ({command: 'brake', motor: args.MOTOR}),
        encode: value => `brake:${value.motor}`
    },
    fade: {
        payload: args => ({command: 'fade',
            target: args.TARGET,
            direction: args.DIRECTION,
            speed: typeof args.SPEED === 'undefined' ? 'medium' : args.SPEED}),
        encode: value => {
            const target = String(value.target).toLowerCase();
            return `fade:${target === 'leds' ? 'LEDs' : target} ${value.direction} ${value.speed}`;
        }
    },
    wiggle: {
        payload: args => ({command: 'wiggle', time: args.TIMES}),
        encode: value => `wiggle:${value.time}`
    },
    moonwalk: {
        payload: args => ({command: 'moonwalk', steps: args.STEPS}),
        encode: value => `moonwalk:${value.steps}`
    }
};
