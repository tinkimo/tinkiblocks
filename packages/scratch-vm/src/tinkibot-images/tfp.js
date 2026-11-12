// TFP v1, matching proxy transfer/protocol.py and transfer/sender.py.
/**
 * @param {Uint8Array} bytes Packet bytes excluding their checksum.
 * @returns {number} Standard IEEE CRC-32 checksum.
 */
const crc32 = bytes => {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
};
const cobs = bytes => {
    const output = [0];
    let marker = 0;
    let count = 1;
    for (const byte of bytes) {
        if (byte) {
            output.push(byte); count++;
        }
        if (!byte || count === 255) {
            output[marker] = count;
            marker = output.length;
            output.push(0);
            count = 1;
        }
    }
    output[marker] = count;
    return new Uint8Array(output);
};
const uncobs = bytes => {
    const output = [];
    let offset = 0;
    while (offset < bytes.length) {
        const count = bytes[offset++];
        if (!count || offset + count - 1 > bytes.length) throw new Error('Invalid TFP frame');
        for (let index = 1; index < count; index++) {
            if (!bytes[offset]) throw new Error('Invalid TFP frame');
            output.push(bytes[offset++]);
        }
        if (count < 255 && offset < bytes.length) output.push(0);
    }
    return new Uint8Array(output);
};
const encode = (kind, id, offset = 0, payload = new Uint8Array()) => {
    const bytes = new Uint8Array(19 + payload.length);
    const view = new DataView(bytes.buffer);
    bytes.set([84, 70, 1, kind, 0]);
    view.setUint32(5, id, true);
    view.setUint32(9, offset, true);
    view.setUint16(13, payload.length, true);
    bytes.set(payload, 15);
    view.setUint32(bytes.length - 4, crc32(bytes.slice(0, -4)), true);
    const body = cobs(bytes);
    const frame = new Uint8Array(body.length + 2);
    frame.set(body, 1);
    return frame;
};
const decode = body => {
    const bytes = uncobs(body);
    if (bytes.length < 19) throw new Error('Invalid TFP frame');
    const view = new DataView(bytes.buffer);
    if (bytes[0] !== 84 || bytes[1] !== 70 || bytes[2] !== 1 || bytes[4] ||
        bytes[3] < 1 || bytes[3] > 9 || !view.getUint32(5, true) ||
        view.getUint16(13, true) !== bytes.length - 19 ||
        crc32(bytes.slice(0, -4)) !== view.getUint32(bytes.length - 4, true)) throw new Error('Invalid TFP frame');
    return {kind: bytes[3], id: view.getUint32(5, true), offset: view.getUint32(9, true), payload: bytes.slice(15, -4)};
};

/** One sender owns the existing serial stream until completion or cleanup. */
class FileSender {
    constructor (channel, options = {}) {
        this.channel = channel;
        this.timeout = options.timeout || 2000;
        this.confirmation = options.confirmation || 60000;
        this.verification = options.verification || 30000;
        this.retries = typeof options.retries === 'number' ? options.retries : 5;
        const random = new Uint32Array(1);
        crypto.getRandomValues(random);
        this.id = random[0] || 1;
    }

    async response (deadline) {
        while (Date.now() < deadline) {
            const packet = await this.channel.receive(deadline - Date.now());
            if (packet.id !== this.id) continue;
            if (packet.kind === 9) {
                if (packet.offset || packet.payload.length) throw new Error('Invalid TFP cancel');
                throw new Error('Upload cancelled on Tinkibot');
            }
            if (packet.kind === 8) {
                const payload = packet.payload;
                if (payload.length < 2 || payload.length > 122 || payload[1] !== payload.length - 2 ||
                    payload[0] < 1 || payload[0] > 13) throw new Error('Invalid TFP error');
                throw new Error(new TextDecoder('utf-8', {fatal: true}).decode(payload.slice(2)) ||
                    'Robot upload failed');
            }
            return packet;
        }
        throw new Error('TFP response timed out');
    }

    async exchange (kind, offset, payload, expected) {
        for (let attempt = 0; attempt <= this.retries; attempt++) {
            await this.channel.send(encode(kind, this.id, offset, payload));
            const deadline = Date.now() + (kind === 6 ? this.verification : this.timeout);
            try {
                while (Date.now() < deadline) {
                    const packet = await this.response(deadline);
                    if ([2, 3].includes(packet.kind)) continue;
                    if (packet.payload.length || ![expected, 5].includes(packet.kind)) {
                        throw new Error('Invalid TFP acknowledgement');
                    }
                    if (packet.kind === 7) {
                        if (packet.offset !== offset) throw new Error('Invalid TFP completion');
                        return packet;
                    }
                    if (kind === 6) {
                        if (packet.offset > offset) throw new Error('Invalid TFP offset');
                        return packet;
                    }
                    if (packet.offset === offset + payload.length) return packet;
                    if (packet.offset > offset) throw new Error('Invalid TFP offset');
                }
            } catch (error) {
                if (error.message !== 'TFP response timed out') throw error;
            }
        }
        throw new Error('TFP response timed out');
    }

    async upload (name, bytes, progress = () => {}) {
        const filename = new TextEncoder().encode(name);
        if (filename.length < 1 || filename.length > 80 || /[/\\\0]|\.\./.test(name)) {
            throw new Error('Invalid upload filename');
        }
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const payload = new Uint8Array(1 + filename.length + 4 + digest.length);
        payload[0] = filename.length;
        payload.set(filename, 1);
        new DataView(payload.buffer).setUint32(1 + filename.length, bytes.length, true);
        payload.set(digest, 5 + filename.length);
        const start = encode(1, this.id, 0, payload);
        if (start.length > this.channel.capacity) throw new Error('Transport capacity is too small for filename');
        let chunk = 0;
        let pendingDeadline = 0;
        let failures = 0;
        progress(0);
        try {
            while (!chunk) {
                await this.channel.send(start);
                const deadline = Math.min(Date.now() + this.timeout, pendingDeadline || Infinity);
                try {
                    let packet = await this.response(deadline);
                    while (packet.kind === 3) {
                        if (packet.offset || packet.payload.length) throw new Error('Invalid TFP pending response');
                        if (!pendingDeadline) pendingDeadline = Date.now() + this.confirmation;
                        packet = await this.response(Math.min(deadline, pendingDeadline));
                    }
                    if (packet.kind !== 2 || packet.offset || packet.payload.length !== 2) {
                        throw new Error('Invalid TFP ready response');
                    }
                    chunk = Math.min(new DataView(packet.payload.buffer).getUint16(0, true), 128,
                        this.channel.capacity - 24);
                    if (chunk < 1) throw new Error('Invalid TFP chunk size');
                } catch (error) {
                    if (error.message !== 'TFP response timed out') throw error;
                    if (pendingDeadline ? Date.now() >= pendingDeadline : ++failures > this.retries) throw error;
                }
            }
            let offset = 0;
            for (let recovery = 0; recovery <= this.retries; recovery++) {
                while (offset < bytes.length) {
                    const data = bytes.slice(offset, offset + chunk);
                    await this.exchange(4, offset, data, 5);
                    offset += data.length;
                    progress(Math.floor(offset * 99 / bytes.length));
                }
                const result = await this.exchange(6, bytes.length, new Uint8Array(), 7);
                if (result.kind === 7) {
                    progress(100); return;
                }
                offset = result.offset;
            }
            throw new Error('TFP verification failed');
        } catch (error) {
            try {
                await this.channel.send(encode(9, this.id));
            } catch { /* Preserve the upload failure. */ }
            throw error;
        }
    }
}
module.exports = {crc32, cobs, uncobs, encode, decode, FileSender};
