import PropTypes from 'prop-types';
import React, {useEffect, useState} from 'react';
import {FormattedMessage} from 'react-intl';
import VM from '@scratch/scratch-vm';

import styles from './connections-tab.css';

const ConnectionsTab = ({vm}) => {
    const [robots, setRobots] = useState(vm.runtime.tinkibotConnectedRobots || []);

    useEffect(() => {
        const updateRobots = nicknames => setRobots(nicknames);
        vm.runtime.on('TINKIBOT_CONNECTED_ROBOTS_CHANGED', updateRobots);
        return () => vm.runtime.removeListener('TINKIBOT_CONNECTED_ROBOTS_CHANGED', updateRobots);
    }, [vm]);

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
                    {robots.map(nickname => (
                        <div className={styles.robotCard} key={nickname}>
                            <span aria-hidden className={styles.statusDot} />
                            <span aria-hidden className={styles.robotIcon}>🤖</span>
                            <strong>{nickname}</strong>
                            <span className={styles.connectedLabel}>
                                <FormattedMessage
                                    defaultMessage="Connected"
                                    description="Status label for a connected robot"
                                    id="gui.connectionsTab.connected"
                                />
                            </span>
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
