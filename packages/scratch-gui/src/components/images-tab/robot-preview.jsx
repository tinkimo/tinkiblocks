import React, {forwardRef, useId} from 'react';
import PropTypes from 'prop-types';
import {useIntl} from 'react-intl';
import messages from './messages';
import styles from './robot-preview.css';

// The screen opening is 160 × 128, with 10 rows reserved for the status strip.
const RobotPreview = forwardRef(({nickname}, ref) => {
    const intl = useIntl();
    const id = useId();
    return (
        <div className={styles.robot}>
            <svg
                aria-hidden
                focusable="false"
                viewBox="0 0 280 224"
                className={styles.housing}
            >
                <defs>
                    <linearGradient
                        id={`${id}-shell`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                    >
                        <stop
                            offset="0"
                            stopColor="#ffe77b"
                        />
                        <stop
                            offset="1"
                            stopColor="#e8b92f"
                        />
                    </linearGradient>
                    <linearGradient
                        id={`${id}-cover`}
                        x1="0"
                        y1="0"
                        x2="1"
                        y2="1"
                    >
                        <stop
                            offset="0"
                            stopColor="#fff1a0"
                        />
                        <stop
                            offset="1"
                            stopColor="#f4cf54"
                        />
                    </linearGradient>
                </defs>
                <rect
                    x="12"
                    y="17"
                    width="256"
                    height="200"
                    rx="34"
                    fill="#d5a72c"
                    opacity="0.2"
                />
                <rect
                    x="10"
                    y="10"
                    width="260"
                    height="200"
                    rx="34"
                    fill={`url(#${id}-shell)`}
                    stroke="#c89e28"
                    strokeWidth="2"
                />
                <path
                    d="M30 25Q20 29 20 49v119"
                    fill="none"
                    stroke="#fff5c0"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
                <rect
                    x="48"
                    y="16"
                    width="184"
                    height="188"
                    rx="18"
                    fill={`url(#${id}-cover)`}
                    stroke="#dfb63e"
                />
                <path
                    d="M62 26h156"
                    stroke="#fff8ce"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
                {[{x: 26, y: 28}, {x: 254, y: 28}, {x: 26, y: 192}, {x: 254, y: 192}].map(({x, y}) => (
                    <g key={`${x}/${y}`}>
                        <circle
                            cx={x}
                            cy={y}
                            r="6"
                            fill="#343c4b"
                        />
                        <path
                            d={`M${x - 2} ${y - 2}l4 4m-4 0 4-4`}
                            stroke="#6e7788"
                            strokeWidth="1.3"
                        />
                    </g>
                ))}
                {[{x: 19, y: 64}, {x: 19, y: 128}, {x: 237, y: 64}, {x: 237, y: 128}].map(({x, y}) => (
                    <g key={`${x}/${y}`}>
                        <rect
                            x={x - 2}
                            y={y - 2}
                            width="28"
                            height="30"
                            rx="8"
                            fill="#c3a74a"
                        />
                        <rect
                            x={x}
                            y={y}
                            width="24"
                            height="25"
                            rx="6"
                            fill="#485265"
                            stroke="#8b95a3"
                            strokeWidth="1.5"
                        />
                        <path
                            d={`M${x + 5} ${y + 4}h14`}
                            stroke="#647087"
                            strokeWidth="2"
                            strokeLinecap="round"
                        />
                    </g>
                ))}
                <rect
                    x="54"
                    y="42"
                    width="172"
                    height="140"
                    rx="9"
                    fill="#333d4b"
                    stroke="#202835"
                    strokeWidth="2"
                />
                <rect
                    x="58"
                    y="46"
                    width="164"
                    height="132"
                    rx="5"
                    fill="#101925"
                />
                <rect
                    x="60"
                    y="48"
                    width="160"
                    height="10"
                    fill="#233c69"
                />
                <text
                    x="64"
                    y="55.5"
                    fill="#f4f7fc"
                    fontSize="6.5"
                    fontFamily="monospace"
                >{nickname ? nickname.slice(0, 20) : 'Tinkibot'}</text>
                <path
                    d="M189 51h4v5h-4zm1-1v-1h2v1m6 0 3 3-3 3v-6l3 3"
                    fill="none"
                    stroke="#bbd6fb"
                    strokeWidth="0.8"
                />
                <rect
                    x="206"
                    y="50"
                    width="9"
                    height="5"
                    rx="1"
                    fill="none"
                    stroke="#91edb4"
                    strokeWidth="0.8"
                />
                <path
                    d="M216 51.5v2m-8-2v2m2-2v2m2-2v2"
                    stroke="#91edb4"
                    strokeWidth="1"
                />
                <path
                    d="M101 192h78"
                    stroke="#d8af39"
                    strokeWidth="2"
                    strokeLinecap="round"
                />
            </svg>
            <canvas
                ref={ref}
                width={160}
                height={118}
                className={styles.screen}
                aria-label={intl.formatMessage(messages.preview)}
            />
        </div>
    );
});
RobotPreview.displayName = 'RobotPreview';
RobotPreview.propTypes = {nickname: PropTypes.string};
export default RobotPreview;
