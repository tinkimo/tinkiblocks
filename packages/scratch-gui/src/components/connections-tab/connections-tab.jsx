import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import VM from '@scratch/scratch-vm';

import styles from './connections-tab.css';
import ConnectionControls, {ConnectionDebugPanel} from './connection-controls.jsx';

const ConnectionsTab = ({vm}) => {
    const manager = vm.runtime.tinkibotConnectionManager;
    const [connection, setConnection] = useState(manager ? manager.snapshot() : null);
    const [proxyRobots, setRobots] = useState(vm.runtime.tinkibotConnectedRobots || []);
    const [pendingBotUuid, setPendingBotUuid] = useState(null);
    const [expertOpen, setExpertOpen] = useState(false);
    const toggleExpert = useCallback(() => setExpertOpen(open => !open), []);
    const serial = connection && connection.method === 'web-serial';
    const robots = proxyRobots;
    const hasClaimedRobot = robots.some(robot => ['paired', 'pending', 'reserved'].includes(robot.claimState));

    useEffect(() => {
        if (!manager) return () => {};
        setConnection(manager.snapshot());
        manager.on('change', setConnection);
        if (manager.started) manager.activate();
        return () => manager.removeListener('change', setConnection);
    }, [manager]);

    useEffect(() => {
        const updateRobots = updatedRobots => {
            setRobots(updatedRobots);
            setPendingBotUuid(null);
        };
        vm.runtime.on('TINKIBOT_CONNECTED_ROBOTS_CHANGED', updateRobots);
        return () => vm.runtime.removeListener('TINKIBOT_CONNECTED_ROBOTS_CHANGED', updateRobots);
    }, [vm]);

    const claimRobot = useCallback(event => {
        const botUuid = event.currentTarget.dataset.botUuid;
        setPendingBotUuid(botUuid);
        vm.runtime.claimTinkibotRobot(botUuid);
    }, [vm]);

    const releaseRobot = useCallback(event => {
        const botUuid = event.currentTarget.dataset.botUuid;
        setPendingBotUuid(botUuid);
        vm.runtime.releaseTinkibotRobot(botUuid);
    }, [vm]);

    const removeRobot = useCallback(event => {
        const botUuid = event.currentTarget.dataset.botUuid;
        setPendingBotUuid(botUuid);
        vm.runtime.removeTinkibotRobot(botUuid);
    }, [vm]);

    return (
        <section
            className={styles.connections}
            tabIndex={0}
        >
            {manager && connection ? <ConnectionControls
                expertOpen={expertOpen}
                manager={manager}
                state={connection}
                onToggleExpert={toggleExpert}
            /> : null}
            <div className={styles.robotsHeading}>
                <div
                    aria-hidden
                    className={styles.headingIcon}
                >🤖</div>
                <h2>
                    {serial ? <FormattedMessage
                        defaultMessage="Discovered Tinkibots"
                        description="Heading for robots discovered through USB modem"
                        id="gui.connectionsTab.discoveredHeading"
                    /> : <FormattedMessage
                        defaultMessage="My robots"
                        description="Heading for the list of connected Tinkibot robots"
                        id="gui.connectionsTab.heading"
                    />}
                </h2>
            </div>
            {robots.length ? (
                <div className={styles.robotList}>
                    {robots.map(robot => (
                        <div
                            className={[styles.robotCard, styles[robot.claimState],
                                robot.connected === false ? styles.disconnected : ''].join(' ')}
                            key={robot.botUuid}
                        >
                            <span
                                aria-hidden
                                className={styles.statusDot}
                            />
                            <span
                                aria-hidden
                                className={styles.robotIcon}
                            >🤖</span>
                            <strong>{robot.nickname || <FormattedMessage
                                defaultMessage="Unnamed Tinkibot"
                                description="Label for a robot whose UUID is known but nickname is empty"
                                id="gui.connectionsTab.unnamedRobot"
                            />}</strong>
                            {serial ? <code className={styles.robotUuid}>{robot.botUuid}</code> : null}
                            <span className={styles.connectedLabel}>
                                {robot.connected === false ? (
                                    <FormattedMessage
                                        defaultMessage="Disconnected"
                                        description="Status label for a robot whose connection has been lost"
                                        id="gui.connectionsTab.disconnected"
                                    />
                                ) : ['reserved', 'confirmable'].includes(robot.claimState) ? (
                                    <FormattedMessage
                                        defaultMessage="Request confirmation on the robot"
                                        description="A retained reservation needs robot-side confirmation"
                                        id="gui.connectionsTab.reservedClaim"
                                    />
                                ) : robot.claimState === 'pending' ? (
                                    <FormattedMessage
                                        defaultMessage="Awaiting robot confirmation; release to cancel"
                                        description="Pending or uncertain gateway claim"
                                        id="gui.connectionsTab.pendingClaim"
                                    />
                                ) : robot.claimState === 'free' ? (
                                    <FormattedMessage
                                        defaultMessage="Ready to claim"
                                        description="Status label for a robot which is available to claim"
                                        id="gui.connectionsTab.free"
                                    />
                                ) : ['paired', 'pending', 'reserved'].includes(robot.claimState) ? (
                                    <FormattedMessage
                                        defaultMessage="Claimed by you"
                                        description="Status label for a robot claimed by this user"
                                        id="gui.connectionsTab.paired"
                                    />
                                ) : (
                                    <FormattedMessage
                                        defaultMessage="Being used by another student"
                                        description="Status label for a robot claimed by another user"
                                        id="gui.connectionsTab.claimedByOther"
                                    />
                                )}
                            </span>
                            {robot.connected !== false &&
                                ['free', 'reserved', 'confirmable'].includes(robot.claimState) ? (
                                    <button
                                        className={styles.claimButton}
                                        disabled={pendingBotUuid !== null || (hasClaimedRobot && robots.some(other =>
                                            other.botUuid !== robot.botUuid &&
                                        ['paired', 'pending', 'reserved'].includes(other.claimState)))}
                                        type="button"
                                        data-bot-uuid={robot.botUuid}
                                        onClick={claimRobot}
                                    >
                                        {pendingBotUuid === robot.botUuid ? (
                                            <FormattedMessage
                                                defaultMessage="Claiming…"
                                                description="Button label while a robot claim is being processed"
                                                id="gui.connectionsTab.claiming"
                                            />
                                        ) : (
                                            <FormattedMessage
                                                defaultMessage="Claim"
                                                description="Button to claim a robot for this user"
                                                id="gui.connectionsTab.claim"
                                            />
                                        )}
                                    </button>
                                ) : null}
                            {robot.connected !== false &&
                                ['paired', 'pending', 'reserved'].includes(robot.claimState) ? (
                                    <button
                                        className={styles.releaseButton}
                                        disabled={pendingBotUuid === robot.botUuid}
                                        type="button"
                                        data-bot-uuid={robot.botUuid}
                                        onClick={releaseRobot}
                                    >
                                        {pendingBotUuid === robot.botUuid ? (
                                            <FormattedMessage
                                                defaultMessage="Releasing…"
                                                description="Button label while a robot release is being processed"
                                                id="gui.connectionsTab.releasing"
                                            />
                                        ) : (
                                            <FormattedMessage
                                                defaultMessage="Release"
                                                description="Button to release a paired robot for other users"
                                                id="gui.connectionsTab.release"
                                            />
                                        )}
                                    </button>
                                ) : null}
                            {robot.connected === false && robot.claimState !== 'claimed' ? (
                                <button
                                    className={styles.releaseButton}
                                    disabled={pendingBotUuid !== null}
                                    type="button"
                                    data-bot-uuid={robot.botUuid}
                                    onClick={removeRobot}
                                >
                                    <FormattedMessage
                                        defaultMessage="Remove"
                                        description="Remove a robot from the pool and release its proxy connection"
                                        id="gui.connectionsTab.remove"
                                    />
                                </button>
                            ) : null}
                        </div>
                    ))}
                </div>
            ) : (
                <div className={styles.emptyState}>
                    {serial ? (
                        <FormattedMessage
                            defaultMessage="No Tinkibots discovered. Connect the USB modem and turn on nearby robots."
                            description="Empty Web Serial discovery list"
                            id="gui.connectionsTab.noDiscoveredRobots"
                        />
                    ) : <FormattedMessage
                        defaultMessage="No robots are connected yet. Turn on your robot to see it here!"
                        description="Friendly instructions shown when there are no connected robots"
                        id="gui.connectionsTab.empty"
                    />}
                </div>
            )}
            {manager && connection && expertOpen ? <ConnectionDebugPanel
                manager={manager}
                state={connection}
            /> : null}
        </section>
    );
};

ConnectionsTab.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

export default ConnectionsTab;
