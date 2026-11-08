// Counters distinguish VM instances without exposing persistent client or robot identities.
let nextInstance = 0;
let nextAttempt = 0;
const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
const stateName = socket => (socket && stateNames[socket.readyState]) || 'UNKNOWN';

class ConnectionDiagnostics {
    constructor () {
        this.instance = ++nextInstance;
        this.currentAttempt = null;
    }

    createAttempt () {
        const instance = this.instance;
        const attempt = ++nextAttempt;
        const started = Date.now();
        let duplicateLogged = false;
        let attemptSocket = null;
        const record = {
            opened: false,
            log (event, socket, details = {}) {
                const context = Object.assign({
                    instance,
                    attempt,
                    elapsedMs: Date.now() - started,
                    state: stateName(socket),
                    isCurrentSocket: Boolean(socket && socket === window.socket)
                }, details);
                const level = event === 'failed' ? 'warn' :
                    event === 'duplicate attempt prevented' ? 'debug' : 'info';
                // eslint-disable-next-line no-console -- Handshake metadata only; never log robot frames.
                console[level](`Tinkibot WebSocket: ${event}`, context);
            },
            start (socket, previousSocket) {
                attemptSocket = socket;
                record.log('attempt started', socket, {
                    origin: window.location && window.location.origin,
                    secureContext: window.isSecureContext,
                    framed: window !== window.top,
                    documentReadyState: window.document && window.document.readyState,
                    visibility: window.document && window.document.visibilityState,
                    previousSocketState: stateName(previousSocket)
                });
            },
            duplicate () {
                if (duplicateLogged) return;
                duplicateLogged = true;
                record.log('duplicate attempt prevented', attemptSocket);
            }
        };
        this.currentAttempt = record;
        return record;
    }
}

module.exports = ConnectionDiagnostics;
