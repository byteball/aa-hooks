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
    /** @private */
    private parallelProcessing;
    /**
     * Read a trigger unit from the DAG, deduplicated and cached per unit hash.
     * Returns an empty object when the unit is missing or cannot be read, so a
     * transient DAG read never crashes the response handler.
     * @param {string} trigger_unit
     * @returns {Promise<object>}
     */
    readTriggerUnit(trigger_unit: string): Promise<object>;
    /**
     * Remove a registered hook by its id.
     * @param {string} id
     */
    removeController(id: string): void;
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
