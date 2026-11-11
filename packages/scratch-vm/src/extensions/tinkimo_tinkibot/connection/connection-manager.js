const EventEmitter = require('events');
const {SerialTransport} = require('./serial-transport');
const uuid = require('uuid');
const publicAPI = require('../api');

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
            proxyStatus: 'disconnected',
            firmware: null};
        this.transport = new SerialTransport({
            onMessage: message => this.receive(message),
            onError: error => {
                if (!this.transport.closing) this.fail(error);
            }
        });
        this.pendingRequests = new Map();
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
                this.update({method, robots: [], error: '', firmware: null});
                this.emit('message', {event: 'connected_robots', robots: []});
                try {
                    if (this.storage) this.storage.setItem(STORAGE_KEY, method);
                } catch (error) {
                    this.log('storage', error.message);
                }
                this.log('method', method);
                if (method === 'web-serial') this.listen();
                else Promise.resolve(this.proxy.connect()).catch(error => this.log('error', error.message));
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
                const registration = await this.control('register').catch(error => {
                    throw new Error(`Gateway registration failed; install tinkimoden-proxy firmware: ${error.message}`);
                });
                if (!Array.isArray(registration.capabilities) ||
                    !registration.capabilities.includes('robot-api-v1')) {
                    throw new Error('Install tinkimoden-proxy firmware with robot-api-v1 support');
                }
                if (attempt !== this.serialAttempt) return;
                this.apiReady = true;
                this.update({status: 'connected', modem: 'identified', firmware: registration.firmware});
                this.acceptRobots(registration.robots);
                this.emit('ready');
                this.log('modem', {firmware: registration.firmware, capabilities: registration.capabilities});
                const leaseEpoch = this.serialAttempt;
                this.leaseTimer = setInterval(() => {
                    this.control('register').then(result => this.acceptRobots(result.robots))
                        .catch(error => {
                            if (this.serialAttempt === leaseEpoch) this.fail(error);
                        });
                }, 5000);
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
        if (this.method !== 'web-serial' || this.transport.closing) return;
        if (message.kind !== 'text') {
            this.log(message.kind === 'overflow' ? 'error' : 'binary', message);
            return;
        }
        if (!message.text) return;
        this.log('rx', message.text);
        if (['tinkimodem', 'tinkimoden-proxy'].includes(message.text.toLowerCase()) && this.identifyDone) {
            this.identifyDone();
        } else {
            let value;
            try {
                value = JSON.parse(message.text);
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    throw new Error('Expected JSON object');
                }
            } catch (error) {
                this.log('error', `Invalid gateway JSON: ${error.message}`);
                return;
            }
            this.log('parsed', value);
            if (value.event) {
                if (!this.apiReady) return;
                if (value.event === 'session_ended') {
                    this.fail(new Error(value.message || 'Gateway session ended'));
                    return;
                }
                if (value.event === 'connected_robots') this.acceptRobots(value.robots);
                else if (value.event === 'diagnostic') this.log('diagnostic', value);
                else {
                    if (value.event === 'robot_disconnected') {
                        for (const [id, request] of this.pendingRequests) {
                            if (request.payload['bot-uuid'] === value['bot-uuid']) {
                                clearTimeout(request.timer);
                                request.reject(new Error('Robot disconnected before replying'));
                                this.pendingRequests.delete(id);
                            }
                        }
                    }
                    this.emit('message', value);
                    this.log('event', value);
                }
                return;
            }
            if (value.status === 'ERROR' && !value['request-id']) {
                this.fail(new Error(value.message || 'Uncorrelated gateway error'));
                return;
            }
            const pending = this.pendingRequests.get(value['request-id']);
            if (!pending || value['client-uuid'] !== pending.payload['client-uuid'] ||
                value['bot-uuid'] !== pending.payload['bot-uuid'] || !['OK', 'ERROR'].includes(value.status)) return;
            clearTimeout(pending.timer);
            this.pendingRequests.delete(value['request-id']);
            if (!pending.internal) this.emit('message', value);
            pending.resolve(value);
        }
    }

    reconnectProxy () {
        return this.enqueue(async () => {
            if (this.method !== 'local-proxy' || this.state.proxyStatus === 'connected') return;
            await this.proxy.disconnect();
            if (!this.disposed) await this.proxy.connect();
        });
    }

    ensureConnected () {
        if (this.method === 'local-proxy') return this.proxy.connect();
        return this.apiReady && this.state.status === 'connected' ? Promise.resolve() :
            Promise.reject(new Error('Connect a compatible USB gateway from the Connections tab'));
    }

    acceptRobots (robots) {
        if (!Array.isArray(robots)) throw new Error('Invalid gateway robot list');
        this.update({robots});
        this.emit('message', {event: 'connected_robots', robots});
    }

    control (command) {
        return this.sendRequest({'command': command,
            'client-uuid': this.clientUuid,
            'request-id': uuid.v4()}, true).then(result => {
            if (result.status !== 'OK') throw new Error(result.message || 'Gateway control request failed');
            return result;
        });
    }

    sendRequest (payload, internal = false) {
        if (this.method === 'local-proxy') {
            try {
                return Promise.resolve(this.proxy.send(payload));
            } catch (error) {
                return Promise.reject(error);
            }
        }
        if (!internal && !this.apiReady) return Promise.reject(new Error('USB gateway is not ready'));
        if (this.pendingRequests.size >= 32 || this.pendingRequests.has(payload['request-id'])) {
            return Promise.reject(new Error('Too many pending requests or duplicate request ID'));
        }
        const wire = `${JSON.stringify(payload)}\n`;
        if (new TextEncoder().encode(wire).length > 6145) {
            return Promise.reject(new Error('Gateway request exceeds 6144 UTF-8 bytes'));
        }
        return new Promise((resolve, reject) => {
            const timeout = publicAPI.timeout(payload);
            const timer = setTimeout(() => {
                this.pendingRequests.delete(payload['request-id']);
                this.log('error', {message: 'Gateway request timed out', request: payload['request-id']});
                reject(new Error('Gateway request timed out'));
            }, timeout);
            this.pendingRequests.set(payload['request-id'], {payload, resolve, reject, timer, internal});
            this.send(wire).catch(error => {
                clearTimeout(timer);
                this.pendingRequests.delete(payload['request-id']);
                reject(error);
            });
        });
    }

    async disconnect (notifyGateway = true) {
        this.serialAttempt++;
        clearInterval(this.leaseTimer);
        const wasReady = this.apiReady;
        this.apiReady = false;
        const error = new Error('Robot transport disconnected');
        for (const pending of this.pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingRequests.clear();
        if (this.identifyDone) this.identifyDone(new Error('Serial connection cancelled'));
        if (wasReady && notifyGateway && !this.transport.closing) {
            // End the client lease without replaying, releasing or cancelling physical actions.
            let timer;
            await Promise.race([
                this.send(`${JSON.stringify({'command': 'end-session',
                    'client-uuid': this.clientUuid,
                    'request-id': uuid.v4()})}\n`).catch(failure => this.log('error', failure.message)),
                new Promise(resolve => {
                    timer = setTimeout(resolve, 200);
                })
            ]);
            clearTimeout(timer);
        }
        try {
            await this.transport.close();
        } catch (failure) {
            this.log('error', failure.message);
            this.update({error: failure.message});
        }
        this.update({status: this.available ? 'disconnected' : 'unsupported',
            modem: 'unidentified',
            robots: this.state.robots.map(robot => ({...robot, connected: false}))});
        this.emit('disconnected', error);
    }

    async fail (error) {
        this.log('error', error.message);
        await this.disconnect(false);
        this.update({status: 'error', error: error.message});
    }

    reportProxy (status) {
        this.update({proxyStatus: status});
        this.log('proxy', status);
        if (status === 'disconnected' && this.method === 'local-proxy') {
            this.emit('disconnected', new Error('Local Proxy disconnected'));
        }
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
