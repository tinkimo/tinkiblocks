import {styleUserImageBlocks} from '../../../src/lib/user-image-blocks';

test('custom image blocks keep their colour while disabled text can be styled independently', () => {
    const root = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const block = {type: 'tinkibotDisplay_display_user_image', getSvgRoot: () => root,
        getColour: () => '#AD5E00', pathObject: {style: {colourSecondary: '#D47A08'}}};
    styleUserImageBlocks({getAllBlocks: () => [block]});
    expect(root.classList.contains('tinkiblocks-user-image')).toBe(true);
    expect(root.style.getPropertyValue('--user-image-colour')).toBe('#AD5E00');
});
