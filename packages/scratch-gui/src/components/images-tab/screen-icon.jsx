import React from 'react';
import PropTypes from 'prop-types';

const ScreenIcon = ({className}) => (
    <svg
        aria-hidden
        className={className}
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
        viewBox="0 0 24 24"
    >
        <rect
            x="2"
            y="3"
            width="20"
            height="15"
            rx="2"
        />
        <circle
            cx="16.5"
            cy="7.5"
            r="1.5"
        />
        <path d="m5 15 5-6 4 5 2-2 3 3M8 22h8m-4-4v4" />
    </svg>
);
ScreenIcon.propTypes = {className: PropTypes.string};
export default ScreenIcon;
