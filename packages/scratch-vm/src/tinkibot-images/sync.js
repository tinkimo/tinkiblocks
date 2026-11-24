const uuid = require('uuid');

/** Restore a fixed project snapshot through the existing, sequential image uploader. */
class ImageSync {
    constructor (runtime) {
        this.runtime = runtime;
        this.projectReady = false;
        this.projectEpoch = 0;
        this.connectionEpoch = 0;
        this.generation = 0;
        this.key = null;
        this.wanted = null;
        this.running = null;
        this.operation = null;
        this.uploaded = new Map();
        this.previouslyUploaded = new Set();
        this.availableNames = '[]';
        runtime.imageSync = this;
        runtime.retryTinkibotImageSync = () => this.retry();
        runtime.on('PROJECT_LOADED', () => {
            this.projectReady = true;
            this.projectEpoch++;
            this.request();
        });
        runtime.on('RUNTIME_DISPOSED', () => {
            this.projectReady = false;
            this.request();
        });
        runtime.on('TINKIBOT_CONNECTED_ROBOTS_CHANGED', () => this.request());
        runtime.on('TINKIBOT_IMAGE_SYNC_TRANSPORT_READY', () => this.request());
        runtime.on('TINKIBOT_PROJECT_IMAGES_CHANGED', () => this.refreshAvailability());
        this.status({phase: 'waiting', blocking: false, error: ''});
    }

    robot () {
        const manager = this.runtime.tinkibotConnectionManager;
        if (manager && manager.method === 'web-serial' && !manager.apiReady) return null;
        return (this.runtime.tinkibotConnectedRobots || []).find(robot =>
            robot.botUuid && robot.claimState === 'paired' && robot.connected !== false);
    }

    fingerprint (robot) {
        const manager = this.runtime.tinkibotConnectionManager;
        if (!robot) return null;
        return [this.projectEpoch, this.connectionEpoch, robot.botUuid,
            robot.nickname, manager && manager.method].join('/');
    }

    status (update) {
        const state = {...this.runtime.tinkibotImageSync, ...update};
        this.runtime.tinkibotImageSync = state;
        this.runtime.emit('TINKIBOT_IMAGE_SYNC_CHANGED', state);
    }

    publish (operation, phase, update = {}) {
        if (this.operation !== operation) return;
        operation.phase = phase;
        const image = operation.images[operation.completed];
        this.status({operationId: operation.id,
            blocking: true,
            phase,
            botUuid: operation.robot.botUuid,
            robot: operation.robot.nickname,
            image: image ? image.snapshot.name : '',
            filename: image ? `${image.snapshot.name}.rgb565` : '',
            completed: operation.completed,
            total: operation.images.length,
            progress: operation.progress,
            canRetry: false,
            ...update});
    }

    connectionReady () {
        this.connectionEpoch++;
        this.request();
    }

    request (force = false) {
        const robot = this.robot();
        const key = this.projectReady && this.runtime.resetTinkibotImages &&
            this.runtime.uploadTinkibotImage ? this.fingerprint(robot) : null;
        if (!force && this.key === key) return;
        this.key = key;
        this.generation++;
        this.uploaded.clear();
        this.previouslyUploaded.clear();
        this.refreshAvailability();
        if (!key) {
            this.interrupt(this.projectReady ? 'Robot disconnected during project image upload' : 'Project changed',
                !this.projectReady);
            return;
        }
        const collection = this.runtime.tinkibotImages;
        const operation = {
            id: uuid.v4(),
            key,
            generation: this.generation,
            collection,
            robot: {...robot},
            images: collection.images.map(image => ({source: {...image},
                snapshot: {...image, pixels: new Uint8Array(image.pixels)}})),
            completed: 0,
            progress: 0,
            cleared: false,
            attempt: 0,
            interruption: null
        };
        this.operation = operation;
        this.wanted = operation;
        this.publish(operation, 'clearing', {error: ''});
        this.runtime.stopAll();
        this.start();
    }

    start () {
        if (!this.running && this.wanted) {
            this.running = Promise.resolve().then(() => this.drain())
                .finally(() => {
                    this.running = null;
                    this.start();
                });
        }
    }

    async drain () {
        while (this.wanted) {
            const operation = this.wanted;
            this.wanted = null;
            const attempt = ++operation.attempt;
            const valid = () => this.operation === operation && attempt === operation.attempt &&
                !operation.interruption && this.projectReady && operation.generation === this.generation &&
                operation.collection === this.runtime.tinkibotImages && this.key === operation.key &&
                this.fingerprint(this.robot()) === operation.key;
            try {
                if (!valid()) throw new Error('Project image upload interrupted');
                if (!operation.cleared) {
                    const token = uuid.v4().replace(/-/g, '')
                        .slice(0, 16);
                    await this.runtime.resetTinkibotImages(operation.robot, token, valid);
                    if (!valid()) throw new Error('Project image upload interrupted');
                    // eslint-disable-next-line require-atomic-updates -- Only the serialized drain writes this flag.
                    operation.cleared = true;
                }
                // Only this operation's private snapshot supplies filenames, data and ordering.
                while (operation.completed < operation.images.length) {
                    if (!valid()) throw new Error('Project image upload interrupted');
                    const image = operation.images[operation.completed];
                    operation.progress = 0;
                    this.publish(operation, 'uploading');
                    await this.runtime.uploadTinkibotImage(image.snapshot, progress => {
                        if (valid()) {
                            operation.progress = progress;
                            this.publish(operation, 'uploading');
                        }
                    }, {
                        botUuid: operation.robot.botUuid,
                        valid,
                        sync: true,
                        showComplete: operation.completed === operation.images.length - 1
                    });
                    if (!valid()) throw new Error('Project image upload interrupted');
                    this.recordUploaded(image.source, valid);
                    operation.completed++;
                }
                operation.attempt++;
                this.publish(operation, 'ready', {blocking: false, progress: 100, error: ''});
            } catch (error) {
                if (this.operation !== operation) continue;
                operation.attempt++;
                if (operation.dismissOnSettle) {
                    this.operation = null;
                    this.status({phase: 'waiting', blocking: false, error: ''});
                } else {
                    this.publish(operation, 'error', {error: operation.interruption || error.message,
                        canRetry: this.key === operation.key && this.fingerprint(this.robot()) === operation.key});
                }
            }
        }
    }

    retry () {
        if (this.busy) return false;
        const operation = this.operation;
        if (operation && operation.phase === 'error' && this.key === operation.key &&
            this.fingerprint(this.robot()) === operation.key) {
            operation.interruption = null;
            operation.progress = 0;
            this.wanted = operation;
            this.publish(operation, operation.cleared ? 'uploading' : 'clearing', {error: ''});
            this.runtime.stopAll();
            this.start();
            return true;
        }
        return false;
    }

    close () {
        if (this.busy || !this.operation || this.operation.phase !== 'error') return false;
        this.status({blocking: false});
        return true;
    }

    interrupt (reason, dismiss = true) {
        this.generation++;
        this.key = null;
        this.wanted = null;
        const operation = this.operation;
        if (operation && this.blocking) {
            operation.interruption = reason;
            operation.dismissOnSettle = dismiss;
            if (this.running) {
                this.publish(operation, 'stopping');
            } else if (dismiss) {
                this.operation = null;
                this.status({phase: 'waiting', blocking: false, error: ''});
            } else {
                this.publish(operation, 'error', {error: reason});
            }
        } else {
            this.status({phase: 'waiting', blocking: false, error: ''});
        }
    }

    get blocking () {
        return Boolean(this.runtime.tinkibotImageSync.blocking);
    }

    assertInteractive () {
        if (this.blocking) throw new Error('Wait for project image uploading to finish');
    }

    uploadedNames () {
        if (!this.projectReady || !this.key || this.key !== this.fingerprint(this.robot())) return [];
        return this.runtime.tinkibotImages.images.filter(image => {
            const uploaded = this.uploaded.get(image.id);
            return uploaded && uploaded.name === image.name && uploaded.pixels === image.pixels;
        }).map(image => image.name);
    }

    uploadStatus (image) {
        if (!this.projectReady || !this.key || this.key !== this.fingerprint(this.robot()) ||
            !this.previouslyUploaded.has(image.id)) return 'not-uploaded';
        const uploaded = this.uploaded.get(image.id);
        return uploaded && uploaded.name === image.name && uploaded.pixels === image.pixels ? 'synced' : 'modified';
    }

    pendingImages () {
        const available = new Set(this.uploadedNames());
        return this.runtime.tinkibotImages.images.filter(image => !available.has(image.name));
    }

    recordUploaded (image, valid) {
        if (!valid()) return;
        this.uploaded.set(image.id, {...image});
        this.previouslyUploaded.add(image.id);
        this.refreshAvailability();
    }

    refreshAvailability () {
        const images = this.runtime.tinkibotImages ? this.runtime.tinkibotImages.images : [];
        for (const [id, uploaded] of this.uploaded) {
            if (!images.some(image => image.id === id && image.name === uploaded.name &&
                image.pixels === uploaded.pixels)) this.uploaded.delete(id);
        }
        for (const id of this.previouslyUploaded) {
            if (!images.some(image => image.id === id)) this.previouslyUploaded.delete(id);
        }
        const names = this.uploadedNames();
        const pending = images.length - names.length;
        if (!this.runtime.tinkibotImageSync || pending !== this.runtime.tinkibotImageSync.pending) {
            this.status({pending});
        }
        const signature = JSON.stringify(names);
        if (signature !== this.availableNames) {
            this.availableNames = signature;
            this.runtime.emit('TINKIBOT_IMAGE_UPLOADS_CHANGED');
        }
    }

    get busy () {
        return Boolean(this.running || this.wanted);
    }

    readyForRobot () {
        return this.projectReady && this.key === this.fingerprint(this.robot()) &&
            this.runtime.tinkibotImageSync.phase === 'ready';
    }

    async wait () {
        this.request();
        while (this.running) await this.running;
        if (this.runtime.tinkibotImageSync.phase === 'error') {
            throw new Error(this.runtime.tinkibotImageSync.error);
        }
        if (!this.readyForRobot()) throw new Error('Claim a connected robot to synchronise project images');
    }
}
module.exports = ImageSync;
