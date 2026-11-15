import React from 'react';
import PropTypes from 'prop-types';

const paths = {
    pencil: 'M4 16 16 4l4 4L8 20H4v-4Zm10-10 4 4M4 16l4 4',
    brush: 'm10 13 8-10 3 3-10 8M10 13c-5-2-6 3-5 4 0 2-2 3-2 3 7 2 10-2 8-6',
    eraser: 'm4 13 9-9 7 7-9 9H8l-4-4v-3Zm5-5 7 7M11 20h10',
    fill: 'm4 11 8-8 9 9-8 8-9-9Zm2 0h13M8 3l5 5M20 16c-4 5 2 7 2 3l-2-3',
    text: 'M4 5h16M12 5v15M8 20h8',
    picker: 'm5 14 9-9 5 5-9 9H5v-5Zm7-7 5 5M3 21l3-3M15 4l2-2 5 5-2 2',
    select: 'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
    line: 'M4 20 20 4',
    rectangle: 'M3 5h18v14H3z',
    ellipse: 'M21 12a9 7 0 1 0-18 0 9 7 0 1 0 18 0'
};
const ToolIcon = ({name}) => (
    <svg
        aria-hidden
        focusable="false"
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
    >
        <path d={paths[name]} />
    </svg>
);
ToolIcon.propTypes = {name: PropTypes.oneOf(Object.keys(paths)).isRequired};
export default ToolIcon;
