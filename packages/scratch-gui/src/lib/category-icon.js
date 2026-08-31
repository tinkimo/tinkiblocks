const iconPaths = {
    Motion: '<path d="m5 12 8-8v5h6v6h-6v5z"/>',
    Looks: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m10 4a4 4 0 1 0 0-8 4 4 0 0 0 0 8"/>',
    Sound: '<path d="M10 18a3 3 0 1 1-2-2.8V6l11-2v11a3 3 0 1 1-2-2.8V8l-7 1.3z"/>',
    Events: '<path d="M6 3h2v18H6zm3 1h10l-3 4 3 4H9z"/>',
    Control: '<path fill="none" stroke="white" stroke-width="2" stroke-linecap="round" d="M7 8a7 7 0 0 1 11 1m-1-4 1 4-4-1M17 16a7 7 0 0 1-11-1m1 4-1-4 4 1"/>',
    Sensing: '<circle cx="12" cy="15" r="2"/><path fill="none" stroke="white" stroke-width="2" stroke-linecap="round" d="M8 11a6 6 0 0 1 8 0M5 8a10 10 0 0 1 14 0"/>',
    Operators: '<path d="M5 6h5v2H5zm9 0h5v2h-5zM5 16h5v2H5zm9-2h5v2h-5zm0 4h5v2h-5zM7 12l2 2-1.4 1.4-2-2-2 2L2.2 14l2-2-2-2 1.4-1.4 2 2 2-2L9 10z"/>',
    Variables: '<path d="M5 5c0-2 14-2 14 0v14c0 2-14 2-14 0zm2 0c1 1 9 1 10 0-1-1-9-1-10 0m0 5c2 1 8 1 10 0V8c-3 1-7 1-10 0zm0 5c2 1 8 1 10 0v-2c-3 1-7 1-10 0zm0 4c2 1 8 1 10 0v-1c-3 1-7 1-10 0z"/>',
    'My Blocks': '<path d="M4 4h6v3a2 2 0 1 0 4 0V4h6v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4z"/>'
};

/**
 * Build a core category icon matching the coloured-square Tinkimo category icons.
 * @param {string} category category name
 * @param {string} color category primary colour
 * @returns {string} encoded SVG data URI
 */
const categoryIconURI = (category, color) => `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>${category}</title>` +
    `<rect width="24" height="24" rx="4" fill="${color}"/><g fill="white">${iconPaths[category]}</g></svg>`
)}`;

export default categoryIconURI;
