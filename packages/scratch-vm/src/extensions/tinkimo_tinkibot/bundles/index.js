const Thread = require('../../../engine/thread');
const BlockType = require('../../../extension-support/block-type');
const actions = require('./actions');
const protocol = require('./protocol');

const tempoOpcodes = new Set([
    'tinkibotSounds_setTempo', 'tinkibotSounds_changeTempo',
    'music_setTempo', 'music_changeTempo'
]);

/** Collect literal action stacks while leaving scheduling and reporters to Scratch. */
class ActionBundles {
    constructor (extension) {
        this.extension = extension;
        this.consumed = new WeakMap();
        this.metadata = null;
        this.robotOpcodes = new Set();
    }

    run (opcode, args, util) {
        // Capture the thread, not BlockUtility: Scratch reuses that utility between primitives.
        const thread = util && util.thread;
        const sequencer = util && util.sequencer;
        const consumed = thread && this.consumed.get(thread);
        if (consumed && consumed.delete(thread.peekStack())) return;
        const definition = actions[opcode];
        const payload = definition.payload(args, this.extension);
        if (payload === null) return;
        const plan = this.collect(opcode, payload, thread);
        let operation;
        if (plan.length > 1) {
            operation = this.extension._sendBundle(plan, thread).then(() => {
                this.consumed.set(thread, new Set(plan.slice(1).map(item => item.id)));
            });
        } else {
            operation = this.extension._sendCommand(payload);
        }
        if (plan.length > 1) {
            return operation.catch(error => {
                const failed = Number.isInteger(error.commandIndex) ? actions[plan[error.commandIndex].opcode] :
                    definition;
                if (failed.music && thread) sequencer.retireThread(thread);
                throw error;
            });
        }
        if (!definition.music) return operation;
        return Promise.resolve(operation).then(() => {}, error => {
            if (thread) sequencer.retireThread(thread);
            throw error;
        });
    }

    _getMetadata () {
        if (!this.metadata) {
            this.metadata = new Map();
            for (const info of this.extension.getInfos()) {
                for (const block of info.blocks) {
                    if (block.supportsBundling || [BlockType.REPORTER, BlockType.BOOLEAN].includes(block.blockType)) {
                        this.robotOpcodes.add(`${info.id}_${block.opcode}`);
                    }
                    if (block.supportsBundling) {
                        this.metadata.set(`${info.id}_${block.opcode}`, block);
                    }
                }
            }
        }
        return this.metadata;
    }

    _hasOperation (blocks, roots, opcodes) {
        const pending = roots.slice();
        const visited = new Set();
        while (pending.length) {
            const id = pending.pop();
            if (!id || visited.has(id)) continue;
            visited.add(id);
            const block = blocks.getBlock(id);
            if (!block) continue;
            if (opcodes.has(block.opcode)) return true;
            pending.push(block.next);
            for (const input of Object.values(block.inputs)) pending.push(input.block);
            if (block.opcode === 'procedures_call' && block.mutation) {
                pending.push(blocks.getProcedureDefinition(block.mutation.proccode));
            }
        }
        return false;
    }

    _canCollect (thread, plan) {
        const runtime = this.extension.runtime;
        const timedMusic = plan.some(item => actions[item.opcode].music);
        if (runtime.threads.some(other => other !== thread && !other.updateMonitor &&
            other.status !== Thread.STATUS_DONE &&
            (this._hasOperation(other.blockContainer, other.stack, this.robotOpcodes) ||
                (timedMusic && this._hasOperation(other.blockContainer, other.stack, tempoOpcodes))))) return false;
        if (!timedMusic) return true;
        const currentRoot = thread.target.blocks.getTopLevelScript(thread.topBlock);
        // Only hats which can change the shared tempo affect precomputed note durations.
        return !runtime.targets.some(target => target.blocks.getScripts().some(id =>
            (target !== thread.target || id !== currentRoot) &&
            runtime.getIsHat(target.blocks.getBlock(id).opcode) &&
            this._hasOperation(target.blocks, [id], tempoOpcodes)));
    }

    _literalArgs (block, blocks, metadata) {
        const runtime = this.extension.runtime;
        const args = {};
        for (const [name, field] of Object.entries(block.fields)) args[name] = field.value;
        for (const [name, input] of Object.entries(block.inputs)) {
            const shadow = blocks.getBlock(input.block);
            if (!shadow || input.block !== input.shadow || !shadow.shadow ||
                runtime.getOpcodeFunction(shadow.opcode) || Object.keys(shadow.inputs).length ||
                Object.keys(shadow.fields).length !== 1) return null;
            // This is the VM's static leaf rule; no reporter primitive is evaluated here.
            args[name] = Object.values(shadow.fields)[0].value;
        }
        if (Object.keys(metadata.arguments || {}).some(name =>
            !Object.prototype.hasOwnProperty.call(args, name))) return null;
        return args;
    }

    collect (opcode, payload, thread) {
        if (!thread || !thread.target) return [];
        const robot = this.extension._connectedRobots.find(item => item.claimState === 'paired');
        if (!robot) return [];
        const blocks = thread.target.blocks;
        const metadata = this._getMetadata();
        const plan = [];
        const visited = new Set();
        let id = thread.peekStack();
        while (id && plan.length < protocol.MAX_COMMANDS && !visited.has(id)) {
            visited.add(id);
            const block = blocks.getBlock(id);
            const info = block && metadata.get(block.opcode);
            if (!info || (plan.length === 0 && info.opcode !== opcode)) break;
            const args = this._literalArgs(block, blocks, info);
            if (!args) break;
            const definition = actions[info.opcode];
            const command = plan.length === 0 ? payload : definition.payload(args, this.extension);
            if (command === null) break;
            const wire = `${robot.nickname}.${definition.encode(command)}`;
            const commands = [...plan.map(item => item.wire), wire];
            // Size and line delimiters are external project data boundaries. The
            // current block will use its normal individual path if it cannot fit.
            try {
                protocol.request(commands);
            } catch {
                break;
            }
            plan.push({id, opcode: info.opcode, payload: command, wire});
            id = blocks.getNextBlock(id);
        }
        if (plan.length < 2) return plan;
        return this._canCollect(thread, plan) ? plan : [];
    }
}

module.exports = ActionBundles;
