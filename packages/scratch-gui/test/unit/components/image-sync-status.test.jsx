import React from 'react';
import EventEmitter from 'events';
import {render, act, fireEvent} from '@testing-library/react';
import '@testing-library/jest-dom';
import {IntlProvider} from 'react-intl';
import ImageSyncStatus from '../../../src/components/image-sync-status/image-sync-status';

test('sync progress, failure and retry are visible, and waiting robots have no stale message', () => {
    const runtime = new EventEmitter();
    runtime.retryTinkibotImageSync = jest.fn();
    runtime.tinkibotImageSync = {phase: 'waiting'};
    const view = render(<IntlProvider locale="en"><ImageSyncStatus runtime={runtime} /></IntlProvider>);
    expect(view.queryByRole('status')).toBeNull();
    act(() => runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', {phase: 'uploading',
        robot: 'lime',
        image: 'picture',
        completed: 0,
        total: 2,
        progress: 50}));
    expect(view.getByRole('status')).toHaveTextContent('Restoring picture to lime');
    expect(view.getByRole('progressbar')).toHaveAttribute('value', '50');
    act(() => runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', {phase: 'error', error: 'Storage is full'}));
    expect(view.getByRole('alert')).toHaveTextContent('Storage is full');
    fireEvent.click(view.getByRole('button', {name: 'Retry image sync'}));
    expect(runtime.retryTinkibotImageSync).toHaveBeenCalledTimes(1);
    act(() => runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', {phase: 'waiting'}));
    expect(view.queryByRole('alert')).toBeNull();
});

test('new edits replace the restored message with an upload reminder', () => {
    const runtime = new EventEmitter();
    runtime.tinkibotImageSync = {phase: 'ready', robot: 'lime', pending: 1};
    const view = render(<IntlProvider locale="en"><ImageSyncStatus runtime={runtime} /></IntlProvider>);
    expect(view.getByRole('status')).toHaveTextContent('1 image needs uploading');
    expect(view.getByRole('status')).not.toHaveTextContent('restored');
    act(() => runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', {phase: 'ready', robot: 'lime', pending: 0}));
    expect(view.getByRole('status')).toHaveTextContent('Project images restored to lime');
});
