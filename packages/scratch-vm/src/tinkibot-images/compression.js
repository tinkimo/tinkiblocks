/**
 * Pack RGB565 pixels with an authenticated header when this saves bytes.
 * @param {Uint8Array} bytes Raw full-screen RGB565 image.
 * @returns {Promise<Uint8Array>} Smaller envelope or the original byte buffer.
 */
const compress = async bytes => {
    if (bytes.length !== 40960) return bytes;
    const output = [84, 73, 82, 49, ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))];
    const same = (a, b) => bytes[a] === bytes[b] && bytes[a + 1] === bytes[b + 1];
    let offset = 0;
    while (offset < bytes.length) {
        let end = offset + 2;
        while (end < Math.min(bytes.length, offset + 256) && same(offset, end)) end += 2;
        if (end - offset >= 4) {
            output.push(128 | (((end - offset) / 2) - 1), bytes[offset], bytes[offset + 1]);
        } else {
            end = offset + 2;
            while (end < Math.min(bytes.length, offset + 256)) {
                if (end + 2 < bytes.length && same(end, end + 2)) break;
                end += 2;
            }
            output.push(((end - offset) / 2) - 1, ...bytes.slice(offset, end));
        }
        offset = end;
    }
    return output.length < bytes.length ? new Uint8Array(output) : bytes;
};
module.exports = {compress};
