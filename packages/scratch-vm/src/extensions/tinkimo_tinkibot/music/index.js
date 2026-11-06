const Cast = require('../../../util/cast');

/** Tempo and timing shared by the robot music blocks. */
class Music {
    constructor (runtime) {
        this.runtime = runtime;
    }

    getTempo () {
        const stage = this.runtime.getTargetForStage();
        return stage ? stage.tempo : 60;
    }

    setTempo (value) {
        const stage = this.runtime.getTargetForStage();
        if (stage) stage.tempo = Math.max(20, Math.min(500, Cast.toNumber(value)));
    }

    duration (beats) {
        return Math.max(0, Math.min(100, Cast.toNumber(beats))) * 60 / this.getTempo();
    }

    note (value) {
        return Math.max(0, Math.min(130, Cast.toNumber(value)));
    }

    rest (beats, util) {
        if (!util.stackTimerNeedsInit()) {
            if (!util.stackTimerFinished()) util.yield();
            return;
        }
        util.startStackTimer(this.duration(beats) * 1000);
        util.yield();
    }
}

module.exports = Music;
