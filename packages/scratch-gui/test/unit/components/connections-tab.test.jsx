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
    for (const method of ['selectMethod', 'addPort', 'refreshPorts', 'connect', 'disconnect', 'reconnectProxy']) {
        manager[method] = jest.fn(() => Promise.resolve());
    }
    for (const method of ['selectPort', 'setVerbose', 'clearLog', 'log']) manager[method] = jest.fn();
    return manager;
};

describe('Web Serial Connections tab', () => {
    test('serial robot cards use shared claim/release operations and show UUIDs', () => {
        const manager = createManager({status: 'connected', modem: 'identified'});
        const {getByText, getAllByText, getByRole, runtime, unmount} = renderConnections([
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
        const manager = createManager({method: 'local-proxy', proxyStatus: 'disconnected'});
        const {getByRole} = renderConnections([], manager);
        fireEvent.click(getByRole('button', {name: 'Reconnect Local Proxy'}));
        expect(manager.reconnectProxy).toHaveBeenCalledTimes(1);
    });

    test('unsupported browser gives guidance and can select Local Proxy', () => {
        const manager = createManager({supported: false, secure: false, status: 'unsupported'});
        const {getByRole, getByText} = renderConnections([], manager);
        expect(getByText(/Web Serial requires HTTPS/)).toBeVisible();
        expect(getByRole('button', {name: 'Add USB Device'})).toBeDisabled();
        fireEvent.change(getByRole('combobox', {name: 'Communication method'}), {target: {value: 'local-proxy'}});
        expect(manager.selectMethod).toHaveBeenCalledWith('local-proxy');
    });

    test('native picker runs in the click handler; port selection and connect use manager', () => {
        const port = {getInfo: () => ({usbVendorId: 0x303a, usbProductId: 0x1001})};
        const manager = createManager({ports: [port], selectedPort: port});
        const {getByRole} = renderConnections([], manager);
        fireEvent.click(getByRole('button', {name: 'Add USB Device'}));
        expect(manager.addPort).toHaveBeenCalledTimes(1);
        fireEvent.change(getByRole('combobox', {name: 'USB modem'}), {target: {value: '0'}});
        expect(manager.selectPort).toHaveBeenCalledWith(port);
        fireEvent.click(getByRole('button', {name: 'Connect'}));
        expect(manager.connect).toHaveBeenCalledTimes(1);
        fireEvent.click(getByRole('button', {name: 'Refresh devices'}));
        expect(manager.refreshPorts).toHaveBeenCalledTimes(1);
    });

    test('temporary diagnostics expose bounded log controls and copy metadata', async () => {
        const writeText = jest.fn(() => Promise.resolve());
        Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
        const manager = createManager({logs: [{time: '2026-11-10T12:00:00Z', kind: 'rx', value: 'tinkimodem'}]});
        const {getByRole, getByText} = renderConnections([], manager);
        fireEvent.click(getByText('Connection debug log'));
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
