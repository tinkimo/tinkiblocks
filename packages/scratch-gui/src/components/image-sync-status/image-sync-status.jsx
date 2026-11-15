import React, {useCallback, useEffect, useState} from 'react';
import PropTypes from 'prop-types';
import {FormattedMessage} from 'react-intl';
import styles from './image-sync-status.css';

const ImageSyncStatus = ({runtime}) => {
    const [state, setState] = useState(runtime.tinkibotImageSync);
    const retry = useCallback(() => runtime.retryTinkibotImageSync(), [runtime]);
    useEffect(() => {
        setState(runtime.tinkibotImageSync);
        runtime.on('TINKIBOT_IMAGE_SYNC_CHANGED', setState);
        return () => runtime.removeListener('TINKIBOT_IMAGE_SYNC_CHANGED', setState);
    }, [runtime]);
    if (!state || state.phase === 'waiting') return null;
    return (
        <div
            className={styles.status}
            role={state.phase === 'error' ? 'alert' : 'status'}
        >
            {state.phase === 'clearing' ? <FormattedMessage
                id="gui.imageSync.preparing"
                defaultMessage="Preparing project images on {robot}…"
                description="Automatic cleanup before restoring project images"
                values={{robot: state.robot}}
            /> : null}
            {state.phase === 'uploading' ? <React.Fragment>
                <FormattedMessage
                    id="gui.imageSync.uploading"
                    defaultMessage="Restoring {image} to {robot} ({completed} of {total} complete)…"
                    description="Progress restoring the active project's images to the robot"
                    values={{image: state.image, robot: state.robot, completed: state.completed, total: state.total}}
                />
                <progress
                    max={100}
                    value={state.progress}
                />
            </React.Fragment> : null}
            {state.phase === 'ready' ? <FormattedMessage
                id="gui.imageSync.ready"
                defaultMessage="Project images restored to {robot}."
                description="All project images have been synchronised to the claimed robot"
                values={{robot: state.robot}}
            /> : null}
            {state.phase === 'error' ? <React.Fragment>
                <FormattedMessage
                    id="gui.imageSync.failed"
                    defaultMessage="Could not synchronise robot images: {error}"
                    description="A failed automatic image restore remains visible until retried"
                    values={{error: state.error}}
                />
                <button
                    type="button"
                    onClick={retry}
                >
                    <FormattedMessage
                        id="gui.imageSync.retry"
                        defaultMessage="Retry image sync"
                        description="Retry restoring this project's images to the claimed robot"
                    />
                </button>
            </React.Fragment> : null}
        </div>
    );
};
ImageSyncStatus.propTypes = {runtime: PropTypes.shape({
    on: PropTypes.func.isRequired,
    removeListener: PropTypes.func.isRequired,
    tinkibotImageSync: PropTypes.shape({phase: PropTypes.string, error: PropTypes.string}),
    retryTinkibotImageSync: PropTypes.func
}).isRequired};
export default ImageSyncStatus;
