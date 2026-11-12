const {Buffer} = require('buffer');
const uuid = require('uuid');

const WIDTH = 128;
const HEIGHT = 140;
const BYTE_LENGTH = WIDTH * HEIGHT * 3;
const MAX_IMAGES = 64;
const validId = id => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const validName = name => /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);

/** Lossless RGB project data; independent of a browser canvas or robot connection. */
class ImageCollection {
    constructor (changed = () => {}) {
        this.images = [];
        this.selectedId = null;
        this.changed = changed;
    }

    select (id) {
        if (!this.images.some(image => image.id === id)) throw new Error('Unknown image');
        this.selectedId = id;
        this.changed();
    }

    create (name, pixels = new Uint8Array(BYTE_LENGTH).fill(255)) {
        if (this.images.length >= MAX_IMAGES) throw new Error('Image limit reached (64)');
        if (!name) {
            const usedNames = new Set(this.images.map(image => image.name.toLowerCase()));
            let index = 1;
            while (usedNames.has(`image${index}`)) index++;
            name = `image${index}`;
        }
        this.validateName(name);
        if (pixels.length !== BYTE_LENGTH) throw new Error('Invalid image dimensions');
        const image = {id: uuid.v4(), name, pixels: new Uint8Array(pixels)};
        this.images.push(image);
        this.selectedId = image.id;
        this.changed();
        return image;
    }

    normalizeName (value) {
        return value.toLowerCase().replace(/[\s_]+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
            .replace(/^-+/, '')
            .slice(0, 64);
    }

    validateName (name, id) {
        if (typeof name !== 'string' || !validName(name)) {
            throw new Error('Use 1–64 lowercase letters, numbers or hyphens, starting with a letter or number');
        }
        if (this.images.some(image => image.id !== id && image.name.toLowerCase() === name.toLowerCase())) {
            throw new Error('An image with that name already exists');
        }
    }

    rename (id, name) {
        this.validateName(name, id);
        this.get(id).name = name;
        this.changed();
    }

    get (id = this.selectedId) {
        const image = this.images.find(item => item.id === id);
        if (!image) throw new Error('Unknown image');
        return image;
    }

    update (id, pixels) {
        if (pixels.length !== BYTE_LENGTH) throw new Error('Invalid image dimensions');
        this.get(id).pixels = new Uint8Array(pixels);
        this.changed();
    }

    remove (id) {
        this.get(id);
        this.images = this.images.filter(image => image.id !== id);
        if (this.selectedId === id) this.selectedId = this.images.length ? this.images[0].id : null;
        this.changed();
    }

    serialize () {
        return {version: 1,
            selectedId: this.selectedId,
            images: this.images.map(image => ({id: image.id,
                name: image.name,
                width: WIDTH,
                height: HEIGHT,
                rgb: Buffer.from(image.pixels).toString('base64')}))};
    }

    static restore (data, changed) {
        const collection = new ImageCollection(changed);
        if (!data) return collection;
        if (data.version !== 1 || !Array.isArray(data.images) || data.images.length > MAX_IMAGES) {
            throw new Error('Invalid project image collection');
        }
        const usedNames = new Set();
        for (const image of data.images) {
            const legacy = image && image.width === 160 && image.height === 118;
            const byteLength = legacy ? 160 * 118 * 3 : BYTE_LENGTH;
            if (!image || typeof image.id !== 'string' || !validId(image.id) ||
                collection.images.some(item => item.id === image.id) ||
                (!legacy && (image.width !== WIDTH || image.height !== HEIGHT)) || typeof image.rgb !== 'string' ||
                image.rgb.length !== byteLength * 4 / 3 || !/^[A-Za-z0-9+/]+$/.test(image.rgb)) {
                throw new Error('Invalid project image asset');
            }
            if (typeof image.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(image.name)) {
                throw new Error('Invalid project image filename');
            }
            const base = collection.normalizeName(image.name);
            let name = base;
            let suffix = 2;
            while (usedNames.has(name)) {
                const ending = `-${suffix++}`;
                name = base.slice(0, 64 - ending.length) + ending;
            }
            collection.validateName(name);
            let pixels = new Uint8Array(Buffer.from(image.rgb, 'base64'));
            if (pixels.length !== byteLength) throw new Error('Invalid project image pixels');
            if (legacy) {
                // Contain draft landscape artwork upright inside the native portrait canvas.
                const portrait = new Uint8Array(BYTE_LENGTH).fill(255);
                const height = Math.floor(118 * WIDTH / 160);
                const top = Math.floor((HEIGHT - height) / 2);
                for (let y = 0; y < height; y++) {
                    const sourceY = Math.floor((y + 0.5) * 118 / height);
                    for (let x = 0; x < WIDTH; x++) {
                        const sourceX = Math.floor((x + 0.5) * 160 / WIDTH);
                        const source = ((sourceY * 160) + sourceX) * 3;
                        portrait.set(pixels.subarray(source, source + 3), (((y + top) * WIDTH) + x) * 3);
                    }
                }
                pixels = portrait;
            }
            collection.images.push({id: image.id, name, pixels});
            usedNames.add(name);
        }
        collection.selectedId = collection.images.some(image => image.id === data.selectedId) ?
            data.selectedId : (collection.images[0] || {}).id || null;
        return collection;
    }
}

module.exports = {ImageCollection, WIDTH, HEIGHT, BYTE_LENGTH, validName};
