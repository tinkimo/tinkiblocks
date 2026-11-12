export const WIDTH = 160;
export const HEIGHT = 118;
export const HISTORY_LIMIT = 30;
export const point = (event, bounds) => ({
    x: Math.max(0, Math.min(WIDTH - 1, Math.floor(((event.clientX - bounds.left) * WIDTH) / bounds.width))),
    y: Math.max(0, Math.min(HEIGHT - 1, Math.floor(((event.clientY - bounds.top) * HEIGHT) / bounds.height)))
});
export const rgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
export const hex = colour => `#${Array.from(colour).map(value => value.toString(16).padStart(2, '0'))
    .join('')}`;
export const colourAt = (pixels, x, y) => pixels.slice(((y * WIDTH) + x) * 3, (((y * WIDTH) + x) * 3) + 3);
export const dot = (pixels, x, y, colour, size = 1) => {
    const start = -Math.floor(size / 2);
    for (let dy = start; dy < (start + size); dy++) {
        for (let dx = start; dx < (start + size); dx++) {
            if ((x + dx) >= 0 && (x + dx) < WIDTH && (y + dy) >= 0 && (y + dy) < HEIGHT) {
                pixels.set(colour, ((((y + dy) * WIDTH) + x) + dx) * 3);
            }
        }
    }
};
export const line = (pixels, from, to, colour, size = 1) => {
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    for (let index = 0; index <= steps; index++) {
        const fraction = steps ? index / steps : 0;
        dot(pixels, Math.round(from.x + ((to.x - from.x) * fraction)),
            Math.round(from.y + ((to.y - from.y) * fraction)), colour, size);
    }
};
export const fill = (pixels, origin, colour) => {
    const target = colourAt(pixels, origin.x, origin.y);
    if (target.every((value, index) => value === colour[index])) return;
    const pending = [(origin.y * WIDTH) + origin.x];
    const visit = index => {
        if (target.every((value, channel) => pixels[(index * 3) + channel] === value)) {
            pixels.set(colour, index * 3);
            pending.push(index);
        }
    };
    pixels.set(colour, pending[0] * 3);
    while (pending.length) {
        const index = pending.pop();
        if (index % WIDTH) visit(index - 1);
        if ((index % WIDTH) < (WIDTH - 1)) visit(index + 1);
        if (index >= WIDTH) visit(index - WIDTH);
        if (index < (WIDTH * (HEIGHT - 1))) visit(index + WIDTH);
    }
};
export const region = (a, b) => ({x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x) + 1,
    height: Math.abs(a.y - b.y) + 1});
export const shape = (pixels, tool, a, b, colour, size = 1) => {
    if (tool === 'line') return line(pixels, a, b, colour, size);
    const box = region(a, b);
    const right = (box.x + box.width) - 1;
    const bottom = (box.y + box.height) - 1;
    if (tool.includes('rectangle')) {
        for (let y = box.y; y <= bottom; y++) {
            for (let x = box.x; x <= right; x++) {
                if (tool === 'rectangleFilled' || x === box.x || x === right || y === box.y || y === bottom) {
                    dot(pixels, x, y, colour);
                }
            }
        }
    } else {
        const rx = box.width / 2;
        const ry = box.height / 2;
        const cx = box.x + ((box.width - 1) / 2);
        const cy = box.y + ((box.height - 1) / 2);
        if (box.width === 1 || box.height === 1) return line(pixels, a, b, colour);
        const inside = (x, y) => ((((x - cx) / rx) ** 2) + (((y - cy) / ry) ** 2)) <= 1;
        for (let y = box.y; y <= bottom; y++) {
            for (let x = box.x; x <= right; x++) {
                if (inside(x, y) && (tool === 'ellipseFilled' || !inside(x - 1, y) || !inside(x + 1, y) ||
                    !inside(x, y - 1) || !inside(x, y + 1))) dot(pixels, x, y, colour);
            }
        }
    }
};
export const copyRegion = (pixels, box) => {
    const data = new Uint8Array((box.width * box.height) * 3);
    for (let y = 0; y < box.height; y++) {
        data.set(pixels.slice((((box.y + y) * WIDTH) + box.x) * 3,
            ((((box.y + y) * WIDTH) + box.x) + box.width) * 3), (y * box.width) * 3);
    }
    return {...box, data};
};
export const pasteRegion = (pixels, clip, origin) => {
    for (let y = 0; y < clip.height; y++) {
        for (let x = 0; x < clip.width; x++) {
            const targetX = origin.x + x;
            const targetY = origin.y + y;
            if (targetX < 0 || targetX >= WIDTH || targetY < 0 || targetY >= HEIGHT) continue;
            const source = ((y * clip.width) + x) * 3;
            const target = ((targetY * WIDTH) + targetX) * 3;
            pixels[target] = clip.data[source];
            pixels[target + 1] = clip.data[source + 1];
            pixels[target + 2] = clip.data[source + 2];
        }
    }
};
export const eraseRegion = (pixels, box, colour) => {
    for (let y = box.y; y < (box.y + box.height); y++) {
        for (let x = box.x; x < (box.x + box.width); x++) dot(pixels, x, y, colour);
    }
};
export const rgba = pixels => {
    const output = new Uint8ClampedArray((WIDTH * HEIGHT) * 4);
    for (let index = 0; index < (WIDTH * HEIGHT); index++) {
        const source = index * 3;
        const target = index * 4;
        output[target] = pixels[source];
        output[target + 1] = pixels[source + 1];
        output[target + 2] = pixels[source + 2];
        output[(index * 4) + 3] = 255;
    }
    return output;
};
export const fromRGBA = (pixels, background) => {
    const output = new Uint8Array((WIDTH * HEIGHT) * 3);
    for (let index = 0; index < (WIDTH * HEIGHT); index++) {
        const alpha = pixels[(index * 4) + 3] / 255;
        for (let channel = 0; channel < 3; channel++) {
            output[(index * 3) + channel] = Math.round((pixels[(index * 4) + channel] * alpha) +
                (background[channel] * (1 - alpha)));
        }
    }
    return output;
};
export const imageCanvas = pixels => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    const image = context.createImageData(WIDTH, HEIGHT);
    image.data.set(rgba(pixels));
    context.putImageData(image, 0, 0);
    return canvas;
};
export const text = (pixels, value, origin, colour, size) => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    context.font = `${size}px monospace`;
    context.textBaseline = 'top';
    context.fillStyle = '#000000';
    context.fillText(value, origin.x, origin.y);
    const data = context.getImageData(0, 0, WIDTH, HEIGHT).data;
    for (let index = 0; index < (WIDTH * HEIGHT); index++) {
        if (data[(index * 4) + 3] >= 128) pixels.set(colour, index * 3);
    }
};
export const importCanvas = (image, strategy, background) => {
    const canvas = imageCanvas(new Uint8Array((WIDTH * HEIGHT) * 3));
    const context = canvas.getContext('2d');
    context.fillStyle = hex(background);
    context.fillRect(0, 0, WIDTH, HEIGHT);
    const scale = Math[strategy === 'crop' ? 'max' : 'min'](WIDTH / image.width, HEIGHT / image.height);
    context.drawImage(image, (WIDTH - (image.width * scale)) / 2, (HEIGHT - (image.height * scale)) / 2,
        image.width * scale, image.height * scale);
    return fromRGBA(context.getImageData(0, 0, WIDTH, HEIGHT).data, background);
};
