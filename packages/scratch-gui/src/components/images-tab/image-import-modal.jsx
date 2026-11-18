import React, {useCallback} from 'react';
import PropTypes from 'prop-types';
import {FormattedMessage, useIntl} from 'react-intl';
import Modal from '../modal/modal.jsx';
import Button from '../button/button.jsx';
import messages from './messages';
import styles from './image-import-modal.css';
import sketchingImage from './tinkibot-sketching.png';

const ImageImportModal = ({preview, fit, onFitChange, onAdd, onCancel}) => {
    const intl = useIntl();
    const changeFit = useCallback(event => onFitChange(event.target.value), [onFitChange]);
    return (
        <Modal
            className={styles.modal}
            contentLabel={intl.formatMessage(messages.importTitle)}
            aria={{modal: true}}
            onRequestClose={onCancel}
        >
            <div className={styles.body}>
                <div className={styles.artwork}>
                    <img
                        src={sketchingImage}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                    />
                    <div
                        className={styles.sketch}
                        role="img"
                        aria-label={intl.formatMessage(messages.importPreview)}
                    >{preview}</div>
                </div>
                <p className={styles.hint}><FormattedMessage {...messages.importHint} /></p>
                <label className={styles.fit}>
                    <span><FormattedMessage {...messages.strategy} /></span>
                    <select
                        value={fit}
                        onChange={changeFit}
                    >
                        <option value="contain">{intl.formatMessage(messages.contain)}</option>
                        <option value="crop">{intl.formatMessage(messages.crop)}</option>
                    </select>
                </label>
                <div className={styles.buttons}>
                    <Button onClick={onCancel}><FormattedMessage {...messages.cancel} /></Button>
                    <Button
                        className={styles.primary}
                        onClick={onAdd}
                    ><FormattedMessage {...messages.add} /></Button>
                </div>
            </div>
        </Modal>
    );
};
ImageImportModal.propTypes = {
    preview: PropTypes.node.isRequired,
    fit: PropTypes.oneOf(['contain', 'crop']).isRequired,
    onFitChange: PropTypes.func.isRequired,
    onAdd: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired
};
export default ImageImportModal;
