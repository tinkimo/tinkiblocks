/**
 * Poll the claimed image cleanup without starting another transaction on retries.
 * @param {function(object): Promise<string>} send Send a claim-owned reset request.
 * @param {string} token Idempotent cleanup token.
 * @param {string} owner Accepted client UUID.
 * @param {function(): boolean} valid Whether this project and robot are still current.
 * @param {object} options Optional clock, delay and timeout for deterministic polling.
 */
const reset = async (send, token, owner, valid, options = {}) => {
    const now = options.now || Date.now;
    const wait = options.wait || (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    const deadline = now() + (options.timeout || 60000);
    while (now() < deadline) {
        if (!valid()) throw new Error('Image synchronisation superseded');
        let result;
        try {
            result = await send({command: 'reset_images', token, owner});
        } catch (error) {
            if (!/busy/i.test(error.message)) throw error;
            result = `BUSY file:image-reset ${token}`;
        }
        if (!valid()) throw new Error('Image synchronisation superseded');
        if (result === `OK file:image-reset ${token}`) return;
        if (![`PENDING file:image-reset ${token}`, `BUSY file:image-reset ${token}`].includes(result)) {
            throw new Error('Invalid robot image synchronisation response');
        }
        await wait(100);
    }
    throw new Error('Robot image synchronisation timed out');
};
module.exports = {reset};
