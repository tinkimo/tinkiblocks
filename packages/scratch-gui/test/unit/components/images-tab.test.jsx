import React from 'react';
import EventEmitter from 'events';
import {render, fireEvent, act} from '@testing-library/react';
import '@testing-library/jest-dom';
import {IntlProvider} from 'react-intl';
import ImagesTab from '../../../src/components/images-tab/images-tab';
import ScreenIcon from '../../../src/components/images-tab/screen-icon';
import {WIDTH, HEIGHT, point, rgb, colourAt, dot, line, fill, shape, region, copyRegion,
    pasteRegion, eraseRegion, rgba, fromRGBA, text, importCanvas} from '../../../src/components/images-tab/pixels';
jest.mock('uuid', () => {
    let index = 0;
    return {v4: () => `00000000-0000-4000-8000-${String(++index).padStart(12, '0')}`};
});
const {ImageCollection} = require('../../../../scratch-vm/src/tinkibot-images/collection');

const buffer = () => new Uint8Array(WIDTH * HEIGHT * 3).fill(255);
let context;
beforeEach(() => {
    context = {createImageData: (width, height) => ({data: new Uint8ClampedArray(width * height * 4)}),
        putImageData: jest.fn(), drawImage: jest.fn(), clearRect: jest.fn(), fillRect: jest.fn(),
        beginPath: jest.fn(), moveTo: jest.fn(), lineTo: jest.fn(), stroke: jest.fn(),
        setLineDash: jest.fn(), strokeRect: jest.fn(), fillText: jest.fn(),
        measureText: value => ({width: value.length * 5}),
        getImageData: () => ({data: new Uint8ClampedArray(WIDTH * HEIGHT * 4)})};
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.setPointerCapture = jest.fn();
    window.confirm = jest.fn(() => true);
    jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const editor = () => {
    const vm = new EventEmitter();
    vm.runtime = new EventEmitter();
    vm.runtime.tinkibotConnectedRobots = [];
    vm.imageSync = {pendingImages: () => [], uploadedNames: () => []};
    vm.projectImages = new ImageCollection(() => vm.emit('TINKIBOT_IMAGES_CHANGED'));
    vm.uploadProjectImage = jest.fn(() => Promise.resolve());
    const view = render(<IntlProvider locale="en"><ImagesTab vm={vm} /></IntlProvider>);
    return {...view, vm};
};

test('pointer mapping respects display scaling, fractional positions and clamped boundaries', () => {
    const bounds = {left: 20, top: 40, width: 256, height: 280};
    expect(point({clientX: 22, clientY: 42}, bounds)).toEqual({x: 1, y: 1});
    expect(point({clientX: 275.9, clientY: 319.9}, bounds)).toEqual({x: 127, y: 139});
    expect(point({clientX: -5, clientY: 1000}, bounds)).toEqual({x: 0, y: 139});
    expect(point({clientX: 100, clientY: 59}, {left: 20, top: 0, width: 128, height: 140}))
        .toEqual({x: 80, y: 59});
});
test('pencil/brush interpolate continuous lines and eraser paints the background exactly', () => {
    const data = buffer();
    const colour = rgb('#123456');
    line(data, {x: 0, y: 0}, {x: 10, y: 10}, colour);
    for (let index = 0; index <= 10; index++) expect(Array.from(colourAt(data, index, index))).toEqual(colour);
    dot(data, 5, 5, [255, 255, 255], 3);
    expect(Array.from(colourAt(data, 4, 4))).toEqual([255, 255, 255]);
    expect(Array.from(colourAt(data, 3, 3))).toEqual(colour);
});
test('flood fill respects a closed boundary and repeated fills terminate', () => {
    const data = buffer();
    shape(data, 'rectangle', {x: 2, y: 2}, {x: 8, y: 8}, [0, 0, 0]);
    fill(data, {x: 4, y: 4}, [10, 20, 30]);
    fill(data, {x: 4, y: 4}, [10, 20, 30]);
    expect(Array.from(colourAt(data, 4, 4))).toEqual([10, 20, 30]);
    expect(Array.from(colourAt(data, 2, 2))).toEqual([0, 0, 0]);
    expect(Array.from(colourAt(data, 1, 1))).toEqual([255, 255, 255]);
});
test.each(['line', 'rectangle', 'rectangleFilled', 'ellipse', 'ellipseFilled'])('shape %s paints bounded pixels', tool => {
    const data = buffer();
    shape(data, tool, {x: 10, y: 10}, {x: 20, y: 20}, [0, 0, 0]);
    expect(data.some(value => value === 0)).toBe(true);
    expect(Array.from(colourAt(data, 0, 0))).toEqual([255, 255, 255]);
    expect(Array.from(colourAt(data, 15, 15))).toEqual(
        ['rectangle', 'ellipse'].includes(tool) ? [255, 255, 255] : [0, 0, 0]);
});
test('copy, cut and move preserve exact RGB pixels and clip at edges', () => {
    const data = buffer();
    dot(data, 5, 5, [17, 99, 201]);
    const box = region({x: 4, y: 4}, {x: 6, y: 6});
    const clip = copyRegion(data, box);
    eraseRegion(data, box, [255, 255, 255]);
    pasteRegion(data, clip, {x: 10, y: 10});
    expect(Array.from(colourAt(data, 5, 5))).toEqual([255, 255, 255]);
    expect(Array.from(colourAt(data, 11, 11))).toEqual([17, 99, 201]);
    expect(() => pasteRegion(data, clip, {x: 127, y: 139})).not.toThrow();
});
test('RGBA round-trip preserves all RGB values and flattens transparency onto the chosen background', () => {
    const data = Uint8Array.from({length: WIDTH * HEIGHT * 3}, (_, index) => index % 256);
    expect(fromRGBA(rgba(data), [255, 255, 255])).toEqual(data);
    const transparent = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    expect(Array.from(fromRGBA(transparent, [17, 99, 201]).slice(0, 3))).toEqual([17, 99, 201]);
});
test('text rasterises only opaque glyph pixels in the selected colour', () => {
    const data = buffer();
    const glyph = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    glyph[3] = 255;
    context.getImageData = () => ({data: glyph});
    text(data, 'A', {x: 0, y: 0}, [17, 99, 201], 8);
    expect(context.fillText).toHaveBeenCalledWith('A', 0, 0);
    expect(Array.from(colourAt(data, 0, 0))).toEqual([17, 99, 201]);
    expect(Array.from(colourAt(data, 1, 0))).toEqual([255, 255, 255]);
});
test('import has explicit contain and crop strategies at native dimensions', () => {
    const image = {width: 256, height: 140};
    expect(importCanvas(image, 'contain', [255, 255, 255]).length).toBe(WIDTH * HEIGHT * 3);
    expect(context.drawImage).toHaveBeenLastCalledWith(image, 0, 35, 128, 70);
    importCanvas(image, 'crop', [255, 255, 255]);
    expect(context.drawImage).toHaveBeenLastCalledWith(image, -64, 0, 256, 140);
});
test('editor works offline, renders the LCD icon and drawing canvas, and manages images', () => {
    const {getByRole, getByLabelText, queryByLabelText, vm} = editor();
    expect(getByRole('button', {name: 'New image'})).toBeEnabled();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    const canvas = getByLabelText('Drawing canvas, 128 by 140 pixels');
    expect(canvas).toHaveAttribute('width', '256');
    expect(canvas).toHaveAttribute('height', '280');
    expect(queryByLabelText('Robot preview')).toBeNull();
    expect(getByRole('toolbar')).toBeInTheDocument();
    expect(getByRole('group', {name: 'Colours'})).toBeInTheDocument();
    expect(getByRole('button', {name: 'Upload to Robot'})).toBeDisabled();
    expect(vm.projectImages.get().pixels.length).toBe(128 * 140 * 3);
    fireEvent.click(getByRole('button', {name: 'Duplicate'}));
    expect(vm.projectImages.images.length).toBe(2);
    const name = getByLabelText('Image filename');
    fireEvent.change(name, {target: {value: 'rainbow'}});
    fireEvent.blur(name);
    expect(vm.projectImages.get().name).toBe('rainbow');
    fireEvent.click(getByRole('option', {name: 'image1'}));
    expect(vm.projectImages.get().name).toBe('image1');
    fireEvent.click(getByRole('button', {name: 'Delete'}));
    expect(window.confirm).toHaveBeenCalled();
    expect(vm.projectImages.images.length).toBe(1);
    const icon = render(<ScreenIcon className="tabIcon" />).container.querySelector('svg');
    expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
    expect(icon.querySelector('rect')).toHaveAttribute('rx', '2');
});
test('New image draws the new canvas and thumbnail once without repainting the gallery', () => {
    const {getByRole, vm} = editor();
    const create = () => fireEvent.click(getByRole('button', {name: 'New image'}));
    create();
    create();
    context.drawImage.mockClear();
    create();
    expect(getByRole('option', {name: 'image3'})).toHaveAttribute('aria-selected', 'true');
    expect(vm.projectImages.get().pixels[0]).toBe(255);
    expect(context.drawImage).toHaveBeenCalledTimes(2);
});

test('undo/redo and project switching preserve isolation', () => {
    const {getByRole, vm} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    act(() => { vm.projectImages.get().pixels.fill(0); vm.emit('TINKIBOT_IMAGES_CHANGED'); });
    fireEvent.click(getByRole('button', {name: 'Clear image'}));
    expect(vm.projectImages.get().pixels[0]).toBe(255);
    fireEvent.click(getByRole('button', {name: 'Undo'}));
    expect(vm.projectImages.get().pixels[0]).toBe(0);
    fireEvent.click(getByRole('button', {name: 'Redo'}));
    expect(vm.projectImages.get().pixels[0]).toBe(255);
    act(() => { vm.projectImages = new ImageCollection(); vm.emit('TINKIBOT_IMAGES_CHANGED'); });
    expect(vm.projectImages.images).toHaveLength(0);
    expect(getByRole('button', {name: 'New image'})).toBeVisible();
});
test('upload feedback uses the selected image and surfaces failures', async () => {
    const {getByRole, findByRole, findByText, vm} = editor();
    act(() => { vm.runtime.tinkibotConnectedRobots = [{claimState: 'paired'}]; });
    fireEvent.click(getByRole('button', {name: 'New image'}));
    fireEvent.click(getByRole('button', {name: 'Upload to Robot'}));
    await findByText('Image uploaded. Use its filename in the display image block.');
    expect(vm.uploadProjectImage.mock.calls[0][0]).toBe(vm.projectImages.selectedId);
    vm.uploadProjectImage.mockRejectedValueOnce(new Error('Disconnected'));
    fireEvent.click(getByRole('button', {name: 'Upload to Robot'}));
    expect(await findByRole('alert')).toHaveTextContent('Disconnected');
});


test('manual upload opens the progress dialog and updates the uploaded image row', async () => {
    const {getByRole, getByText, queryByRole, queryByText, vm} = editor();
    act(() => {
        vm.runtime.tinkibotConnectedRobots = [{claimState: 'paired'}];
        vm.runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', {phase: 'ready', pending: 2});
    });
    fireEvent.click(getByRole('button', {name: 'New image'}));
    fireEvent.click(getByRole('button', {name: 'New image'}));
    expect(queryByText('2 images need uploading before use.')).toBeNull();
    expect(getByRole('option', {name: 'image1'})).toHaveAccessibleDescription('Not uploaded');
    expect(getByRole('option', {name: 'image2'})).toHaveAccessibleDescription('Not uploaded');
    let complete;
    vm.uploadProjectImage.mockImplementation((id, progress) => new Promise(resolve => {
        progress(42);
        complete = resolve;
    }));
    fireEvent.click(getByRole('button', {name: 'Upload to Robot'}));
    expect(getByRole('dialog', {name: 'Uploading image…'})).toBeVisible();
    expect(getByText('image2.rgb565')).toBeVisible();
    expect(getByRole('progressbar')).toHaveValue(42);
    await act(async () => {
        vm.imageSync.uploadedNames = () => ['image2'];
        complete();
    });
    expect(queryByRole('dialog')).toBeNull();
    expect(getByRole('option', {name: 'image1'})).toHaveAccessibleDescription('Not uploaded');
    expect(getByRole('option', {name: 'image2'})).toHaveAccessibleDescription('Uploaded');
    act(() => {
        vm.imageSync.uploadedNames = () => [];
        vm.emit('TINKIBOT_IMAGES_CHANGED');
    });
    expect(getByRole('option', {name: 'image2'})).toHaveAccessibleDescription('Not uploaded');
});

test('controls are grouped by purpose and the grid control is removed', () => {
    const {getByRole, queryByRole} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    for (const name of ['Tools', 'Shapes', 'Selection', 'Colours', 'Image actions', 'Export & upload']) {
        expect(getByRole('group', {name})).toBeVisible();
    }
    expect(queryByRole('checkbox', {name: 'Pixel grid'})).toBeNull();
});

test('filename rules are visible above the field and invalid names are prevented inline', () => {
    const {getByRole, getByLabelText, getByText, vm} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    const first = vm.projectImages.get();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    const input = getByLabelText('Image filename');
    const hint = getByText(/Use lowercase letters, numbers and hyphens/);
    expect(hint.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input).toHaveAttribute('aria-describedby', 'image-filename-hint');
    fireEvent.change(input, {target: {value: 'Sunny_Day 2!'}});
    expect(input).toHaveValue('sunny-day-2');
    fireEvent.blur(input);
    expect(vm.projectImages.get().name).toBe('sunny-day-2');
    fireEvent.change(input, {target: {value: first.name}});
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(getByRole('alert')).toHaveAttribute('id', 'image-filename-error');
    expect(input).toHaveAttribute('aria-describedby', 'image-filename-hint image-filename-error');
    fireEvent.blur(input);
    expect(vm.projectImages.get().name).toBe('sunny-day-2');
    fireEvent.change(input, {target: {value: ''}});
    expect(getByRole('alert')).toHaveTextContent('Enter a filename');
    fireEvent.change(input, {target: {value: 'moon-light'}});
    expect(input).toHaveAttribute('aria-invalid', 'false');
    fireEvent.blur(input);
    expect(vm.projectImages.get().name).toBe('moon-light');
});


test('reopening the same project clears a stale filename draft and its error', () => {
    const {getByRole, getByLabelText, queryByRole, vm} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    const saved = vm.projectImages.serialize();
    fireEvent.change(getByLabelText('Image filename'), {target: {value: ''}});
    expect(getByRole('alert')).toBeVisible();
    act(() => {
        vm.projectImages = ImageCollection.restore(saved);
        vm.emit('TINKIBOT_IMAGES_CHANGED');
    });
    expect(getByLabelText('Image filename')).toHaveValue('image1');
    expect(queryByRole('alert')).toBeNull();
});


test('Paint-style shape fill toggles the drawing mode without duplicate tools', () => {
    const {getByRole, queryByRole, getByText} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    fireEvent.click(getByRole('button', {name: 'Rectangle', exact: true}));
    expect(getByRole('button', {name: 'Rectangle', exact: true})).toHaveAttribute('aria-pressed', 'true');
    expect(queryByRole('button', {name: 'Filled rectangle', exact: true})).toBeNull();
    fireEvent.click(getByRole('checkbox', {name: 'Fill shape'}));
    expect(getByRole('button', {name: 'Rectangle', exact: true})).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('checkbox', {name: 'Fill shape'})).toBeChecked();
    fireEvent.click(getByRole('button', {name: 'Ellipse', exact: true}));
    expect(getByRole('checkbox', {name: 'Fill shape'})).toBeChecked();
    expect(getByText(/Drag to draw an oval/)).toBeVisible();
});

test.each(['rectangle', 'ellipse'])('Paint bucket fills a closed %s in one undo step', outline => {
    const {getByRole, getByLabelText, vm} = editor();
    const pixels = buffer();
    shape(pixels, outline, {x: 10, y: 10}, {x: 30, y: 30}, [0, 0, 0]);
    act(() => { vm.projectImages.create('outlined-shape', pixels); });
    const canvas = getByLabelText('Drawing canvas, 128 by 140 pixels');
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 256, height: 280});
    fireEvent.click(getByRole('button', {name: 'Drawing colour #ef4444'}));
    fireEvent.click(getByRole('button', {name: 'Paint bucket'}));
    fireEvent(canvas, new MouseEvent('pointerdown', {bubbles: true, clientX: 40, clientY: 40}));
    fireEvent(canvas, new MouseEvent('pointerup', {bubbles: true, clientX: 40, clientY: 40}));
    expect(Array.from(colourAt(vm.projectImages.get().pixels, 20, 20))).toEqual(rgb('#ef4444'));
    expect(Array.from(colourAt(vm.projectImages.get().pixels, 20, 10))).toEqual([0, 0, 0]);
    expect(Array.from(colourAt(vm.projectImages.get().pixels, 5, 5))).toEqual([255, 255, 255]);
    fireEvent.click(getByRole('button', {name: 'Undo'}));
    expect(vm.projectImages.get().pixels).toEqual(pixels);
    expect(getByRole('button', {name: 'Undo'})).toBeDisabled();
});

test('text is typed on the image, finishes as one undo step, and Escape discards a draft', () => {
    window.PointerEvent = MouseEvent;
    const {getByRole, getByLabelText, queryByRole, vm} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    fireEvent.click(getByRole('button', {name: 'Text', exact: true}));
    const canvas = getByLabelText('Drawing canvas, 128 by 140 pixels');
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 256, height: 280});
    const original = new Uint8Array(vm.projectImages.get().pixels);
    const glyph = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    glyph[3] = 255;
    context.getImageData = () => ({data: glyph});
    fireEvent.pointerDown(canvas, {clientX: 20, clientY: 20, button: 0});
    const input = getByRole('textbox', {name: 'Text on image'});
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    fireEvent.change(input, {target: {value: 'Hello\nrobot'}});
    expect(vm.projectImages.get().pixels).toEqual(original);
    fireEvent.keyDown(input, {key: 'Enter', ctrlKey: true});
    expect(queryByRole('textbox', {name: 'Text on image'})).toBeNull();
    expect(vm.projectImages.get().pixels).not.toEqual(original);
    fireEvent.click(getByRole('button', {name: 'Undo', exact: true}));
    expect(vm.projectImages.get().pixels).toEqual(original);
    expect(getByRole('button', {name: 'Undo', exact: true})).toBeDisabled();
    fireEvent.pointerDown(canvas, {clientX: 40, clientY: 40, button: 0});
    const cancelled = getByRole('textbox', {name: 'Text on image'});
    fireEvent.change(cancelled, {target: {value: 'Cancel me'}});
    fireEvent.keyDown(cancelled, {key: 'Escape'});
    expect(vm.projectImages.get().pixels).toEqual(original);
    expect(queryByRole('textbox', {name: 'Text on image'})).toBeNull();
});

test('text wraps at the picture edge and preserves explicit new lines', () => {
    text(buffer(), 'ABC\nD', {x: WIDTH - 10, y: 0}, [0, 0, 0], 8);
    expect(context.fillText.mock.calls).toEqual([
        ['AB', WIDTH - 10, 0], ['C', WIDTH - 10, 10], ['D', WIDTH - 10, 20]
    ]);
});

test('text formatting keeps the draft open and clicking outside applies it', () => {
    window.PointerEvent = MouseEvent;
    const {getByRole, getByLabelText, queryByRole, vm} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    fireEvent.click(getByRole('button', {name: 'Text', exact: true}));
    const canvas = getByLabelText('Drawing canvas, 128 by 140 pixels');
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 256, height: 280});
    const glyph = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    glyph[3] = 255;
    context.getImageData = () => ({data: glyph});
    fireEvent.pointerDown(canvas, {clientX: 10, clientY: 10, button: 0});
    const input = getByRole('textbox', {name: 'Text on image'});
    fireEvent.change(input, {target: {value: 'Blue'}});
    const colour = getByLabelText('Drawing colour');
    fireEvent.blur(input, {relatedTarget: colour});
    fireEvent.change(colour, {target: {value: '#3b82f6'}});
    expect(getByRole('textbox', {name: 'Text on image'})).toHaveValue('Blue');
    fireEvent.pointerDown(document.body);
    expect(queryByRole('textbox', {name: 'Text on image'})).toBeNull();
    expect(Array.from(vm.projectImages.get().pixels.slice(0, 3))).toEqual([59, 130, 246]);
});

test('a loaded project discards a text draft belonging to the previous project', () => {
    window.PointerEvent = MouseEvent;
    const {getByRole, getByLabelText, queryByRole, vm} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    fireEvent.click(getByRole('button', {name: 'Text', exact: true}));
    const canvas = getByLabelText('Drawing canvas, 128 by 140 pixels');
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 256, height: 280});
    fireEvent.pointerDown(canvas, {clientX: 10, clientY: 10, button: 0});
    fireEvent.change(getByRole('textbox', {name: 'Text on image'}), {target: {value: 'Old project'}});
    act(() => {
        vm.projectImages = new ImageCollection();
        vm.projectImages.create();
        vm.emit('TINKIBOT_IMAGES_CHANGED');
    });
    expect(queryByRole('textbox', {name: 'Text on image'})).toBeNull();
    expect(vm.projectImages.get().pixels).toEqual(buffer());
});

test('leaving the Images tab finishes text before the editor unmounts', () => {
    window.PointerEvent = MouseEvent;
    const {getByRole, getByLabelText, unmount, vm} = editor();
    vm.imageSync.pendingImages = () => vm.projectImages.images.filter(image => image.pixels[0] !== 255);
    fireEvent.click(getByRole('button', {name: 'New image'}));
    fireEvent.click(getByRole('button', {name: 'Text', exact: true}));
    const canvas = getByLabelText('Drawing canvas, 128 by 140 pixels');
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 256, height: 280});
    const glyph = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    glyph[3] = 255;
    context.getImageData = () => ({data: glyph});
    fireEvent.pointerDown(canvas, {clientX: 10, clientY: 10, button: 0});
    fireEvent.change(getByRole('textbox', {name: 'Text on image'}), {target: {value: 'Keep me'}});
    unmount();
    expect(Array.from(vm.projectImages.get().pixels.slice(0, 3))).toEqual([0, 0, 0]);
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Upload to Robot'));
});

test('leaving Images warns for new images but not when all images are uploaded or deleted', () => {
    const view = editor();
    view.vm.imageSync.pendingImages = () => view.vm.projectImages.images;
    fireEvent.click(view.getByRole('button', {name: 'New image'}));
    view.unmount();
    expect(window.alert).toHaveBeenCalledTimes(1);
    window.alert.mockClear();
    const uploaded = editor();
    fireEvent.click(uploaded.getByRole('button', {name: 'New image'}));
    uploaded.unmount();
    expect(window.alert).not.toHaveBeenCalled();
    const empty = editor();
    empty.vm.imageSync.pendingImages = () => empty.vm.projectImages.images;
    fireEvent.click(empty.getByRole('button', {name: 'New image'}));
    fireEvent.click(empty.getByRole('button', {name: 'Delete', exact: true}));
    empty.unmount();
    expect(window.alert).not.toHaveBeenCalled();
});


test('manual upload waits while automatic project image restore is active', () => {
    const view = editor();
    act(() => {
        view.vm.projectImages.create();
        view.vm.runtime.tinkibotConnectedRobots = [{botUuid: 'robot', claimState: 'paired', connected: true}];
        view.vm.runtime.emit('TINKIBOT_CONNECTED_ROBOTS_CHANGED');
        view.vm.runtime.tinkibotImageSync = {phase: 'clearing', robot: 'lime'};
        view.vm.runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', view.vm.runtime.tinkibotImageSync);
    });
    expect(view.getByRole('button', {name: 'Upload to Robot'})).toBeDisabled();
    act(() => {
        view.vm.runtime.tinkibotImageSync = {phase: 'ready', robot: 'lime'};
        view.vm.runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', view.vm.runtime.tinkibotImageSync);
    });
    expect(view.getByRole('button', {name: 'Upload to Robot'})).toBeEnabled();
});

test('modal focus changes do not commit a pending filename while uploads are blocked', () => {
    const view = editor();
    fireEvent.click(view.getByRole('button', {name: 'New image'}));
    const field = view.getByLabelText('Image filename');
    fireEvent.change(field, {target: {value: 'draft-name'}});
    view.vm.imageSync.blocking = true;
    fireEvent.blur(field);
    expect(view.vm.projectImages.get().name).toBe('image1');
    view.vm.imageSync.blocking = false;
    fireEvent.blur(field);
    expect(view.vm.projectImages.get().name).toBe('draft-name');
});

test('modal focus keeps a text draft uncommitted until editing is unlocked', () => {
    window.PointerEvent = MouseEvent;
    const view = editor();
    fireEvent.click(view.getByRole('button', {name: 'New image'}));
    fireEvent.click(view.getByRole('button', {name: 'Text', exact: true}));
    const canvas = view.getByLabelText('Drawing canvas, 128 by 140 pixels');
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 256, height: 280});
    const glyph = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    glyph[3] = 255;
    context.getImageData = () => ({data: glyph});
    fireEvent.pointerDown(canvas, {clientX: 10, clientY: 10, button: 0});
    fireEvent.change(view.getByRole('textbox', {name: 'Text on image'}), {target: {value: 'Draft'}});
    view.vm.imageSync.blocking = true;
    fireEvent.focusIn(document.body);
    expect(view.vm.projectImages.get().pixels[0]).toBe(255);
    expect(view.getByRole('textbox', {name: 'Text on image'})).toHaveValue('Draft');
    view.vm.imageSync.blocking = false;
    fireEvent.focusIn(document.body);
    expect(view.vm.projectImages.get().pixels[0]).toBe(0);
});

test('import uses the shared modal with a live sketchpad preview, fit choice and safe dismissal', () => {
    const ReactModal = require('react-modal');
    const view = editor();
    ReactModal.setAppElement(view.container);
    const NativeImage = window.Image;
    const oldCreate = URL.createObjectURL;
    const oldRevoke = URL.revokeObjectURL;
    let loaded;
    window.Image = class {
        constructor () {
            this.width = 256; this.height = 140; loaded = this;
        }
    };
    URL.createObjectURL = jest.fn(() => 'blob:import');
    URL.revokeObjectURL = jest.fn();
    try {
        const open = () => {
            fireEvent.change(view.container.querySelector('input[type="file"]'),
                {target: {files: [new File(['image'], 'drawing.png', {type: 'image/png'})]}});
            act(() => loaded.onload());
        };
        open();
        const dialog = view.getByRole('dialog', {name: 'Import preview'});
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(view.container).toHaveAttribute('aria-hidden', 'true');
        expect(view.getByRole('img', {name: /robot’s sketchpad/}).querySelector('canvas'))
            .toHaveAttribute('width', '128');
        expect(dialog.querySelector('img[aria-hidden="true"]')).toHaveAttribute('alt', '');
        expect(view.vm.projectImages.images).toHaveLength(0);
        fireEvent.change(view.getByLabelText('Image fit'), {target: {value: 'crop'}});
        expect(context.drawImage).toHaveBeenCalledWith(loaded, -64, 0, 256, 140);
        fireEvent.click(view.getByRole('button', {name: 'Add image'}));
        expect(view.vm.projectImages.images).toHaveLength(1);
        expect(view.queryByRole('dialog')).toBeNull();
        open();
        fireEvent.keyDown(view.getByRole('dialog'), {key: 'Escape', keyCode: 27});
        expect(view.queryByRole('dialog')).toBeNull();
        expect(view.vm.projectImages.images).toHaveLength(1);
        expect(view.container).not.toHaveAttribute('aria-hidden');
        open();
        fireEvent.click(view.getByRole('button', {name: 'Cancel'}));
        expect(view.queryByRole('dialog')).toBeNull();
        expect(view.vm.projectImages.images).toHaveLength(1);
    } finally {
        window.Image = NativeImage;
        URL.createObjectURL = oldCreate;
        URL.revokeObjectURL = oldRevoke;
    }
});
