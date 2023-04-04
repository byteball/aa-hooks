export class Hooks {
    /**
     * Create a instance.
        * @param {Array.<string>} addresses
     */
    constructor(addresses: Array<string>, config?: {
        newEventsOnly: boolean;
        parallelProcessing: boolean;
    });
    /** @private */
    private filters;
    /** @private */
    private startTs;
    /**
     *
     * @callback eventCallback
     * @param {object} triggerUnit
     * @param {object} responseObj
     */
    /**
     * Register event
        * @param {eventCallback} callback
     */
    register(callback: (triggerUnit: object, responseObj: object) => any): HookController;
    /**
    * @param {string} address
   */
    addWatchedAddress(address: string): Promise<void>;
    #private;
}
import HookController = require("./hookController");
