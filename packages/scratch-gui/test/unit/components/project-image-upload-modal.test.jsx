import React from 'react';
import EventEmitter from 'events';
import ReactModal from 'react-modal';
import {act, render, fireEvent, waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import {IntlProvider} from 'react-intl';
import ProjectImageUploadModal from '../../../src/components/project-image-upload-modal/project-image-upload-modal';

const setup = () => {
    const workspace = document.createElement('div');
    const create = document.createElement('button');
    create.textContent = 'New image';
    workspace.appendChild(create);
    document.body.appendChild(workspace);
    create.focus();
    ReactModal.setAppElement(workspace);
    const runtime = new EventEmitter();
    runtime.tinkibotImageSync = {phase: 'uploading',
        blocking: true,
        completed: 0,
        total: 2,
        filename: 'first.rgb565',
        progress: 30};
    const update = state => {
        runtime.tinkibotImageSync = {...runtime.tinkibotImageSync, ...state};
        runtime.imageSync.blocking = runtime.tinkibotImageSync.blocking;
        runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', runtime.tinkibotImageSync);
    };
    runtime.imageSync = {
        blocking: true,
        request: jest.fn(),
        interrupt: jest.fn(),
        retry: jest.fn(() => update({phase: 'uploading', error: '', progress: 0})),
        close: jest.fn(() => update({blocking: false}))
    };
    const view = render(<IntlProvider locale="en"><ProjectImageUploadModal
        runtime={runtime}
        workspaceRef={{current: workspace}}
    /></IntlProvider>);
    return {...view, runtime, update, workspace, create};
};

afterEach(() => {
    document.querySelectorAll('[data-test-workspace]').forEach(node => node.remove());
});

test('upload modal blocks workspace events, traps focus, reports acknowledged progress and cannot cancel', async () => {
    const h = setup();
    h.workspace.setAttribute('data-test-workspace', '');
    const clicked = jest.fn();
    const shortcut = jest.fn();
    h.create.addEventListener('click', clicked);
    document.addEventListener('keydown', shortcut);
    const dialog = h.getByRole('dialog', {name: 'Uploading project images'});
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(h.workspace).toHaveAttribute('inert');
    expect(h.workspace).toHaveAttribute('aria-busy', 'true');
    expect(h.getByRole('status')).toHaveTextContent('first.rgb565');
    expect(h.getByRole('status')).toHaveTextContent('0 of 2 images completed');
    expect(h.getByRole('progressbar')).toHaveAttribute('value', '30');
    expect(h.queryByRole('button', {name: /cancel|close/i})).toBeNull();
    fireEvent.click(h.create);
    fireEvent.keyDown(h.create, {key: 's', ctrlKey: true});
    fireEvent.keyDown(dialog, {key: 's', ctrlKey: true});
    expect(clicked).not.toHaveBeenCalled();
    expect(shortcut).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, {key: 'Escape', keyCode: 27});
    expect(h.runtime.imageSync.close).not.toHaveBeenCalled();
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, {key: 'Tab', keyCode: 9});
    expect(dialog).toHaveFocus();
    act(() => h.update({completed: 1, filename: 'second.rgb565', progress: 5}));
    expect(h.getByRole('status')).toHaveTextContent('1 of 2 images completed');
    act(() => h.update({phase: 'ready', blocking: false, completed: 2}));
    expect(h.queryByRole('dialog')).toBeNull();
    expect(h.workspace).not.toHaveAttribute('inert');
    expect(h.workspace).not.toHaveAttribute('aria-busy');
    fireEvent.click(h.create);
    expect(clicked).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', shortcut);
});

test('failure retains the modal with filename, error, retry and safe close', () => {
    const h = setup();
    h.workspace.setAttribute('data-test-workspace', '');
    act(() => h.update({phase: 'error',
        filename: 'second.rgb565',
        completed: 1,
        error: 'Robot storage full',
        canRetry: true}));
    expect(h.getByRole('alert')).toHaveTextContent('Robot storage full');
    expect(h.getByRole('status')).toHaveTextContent('second.rgb565');
    expect(h.workspace).toHaveAttribute('inert');
    fireEvent.click(h.getByRole('button', {name: 'Retry'}));
    expect(h.runtime.imageSync.retry).toHaveBeenCalledTimes(1);
    expect(h.getByRole('dialog')).toBeInTheDocument();
    act(() => h.update({phase: 'error', error: 'Robot disconnected', canRetry: false}));
    expect(h.getByRole('button', {name: 'Retry'})).toHaveAttribute('aria-disabled', 'true');
    const close = h.getAllByRole('button', {name: 'Close'}).pop();
    fireEvent.click(close);
    expect(h.runtime.imageSync.close).toHaveBeenCalledTimes(1);
    expect(h.queryByRole('dialog')).toBeNull();
    expect(h.workspace).not.toHaveAttribute('inert');
});

test('unmount removes listeners and interaction locks and interrupts the operation', () => {
    const h = setup();
    h.workspace.setAttribute('data-test-workspace', '');
    h.unmount();
    expect(h.runtime.imageSync.interrupt).toHaveBeenCalledTimes(1);
    expect(h.runtime.listenerCount('TINKIBOT_IMAGE_SYNC_CHANGED')).toBe(0);
    expect(h.workspace).not.toHaveAttribute('inert');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
});
