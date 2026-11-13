/* eslint react/jsx-no-bind: off -- Local handlers use the current drawing state. */
/* eslint no-alert: off -- Confirm destructive image actions using the browser dialog. */
import React, {useEffect, useRef, useState} from 'react';
import PropTypes from 'prop-types';
import {useIntl} from 'react-intl';
import messages from './messages';
import styles from './images-tab.css';
import FilenameField from './filename-field';
import RobotPreview from './robot-preview';
import {WIDTH, HEIGHT, HISTORY_LIMIT, point, rgb, hex, colourAt, line, fill, shape, region,
    copyRegion, pasteRegion, eraseRegion, imageCanvas, text, importCanvas} from './pixels';

const toolGroups = [
    {label: 'drawTools', items: ['pencil', 'brush', 'eraser', 'fill', 'text']},
    {label: 'shapeTools', items: ['line', 'rectangle', 'rectangleFilled', 'ellipse', 'ellipseFilled']},
    {label: 'selectionTools', items: ['select', 'picker']}
];
const symbols = {pencil: '✎',
    brush: '🖌',
    eraser: '▱',
    fill: '▨',
    line: '╱',
    rectangle: '□',
    rectangleFilled: '■',
    ellipse: '○',
    ellipseFilled: '●',
    text: 'T',
    picker: '◉',
    select: '⬚'};
const palette = ['#000000', '#ffffff', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e',
    '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#ec4899', '#92400e', '#64748b', '#cbd5e1'];
const histories = new WeakMap();

const Thumbnail = ({pixels}) => {
    const canvas = useRef(null);
    useEffect(() => {
        const context = canvas.current.getContext('2d');
        context.imageSmoothingEnabled = false;
        context.drawImage(imageCanvas(pixels), 0, 0);
    }, [pixels]);
    return (<canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        aria-hidden
    />);
};
Thumbnail.propTypes = {pixels: PropTypes.instanceOf(Uint8Array).isRequired};

const ImagesTab = ({vm}) => {
    const intl = useIntl();
    const label = key => intl.formatMessage(messages[key]);
    const [, refresh] = useState(0);
    const [tool, setTool] = useState('pencil');
    const [colour, setColour] = useState('#000000');
    const [background, setBackground] = useState('#ffffff');
    const [size, setSize] = useState(5);
    const [fontSize, setFontSize] = useState(12);
    const [words, setWords] = useState(intl.formatMessage(messages.initialText));
    const [nameInvalid, setNameInvalid] = useState(false);
    const [error, setError] = useState('');
    const [upload, setUpload] = useState(null);
    const [imported, setImported] = useState(null);
    const [fit, setFit] = useState('contain');
    const canvas = useRef(null);
    const preview = useRef(null);
    const root = useRef(null);
    const file = useRef(null);
    const gesture = useRef(null);
    const selection = useRef(null);
    const clipboard = useRef(null);
    const pixels = useRef(null);
    const alive = useRef(true);
    const collection = vm.projectImages;
    const current = collection.images.find(image => image.id === collection.selectedId);
    if (!histories.has(collection)) histories.set(collection, new Map());
    const historyFor = () => {
        const records = histories.get(collection);
        if (!records.has(current.id)) records.set(current.id, {undo: [], redo: []});
        return records.get(current.id);
    };
    const attempt = action => {
        try {
            setError('');
            action();
        } catch (failure) {
            setError(failure.message);
        }
    };
    const paint = data => {
        if (!canvas.current || !preview.current || !data) return;
        const source = imageCanvas(data);
        for (const target of [canvas.current, preview.current]) {
            const context = target.getContext('2d');
            context.imageSmoothingEnabled = false;
            context.clearRect(0, 0, target.width, target.height);
            context.drawImage(source, 0, 0, target.width, target.height);
        }
        const context = canvas.current.getContext('2d');
        context.setLineDash([]);
        if (selection.current) {
            const box = selection.current;
            context.strokeStyle = '#8854d0';
            context.setLineDash([4, 2]);
            context.lineWidth = 1;
            context.strokeRect((box.x * 2) + 0.5, (box.y * 2) + 0.5, (box.width * 2) - 1, (box.height * 2) - 1);
        }
    };
    const commit = data => {
        if (!current || vm.projectImages !== collection) return;
        const before = current.pixels;
        if (before.every((value, index) => value === data[index])) return;
        const history = historyFor();
        history.undo.push(new Uint8Array(before));
        if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
        history.redo = [];
        const records = histories.get(collection);
        let count = [...records.values()].reduce((sum, item) => sum + item.undo.length + item.redo.length, 0);
        for (const item of records.values()) {
            while (count > 140 && item.undo.length) {
                item.undo.shift(); count--;
            }
            while (count > 140 && item.redo.length) {
                item.redo.shift(); count--;
            }
        }
        collection.update(current.id, data);
    };
    useEffect(() => {
        alive.current = true;
        const changed = () => refresh(value => value + 1);
        vm.on('TINKIBOT_IMAGES_CHANGED', changed);
        const robots = () => refresh(value => value + 1);
        vm.runtime.on('TINKIBOT_CONNECTED_ROBOTS_CHANGED', robots);
        return () => {
            alive.current = false;
            vm.removeListener('TINKIBOT_IMAGES_CHANGED', changed);
            vm.runtime.removeListener('TINKIBOT_CONNECTED_ROBOTS_CHANGED', robots);
        };
    }, [vm]);
    useEffect(() => {
        gesture.current = null;
        selection.current = null;
        pixels.current = current ? new Uint8Array(current.pixels) : null;
        paint(pixels.current);
        setImported(null);
        setUpload(null);
    }, [collection, current && current.id]);
    useEffect(() => {
        if (!gesture.current && current) pixels.current = new Uint8Array(current.pixels);
        paint(pixels.current);
    }, [current && current.pixels]);

    const undo = redo => {
        if (!current) return;
        const history = historyFor();
        const from = redo ? history.redo : history.undo;
        const to = redo ? history.undo : history.redo;
        if (!from.length) return;
        to.push(new Uint8Array(current.pixels));
        collection.update(current.id, from.pop());
        selection.current = null;
    };
    const copy = cut => {
        if (!current || !selection.current) return;
        clipboard.current = copyRegion(current.pixels, selection.current);
        if (cut) {
            const data = new Uint8Array(current.pixels);
            eraseRegion(data, selection.current, rgb(background));
            commit(data);
        }
        refresh(value => value + 1);
    };
    const paste = () => {
        if (!current || !clipboard.current) return;
        const data = new Uint8Array(current.pixels);
        const chosen = selection.current || {x: 0, y: 0};
        const origin = {x: Math.min(chosen.x, WIDTH - clipboard.current.width),
            y: Math.min(chosen.y, HEIGHT - clipboard.current.height)};
        pasteRegion(data, clipboard.current, origin);
        selection.current = {...origin, width: clipboard.current.width, height: clipboard.current.height};
        setTool('select');
        commit(data);
    };
    const move = event => {
        if (!current) return;
        const at = point(event, canvas.current.getBoundingClientRect());
        const drag = gesture.current;
        if (!drag) {
            if (tool === 'text') {
                const data = new Uint8Array(current.pixels);
                text(data, words, at, rgb(colour), fontSize);
                paint(data);
            }
            return;
        }
        if (['pencil', 'brush', 'eraser'].includes(drag.tool)) {
            line(pixels.current, drag.last, at, rgb(drag.tool === 'eraser' ? background : colour),
                drag.tool === 'pencil' ? 1 : size);
        } else if (drag.tool === 'select') {
            pixels.current = new Uint8Array(drag.base);
            if (drag.moving) {
                const origin = {x: Math.max(0, Math.min(WIDTH - drag.box.width, (drag.box.x + at.x) - drag.start.x)),
                    y: Math.max(0, Math.min(HEIGHT - drag.box.height, (drag.box.y + at.y) - drag.start.y))};
                eraseRegion(pixels.current, drag.box, rgb(background));
                pasteRegion(pixels.current, copyRegion(drag.base, drag.box), origin);
                selection.current = {...drag.box, ...origin};
            } else selection.current = region(drag.start, at);
        } else {
            pixels.current = new Uint8Array(drag.base);
            if (drag.tool === 'text') text(pixels.current, words, at, rgb(colour), fontSize);
            else shape(pixels.current, drag.tool, drag.start, at, rgb(colour), size);
        }
        drag.last = at;
        paint(pixels.current);
    };
    const down = event => {
        if (!current || event.button > 0) return;
        event.preventDefault();
        canvas.current.focus();
        canvas.current.setPointerCapture(event.pointerId);
        const start = point(event, canvas.current.getBoundingClientRect());
        const base = new Uint8Array(current.pixels);
        const box = selection.current;
        const moving = tool === 'select' && box && start.x >= box.x && start.x < (box.x + box.width) &&
            start.y >= box.y && start.y < (box.y + box.height);
        gesture.current = {start, last: start, base, moving, box, tool};
        pixels.current = new Uint8Array(base);
        if (tool === 'picker') {
            setColour(hex(colourAt(base, start.x, start.y)));
            gesture.current = null;
        } else if (tool === 'fill') {
            fill(pixels.current, start, rgb(colour));
            commit(pixels.current);
            gesture.current = null;
        } else {
            move(event);
        }
    };
    const up = event => {
        if (!gesture.current) return;
        move(event);
        gesture.current = null;
        commit(pixels.current);
        refresh(value => value + 1);
    };
    const cancel = () => {
        if (gesture.current && gesture.current.moving) selection.current = gesture.current.box;
        gesture.current = null;
        pixels.current = current ? new Uint8Array(current.pixels) : null;
        paint(pixels.current);
    };
    const shortcut = event => {
        event.stopPropagation();
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
        const key = event.key.toLowerCase();
        if (event.ctrlKey || event.metaKey) {
            const actions = {z: () => undo(event.shiftKey),
                y: () => undo(true),
                c: () => copy(false),
                x: () => copy(true),
                v: paste};
            if (actions[key]) {
                event.preventDefault(); actions[key]();
            }
        } else if (key === 'escape') {
            cancel(); selection.current = null; paint(pixels.current);
        } else if (key.startsWith('arrow') && selection.current && current) {
            event.preventDefault();
            const box = selection.current;
            const origin = {x: Math.max(0, Math.min(WIDTH - box.width,
                box.x + (key === 'arrowright' ? 1 : key === 'arrowleft' ? -1 : 0))),
            y: Math.max(0, Math.min(HEIGHT - box.height,
                box.y + (key === 'arrowdown' ? 1 : key === 'arrowup' ? -1 : 0)))};
            const data = new Uint8Array(current.pixels);
            eraseRegion(data, box, rgb(background));
            pasteRegion(data, copyRegion(current.pixels, box), origin);
            selection.current = {...box, ...origin};
            commit(data);
        }
    };
    const readFile = event => {
        const uploaded = event.target.files[0];
        event.target.value = '';
        if (!uploaded) return;
        if (!['image/png', 'image/jpeg'].includes(uploaded.type)) {
            setError(label('invalidImport')); return;
        }
        const url = URL.createObjectURL(uploaded);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            if (alive.current && vm.projectImages === collection) {
                setImported(image); setFit('contain');
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url); if (alive.current) setError(label('importFailed'));
        };
        image.src = url;
    };
    const exportImage = () => {
        imageCanvas(current.pixels).toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${current.name}.png`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    };
    const uploadImage = async () => {
        const id = current.id;
        setUpload({busy: true, progress: null});
        setError('');
        try {
            await vm.uploadProjectImage(id, value => {
                if (alive.current && vm.projectImages === collection && collection.selectedId === id) {
                    setUpload({busy: true, progress: value});
                }
            });
            if (alive.current && vm.projectImages === collection && collection.selectedId === id) {
                setUpload({busy: false, success: true});
            }
        } catch (failure) {
            if (alive.current && vm.projectImages === collection) {
                setUpload(null); setError(failure.message);
            }
        }
    };
    const button = (key, action, disabled = false) => (
        <button
            type="button"
            onClick={() => attempt(action)}
            disabled={disabled}
            title={label(key)}
        >{label(key)}</button>
    );
    const paired = (vm.runtime.tinkibotConnectedRobots || []).some(robot =>
        robot.claimState === 'paired' && robot.connected !== false);
    const history = current ? historyFor() : {undo: [], redo: []};
    const importPixels = imported ? importCanvas(imported, fit, rgb(background)) : null;
    return (
        <section
            className={styles.editor}
            ref={root}
            onKeyDown={shortcut}
            onKeyUp={event => event.stopPropagation()}
        >
            <aside className={styles.gallery}>
                <h2>{label('heading')}</h2>
                {button('newImage', () => collection.create(), collection.images.length >= 64)}
                {button('importImage', () => file.current.click(), collection.images.length >= 64)}
                <input
                    ref={file}
                    type="file"
                    accept="image/png,image/jpeg"
                    hidden
                    onChange={readFile}
                />
                <div
                    className={styles.imageList}
                    role="listbox"
                    aria-label={label('heading')}
                >
                    {collection.images.map(image => (
                        <button
                            key={image.id}
                            type="button"
                            role="option"
                            aria-selected={image.id === collection.selectedId}
                            onClick={() => collection.select(image.id)}
                        >
                            <Thumbnail pixels={image.pixels} />
                            <span>{image.name}</span>
                        </button>
                    ))}
                </div>
                <p>{label('savedHint')}</p>
            </aside>
            <main className={styles.workspace}>
                {current ? <div className={styles.content}>
                    <div className={styles.imageHeader}>
                        <FilenameField
                            collection={collection}
                            image={current}
                            onValidityChange={setNameInvalid}
                        />
                        <fieldset className={styles.controlGroup}>
                            <legend>{label('imageActions')}</legend>
                            {button('duplicate', () => collection.create(null, current.pixels),
                                collection.images.length >= 64)}
                            {button('deleteImage', () => {
                                if (window.confirm(label('deleteConfirm'))) collection.remove(current.id);
                            })}
                        </fieldset>
                    </div>
                    <div
                        className={styles.tools}
                        role="toolbar"
                        aria-label={label('tools')}
                    >
                        {toolGroups.map(group => (
                            <fieldset
                                className={styles.controlGroup}
                                key={group.label}
                            >
                                <legend>{label(group.label)}</legend>
                                <div className={styles.groupButtons}>
                                    {group.items.map(item => (
                                        <button
                                            key={item}
                                            type="button"
                                            aria-pressed={tool === item}
                                            title={label(item)}
                                            onClick={() => {
                                                cancel(); setTool(item);
                                            }}
                                        >
                                            <span aria-hidden>{symbols[item]}</span> {label(item)}
                                        </button>
                                    ))}
                                </div>
                            </fieldset>
                        ))}
                    </div>
                    <div className={styles.row}>
                        <fieldset className={styles.controlGroup}>
                            <legend>{label('editActions')}</legend>
                            <div className={styles.groupButtons}>
                                {button('undo', () => undo(false), !history.undo.length)}
                                {button('redo', () => undo(true), !history.redo.length)}
                                {button('clear', () => {
                                    if (window.confirm(label('clearConfirm'))) {
                                        const data = new Uint8Array((WIDTH * HEIGHT) * 3);
                                        for (let i = 0; i < (WIDTH * HEIGHT); i++) data.set(rgb(background), i * 3);
                                        commit(data);
                                    }
                                })}
                            </div>
                        </fieldset>
                        <fieldset className={styles.controlGroup}>
                            <legend>{label('selectionActions')}</legend>
                            <div className={styles.groupButtons}>
                                {button('copy', () => copy(false), !selection.current)}
                                {button('cut', () => copy(true), !selection.current)}
                                {button('paste', paste, !clipboard.current)}
                            </div>
                        </fieldset>
                    </div>
                    <div
                        className={styles.palette}
                        role="group"
                        aria-label={label('palette')}
                    >
                        {palette.map(value => (<button
                            key={value}
                            type="button"
                            aria-label={`${label('colour')} ${value}`}
                            title={value}
                            aria-pressed={colour === value}
                            style={{backgroundColor: value}}
                            onClick={() => setColour(value)}
                        />))}
                        <label>{label('colour')} <input
                            type="color"
                            value={colour}
                            onChange={event => setColour(event.target.value)}
                        /></label>
                        <output>{label('rgb')} {rgb(colour).join(', ')}</output>
                        <label>{label('background')} <input
                            type="color"
                            value={background}
                            onChange={event => setBackground(event.target.value)}
                        /></label>
                    </div>
                    <div className={styles.row}>
                        {['brush', 'eraser', 'line'].includes(tool) ? <label>{label('size')} <select
                            value={size}
                            onChange={event => setSize(Number(event.target.value))}
                        >
                            {[1, 3, 5, 9, 15].map(value => <option key={value}>{value}</option>)}
                        </select></label> : null}
                        {tool === 'text' ? <React.Fragment>
                            <label>{label('textValue')} <input
                                value={words}
                                maxLength={100}
                                onChange={event => setWords(event.target.value)}
                            /></label>
                            <label>{label('fontSize')} <select
                                value={fontSize}
                                onChange={event => setFontSize(Number(event.target.value))}
                            >
                                {[8, 10, 12, 16, 24, 32].map(value => <option key={value}>{value}</option>)}
                            </select></label>
                        </React.Fragment> : null}
                    </div>
                    <div className={styles.canvases}>
                        <div>
                            <canvas
                                ref={canvas}
                                width={WIDTH * 2}
                                height={HEIGHT * 2}
                                className={styles.canvas}
                                tabIndex={0}
                                aria-label={label('canvas')}
                                onPointerDown={down}
                                onPointerMove={move}
                                onPointerUp={up}
                                onPointerCancel={cancel}
                                onLostPointerCapture={cancel}
                                onPointerLeave={() => {
                                    if (!gesture.current) paint(current.pixels);
                                }}
                            />
                            <p>{tool === 'select' ? label('selectionHint') : label('nativeSize')}</p>
                        </div>
                        <div className={styles.preview}><h3>{label('preview')}</h3>
                            <RobotPreview
                                ref={preview}
                                nickname={((vm.runtime.tinkibotConnectedRobots || [])
                                    .find(robot => robot.claimState === 'paired') || {}).nickname}
                            />
                        </div>
                    </div>
                    <fieldset className={`${styles.controlGroup} ${styles.fileActions}`}>
                        <legend>{label('fileActions')}</legend>
                        {button('exportImage', exportImage)}
                        {button(upload && upload.busy ? 'uploading' : 'upload', uploadImage,
                            !paired || nameInvalid || Boolean(upload && upload.busy))}
                    </fieldset>
                    {upload && upload.busy ? (
                        <div role="status">
                            <progress
                                max={100}
                                {...(upload.progress === null ? {} : {value: upload.progress})}
                            />
                            <p>{label('overwrite')}</p>
                        </div>
                    ) : null}
                    {upload && upload.success ? <p role="status">{label('uploaded')}</p> : null}
                    {paired ? null : <p>{label('offline')}</p>}
                </div> : <p className={styles.empty}>{label('empty')}</p>}
                {error ? <p
                    role="alert"
                    className={styles.error}
                >{error}</p> : null}
                {imported ? <div
                    className={styles.importPanel}
                    role="dialog"
                    aria-label={label('importTitle')}
                >
                    <h3>{label('importTitle')}</h3>
                    <Thumbnail pixels={importPixels} />
                    <label>{label('strategy')} <select
                        value={fit}
                        onChange={event => setFit(event.target.value)}
                    >
                        <option value="contain">{label('contain')}</option><option value="crop">{label('crop')}</option>
                    </select></label>
                    {button('add', () => {
                        collection.create(null, importPixels); setImported(null);
                    })}
                    {button('cancel', () => setImported(null))}
                </div> : null}
            </main>
        </section>
    );
};
ImagesTab.propTypes = {
    vm: PropTypes.shape({
        on: PropTypes.func.isRequired,
        removeListener: PropTypes.func.isRequired,
        uploadProjectImage: PropTypes.func.isRequired,
        projectImages: PropTypes.shape({
            images: PropTypes.arrayOf(PropTypes.shape({id: PropTypes.string.isRequired})).isRequired,
            selectedId: PropTypes.string,
            update: PropTypes.func.isRequired,
            create: PropTypes.func.isRequired,
            select: PropTypes.func.isRequired,
            rename: PropTypes.func.isRequired,
            remove: PropTypes.func.isRequired
        }).isRequired,
        runtime: PropTypes.shape({
            tinkibotConnectedRobots: PropTypes.arrayOf(PropTypes.shape({claimState: PropTypes.string})),
            on: PropTypes.func.isRequired,
            removeListener: PropTypes.func.isRequired
        }).isRequired
    }).isRequired
};
export default ImagesTab;
