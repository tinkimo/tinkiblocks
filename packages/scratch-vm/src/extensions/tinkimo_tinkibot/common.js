/**
 * Build a Tinkibot icon in the same colour as its category blocks.
 * @param {string} color category primary colour
 * @returns {string} encoded SVG data URI
 */
const makeIconURI = color => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
    `<rect width="40" height="40" rx="8" fill="${color}"/>` +
    '<path fill="white" d="M8 9h24v7h-8v16h-8V16H8z"/>' +
    '</svg>'
)}`;

const createCategoryStyle = (color1, color2, color3) => {
    const iconURI = makeIconURI(color1);
    return {color1, color2, color3, blockIconURI: iconURI, menuIconURI: iconURI};
};

const categoryStyles = {
    tinkibotMovement: createCategoryStyle('#D1495B', '#B6384A', '#8F2838'),
    tinkibotInteraction: createCategoryStyle('#00798C', '#006273', '#004A58'),
    tinkibotSensors: createCategoryStyle('#3A7D44', '#2D6536', '#204C28'),
    tinkibotSounds: createCategoryStyle('#7B2CBF', '#64239E', '#4B1978'),
    tinkibotDisplay: createCategoryStyle('#B86B00', '#975700', '#713F00')
};

module.exports = categoryStyles;
