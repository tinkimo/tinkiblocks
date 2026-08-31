import PropTypes from 'prop-types';
import React, {useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import VM from '@scratch/scratch-vm';

import styles from './connections-tab.css';

const ConnectionsTab = ({vm}) => {
    const [robots, setRobots] = useState(vm.runtime.tinkibotConnectedRobots || []);
    const [claimingNickname, setClaimingNickname] = useState(null);

    useEffect(() => {
        const updateRobots = updatedRobots => {
            setRobots(updatedRobots);
            setClaimingNickname(null);
        };
        vm.runtime.on('TINKIBOT_CONNECTED_ROBOTS_CHANGED', updateRobots);
        return () => vm.runtime.removeListener('TINKIBOT_CONNECTED_ROBOTS_CHANGED', updateRobots);
    }, [vm]);

    const claimRobot = nickname => {
        setClaimingNickname(nickname);
        vm.runtime.claimTinkibotRobot(nickname);
    };

    return (
        <section className={styles.connections}>
            <div aria-hidden className={styles.headingIcon}>🤖</div>
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
                            className={`${styles.robotCard} ${styles[robot.claimState]}`}
                            key={robot.nickname}
                        >
                            <span aria-hidden className={styles.statusDot} />
                            <span aria-hidden className={styles.robotIcon}>🤖</span>
                            <strong>{robot.nickname}</strong>
                            <span className={styles.connectedLabel}>
                                {robot.claimState === 'free' ? (
                                    <FormattedMessage
                                        defaultMessage="Ready to claim"
                                        description="Status label for a robot which is available to claim"
                                        id="gui.connectionsTab.free"
                                    />
                                ) : robot.claimState === 'paired' ? (
                                    <FormattedMessage
                                        defaultMessage="Paired with you"
                                        description="Status label for a robot paired with this user"
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
                            {robot.claimState === 'free' ? (
                                <button
                                    className={styles.claimButton}
                                    disabled={claimingNickname === robot.nickname}
                                    type="button"
                                    onClick={() => claimRobot(robot.nickname)}
                                >
                                    {claimingNickname === robot.nickname ? (
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
