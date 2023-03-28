export class Hooks {
    /**
     * Create a instance.
        * @param {Array.<string>} addresses
     */
    constructor(addresses: Array<string>, config?: {
        newEventsOnly: boolean;
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
        * @param {eventCallback} callback
     */
    register(callback: (response: object, trigger: object) => any): HookController;
    #private;
}
import HookController = require("./hookController");
