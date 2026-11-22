const uuid = require('uuid');
const {FileSender, decode} = require('./tfp');

/**
 * Negotiate the documented TFP route on the already-open modem connection.
 * @param {object} manager Current connection manager.
 * @param {object} robot Claimed robot identity.
 * @param {string} name Safe destination basename.
 * @param {Uint8Array} bytes Encoded image file.
 * @param {function(number): void} progress Upload percentage callback.
 * @param {object} context Optional current-project guard; cancellation packets still pass.
 * @returns {Promise<void>} Resolves only after verified completion.
 */
const upload = async (manager, robot, name, bytes, progress, context) => {
    if (!manager.apiReady || manager.method !== 'web-serial' || manager.uploadChannel) {
        throw new Error('USB connection is not ready for an upload');
    }
    let nonce = uuid.v4().replace(/-/g, '')
        .slice(0, 16);
    let negotiation;
    let negotiationTimer;
    let fallback;
    let waiter;
    let closed;
    const inbox = [];
    const reject = error => {
        closed = error;
        if (negotiation) negotiation.reject(error);
        if (waiter) {
            clearTimeout(waiter.timer); waiter.reject(error); waiter = null;
        }
    };
    const channel = {
        capacity: 512,
        text: value => {
            if (!negotiation) return false;
            if (value === 'ERR tfp-invalid-tfp-open' && fallback) {
                fallback();
                return true;
            }
            if (!value.startsWith('TFP1-MODEM ')) return false;
            const match = /^TFP1-MODEM ([a-f0-9]{16}) ([0-9]+)( rgb565-rle1)?$/.exec(value);
            if (!match || match[1] !== nonce) return false;
            const capacity = Number(match[2]);
            if (capacity < 24 || capacity > 512) negotiation.reject(new Error('Invalid modem TFP capacity'));
            else {
                channel.capacity = capacity; channel.compression = Boolean(match[3]); negotiation.resolve();
            }
            return true;
        },
        feed: body => {
            let packet;
            try {
                packet = decode(body);
            } catch (error) {
                manager.log('error', error.message); return;
            }
            if (waiter) {
                clearTimeout(waiter.timer);
                waiter.resolve(packet);
                waiter = null;
            } else if (inbox.length < 16) inbox.push(packet);
        },
        send: frame => {
            if (closed) return Promise.reject(closed);
            if (context && !context.valid() && decode(frame.slice(1, -1)).kind !== 9) {
                return Promise.reject(new Error('Image synchronisation superseded'));
            }
            if (frame.length > channel.capacity) return Promise.reject(new Error('TFP frame exceeds capacity'));
            return manager.transport.write(frame);
        },
        receive: timeout => {
            if (closed) return Promise.reject(closed);
            if (inbox.length) return Promise.resolve(inbox.shift());
            return new Promise((resolve, fail) => {
                waiter = {resolve,
                    reject: fail,
                    timer: setTimeout(() => {
                        waiter = null;
                        fail(new Error('TFP response timed out'));
                    }, Math.max(1, timeout))};
            });
        }
    };
    const disconnected = error => reject(error || new Error('Robot disconnected'));
    const message = value => {
        if (value.event === 'robot_disconnected' && value['bot-uuid'] === robot.botUuid) {
            reject(new Error('Robot disconnected during upload'));
        }
    };
    manager.uploadChannel = channel;
    manager.on('disconnected', disconnected);
    manager.on('message', message);
    try {
        const ready = new Promise((resolve, fail) => {
            negotiation = {resolve, reject: fail};
            fallback = () => {
                fallback = null;
                // A late capability reply must never authorize a different route.
                nonce = uuid.v4().replace(/-/g, '')
                    .slice(0, 16);
                manager.send(`${robot.nickname}.tfp:open ${nonce} 512\n`).catch(fail);
            };
            negotiationTimer = setTimeout(() => fail(new Error('Modem does not support TFP upload negotiation')), 5000);
        });
        // Register the waiter before writing: a fast modem can reply immediately.
        await Promise.all([ready, manager.send(`${robot.nickname}.tfp:open ${nonce} 512 rgb565-rle1\n`)]);
        clearTimeout(negotiationTimer);
        negotiation = null;
        await new FileSender(channel).upload(name, bytes, progress, !context || context.showComplete !== false);
    } finally {
        clearTimeout(negotiationTimer);
        if (waiter) clearTimeout(waiter.timer);
        manager.removeListener('disconnected', disconnected);
        manager.removeListener('message', message);
        manager.uploadChannel = null;
    }
};
module.exports = {upload};
