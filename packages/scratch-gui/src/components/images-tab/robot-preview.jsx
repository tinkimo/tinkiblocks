import React, {forwardRef, useId} from 'react';
import PropTypes from 'prop-types';
import {useIntl} from 'react-intl';
import messages from './messages';
import styles from './robot-preview.css';

// Portrait LCD: 128 × 160, including ten status rows. Artwork fits at 128 × 94.
const RobotPreview = forwardRef(({nickname}, ref) => {
    const intl = useIntl();
    const id = useId();
    return (
        <div className={styles.robot}>
            <svg
                aria-hidden
                focusable="false"
                viewBox="0 0 280 320"
                className={styles.housing}
            >
                <defs>
                    <linearGradient
                        id={`${id}-shell`}
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="1"
                    >
                        <stop
                            offset="0"
                            stopColor="#ffe878"
                        />
                        <stop
                            offset="0.55"
                            stopColor="#f5cf38"
                        />
                        <stop
                            offset="1"
                            stopColor="#dbaa20"
                        />
                    </linearGradient>
                    <linearGradient
                        id={`${id}-cover`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                    >
                        <stop
                            offset="0"
                            stopColor="#ffe56c"
                        />
                        <stop
                            offset="0.5"
                            stopColor="#f8d447"
                        />
                        <stop
                            offset="1"
                            stopColor="#edc231"
                        />
                    </linearGradient>
                    <linearGradient
                        id={`${id}-mount`}
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="1"
                    >
                        <stop
                            offset="0"
                            stopColor="#e0dfd5"
                        />
                        <stop
                            offset="0.5"
                            stopColor="#9d9d98"
                        />
                        <stop
                            offset="1"
                            stopColor="#777b7b"
                        />
                    </linearGradient>
                </defs>
                <rect
                    x="13"
                    y="27"
                    width="256"
                    height="278"
                    rx="27"
                    fill="#aa8221"
                    opacity="0.18"
                />
                <rect
                    x="10"
                    y="20"
                    width="260"
                    height="280"
                    rx="25"
                    fill={`url(#${id}-shell)`}
                    stroke="#c59e28"
                    strokeWidth="1.5"
                />
                <path
                    d="M40 25H240M17 58v198"
                    fill="none"
                    stroke="#fff3ad"
                    strokeWidth="2"
                />
                <rect
                    x="58"
                    y="9"
                    width="164"
                    height="304"
                    rx="15"
                    fill="#b89022"
                    opacity="0.23"
                />
                <rect
                    x="60"
                    y="6"
                    width="160"
                    height="304"
                    rx="14"
                    fill={`url(#${id}-cover)`}
                    stroke="#dfb635"
                />
                <path
                    d="M72 14h136M65 24v265"
                    fill="none"
                    stroke="#fff0a0"
                    strokeWidth="2"
                />
                {[28, 33, 38, 43, 48, 270, 275, 280, 285, 290].map(y => (
                    <path
                        key={y}
                        d={`M75 ${y}h130`}
                        stroke="#dfb73c"
                        opacity="0.25"
                    />
                ))}
                {[{x: 26, y: 36}, {x: 254, y: 36}, {x: 26, y: 284}, {x: 254, y: 284}].map(({x, y}) => (
                    <g key={`${x}/${y}`}>
                        <circle
                            cx={x + 1}
                            cy={y + 2}
                            r="9"
                            fill="#a98623"
                            opacity="0.35"
                        />
                        <circle
                            cx={x}
                            cy={y}
                            r="8"
                            fill="#21272c"
                            stroke="#697075"
                            strokeWidth="1.5"
                        />
                        <path
                            d={`M${x - 3} ${y - 2}l6 4m-5 1 4-6`}
                            stroke="#0c1015"
                            strokeWidth="2.2"
                        />
                        <path
                            d={`M${x - 4} ${y - 4}l2-1`}
                            stroke="#92989b"
                            strokeWidth="1.3"
                        />
                    </g>
                ))}
                {[{x: 22, y: 98}, {x: 22, y: 192}, {x: 228, y: 98}, {x: 228, y: 192}].map(({x, y}) => (
                    <g key={`${x}/${y}`}>
                        <rect
                            x={x - 3}
                            y={y - 2}
                            width="36"
                            height="38"
                            rx="7"
                            fill="#b18d28"
                            opacity="0.4"
                        />
                        <rect
                            x={x}
                            y={y}
                            width="30"
                            height="32"
                            rx="5"
                            fill={`url(#${id}-mount)`}
                            stroke="#8b8e87"
                        />
                        <rect
                            x={x + 5}
                            y={y + 5}
                            width="20"
                            height="21"
                            rx="3"
                            fill="#20262b"
                            stroke="#41494e"
                        />
                        <path
                            d={`M${x + 9} ${y + 9}h12v7`}
                            fill="none"
                            stroke="#535b60"
                        />
                        <circle
                            cx={x + 15}
                            cy={y + 16}
                            r="4"
                            fill="#151b20"
                        />
                    </g>
                ))}
                <rect
                    x="70"
                    y="74"
                    width="140"
                    height="172"
                    rx="3"
                    fill="#252c30"
                    stroke="#b8952c"
                    strokeWidth="2"
                />
                <rect
                    x="74"
                    y="78"
                    width="132"
                    height="164"
                    fill="#080e14"
                />
                <rect
                    x="76"
                    y="80"
                    width="128"
                    height="10"
                    fill="#233c69"
                />
                <text
                    x="80"
                    y="87.5"
                    fill="#f4f7fc"
                    fontSize="6.5"
                    fontFamily="monospace"
                >
                    {nickname ? nickname.slice(0, 12) : 'Tinkibot'}
                </text>
                <path
                    d="M171 83h4v5h-4zm1-1v-1h2v1m6 0 3 3-3 3v-6l3 3"
                    fill="none"
                    stroke="#bbd6fb"
                    strokeWidth="0.8"
                />
                <rect
                    x="190"
                    y="82"
                    width="9"
                    height="5"
                    rx="1"
                    fill="none"
                    stroke="#91edb4"
                    strokeWidth="0.8"
                />
                <path
                    d="M200 83.5v2m-8-2v2m2-2v2m2-2v2"
                    stroke="#91edb4"
                    strokeWidth="1"
                />
            </svg>
            <canvas
                ref={ref}
                width={128}
                height={150}
                className={styles.screen}
                aria-label={intl.formatMessage(messages.preview)}
            />
        </div>
    );
});
RobotPreview.displayName = 'RobotPreview';
RobotPreview.propTypes = {nickname: PropTypes.string};
export default RobotPreview;
