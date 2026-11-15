/**
 * Keep existing workspace blocks consistent with the project's image dropdown.
 * @param {object} workspace Blockly workspace containing the project blocks.
 * @param {string[]} names Current project image filenames.
 */
export default function updateUserImageBlocks (workspace, names) {
    for (const block of workspace.getAllBlocks(false)) {
        if (block.type !== 'tinkibotDisplay_display_user_image') continue;
        block.setDisabledReason(!names.length, 'no-project-images');
        const value = names.includes(block.getFieldValue('IMAGE')) ? block.getFieldValue('IMAGE') :
            names[0] || '__no_images__';
        if (value !== block.getFieldValue('IMAGE')) block.setFieldValue(value, 'IMAGE');
    }
}
