import React, {useCallback, useEffect, useState} from 'react';
import PropTypes from 'prop-types';
import {useIntl} from 'react-intl';
import messages from './messages';
import styles from './images-tab.css';

const FilenameField = ({collection, image, onValidityChange}) => {
    const intl = useIntl();
    const [value, setValue] = useState(image.name);
    const [error, setError] = useState('');
    useEffect(() => {
        setValue(image.name);
        setError('');
        onValidityChange(false);
    }, [collection, image.id, image.name, onValidityChange]);
    const validate = useCallback(next => {
        try {
            collection.validateName(next, image.id);
            setError('');
            onValidityChange(false);
            return true;
        } catch (failure) {
            setError(intl.formatMessage(next ? messages.filenameDuplicate : messages.filenameRequired));
            onValidityChange(true);
            return false;
        }
    }, [collection, image.id, intl, onValidityChange]);
    const change = useCallback(event => {
        const next = collection.normalizeName(event.target.value);
        setValue(next);
        validate(next);
    }, [collection, validate]);
    const commit = useCallback(() => {
        if (validate(value) && value !== image.name) collection.rename(image.id, value);
    }, [collection, image.id, image.name, validate, value]);
    const keyDown = useCallback(event => {
        if (event.key === 'Enter') event.target.blur();
    }, []);
    return (
        <div className={styles.filename}>
            <label htmlFor="image-filename">{intl.formatMessage(messages.rename)}</label>
            <p id="image-filename-hint">{intl.formatMessage(messages.filenameHint)}</p>
            <input
                id="image-filename"
                value={value}
                maxLength={64}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={error ? 'image-filename-hint image-filename-error' : 'image-filename-hint'}
                aria-invalid={Boolean(error)}
                onChange={change}
                onBlur={commit}
                onKeyDown={keyDown}
            />
            {error ? <p
                id="image-filename-error"
                className={styles.error}
                role="alert"
            >{error}</p> : null}
        </div>
    );
};
FilenameField.propTypes = {
    collection: PropTypes.shape({
        normalizeName: PropTypes.func.isRequired,
        validateName: PropTypes.func.isRequired,
        rename: PropTypes.func.isRequired
    }).isRequired,
    image: PropTypes.shape({id: PropTypes.string.isRequired, name: PropTypes.string.isRequired}).isRequired,
    onValidityChange: PropTypes.func.isRequired
};
export default FilenameField;
