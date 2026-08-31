const iconPaths = {
    Movement: '<path d="M19.4 13a7.8 7.8 0 0 0 0-2l2.1-1.7-2-3.4-2.6 1a8 8 0 0 0-1.7-1L14.8 3h-4l-.4 2.8a8 8 0 0 0-1.7 1l-2.6-1-2 3.4L6.3 11a8 8 0 0 0 0 2l-2.2 1.7 2 3.4 2.6-1a8 8 0 0 0 1.7 1l.4 2.8h4l.4-2.8a8 8 0 0 0 1.7-1l2.6 1 2-3.4zM12.8 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8"/>',
    Interaction: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="8" cy="16" r="3"/><circle cx="16" cy="16" r="3"/>',
    Sensors: '<circle cx="12" cy="15" r="2"/><path fill="none" stroke="white" stroke-width="2" stroke-linecap="round" d="M7.8 10.8a6 6 0 0 1 8.4 0M4.3 7.3a11 11 0 0 1 15.4 0"/>',
    Sounds: '<path d="M10 18a3 3 0 1 1-2-2.8V6l11-2v11a3 3 0 1 1-2-2.8V8l-7 1.3z"/>',
    Display: '<path d="M3 4h18v14h-7v2h3v2H7v-2h3v-2H3zm3 3v8h12V7z"/>'
};

/**
 * Build an icon in the same colour as its category blocks.
 * @param {string} name category name used for its accessible label
 * @param {string} color category primary colour
 * @returns {string} encoded SVG data URI
 */
const makeIconURI = (name, color) => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">` +
    `<title>${name}</title><rect width="24" height="24" rx="4" fill="${color}"/>` +
    `<g fill="white">${iconPaths[name]}</g></svg>`
)}`;

const createCategoryStyle = (name, color1, color2, color3) => {
    const iconURI = makeIconURI(name, color1);
    return {color1, color2, color3, blockIconURI: iconURI, menuIconURI: iconURI};
};

const categoryStyles = {
    tinkibotMovement: createCategoryStyle('Movement', '#B832D0', '#D34BE8', '#E667F5'),
    tinkibotInteraction: createCategoryStyle('Interaction', '#007F96', '#009DB8', '#18BDD5'),
    tinkibotSensors: createCategoryStyle('Sensors', '#12833A', '#20A64E', '#3AC865'),
    tinkibotSounds: createCategoryStyle('Sounds', '#7950E8', '#956CF2', '#B18BFA'),
    tinkibotDisplay: createCategoryStyle('Display', '#AD5E00', '#D47A08', '#F39A23')
};

module.exports = categoryStyles;
