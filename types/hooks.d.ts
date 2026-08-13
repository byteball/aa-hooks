export = Hooks;
/**
 * Public facade for registering AA response filters and callbacks.
 *
 * Transport subscriptions, trigger-unit storage, and delivery state are
 * delegated to focused collaborators. This class only coordinates them.
 */
declare class Hooks {
    /**
     * @param {string[]} addresses
     * @param {{newEventsOnly?: boolean, parallelProcessing?: boolean, logEvents?: boolean, logger?: (message: string) => void}} [config]
     */
    constructor(addresses: string[], config?: {
        newEventsOnly?: boolean;
        parallelProcessing?: boolean;
        logEvents?: boolean;
        logger?: (message: string) => void;
    });
    /** @private @type {Record<string, Array<{filter: Function, opposite: boolean}>>} */
    private filters;
    /** @private @type {number} */
    private startTs;
    /** @private @type {boolean} */
    private parallelProcessing;
    /** @private @type {boolean} */
    private logEvents;
    /**
     * Detach this instance from the event bus and drop its hooks.
     *
     * ocore has no way to unwatch an AA, so the underlying subscriptions stay in
     * place; this only stops the instance from consuming events. Idempotent.
     */
    close(): void;
    /**
     * Read a trigger unit from the shared read-through repository.
     * @param {string} triggerUnit
     * @returns {Promise<object>}
     */
    readTriggerUnit(triggerUnit: string): Promise<object>;
    /**
     * Remove a registered hook by its id.
     * @param {string} id
     */
    removeController(id: string): void;
    /**
     * @callback eventCallback
     * @param {object} triggerUnit
     * @param {object} responseObj
     */
    /**
     * Register an event callback and return its fluent filter controller.
     * @param {eventCallback} callback
     */
    register(callback: (triggerUnit: object, responseObj: object) => any): HookController;
    /**
     * Add an AA address at runtime using both live and history delivery paths.
     * @param {string} address
     */
    addWatchedAddress(address: string): Promise<void>;
    #private;
}
import HookController = require("./hookController");
