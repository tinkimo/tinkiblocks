/**
 * Move literal project-image choices into the dedicated block without changing their command.
 * @param {object} project Validated Scratch project JSON.
 * @param {string[]} names Current project image filenames.
 */
module.exports = (project, names) => {
    const images = new Set(names);
    for (const target of project.targets || []) {
        const blocks = target.blocks || {};
        for (const [id, block] of Object.entries(blocks)) {
            if (block.opcode !== 'tinkibotDisplay_display_image') continue;
            const input = block.inputs && block.inputs.IMAGE;
            if (!input || input[0] !== 1 || typeof input[1] !== 'string') continue;
            const shadow = blocks[input[1]];
            if (!shadow || !shadow.shadow || shadow.parent !== id ||
                shadow.opcode !== 'tinkibotDisplay_menu_image_options') continue;
            const field = shadow.fields && shadow.fields.image_options;
            if (!Array.isArray(field)) continue;
            const image = field[0];
            if (!images.has(image)) continue;
            block.opcode = 'tinkibotDisplay_display_user_image';
            block.fields.IMAGE = [image, null];
            delete block.inputs.IMAGE;
            delete blocks[input[1]];
        }
    }
};
