export class Net {
    /**
     * Create a net.
      * @param {Array.<string>} addresses
     */
    constructor(addresses: Array<string>, config?: {
        ignoreHistory: boolean;
    });
    /** @private */
    private filters;
    /** @private */
    private startTs;
    /**
     *
     * @callback eventCallback
     * @param {object} response
     * @param {object} trigger
     */
    /**
     * Register event
      * @param {string} type - unique event ID
      * @param {eventCallback} callback
     */
    register(type: string, callback: (response: object, trigger: object) => any): HookController;
    #private;
}
import HookController = require("./hookController");
