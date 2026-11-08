import PropTypes from 'prop-types';
import React, {useCallback, useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import VM from '@scratch/scratch-vm';

import styles from './connections-tab.css';

const ConnectionsTab = ({vm}) => {
    const [robots, setRobots] = useState(vm.runtime.tinkibotConnectedRobots || []);
    const [pendingBotUuid, setPendingBotUuid] = useState(null);
    const hasClaimedRobot = robots.some(robot => robot.claimState === 'paired');

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
        <section className={styles.connections}>
            <div
                aria-hidden
                className={styles.headingIcon}
            >🤖</div>
            <h2>
                <FormattedMessage
                    defaultMessage="My robots"
                    description="Heading for the list of connected Tinkibot robots"
                    id="gui.connectionsTab.heading"
                />
            </h2>
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
                            <strong>{robot.nickname}</strong>
                            <span className={styles.connectedLabel}>
                                {robot.connected === false ? (
                                    <FormattedMessage
                                        defaultMessage="Disconnected"
                                        description="Status label for a robot whose connection has been lost"
                                        id="gui.connectionsTab.disconnected"
                                    />
                                ) : robot.claimState === 'free' ? (
                                    <FormattedMessage
                                        defaultMessage="Ready to claim"
                                        description="Status label for a robot which is available to claim"
                                        id="gui.connectionsTab.free"
                                    />
                                ) : robot.claimState === 'paired' ? (
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
                            {robot.connected !== false && robot.claimState === 'free' ? (
                                <button
                                    className={styles.claimButton}
                                    disabled={pendingBotUuid !== null || hasClaimedRobot}
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
                            {robot.connected !== false && robot.claimState === 'paired' ? (
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
                    <FormattedMessage
                        defaultMessage="No robots are connected yet. Turn on your robot to see it here!"
                        description="Friendly instructions shown when there are no connected robots"
                        id="gui.connectionsTab.empty"
                    />
                </div>
            )}
        </section>
    );
};

ConnectionsTab.propTypes = {
    vm: PropTypes.instanceOf(VM).isRequired
};

export default ConnectionsTab;
