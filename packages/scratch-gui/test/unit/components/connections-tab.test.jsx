import React from 'react';
import {act, fireEvent, render, within} from '@testing-library/react';
import '@testing-library/jest-dom';
import {IntlProvider} from 'react-intl';
import EventEmitter from 'events';

import ConnectionsTab from '../../../src/components/connections-tab/connections-tab';

const renderConnections = robots => {
    const runtime = new EventEmitter();
    runtime.tinkibotConnectedRobots = robots;
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
