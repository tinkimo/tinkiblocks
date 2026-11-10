const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const uuidReply = new RegExp(`^OK get uuid (${UUID})$`, 'i');

// The modem has no discovery opcode. Broadcast the proxy's existing identity query.
class ModemDiscovery {
    constructor ({send, onRobots, log, now = Date.now, interval = 5000, expiry = 15000}) {
        Object.assign(this, {send, onRobots, log, now, interval, expiry});
        this.robots = new Map();
        this.pendingNicknames = new Set();
    }

    start () {
        this.stop();
        this.active = true;
        this.poll();
        this.timer = setInterval(() => this.poll(), this.interval);
    }

    stop () {
        this.active = false;
        clearInterval(this.timer);
        this.pendingNicknames.clear();
        for (const robot of this.robots.values()) robot.connected = false;
        this.publish();
    }

    async poll () {
        try {
            for (const robot of this.robots.values()) {
                robot.connected = this.now() - robot.lastSeen < this.expiry;
            }
            this.publish();
            await this.send('all.get:uuid\n');
        } catch (error) {
            if (this.active) this.log('error', error.message);
        }
    }

    receive (line) {
        if (!this.active || line.startsWith('BLE:') || line.startsWith('Connection state changed.')) return;
        const match = /^\+?([^.\r\n]*)\.(.*)$/.exec(line);
        if (!match) return;
        const [, target, value] = match;
        if (target.toLowerCase() === 'tinkimodem' || target === 'all') return;
        const identity = uuidReply.exec(value);
        if (identity) {
            const botUuid = identity[1].toLowerCase();
            const known = this.robots.get(botUuid);
            if (!known && this.robots.size >= 128) {
                this.log('error', 'Robot discovery capacity reached (128)');
                return;
            }
            const robot = {...known,
                botUuid,
                nickname: target,
                route: target,
                connected: true,
                lastSeen: this.now()};
            this.robots.set(botUuid, robot);
            this.log('parsed', {target, uuid: botUuid});
            if (!known || !known.connected) this.log('discovery', {nickname: target, botUuid});
            this.publish();
            if (target && !this.pendingNicknames.has(target)) {
                this.pendingNicknames.add(target);
                this.send(`${target}.get:nickname\n`).catch(error => {
                    if (this.active) this.log('error', error.message);
                })
                    .finally(() => this.pendingNicknames.delete(target));
            }
        } else if (/^OK get nickname(?: |$)/i.test(value)) {
            const nickname = value.replace(/^OK get nickname\s*/i, '').trim();
            for (const robot of this.robots.values()) {
                if (robot.route === target && nickname) robot.nickname = nickname;
            }
            this.log('parsed', {target, nickname});
            this.publish();
        } else if (value.startsWith('event:')) {
            // Events alone never establish robot identity or claim ownership.
            this.log('parsed', {target, event: value});
        }
    }

    publish () {
        this.onRobots(Array.from(this.robots.values(), robot => ({...robot})));
    }
}

module.exports = ModemDiscovery;
