import React from 'react';
import {act, fireEvent, render, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {IntlProvider} from 'react-intl';
import EventEmitter from 'events';

import ConnectionsTab from '../../../src/components/connections-tab/connections-tab';

const renderConnections = (robots, manager = null) => {
    const runtime = new EventEmitter();
    runtime.tinkibotConnectedRobots = robots;
    runtime.tinkibotConnectionManager = manager;
    runtime.claimTinkibotRobot = jest.fn();
    runtime.releaseTinkibotRobot = jest.fn();
    runtime.removeTinkibotRobot = jest.fn();
    return {runtime,
        ...render(
            <IntlProvider locale="en">
                <ConnectionsTab vm={{runtime}} />
            </IntlProvider>
        )};
};

describe('ConnectionsTab', () => {
    test('disables other claim buttons while a robot is claimed', () => {
        const {getByRole, queryByRole} = renderConnections([
            {nickname: 'orange', botUuid: 'orange-uuid', claimState: 'paired'},
            {nickname: 'blue', botUuid: 'blue-uuid', claimState: 'free'}
        ]);

        expect(getByRole('button', {name: 'Claim'})).toBeDisabled();
        expect(getByRole('button', {name: 'Release'})).toBeEnabled();
        expect(queryByRole('button', {name: 'Remove'})).toBeNull();
    });
    test('disconnected reservation stays visible and Remove frees the selection', () => {
        const robots = [
            {nickname: 'lime', botUuid: 'lime-uuid', claimState: 'paired', connected: false},
            {nickname: 'blue', botUuid: 'blue-uuid', claimState: 'free'}
        ];
        const {getByText, getByRole, runtime} = renderConnections(robots);
        expect(getByText('Disconnected')).toBeVisible();
        expect(getByRole('button', {name: 'Claim'})).toBeDisabled();
        const card = getByText('lime').closest('div');
        expect(within(card).queryByRole('button', {name: 'Claim'})).toBeNull();
        expect(within(card).queryByRole('button', {name: 'Release'})).toBeNull();
        fireEvent.click(within(card).getByRole('button', {name: 'Remove'}));
        expect(runtime.removeTinkibotRobot).toHaveBeenCalledWith('lime-uuid');
        act(() => runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED', [robots[1]]));
        expect(getByRole('button', {name: 'Claim'})).toBeEnabled();
    });

    test('reconnection restores the paired card without claiming again', () => {
        const robot = {nickname: 'lime', botUuid: 'lime-uuid', claimState: 'paired', connected: false};
        const {getByText, getByRole, queryByText, queryByRole, runtime} = renderConnections([robot]);
        expect(getByText('Disconnected')).toBeVisible();
        act(() => runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED', [{...robot, connected: true}]));
        expect(queryByText('Disconnected')).toBeNull();
        expect(queryByRole('button', {name: 'Remove'})).toBeNull();
        expect(getByRole('button', {name: 'Release'})).toBeEnabled();
        expect(runtime.claimTinkibotRobot).not.toHaveBeenCalled();
    });

    test('an unclaimed offline robot offers Remove instead of Claim', () => {
        const {getByRole, queryByRole} = renderConnections([
            {nickname: 'lime', botUuid: 'lime-uuid', claimState: 'free', connected: false}
        ]);
        expect(getByRole('button', {name: 'Remove'})).toBeEnabled();
        expect(queryByRole('button', {name: 'Claim'})).toBeNull();
        expect(queryByRole('button', {name: 'Release'})).toBeNull();
    });

});

const createManager = overrides => {
    const manager = new EventEmitter();
    manager.state = {method: 'web-serial',
        preference: 'modem',
        phase: 'disconnected',
        supported: true,
        secure: true,
        status: 'disconnected',
        modem: 'unidentified',
        ports: [],
        selectedPort: null,
        robots: [],
        logs: [],
        verbose: false,
        error: '',
        switching: false,
        proxyStatus: 'disconnected',
        ...overrides};
    manager.snapshot = () => manager.state;
    const operations = ['selectPreference', 'retry', 'addPort', 'refreshPorts', 'connectSelected',
        'disconnect', 'reconnectProxy'];
    for (const method of operations) {
        manager[method] = jest.fn(() => Promise.resolve());
    }
    for (const method of ['selectPort', 'setVerbose', 'clearLog', 'log']) manager[method] = jest.fn();
    return manager;
};

const renderExpertConnections = (robots, manager) => {
    const view = renderConnections(robots, manager);
    fireEvent.click(view.getByRole('button', {name: 'Expert'}));
    return view;
};

describe('Web Serial Connections tab', () => {
    test('serial robot cards use shared claim/release operations and show UUIDs', () => {
        const manager = createManager({status: 'connected', modem: 'identified'});
        const {getByText, getAllByText, getByRole, runtime, unmount} = renderExpertConnections([
            {nickname: 'USB lime', botUuid: 'usb-robot-uuid', connected: true, claimState: 'free'}
        ], manager);
        expect(getByText('Discovered Tinkibots')).toBeVisible();
        expect(getByText('USB lime')).toBeVisible();
        expect(getByText('usb-robot-uuid')).toBeVisible();
        fireEvent.click(getByRole('button', {name: 'Claim'}));
        expect(runtime.claimTinkibotRobot).toHaveBeenCalledWith('usb-robot-uuid');
        act(() => runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED', [
            {nickname: 'USB lime', botUuid: 'usb-robot-uuid', connected: true, claimState: 'pending'}
        ]));
        expect(getByText('Awaiting robot confirmation; release to cancel')).toBeVisible();
        fireEvent.click(getByRole('button', {name: 'Release'}));
        expect(runtime.releaseTinkibotRobot).toHaveBeenCalledWith('usb-robot-uuid');
        expect(getAllByText('USB: Connected · Tinkimodem identified')[0]).toBeVisible();
        expect(manager.listenerCount('change')).toBe(1);
        unmount();
        expect(manager.listenerCount('change')).toBe(0);
    });

    test('Local Proxy can be retried without changing the transport preference', () => {
        const manager = createManager({method: 'local-proxy', preference: 'proxy', proxyStatus: 'disconnected'});
        const {getByRole} = renderExpertConnections([], manager);
        fireEvent.click(getByRole('button', {name: 'Reconnect Local Proxy'}));
        expect(manager.reconnectProxy).toHaveBeenCalledTimes(1);
    });

    test('unsupported browser gives guidance and can select Local Proxy', () => {
        const manager = createManager({supported: false, secure: false, status: 'unsupported'});
        const {getByRole, getByText} = renderExpertConnections([], manager);
        expect(getByText(/Web Serial requires HTTPS/)).toBeVisible();
        expect(getByRole('button', {name: 'Add USB Device'})).toBeDisabled();
        fireEvent.click(getByRole('radio', {name: 'Proxy'}));
        expect(manager.selectPreference).toHaveBeenCalledWith('proxy');
    });

    test('native picker runs in the click handler; port selection and connect use manager', () => {
        const port = {getInfo: () => ({usbVendorId: 0x303a, usbProductId: 0x1001})};
        const manager = createManager({ports: [port], selectedPort: port});
        const {getByRole} = renderExpertConnections([], manager);
        fireEvent.click(getByRole('button', {name: 'Add USB Device'}));
        expect(manager.addPort).toHaveBeenCalledTimes(1);
        fireEvent.change(getByRole('combobox', {name: 'USB modem'}), {target: {value: '0'}});
        expect(manager.selectPort).toHaveBeenCalledWith(port);
        fireEvent.click(getByRole('button', {name: 'Connect'}));
        expect(manager.connectSelected).toHaveBeenCalledTimes(1);
        fireEvent.click(getByRole('button', {name: 'Refresh devices'}));
        expect(manager.refreshPorts).toHaveBeenCalledTimes(1);
    });

    test('permanent diagnostics expose bounded log controls and copy metadata', async () => {
        const writeText = jest.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
        const manager = createManager({logs: [{time: '2026-11-10T12:00:00Z', kind: 'rx', value: 'tinkimodem'}]});
        const {getByRole, getByText} = renderExpertConnections([], manager);
        fireEvent.click(getByText('Connection debug log'));
        const output = getByText('2026-11-10T12:00:00Z [rx] tinkimodem');
        expect(output).toHaveAccessibleName('Connection log');
        output.focus();
        expect(output).toHaveFocus();
        fireEvent.click(getByRole('checkbox', {name: 'Verbose logging (raw and parsed messages)'}));
        expect(manager.setVerbose).toHaveBeenCalledWith(true);
        fireEvent.click(getByRole('button', {name: 'Clear log'}));
        expect(manager.clearLog).toHaveBeenCalledTimes(1);
        await act(async () => {
            fireEvent.click(getByRole('button', {name: 'Copy log'}));
            await Promise.resolve();
        });
        expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({method: 'web-serial',
            supported: true,
            secure: true,
            logs: manager.state.logs});
        expect(getByText('Log copied')).toBeVisible();
        delete navigator.clipboard;
    });
});

test('Auto preference is distinct from active transport and diagnostics stay below changing robots', () => {
    const logs = [{time: '2026-11-11T10:00:00Z', kind: 'proxy', value: 'connected'}];
    const manager = createManager({preference: 'auto',
        method: 'local-proxy',
        phase: 'proxy-connected',
        activeTransport: 'local-proxy',
        logs});
    const {getByRole, getByText, runtime} = renderExpertConnections([
        {nickname: 'lime', botUuid: 'lime', claimState: 'free'}
    ], manager);
    expect(getByRole('radio', {name: 'Auto'})).toHaveAttribute('aria-checked', 'true');
    expect(getByText('Connected via Local Proxy')).toBeVisible();
    const consolePanel = getByText('Connection debug log').closest('details');
    expect(getByText('lime').compareDocumentPosition(consolePanel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => {
        manager.state = {...manager.state, method: 'web-serial', phase: 'usb-connected', logs};
        manager.emit('change', manager.state);
        runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED', [
            {nickname: 'renamed lime', botUuid: 'lime', claimState: 'free'}
        ]);
    });
    const position = getByText('renamed lime').compareDocumentPosition(consolePanel);
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(consolePanel.textContent).toContain('2026-11-11T10:00:00Z [proxy] connected');
    fireEvent.click(getByRole('button', {name: 'Retry connection detection'}));
    expect(manager.retry).toHaveBeenCalledTimes(1);
});

describe('Simple connection status', () => {
    test.each([
        [{activeTransport: 'web-serial', phase: 'usb-connected'}, 'Connected via USB Modem', 'online'],
        [{activeTransport: 'local-proxy', phase: 'proxy-connected'}, 'Connected via Local Proxy', 'online'],
        [{phase: 'searching-modem'}, 'Searching for modem', 'searching'],
        [{phase: 'connecting-proxy'}, 'Connecting to proxy', 'searching'],
        [{phase: 'retrying'}, 'Looking for a connection', 'searching'],
        [{phase: 'disconnected'}, 'Disconnected', 'offline']
    ])('shows the actual connection state with controls collapsed: %s', (state, text, indicator) => {
        const manager = createManager(state);
        const {getByText, getByRole, queryByRole, queryByText} = renderConnections([], manager);
        expect(getByText(text)).toBeVisible();
        expect(getByText(text).parentElement.querySelector('[data-state]').dataset.state).toBe(indicator);
        expect(getByRole('button', {name: 'Expert'})).toHaveAttribute('aria-expanded', 'false');
        expect(queryByRole('radio', {name: 'Auto'})).toBeNull();
        expect(queryByRole('button', {name: 'Add USB Device'})).toBeNull();
        expect(queryByText('Connection debug log')).toBeNull();
    });

    test('Expert toggles manual controls and diagnostics without losing log history', () => {
        const manager = createManager({logs: [{time: 'now', kind: 'error', value: 'Proxy unavailable'}]});
        const {getByRole, getByText, queryByRole, queryByText} = renderConnections([], manager);
        const expert = getByRole('button', {name: 'Expert'});
        fireEvent.click(expert);
        expect(expert).toHaveAttribute('aria-expanded', 'true');
        expect(getByRole('radio', {name: 'Auto'})).toBeVisible();
        fireEvent.click(getByText('Connection debug log'));
        expect(getByText('now [error] Proxy unavailable')).toBeVisible();
        fireEvent.click(expert);
        expect(queryByRole('radio', {name: 'Auto'})).toBeNull();
        expect(queryByText('Connection debug log')).toBeNull();
        fireEvent.click(expert);
        expect(getByText('now [error] Proxy unavailable')).toBeInTheDocument();
        expect(manager.state.logs).toHaveLength(1);
    });
});

test.each([
    ['Remove', 'removeTinkibotRobot', {connected: false, claimState: 'paired'}],
    ['Claim', 'claimTinkibotRobot', {connected: true, claimState: 'free'}],
    ['Release', 'releaseTinkibotRobot', {connected: true, claimState: 'paired'}]
])('%s handles a rejected runtime operation and permits retry', async (label, method, state) => {
    const {getByRole, runtime} = renderConnections([{nickname: 'pink', botUuid: 'pink', ...state}]);
    runtime[method].mockRejectedValue(new Error('Connection is disconnected or switching'));
    await act(async () => {
        fireEvent.click(getByRole('button', {name: label}));
        await Promise.resolve();
    });
    expect(getByRole('alert')).toHaveTextContent('Robot action failed: Connection is disconnected or switching');
    expect(getByRole('button', {name: label})).toBeEnabled();
    runtime[method].mockResolvedValue();
    await act(async () => {
        fireEvent.click(getByRole('button', {name: label}));
        await Promise.resolve();
    });
    expect(runtime[method]).toHaveBeenCalledTimes(2);
});
