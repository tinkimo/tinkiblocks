import React, {useCallback, useEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {FormattedMessage, useIntl} from 'react-intl';
import Modal from '../modal/modal.jsx';
import Button from '../button/button.jsx';
import styles from './project-image-upload-modal.css';
import cleaningImage from './tinkibot-cleaning.png';
import uploadingImage from './tinkibot-uploading.png';
import surprisedImage from './tinkibot-surprised.png';

const illustrations = {clearing: cleaningImage, uploading: uploadingImage, error: surprisedImage};

const ProjectImageUploadModal = ({runtime, workspaceRef, isRtl}) => {
    const intl = useIntl();
    const [state, setState] = useState(runtime.tinkibotImageSync);
    const body = useRef(null);
    const wasBlocking = useRef(Boolean(state && state.blocking));
    const previousFocus = useRef(document.activeElement);
    const blocking = Boolean(state && state.blocking);
    const failed = state && state.phase === 'error';
    const preparing = state && state.phase === 'clearing';
    const overallProgress = state && state.total ?
        ((state.completed + (Math.min(99, state.progress) / 100)) / state.total) * 100 : 0;
    const retry = useCallback(() => runtime.imageSync.retry(), [runtime]);
    const close = useCallback(() => runtime.imageSync.close(), [runtime]);
    useEffect(() => {
        const update = next => {
            if (next.blocking && !wasBlocking.current) previousFocus.current = document.activeElement;
            wasBlocking.current = Boolean(next.blocking);
            setState(next);
        };
        runtime.on('TINKIBOT_IMAGE_SYNC_CHANGED', update);
        runtime.imageSync.request();
        update(runtime.tinkibotImageSync);
        return () => {
            runtime.removeListener('TINKIBOT_IMAGE_SYNC_CHANGED', update);
            if (runtime.imageSync.blocking) runtime.imageSync.interrupt('Project upload view closed');
        };
    }, [runtime]);
    useEffect(() => {
        if (!blocking) return () => {};
        const workspace = workspaceRef.current;
        const inert = workspace.getAttribute('inert');
        const busy = workspace.getAttribute('aria-busy');
        workspace.setAttribute('inert', '');
        workspace.setAttribute('aria-busy', 'true');
        // Document shortcuts and synthetic clicks must not bypass the modal overlay.
        const blockOutside = event => {
            const dialog = body.current && body.current.closest('[role="dialog"]');
            const shortcut = event.type === 'keydown' && (event.ctrlKey || event.metaKey);
            if (shortcut || !dialog || !dialog.contains(event.target)) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
        };
        const events = ['keydown', 'click', 'pointerdown', 'dblclick', 'drop', 'paste', 'cut', 'wheel', 'touchmove'];
        for (const name of events) document.addEventListener(name, blockOutside, {capture: true, passive: false});
        return () => {
            if (inert === null) workspace.removeAttribute('inert');
            else workspace.setAttribute('inert', inert);
            if (busy === null) workspace.removeAttribute('aria-busy');
            else workspace.setAttribute('aria-busy', busy);
            for (const name of events) document.removeEventListener(name, blockOutside, true);
            if (previousFocus.current && previousFocus.current.isConnected) previousFocus.current.focus();
        };
    }, [blocking, workspaceRef]);
    useEffect(() => {
        if (!blocking) return;
        // ReactModal opens its portal after mounting this component.
        const dialog = body.current && body.current.closest('[role="dialog"]');
        if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    }, [blocking, state && state.phase]);
    if (!blocking) return null;
    return (
        <Modal
            aria={{modal: true}}
            className={styles.modal}
            contentLabel={intl.formatMessage(failed ? {
                id: 'gui.projectImageUpload.failedTitle',
                defaultMessage: 'Image upload failed',
                description: 'Title of the project image upload error dialog'
            } : preparing ? {
                id: 'gui.projectImageUpload.preparingTitle',
                defaultMessage: 'Preparing robot for use.',
                description: 'Title while a newly claimed robot is cleared and prepared'
            } : {
                id: 'gui.projectImageUpload.title',
                defaultMessage: 'Uploading project images',
                description: 'Title of the blocking project image restore dialog'
            })}
            hideCloseButton={!failed}
            isRtl={isRtl}
            onRequestClose={failed ? close : null}
        >
            <div
                ref={body}
                className={styles.body}
            >
                {illustrations[state.phase] ? <img
                    className={styles.illustration}
                    src={illustrations[state.phase]}
                    alt=""
                    aria-hidden="true"
                /> : null}
                <div
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                >
                    {preparing ? <FormattedMessage
                        id="gui.projectImageUpload.preparing"
                        defaultMessage="Getting your Tinkibot ready for this project…"
                        description="Friendly caption while the robot is prepared for the project"
                    /> : state.phase === 'stopping' ? <FormattedMessage
                        id="gui.projectImageUpload.stopping"
                        defaultMessage="Waiting for the active transfer to stop safely…"
                        description="The workspace stays blocked until an interrupted transfer settles"
                    /> : <p>{state.filename}</p>}
                    {!preparing || state.total > 0 ? <p>
                        <FormattedMessage
                            id="gui.projectImageUpload.count"
                            defaultMessage="{completed} of {total} images completed"
                            description="Robot-acknowledged images completed out of the fixed snapshot total"
                            values={{completed: state.completed, total: state.total}}
                        />
                    </p> : null}
                </div>
                {!failed && state.phase === 'uploading' ? <progress
                    max={100}
                    value={overallProgress}
                    aria-label={intl.formatMessage({
                        id: 'gui.projectImageUpload.progress',
                        defaultMessage: 'Overall project image upload progress',
                        description: 'Accessible label of the progress bar for all project images'
                    })}
                /> : null}
                {failed ? <React.Fragment>
                    <p className={styles.reassurance}>
                        <FormattedMessage
                            id="gui.projectImageUpload.reassurance"
                            defaultMessage="Your images are still in your project. Try again, or close to keep editing."
                            description="Reassurance and recovery guidance after an image upload fails"
                        />
                    </p>
                    <div
                        role="alert"
                        className={styles.error}
                    >
                        {state.error === 'invalid_image_upload_parameters' ? <FormattedMessage
                            id="gui.projectImageUpload.invalidRequest"
                            defaultMessage={'The image upload request wasn’t accepted. ' +
                                'Save your project, then refresh Tinkiblocks and try again.'}
                            description="Friendly explanation of rejected image upload parameters"
                        /> : /^[a-z][a-z0-9_]+$/.test(state.error) ? <FormattedMessage
                            id="gui.projectImageUpload.unexpectedError"
                            defaultMessage="The upload stopped before this image was ready."
                            description="Friendly explanation for a technical image upload error code"
                        /> : state.error}
                    </div>
                    {/^[a-z][a-z0-9_]+$/.test(state.error) ? <details className={styles.details}>
                        <summary><FormattedMessage
                            id="gui.projectImageUpload.technicalDetails"
                            defaultMessage="Technical details"
                            description="Expandable technical error code for troubleshooting"
                        /></summary>
                        <code>{state.error}</code>
                    </details> : null}
                    <div className={styles.buttons}>
                        <Button onClick={close}>
                            <FormattedMessage
                                id="gui.projectImageUpload.close"
                                defaultMessage="Close"
                                description="Dismiss a stopped, failed upload and restore workspace interaction"
                            />
                        </Button>
                        <Button
                            className={styles.primary}
                            disabled={!state.canRetry}
                            aria-disabled={!state.canRetry}
                            onClick={retry}
                        >
                            <FormattedMessage
                                id="gui.projectImageUpload.retry"
                                defaultMessage="Retry"
                                description="Retry only the failed image and remaining snapshot"
                            />
                        </Button>
                    </div>
                </React.Fragment> : null}
            </div>
        </Modal>
    );
};
ProjectImageUploadModal.propTypes = {
    isRtl: PropTypes.bool,
    workspaceRef: PropTypes.shape({current: PropTypes.instanceOf(Element)}).isRequired,
    runtime: PropTypes.shape({
        tinkibotImageSync: PropTypes.shape({blocking: PropTypes.bool, phase: PropTypes.string}),
        on: PropTypes.func.isRequired,
        removeListener: PropTypes.func.isRequired,
        imageSync: PropTypes.shape({
            request: PropTypes.func.isRequired,
            retry: PropTypes.func.isRequired,
            close: PropTypes.func.isRequired,
            interrupt: PropTypes.func.isRequired,
            blocking: PropTypes.bool
        }).isRequired
    }).isRequired
};
export default ProjectImageUploadModal;
