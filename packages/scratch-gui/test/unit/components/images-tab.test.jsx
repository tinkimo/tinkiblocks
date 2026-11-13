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
        getImageData: () => ({data: new Uint8ClampedArray(WIDTH * HEIGHT * 4)})};
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    HTMLCanvasElement.prototype.setPointerCapture = jest.fn();
    window.confirm = jest.fn(() => true);
});
afterEach(() => jest.restoreAllMocks());

const editor = () => {
    const vm = new EventEmitter();
    vm.runtime = new EventEmitter();
    vm.runtime.tinkibotConnectedRobots = [];
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
test('editor works offline, renders LCD icon and fixed canvases, and manages images', () => {
    const {getByRole, getByLabelText, vm} = editor();
    expect(getByRole('button', {name: 'New image'})).toBeEnabled();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    const canvas = getByLabelText('Drawing canvas, 128 by 140 pixels');
    expect(canvas).toHaveAttribute('width', '256');
    expect(canvas).toHaveAttribute('height', '280');
    expect(getByLabelText('Robot preview')).toHaveAttribute('width', '128');
    expect(getByLabelText('Robot preview')).toHaveAttribute('height', '140');
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
test('undo/redo and project switching preserve isolation', () => {
    const {getByRole, vm} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    act(() => { vm.projectImages.get().pixels.fill(0); vm.emit('TINKIBOT_IMAGES_CHANGED'); });
    fireEvent.click(getByRole('button', {name: 'Clear'}));
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


test('controls are grouped by purpose and the grid control is removed', () => {
    const {getByRole, queryByRole} = editor();
    fireEvent.click(getByRole('button', {name: 'New image'}));
    for (const name of ['Draw', 'Shapes', 'Select & pick', 'Edit image', 'Selection', 'Image actions', 'Export & upload']) {
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
