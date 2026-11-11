const EventEmitter = require('events');
const {SerialTransport} = require('./serial-transport');
const uuid = require('uuid');
const publicAPI = require('../api');

const STORAGE_KEY = 'tinkiblocks.communicationMethod';
const METHODS = ['local-proxy', 'web-serial'];
const PREFERENCE_KEY = 'tinkiblocks.connectionPreference';

// Keep diagnostics bounded and redact credentials before retaining them.
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
        this.preference = 'auto';
        try {
            const saved = this.storage && this.storage.getItem(PREFERENCE_KEY);
            if (['auto', 'modem', 'proxy'].includes(saved)) this.preference = saved;
        } catch {
            this.storage = null;
        }
        this.refreshInterval = environment.refreshInterval || 5000;
        this.proxyTimeout = environment.proxyTimeout || 2500;
        this.failedPorts = new WeakSet();
        this.policyEpoch = 0;
        this.retryCount = 0;
        this.document = environment.document || (typeof document === 'undefined' ? null : document);
        this.onVisibility = () => {
            if (this.document.visibilityState === 'visible') this.activate();
        };
        this.state = {method: this.method,
            preference: this.preference,
            activeTransport: null,
            phase: 'disconnected',
            upgradePending: false,
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
            const port = event.port || event.target;
            if (port && typeof port === 'object') this.failedPorts.delete(port);
            this.refreshPorts();
            if (this.started && !this.paused && event.type === 'connect') this.activate();
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
        if (!this.available || this.preference === 'proxy') return;
        try {
            const ports = await this.serial.getPorts();
            if (this.disposed || this.preference === 'proxy') return;
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
        if (!this.available || this.preference === 'proxy') return;
        try {
            const port = await this.serial.requestPort();
            if (this.disposed || this.preference === 'proxy') return;
            await this.refreshPorts();
            this.manualPort = port;
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
        this.manualPort = port;
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
                this.paused = false;
                await this.proxy.disconnect();
                this.unlisten();
                await this.disconnect(true, false);
                this.update({method, error: '', firmware: null});
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
        this.paused = false;
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
                this.update({status: 'connected',
                    modem: 'identified',
                    firmware: registration.firmware,
                    activeTransport: 'web-serial',
                    phase: 'usb-connected'});
                this.acceptRobots(registration.robots);
                this.emit('ready');
                this.log('modem', {firmware: registration.firmware, capabilities: registration.capabilities});
                this.scheduleRefresh();
            } catch (error) {
                if (attempt !== this.serialAttempt) return;
                await this.disconnect(true, false);
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

    // register renews the client lease and reads the cached registry; it sends no robot command.
    scheduleRefresh () {
        clearTimeout(this.leaseTimer);
        const epoch = this.serialAttempt;
        this.leaseTimer = setTimeout(async () => {
            try {
                const result = await this.control('register');
                if (epoch !== this.serialAttempt || !this.apiReady) return;
                this.refreshFailures = 0;
                this.acceptRobots(result.robots);
            } catch (error) {
                if (epoch !== this.serialAttempt || !this.apiReady) return;
                this.log('refresh', error.message);
                this.refreshFailures = (this.refreshFailures || 0) + 1;
                if (this.refreshFailures >= 3) {
                    await this.fail(error);
                    return;
                }
            }
            if (epoch === this.serialAttempt && this.apiReady) this.scheduleRefresh();
        }, this.refreshInterval);
    }

    start () {
        if (this.started) return this.policyTask || Promise.resolve();
        this.started = true;
        this.paused = false;
        if (this.preference !== 'proxy') this.listen();
        if (this.document) this.document.addEventListener('visibilitychange', this.onVisibility);
        return this.activate();
    }

    activate () {
        if (this.paused || this.disposed) return Promise.resolve();
        this.retryCount = 0;
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
        return this.detect();
    }

    retry () {
        this.paused = false;
        this.failedPorts = new WeakSet();
        this.update({upgradePending: false});
        return this.activate();
    }

    busy () {
        return Boolean((this.proxy.isBusy && this.proxy.isBusy()) ||
            [...this.pendingRequests.values()].some(request => !request.internal));
    }

    async selectPreference (preference) {
        if (!['auto', 'modem', 'proxy'].includes(preference)) throw new Error('Unknown connection preference');
        const selection = ++this.policyEpoch;
        this.update({switching: true});
        this.paused = true;
        clearTimeout(this.retryTimer);
        if (this.cancelProxyAttempt) this.cancelProxyAttempt();
        if (this.probe) await this.probe.disconnect(false, false);
        if (this.policyTask) await this.policyTask;
        if (selection !== this.policyEpoch) return;
        await this.disconnect(true, false);
        await this.proxy.disconnect();
        this.preference = preference;
        this.manualPort = null;
        this.failedPorts = new WeakSet();
        try {
            if (this.storage) this.storage.setItem(PREFERENCE_KEY, preference);
        } catch (error) {
            this.log('storage', error.message);
        }
        this.log('preference', preference);
        this.method = preference === 'modem' ? 'web-serial' : 'local-proxy';
        this.update({preference, method: this.method, error: '', upgradePending: false, switching: false});
        this.paused = false;
        this.started = true;
        if (preference === 'proxy') this.unlisten();
        else this.listen();
        return this.activate();
    }

    detect () {
        if (this.policyTask) return this.policyTask;
        if (this.disposed || this.paused || this.apiReady) return Promise.resolve();
        const epoch = this.policyEpoch;
        // The no-serial path starts WebSocket synchronously, preserving the adapter contract.
        this.policyTask = this.runDetection(epoch).finally(() => {
            this.policyTask = null;
        });
        return this.policyTask;
    }

    async runDetection (epoch) {
        const valid = () => !this.disposed && !this.paused && epoch === this.policyEpoch;
        const proxyWasConnected = this.state.proxyStatus === 'connected';
        if (this.preference !== 'proxy' && this.available) {
            this.update({phase: proxyWasConnected ? 'proxy-connected' : 'searching-modem'});
            await this.refreshPorts();
            const ports = this.manualPort ? [this.manualPort] : this.state.ports;
            for (const port of ports) {
                if (!valid()) return;
                if (this.failedPorts.has(port)) continue;
                // A candidate has its own parser and pending map; the active proxy stays usable.
                const candidate = new ConnectionManager({}, {serial: null, secure: true});
                candidate.serial = this.serial;
                candidate.method = 'web-serial';
                candidate.clientUuid = this.clientUuid;
                candidate.state.selectedPort = port;
                candidate.log = (kind, value) => this.log(kind, value);
                this.probe = candidate;
                await candidate.connect();
                this.probe = null;
                if (!valid() || !candidate.apiReady) {
                    if (valid()) this.failedPorts.add(port);
                    await candidate.dispose();
                    continue;
                }
                if (proxyWasConnected && this.busy()) {
                    this.update({upgradePending: true, phase: 'proxy-connected'});
                    this.log('switch', 'Compatible USB modem found; retry when commands and claims finish');
                    await candidate.dispose();
                    return;
                }
                clearTimeout(candidate.leaseTimer);
                this.update({switching: true});
                await this.proxy.disconnect();
                if (!valid()) {
                    await candidate.dispose();
                    return;
                }
                this.transport = candidate.transport;
                this.transport.onMessage = message => this.receive(message);
                this.transport.onError = error => {
                    if (!this.transport.closing) this.fail(error);
                };
                candidate.disposed = true;
                clearTimeout(candidate.logTimer);
                this.method = 'web-serial';
                this.apiReady = true;
                this.serialAttempt++;
                this.refreshFailures = 0;
                this.update({method: this.method,
                    activeTransport: this.method,
                    phase: 'usb-connected',
                    status: 'connected',
                    modem: 'identified',
                    selectedPort: port,
                    firmware: candidate.state.firmware,
                    error: '',
                    upgradePending: false,
                    switching: false});
                this.acceptRobots(candidate.state.robots);
                this.emit('ready');
                this.scheduleRefresh();
                return;
            }
        }
        if (!valid()) return;
        if (this.preference !== 'modem' && !this.manualPort) {
            if (proxyWasConnected) {
                this.update({phase: 'proxy-connected'});
                return;
            }
            this.method = 'local-proxy';
            this.update({method: this.method, phase: 'connecting-proxy'});
            try {
                if (this.proxyNeedsReset) {
                    await this.proxy.disconnect();
                    this.proxyNeedsReset = false;
                }
                if (!valid()) return;
                await Promise.race([Promise.resolve(this.proxy.connect()), new Promise((resolve, reject) => {
                    this.cancelProxyAttempt = () => reject(new Error('Connection attempt cancelled'));
                    this.proxyTimer = setTimeout(() => reject(new Error('Local Proxy connection timed out')),
                        this.proxyTimeout);
                })]);
                if (valid()) this.reportProxy('connected');
            } catch (error) {
                if (valid()) {
                    await this.proxy.disconnect();
                    this.update({phase: 'disconnected', proxyStatus: 'error', error: error.message});
                    this.log('error', error.message);
                    this.scheduleRecovery();
                }
            } finally {
                clearTimeout(this.proxyTimer);
                this.cancelProxyAttempt = null;
            }
        } else {
            this.update({phase: 'disconnected', error: 'No compatible authorised USB modem available'});
            this.scheduleRecovery();
        }
    }

    scheduleRecovery () {
        if (!this.started || this.paused || this.disposed || this.state.switching ||
            this.retryTimer || this.retryCount >= 3) return;
        const delay = [1000, 3000, 10000][this.retryCount++];
        this.log('recovery', `Retry in ${delay} ms`);
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            this.detect();
        }, delay);
    }

    async connectSelected () {
        this.manualPort = this.state.selectedPort;
        if (this.apiReady) await this.disconnect(true, false);
        this.paused = false;
        this.failedPorts = new WeakSet();
        return this.activate();
    }

    reconnectProxy () {
        if (this.started) return this.retry();
        return this.enqueue(async () => {
            if (this.method !== 'local-proxy' || this.state.proxyStatus === 'connected') return;
            await this.proxy.disconnect();
            if (!this.disposed) await this.proxy.connect();
        });
    }

    ensureConnected () {
        if (this.state.switching || this.paused) {
            return Promise.reject(new Error('Connection is disconnected or switching'));
        }
        if (this.policyTask) return this.policyTask.then(() => this.ensureConnected());
        if (this.method === 'local-proxy') return this.proxy.connect();
        return this.apiReady && this.state.status === 'connected' ? Promise.resolve() :
            Promise.reject(new Error('Connect a compatible USB gateway from the Connections tab'));
    }

    acceptRobots (robots) {
        if (!Array.isArray(robots)) throw new Error('Invalid gateway robot list');
        const ordered = robots.slice().sort((a, b) =>
            String(a['bot-uuid']).localeCompare(String(b['bot-uuid'])));
        if (JSON.stringify(ordered) === JSON.stringify(this.state.robots)) return;
        this.update({robots: ordered});
        this.log('discovery', ordered);
        this.emit('message', {event: 'connected_robots', robots: ordered});
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
        if (!internal && this.state.switching) return Promise.reject(new Error('Connection is switching'));
        if (this.method === 'local-proxy') {
            this.log('tx', payload);
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

    async disconnect (notifyGateway = true, manual = true) {
        if (manual) {
            this.paused = true;
            this.policyEpoch++;
            clearTimeout(this.retryTimer);
            if (this.cancelProxyAttempt) this.cancelProxyAttempt();
            if (this.probe) await this.probe.disconnect(false, false);
            if (this.method === 'local-proxy' && this.proxy.disconnect) await this.proxy.disconnect();
        }
        this.serialAttempt++;
        clearTimeout(this.leaseTimer);
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
        this.update({...(this.method === 'local-proxy' ? {proxyStatus: 'disconnected'} : {}),
            activeTransport: null,
            phase: 'disconnected',
            status: this.available ? 'disconnected' : 'unsupported',
            modem: 'unidentified',
            robots: this.state.robots.map(robot => ({...robot, connected: false}))});
        this.emit('disconnected', error);
    }

    async fail (error) {
        this.log('error', error.message);
        await this.disconnect(false, false);
        this.update({status: 'error', error: error.message});
        this.scheduleRecovery();
    }

    reportProxy (status) {
        this.update({proxyStatus: status,
            ...(this.method === 'local-proxy' ? {
                activeTransport: status === 'connected' ? 'local-proxy' : null,
                phase: status === 'connected' ? 'proxy-connected' :
                    (status === 'connecting' ? 'connecting-proxy' : 'disconnected')
            } : {})});
        this.log('proxy', status);
        if (['disconnected', 'error'].includes(status) && this.method === 'local-proxy') {
            this.proxyNeedsReset = true;
            this.emit('disconnected', new Error('Local Proxy disconnected'));
            this.scheduleRecovery();
        }
    }

    async dispose () {
        this.disposed = true;
        this.unlisten();
        if (this.document) this.document.removeEventListener('visibilitychange', this.onVisibility);
        clearTimeout(this.retryTimer);
        clearTimeout(this.proxyTimer);
        await this.disconnect();
        await this.operations;
        if (this.proxy.disconnect) await this.proxy.disconnect();
        clearTimeout(this.logTimer);
        this.removeAllListeners();
    }
}

module.exports = ConnectionManager;
