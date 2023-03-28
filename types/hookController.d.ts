export = HookController;
declare class HookController {
    constructor(net: any, callback: any, type: any);
    net: any;
    callback: any;
    type: any;
    getTriggerUnit(trigger_unit: any): Promise<any>;
    /**
        * @param {string} address
     */
    aaAddressIs(address: string): import("./hookController");
    /**
        * @param {string} address
     */
    triggerAddressIs(address: string): import("./hookController");
    /**
        * @param {string} unit
     */
    triggerUnitIs(unit: string): import("./hookController");
    /**
        * @param {string} address
     */
    baseAaIs(address: string): import("./hookController");
    /**
        * @param {string} key
     */
    responseKeyContains(key: string): import("./hookController");
    /**
        * @param {string} key
        * @param {string | number} value
     */
    responseKeyIs(key: string, value: string | number): import("./hookController");
    /**
        * @param {string} key
        * @param {string | number} value
     */
    responseKeyLessThan(key: string, value: string | number): import("./hookController");
    /**
        * @param {string} key
        * @param {string | number} value
     */
    responseKeyMoreThan(key: string, value: string | number): import("./hookController");
    /**
        * @param {string} key
     */
    triggerDataContainsKey(key: string): import("./hookController");
    /**
        * @param {string} key
        * @param {string | number} value
     */
    triggerDataKeyIs(key: string, value: string | number): import("./hookController");
    /**
        * @param {string} key
        * @param {string | number} value
     */
    payloadKeyLessThan(key: string, value: string | number): import("./hookController");
    /**
        * @param {string} key
        * @param {string | number} value
     */
    triggerDataKeyMoreThan(key: string, value: string | number): import("./hookController");
    isSuccess(): import("./hookController");
    isBounced(): import("./hookController");
    /**
        * @param {string} value
        * @param {string | number} asset
        * @param {string=} address
     */
    responseOutputsAmountIs(value: string, asset: string | number, address?: string | undefined): import("./hookController");
    /**
         * @param {string} value
         * @param {string | number} asset
         * @param {string=} address
     */
    responseOutputsAmountLessThan(value: string, asset: string | number, address?: string | undefined): import("./hookController");
    /**
    * @param {string} value
    * @param {string | number} asset
    * @param {string=} address
 */
    responseOutputsAmountMoreThan(value: string, asset: string | number, address?: string | undefined): import("./hookController");
    /**
    * @param {string} value
    * @param {string | number} asset
    * @param {string=} address
 */
    sentAmountLessThan(asset: string | number, value: string, address?: string | undefined): import("./hookController");
    /**
    * @param {string} value
    * @param {string | number} asset
    * @param {string=} address
 */
    sentAmountMoreThan(asset: string | number, value: string, address?: string | undefined): import("./hookController");
    /**
    * @param {string} value
    * @param {string | number} asset
    * @param {string=} address
 */
    sentAmountIs(asset: string | number, value: string, address?: string | undefined): import("./hookController");
    /**
     * This callback is displayed as part of the Requester class.
     * @callback filterCallback
     * @param {response} response
     * @param {meta} meta
     * @returns {boolean}
     */
    /**
        * @param {filterCallback} filter
        * @param {Array.<string>} metaKeys
    */
    customHook(filter: (response: response, meta: meta) => boolean, metaKeys?: Array<string>): import("./hookController");
    #private;
}
