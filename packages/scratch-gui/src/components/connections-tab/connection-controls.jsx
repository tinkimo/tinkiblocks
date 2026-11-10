import React, {useCallback, useState} from 'react';
import PropTypes from 'prop-types';
import {defineMessages, FormattedMessage, useIntl} from 'react-intl';
import styles from './connections-tab.css';

const messages = defineMessages({
    method: {
        id: 'gui.connectionsTab.method',
        defaultMessage: 'Communication method',
        description: 'Transport selector'
    },
    proxy: {
        id: 'gui.connectionsTab.proxy',
        defaultMessage: 'Local Proxy',
        description: 'WebSocket proxy transport'
    },
    serial: {
        id: 'gui.connectionsTab.serial',
        defaultMessage: 'Web Serial',
        description: 'Direct USB serial transport'
    },
    device: {
        id: 'gui.connectionsTab.device',
        defaultMessage: 'USB modem',
        description: 'Authorised serial port selector'
    },
    noPorts: {
        id: 'gui.connectionsTab.noPorts',
        defaultMessage: 'No authorised USB devices',
        description: 'Empty port list'
    },
    add: {
        id: 'gui.connectionsTab.addUsb',
        defaultMessage: 'Add USB Device',
        description: 'Open native serial permission dialog'
    },
    refresh: {
        id: 'gui.connectionsTab.refreshUsb',
        defaultMessage: 'Refresh devices',
        description: 'Refresh authorised serial ports'
    },
    connect: {
        id: 'gui.connectionsTab.connectUsb',
        defaultMessage: 'Connect',
        description: 'Open selected USB modem'
    },
    disconnect: {
        id: 'gui.connectionsTab.disconnectUsb',
        defaultMessage: 'Disconnect',
        description: 'Close selected USB modem'
    },
    unsupported: {
        id: 'gui.connectionsTab.unsupported',
        defaultMessage: 'Unsupported',
        description: 'Serial unavailable status'
    },
    disconnected: {
        id: 'gui.connectionsTab.usbDisconnected',
        defaultMessage: 'Disconnected',
        description: 'USB disconnected status'
    },
    connecting: {
        id: 'gui.connectionsTab.usbConnecting',
        defaultMessage: 'Connecting',
        description: 'USB connecting status'
    },
    connected: {
        id: 'gui.connectionsTab.usbConnected',
        defaultMessage: 'Connected',
        description: 'USB connected status'
    },
    error: {
        id: 'gui.connectionsTab.usbError',
        defaultMessage: 'Error',
        description: 'USB error status'
    },
    identified: {
        id: 'gui.connectionsTab.identified',
        defaultMessage: 'Tinkimodem identified',
        description: 'Handshake succeeded'
    },
    identifying: {
        id: 'gui.connectionsTab.identifying',
        defaultMessage: 'Identifying modem',
        description: 'Handshake in progress'
    },
    unidentified: {
        id: 'gui.connectionsTab.unidentified',
        defaultMessage: 'Modem not identified',
        description: 'Handshake not completed'
    },
    clear: {
        id: 'gui.connectionsTab.clearLog',
        defaultMessage: 'Clear log',
        description: 'Clear diagnostic buffer'
    },
    copy: {
        id: 'gui.connectionsTab.copyLog',
        defaultMessage: 'Copy log',
        description: 'Copy diagnostics to clipboard'
    },
    copied: {
        id: 'gui.connectionsTab.logCopied',
        defaultMessage: 'Log copied',
        description: 'Clipboard success'
    },
    copyFailed: {
        id: 'gui.connectionsTab.copyFailed',
        defaultMessage: 'Could not copy log',
        description: 'Clipboard failure'
    },
    verbose: {
        id: 'gui.connectionsTab.verbose',
        defaultMessage: 'Verbose logging (raw and parsed messages)',
        description: 'Enable detailed USB diagnostics'
    },
    debug: {
        id: 'gui.connectionsTab.debug',
        defaultMessage: 'Connection debug log',
        description: 'Temporary diagnostics panel'
    },
    availability: {
        id: 'gui.connectionsTab.availability',
        defaultMessage: 'Web Serial available: {supported}; secure context: {secure}',
        description: 'Browser capability diagnostics'
    },
    yes: {
        id: 'gui.connectionsTab.yes',
        defaultMessage: 'Yes',
        description: 'Capability available'
    },
    no: {
        id: 'gui.connectionsTab.no',
        defaultMessage: 'No',
        description: 'Capability unavailable'
    },
    usbStatus: {
        id: 'gui.connectionsTab.usbStatus',
        defaultMessage: 'USB: {status} · {modem}',
        description: 'Separate serial and modem handshake status'
    },
    proxyStatus: {
        id: 'gui.connectionsTab.proxyStatus',
        defaultMessage: 'Local Proxy: {status}',
        description: 'Existing WebSocket status'
    },
    unknown: {
        id: 'gui.connectionsTab.unknownUsb',
        defaultMessage: 'USB device {number} (identifiers unavailable)',
        description: 'Port without USB IDs'
    },
    port: {
        id: 'gui.connectionsTab.usbPort',
        defaultMessage: 'USB device {number} · VID {vendor} / PID {product}',
        description: 'Serial port USB identifiers'
    }
});

const portLabel = (port, index, intl) => {
    const info = port.getInfo();
    const hex = value => (typeof value === 'number' ? `0x${value.toString(16).padStart(4, '0')}` : '—');
    return intl.formatMessage(typeof info.usbVendorId === 'number' ? messages.port : messages.unknown,
        {number: index + 1, vendor: hex(info.usbVendorId), product: hex(info.usbProductId)});
};

// Temporary diagnostics: remove this component and its single call site after the POC.
const ConnectionDebugPanel = ({manager, state}) => {
    const intl = useIntl();
    const [copyStatus, setCopyStatus] = useState(null);
    const serial = state.method === 'web-serial';
    const changeVerbose = useCallback(event => manager.setVerbose(event.target.checked), [manager]);
    const clearLog = useCallback(() => manager.clearLog(), [manager]);
    const copyLog = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(JSON.stringify({
                method: state.method,
                supported: state.supported,
                secure: state.secure,
                status: state.status,
                modem: state.modem,
                proxyStatus: state.proxyStatus,
                device: state.selectedPort ? state.selectedPort.getInfo() : null,
                logs: state.logs
            }, null, 2));
            setCopyStatus('copied');
        } catch (error) {
            setCopyStatus('copyFailed');
        }
    }, [state]);
    return (
        <details className={styles.debugPanel}>
            <summary>{intl.formatMessage(messages.debug)}</summary>
            <p>{intl.formatMessage(serial ? messages.serial : messages.proxy)}</p>
            <p>{intl.formatMessage(messages.availability, {
                supported: intl.formatMessage(state.supported ? messages.yes : messages.no),
                secure: intl.formatMessage(state.secure ? messages.yes : messages.no)
            })}</p>
            <p>{intl.formatMessage(messages.usbStatus, {
                status: intl.formatMessage(messages[state.status]), modem: intl.formatMessage(messages[state.modem])
            })}</p>
            {state.selectedPort ? (
                <p>{portLabel(state.selectedPort, state.ports.indexOf(state.selectedPort), intl)}</p>
            ) : null}
            <label>
                <input
                    checked={state.verbose}
                    type="checkbox"
                    onChange={changeVerbose}
                />{intl.formatMessage(messages.verbose)}
            </label>
            <div className={styles.connectionActions}>
                <button
                    type="button"
                    onClick={clearLog}
                >{intl.formatMessage(messages.clear)}</button>
                <button
                    type="button"
                    onClick={copyLog}
                >{intl.formatMessage(messages.copy)}</button>
                {copyStatus ? <span role="status">{intl.formatMessage(messages[copyStatus])}</span> : null}
            </div>
            <pre>{state.logs.map(entry => `${entry.time} [${entry.kind}] ${entry.value}`).join('\n')}</pre>
        </details>
    );
};

ConnectionDebugPanel.propTypes = {
    manager: PropTypes.object.isRequired,
    state: PropTypes.object.isRequired
};

const ConnectionControls = ({manager, state}) => {
    const intl = useIntl();
    const serial = state.method === 'web-serial';
    const busy = state.switching || state.status === 'connecting';
    const open = state.status === 'connected' || state.status === 'connecting';
    const available = state.supported && state.secure;
    const run = useCallback(operation => operation.catch(error => manager.log('error', error.message)), [manager]);
    const changeMethod = useCallback(event => run(manager.selectMethod(event.target.value)), [manager, run]);
    const changePort = useCallback(event => {
        manager.selectPort(state.ports[Number(event.target.value)]);
    }, [manager, state.ports]);
    const addPort = useCallback(() => run(manager.addPort()), [manager, run]);
    const refreshPorts = useCallback(() => run(manager.refreshPorts()), [manager, run]);
    const toggleConnection = useCallback(
        () => run(open ? manager.disconnect() : manager.connect()), [manager, open, run]);
    return (
        <div className={styles.connectionControls}>
            <label>
                {intl.formatMessage(messages.method)}
                <select
                    disabled={state.switching}
                    value={state.method}
                    onChange={changeMethod}
                >
                    <option value="local-proxy">{intl.formatMessage(messages.proxy)}</option>
                    <option value="web-serial">{intl.formatMessage(messages.serial)}</option>
                </select>
            </label>
            {serial ? (
                <div>
                    {available ? null : (
                        <p role="status">
                            <FormattedMessage
                                defaultMessage="Web Serial requires HTTPS and a current desktop Chrome
                                or Microsoft Edge browser.
                                Check that this site's serial permission is allowed."
                                description="Web Serial capability and security guidance"
                                id="gui.connectionsTab.serialUnavailable"
                            />
                        </p>
                    )}
                    <label>
                        {intl.formatMessage(messages.device)}
                        <select
                            disabled={!available || open || busy}
                            value={state.ports.indexOf(state.selectedPort)}
                            onChange={changePort}
                        >
                            {state.ports.length ? null : (
                                <option value={-1}>{intl.formatMessage(messages.noPorts)}</option>
                            )}
                            {state.ports.map((port, index) => (
                                <option
                                    key={index}
                                    value={index}
                                >{portLabel(port, index, intl)}</option>
                            ))}
                        </select>
                    </label>
                    <div className={styles.connectionActions}>
                        <button
                            disabled={!available || busy || open}
                            type="button"
                            onClick={addPort}
                        >{intl.formatMessage(messages.add)}</button>
                        <button
                            disabled={!available || busy}
                            type="button"
                            onClick={refreshPorts}
                        >{intl.formatMessage(messages.refresh)}</button>
                        <button
                            disabled={!available || state.switching || (!open && !state.selectedPort)}
                            type="button"
                            onClick={toggleConnection}
                        >{intl.formatMessage(open ? messages.disconnect : messages.connect)}</button>
                    </div>
                    <p role="status">{intl.formatMessage(messages.usbStatus, {
                        status: intl.formatMessage(messages[state.status]),
                        modem: intl.formatMessage(messages[state.modem])
                    })}</p>
                    <p>
                        <FormattedMessage
                            defaultMessage="USB connects to the modem. Robots below are discovered through it.
                            This preview supports discovery only; use Local Proxy to claim and control robots.
                            Other serial devices are not assumed to be Tinkimo modems."
                            description="Explain modem versus robots and proof of concept scope"
                            id="gui.connectionsTab.discoveryOnly"
                        />
                    </p>
                </div>
            ) : <p role="status">{intl.formatMessage(messages.proxyStatus, {
                status: intl.formatMessage(messages[state.proxyStatus])
            })}</p>}
            {state.error ? <p role="alert">{state.error}</p> : null}
            <ConnectionDebugPanel
                manager={manager}
                state={state}
            />
        </div>
    );
};

ConnectionControls.propTypes = {
    manager: PropTypes.object.isRequired,
    state: PropTypes.object.isRequired
};

export default ConnectionControls;
