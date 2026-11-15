import updateUserImageBlocks from '../../../src/lib/user-image-blocks';

test('placed user-image blocks disable when empty and recover with a valid filename', () => {
    let value = 'deleted-image';
    const block = {
        type: 'tinkibotDisplay_display_user_image',
        getSvgRoot: () => null,
        getFieldValue: jest.fn(() => value),
        setFieldValue: jest.fn(next => { value = next; }),
        setDisabledReason: jest.fn()
    };
    const other = {type: 'tinkibotDisplay_display_image', setDisabledReason: jest.fn()};
    const workspace = {getAllBlocks: () => [block, other]};
    updateUserImageBlocks(workspace, []);
    expect(block.setDisabledReason).toHaveBeenLastCalledWith(true, 'no-project-images');
    expect(value).toBe('__no_images__');
    updateUserImageBlocks(workspace, ['first', 'second']);
    expect(block.setDisabledReason).toHaveBeenLastCalledWith(false, 'no-project-images');
    expect(value).toBe('first');
    value = 'second';
    updateUserImageBlocks(workspace, ['first', 'second']);
    expect(value).toBe('second');
    updateUserImageBlocks(workspace, ['first']);
    expect(value).toBe('first');
    expect(other.setDisabledReason).not.toHaveBeenCalled();
});
