import React from 'react';
import {render} from '@testing-library/react';
import '@testing-library/jest-dom';
import {IntlProvider} from 'react-intl';
import EventEmitter from 'events';

import ConnectionsTab from '../../../src/components/connections-tab/connections-tab';

const renderConnections = robots => {
    const runtime = new EventEmitter();
    runtime.tinkibotConnectedRobots = robots;
    runtime.claimTinkibotRobot = jest.fn();
    runtime.releaseTinkibotRobot = jest.fn();
    return render(
        <IntlProvider locale="en">
            <ConnectionsTab vm={{runtime}} />
        </IntlProvider>
    );
};

describe('ConnectionsTab', () => {
    test('disables other claim buttons while a robot is claimed', () => {
        const {getByRole} = renderConnections([
            {nickname: 'orange', botUuid: 'orange-uuid', claimState: 'paired'},
            {nickname: 'blue', botUuid: 'blue-uuid', claimState: 'free'}
        ]);

        expect(getByRole('button', {name: 'Claim'})).toBeDisabled();
        expect(getByRole('button', {name: 'Release'})).toBeEnabled();
    });
});
