const {WIDTH, HEIGHT, BYTE_LENGTH} = require('./collection');

/**
 * Encode row-major, big-endian RGB565 words without a file header.
 * @param {Uint8Array} pixels Native 160 by 118 RGB888 image.
 * @returns {Uint8Array} Firmware-compatible RGB565 bytes.
 */
const encode = pixels => {
    if (pixels.length !== BYTE_LENGTH) throw new Error('Invalid image dimensions');
    const output = new Uint8Array((WIDTH * HEIGHT) * 2);
    for (let index = 0; index < (WIDTH * HEIGHT); index++) {
        const word = (((pixels[index * 3] >> 3) << 11) |
            ((pixels[(index * 3) + 1] >> 2) << 5)) | (pixels[(index * 3) + 2] >> 3);
        output[index * 2] = word >> 8;
        output[(index * 2) + 1] = word & 255;
    }
    return output;
};
module.exports = {encode};
