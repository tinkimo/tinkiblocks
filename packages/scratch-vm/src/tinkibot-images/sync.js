const uuid = require('uuid');

/** Restore the active project's images to its currently claimed robot, one transfer at a time. */
class ImageSync {
    constructor (runtime) {
        this.runtime = runtime;
        this.projectReady = false;
        this.projectEpoch = 0;
        this.connectionEpoch = 0;
        this.generation = 0;
        this.key = null;
        this.wanted = false;
        this.running = null;
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
        runtime.on('TINKIBOT_PROJECT_IMAGES_CHANGED', () => {
            if (!this.busy || !this.projectReady) return;
            const images = runtime.tinkibotImages.images;
            if (!this.observed || images.length !== this.observed.length || images.some((image, index) =>
                image.id !== this.observed[index].id || image.name !== this.observed[index].name ||
                image.pixels !== this.observed[index].pixels)) this.request(true);
        });
        this.status({phase: 'waiting', error: ''});
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
        this.wanted = Boolean(key);
        this.observed = this.runtime.tinkibotImages ?
            this.runtime.tinkibotImages.images.map(image => ({...image})) : [];
        if (!key) {
            this.status({phase: 'waiting', error: ''});
            return;
        }
        this.start();
    }

    start () {
        if (!this.running && this.wanted) {
            this.running = this.drain().finally(() => {
                this.running = null;
                this.start();
            });
        }
    }

    async drain () {
        while (this.wanted) {
            this.wanted = false;
            const generation = this.generation;
            const key = this.key;
            const robot = this.robot();
            const collection = this.runtime.tinkibotImages;
            const valid = () => generation === this.generation && this.projectReady &&
                this.runtime.tinkibotImages === collection && this.fingerprint(this.robot()) === key;
            const images = collection.images.map(image => ({...image, pixels: new Uint8Array(image.pixels)}));
            this.status({phase: 'clearing',
                botUuid: robot.botUuid,
                robot: robot.nickname,
                total: images.length,
                completed: 0,
                image: '',
                progress: 0,
                error: ''});
            try {
                const token = uuid.v4().replace(/-/g, '')
                    .slice(0, 16);
                await this.runtime.resetTinkibotImages(robot, token, valid);
                if (!valid()) continue;
                for (let index = 0; index < images.length && valid(); index++) {
                    const image = images[index];
                    this.status({phase: 'uploading', image: image.name, completed: index, progress: 0});
                    await this.runtime.uploadTinkibotImage(image, progress => {
                        if (valid() && progress !== this.runtime.tinkibotImageSync.progress) this.status({progress});
                    }, {botUuid: robot.botUuid, valid, sync: true});
                    if (valid()) this.status({completed: index + 1});
                }
                if (valid()) this.status({phase: 'ready', image: '', progress: 100});
            } catch (error) {
                if (valid()) this.status({phase: 'error', error: error.message});
            }
        }
    }

    retry () {
        this.request(true);
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
