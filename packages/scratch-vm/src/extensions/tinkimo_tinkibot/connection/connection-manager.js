const EventEmitter = require('events');
const {SerialTransport} = require('./serial-transport');
const ModemDiscovery = require('./modem-discovery');

const STORAGE_KEY = 'tinkiblocks.communicationMethod';
const METHODS = ['local-proxy', 'web-serial'];

// Diagnostic output is temporary and deliberately isolated from transport/protocol code.
const redact = value => String(typeof value === 'string' ? value : JSON.stringify(value))
    .slice(0, 1000)
    .replace(/-----BEGIN[\s\S]*/g, '[redacted key]')
    .replace(/\b((?:password|passwd|token|secret|credentials?|[\w-]*key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi,
        '$1[redacted]')
    .slice(0, 1000);

class ConnectionManager extends EventEmitter {
    constructor (proxy, environment = {}) {
        super();
        this.proxy = proxy;
        this.serial = Object.prototype.hasOwnProperty.call(environment, 'serial') ? environment.serial :
            (typeof navigator === 'undefined' ? null : navigator.serial);
        this.secure = Object.prototype.hasOwnProperty.call(environment, 'secure') ? environment.secure :
            (typeof window !== 'undefined' && window.isSecureContext === true);
        try {
            this.storage = environment.storage || (typeof window !== 'undefined' && window.localStorage);
            this.method = this.storage && this.storage.getItem(STORAGE_KEY);
        } catch {
            this.storage = null;
        }
        if (!METHODS.includes(this.method)) this.method = 'local-proxy';
        this.state = {method: this.method,
            supported: Boolean(this.serial),
            secure: this.secure,
            status: this.available ? 'disconnected' : 'unsupported',
            modem: 'unidentified',
            ports: [],
            selectedPort: null,
            robots: [],
            logs: [],
            verbose: false,
            error: '',
            switching: false,
            proxyStatus: 'disconnected'};
        this.transport = new SerialTransport({
            onMessage: message => this.receive(message),
            onError: error => {
                if (!this.transport.closing) this.fail(error);
            }
        });
        this.discovery = new ModemDiscovery({
            send: text => this.send(text),
            onRobots: robots => this.update({robots}),
            log: (...args) => this.log(...args)
        });
        this.operations = Promise.resolve();
        this.serialAttempt = 0;
        this.onPortsChanged = event => {
            if (event.type === 'disconnect' && (event.port || event.target) === this.transport.port) {
                this.fail(new Error('Serial device removed'));
            }
            this.refreshPorts();
        };
        if (this.method === 'web-serial') this.listen();
    }

    get available () {
        return Boolean(this.serial && this.secure);
    }

    snapshot () {
        return {...this.state, logs: this.state.logs.slice()};
    }

    update (changes) {
        Object.assign(this.state, changes);
        this.emit('change', this.snapshot());
    }

    log (kind, value) {
        if (this.disposed) return;
        if (['tx', 'rx', 'parsed', 'binary'].includes(kind) && !this.state.verbose) return;
        this.state.logs.push({time: new Date().toISOString(), kind, value: redact(value)});
        if (this.state.logs.length > 200) this.state.logs.shift();
        if (!this.logTimer) {
            this.logTimer = setTimeout(() => {
                this.logTimer = null;
                this.update({});
            }, 50);
        }
    }

    clearLog () {
        this.update({logs: []});
    }

    setVerbose (verbose) {
        this.update({verbose});
    }

    listen () {
        if (!this.available || this.listening) return;
        this.serial.addEventListener('connect', this.onPortsChanged);
        this.serial.addEventListener('disconnect', this.onPortsChanged);
        this.listening = true;
        this.refreshPorts();
    }

    unlisten () {
        if (!this.listening) return;
        this.serial.removeEventListener('connect', this.onPortsChanged);
        this.serial.removeEventListener('disconnect', this.onPortsChanged);
        this.listening = false;
    }

    async refreshPorts () {
        if (!this.available || this.method !== 'web-serial') return;
        try {
            const ports = await this.serial.getPorts();
            if (this.disposed || this.method !== 'web-serial') return;
            this.update({ports,
                selectedPort: ports.includes(this.state.selectedPort) ?
                    this.state.selectedPort : (ports[0] || null)});
        } catch (error) {
            this.update({error: error.message});
            this.log('error', error.message);
        }
    }

    // Called by the click handler without awaiting anything before the native picker.
    async addPort () {
        if (!this.available || this.method !== 'web-serial') return;
        try {
            const port = await this.serial.requestPort();
            if (this.disposed || this.method !== 'web-serial') return;
            await this.refreshPorts();
            this.update({selectedPort: port, error: ''});
        } catch (error) {
            if (error.name === 'NotFoundError') {
                this.log('permission', 'Device selection cancelled');
            } else {
                this.update({error: error.message});
                this.log('error', error.message);
            }
        }
    }

    selectPort (port) {
        if (this.transport.port || this.state.switching) return;
        this.update({selectedPort: port});
    }

    selectMethod (method) {
        if (!METHODS.includes(method)) return Promise.reject(new Error('Unknown communication method'));
        return this.enqueue(async () => {
            if (this.method === method) return;
            this.update({switching: true});
            try {
                // Gate new proxy commands before releasing either transport.
                this.method = method;
                await this.proxy.disconnect();
                this.unlisten();
                await this.disconnect();
                this.update({method, robots: [], error: ''});
                try {
                    if (this.storage) this.storage.setItem(STORAGE_KEY, method);
                } catch (error) {
                    this.log('storage', error.message);
                }
                this.log('method', method);
                if (method === 'web-serial') this.listen();
                else this.proxy.connect();
            } finally {
                this.update({switching: false});
            }
        });
    }

    enqueue (operation) {
        const result = this.operations.then(() => (this.disposed ? null : operation()));
        this.operations = result.catch(() => {});
        return result;
    }

    connect () {
        return this.enqueue(async () => {
            if (!this.available || this.method !== 'web-serial' || this.transport.port) return;
            const port = this.state.selectedPort;
            if (!port) return;
            const attempt = ++this.serialAttempt;
            this.update({status: 'connecting', modem: 'identifying', error: '', robots: []});
            this.log('device', port.getInfo());
            try {
                await this.transport.open(port);
                if (this.transport.closing || attempt !== this.serialAttempt) return;
                await this.identify();
                if (attempt !== this.serialAttempt) return;
                this.update({status: 'connected', modem: 'identified'});
                this.log('modem', 'tinkimodem identified');
                this.discovery.robots.clear();
                this.discovery.start();
            } catch (error) {
                if (attempt !== this.serialAttempt) return;
                await this.disconnect();
                this.update({status: 'error', modem: 'unidentified', error: error.message});
                this.log('error', error.message);
            }
        });
    }

    identify () {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const finish = error => {
                clearTimeout(this.identifyTimer);
                this.identifyDone = null;
                if (error) reject(error);
                else resolve();
            };
            this.identifyDone = finish;
            const attempt = () => {
                if (attempts++ === 3) {
                    finish(new Error('No tinkimodem response after three identify attempts'));
                    return;
                }
                this.identifyTimer = setTimeout(attempt, 1000);
                this.send('identify\n').catch(error => {
                    if (this.identifyDone === finish) finish(error);
                });
            };
            attempt();
        });
    }

    async send (text) {
        this.log('tx', text);
        try {
            await this.transport.write(text);
        } catch (error) {
            if (!this.transport.closing && this.state.status === 'connected') await this.fail(error);
            throw error;
        }
    }

    receive (message) {
        if (message.kind !== 'text') {
            this.log(message.kind === 'overflow' ? 'error' : 'binary', message);
            return;
        }
        if (!message.text) return;
        this.log('rx', message.text);
        if (message.text.toLowerCase() === 'tinkimodem' && this.identifyDone) this.identifyDone();
        else this.discovery.receive(message.text);
    }

    async disconnect () {
        this.serialAttempt++;
        this.discovery.stop();
        if (this.identifyDone) this.identifyDone(new Error('Serial connection cancelled'));
        try {
            await this.transport.close();
        } catch (error) {
            this.log('error', error.message);
            this.update({error: error.message});
        }
        this.update({status: this.available ? 'disconnected' : 'unsupported', modem: 'unidentified'});
    }

    async fail (error) {
        this.log('error', error.message);
        await this.disconnect();
        this.update({status: 'error', error: error.message});
    }

    reportProxy (status) {
        this.update({proxyStatus: status});
        this.log('proxy', status);
    }

    async dispose () {
        this.disposed = true;
        this.unlisten();
        await this.disconnect();
        await this.operations;
        await this.proxy.disconnect();
        clearTimeout(this.logTimer);
        this.removeAllListeners();
    }
}

module.exports = ConnectionManager;
