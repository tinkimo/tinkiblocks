/**
 * Keep existing workspace blocks consistent with the project's image dropdown.
 * @param {object} workspace Blockly workspace containing the project blocks.
 * @param {string[]} names Current project image filenames.
 */
export default function updateUserImageBlocks (workspace, names) {
    for (const block of workspace.getAllBlocks(false)) {
        if (block.type !== 'tinkibotDisplay_display_user_image') continue;
        block.setDisabledReason(!names.length, 'no-project-images');
        styleUserImageBlock(block);
        const value = names.includes(block.getFieldValue('IMAGE')) ? block.getFieldValue('IMAGE') :
            names[0] || '__no_images__';
        if (value !== block.getFieldValue('IMAGE')) block.setFieldValue(value, 'IMAGE');
    }
}

const styleUserImageBlock = block => {
    const root = block.getSvgRoot();
    if (!root) return; // Blockly may create the model before rendering its SVG.
    root.classList.add('tinkiblocks-user-image');
    root.style.setProperty('--user-image-colour', block.getColour());
    root.style.setProperty('--user-image-secondary', block.pathObject.style.colourSecondary);
};

/**
 * Tag rendered custom-image blocks for disabled text-only styling.
 * @param {object} workspace Blockly workspace, including a palette workspace.
 */
export const styleUserImageBlocks = workspace => {
    for (const block of workspace.getAllBlocks(false)) {
        if (block.type === 'tinkibotDisplay_display_user_image') styleUserImageBlock(block);
    }
};
