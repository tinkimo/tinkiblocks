// Mirrors comms/framing.py: split binary envelopes before decoding UTF-8 text.
class SerialFramer {
    constructor () {
        this.pending = [];
        this.binary = false;
        this.discard = false;
        this.decoder = new TextDecoder();
    }

    feed (bytes) {
        const messages = [];
        for (const byte of bytes) {
            if (byte === 0) {
                if (this.binary && this.pending.length && !this.discard) {
                    messages.push({kind: 'binary', bytes: this.pending.length});
                }
                this.binary = !this.binary;
                this.pending = [];
                this.discard = false;
            } else if (!this.binary && byte === 10) {
                if (!this.discard) {
                    messages.push({kind: 'text',
                        text: this.decoder.decode(
                            new Uint8Array(this.pending)).trim()});
                }
                this.pending = [];
                this.discard = false;
            } else if (!this.discard) {
                this.pending.push(byte);
                if (this.pending.length > (this.binary ? 510 : 24704)) {
                    this.pending = [];
                    this.discard = true;
                    messages.push({kind: 'overflow'});
                }
            }
        }
        return messages;
    }
}

class SerialTransport {
    constructor ({onMessage, onError}) {
        this.onMessage = onMessage;
        this.onError = onError;
        this.writeTail = Promise.resolve();
        this.closing = false;
    }

    async open (port) {
        if (this.port) throw new Error('Serial transport is already open');
        this.port = port;
        this.closing = false;
        this.framer = new SerialFramer();
        // PySerial defaults: 115200, 8 data bits, no parity, one stop bit, no flow control.
        // Do not toggle DTR/RTS or send break: those may reset/bootload ESP32 boards.
        this.opening = port.open({baudRate: 115200,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'});
        try {
            await this.opening;
            this.reader = port.readable.getReader();
            this.writer = port.writable.getWriter();
            this.readTask = this.read();
        } catch (error) {
            await this.close();
            throw error;
        }
    }

    async read () {
        try {
            while (!this.closing) {
                const {value, done} = await this.reader.read();
                if (this.closing) return;
                if (done) {
                    if (!this.closing) throw new Error('Serial device disconnected');
                    return;
                }
                for (const message of this.framer.feed(value)) this.onMessage(message);
            }
        } catch (error) {
            if (!this.closing) this.onError(error);
        }
    }

    write (text) {
        const writer = this.writer;
        const operation = this.writeTail.then(() => {
            if (this.closing || !writer || writer !== this.writer) throw new Error('Serial device disconnected');
            return writer.write(new TextEncoder().encode(text));
        });
        this.writeTail = operation.catch(() => {});
        return operation;
    }

    close () {
        if (this.closeTask) return this.closeTask;
        this.closing = true;
        this.closeTask = this.finishClose().finally(() => {
            this.closeTask = null;
        });
        return this.closeTask;
    }

    async finishClose () {
        if (!this.port) return;
        const port = this.port;
        try {
            await this.opening;
        } catch {
            this.port = null;
            return;
        }
        try {
            const results = await Promise.allSettled([
                this.reader ? this.reader.cancel() : Promise.resolve(),
                this.writer ? this.writer.abort() : Promise.resolve()
            ]);
            await this.readTask;
            await this.writeTail;
            const failure = results.find(result => result.status === 'rejected');
            if (failure) this.onError(failure.reason);
        } finally {
            if (this.reader) this.reader.releaseLock();
            if (this.writer) this.writer.releaseLock();
            this.reader = null;
            this.writer = null;
            try {
                await port.close();
            } finally {
                this.port = null;
            }
        }
    }
}

module.exports = {SerialFramer, SerialTransport};
