export = HookController;
declare class HookController {
    constructor(net: any, callback: any, id: any);
    net: any;
    callback: any;
    id: any;
    /** @private */
    private opposite;
    get not(): this;
    getTriggerUnit(trigger_unit: any): Promise<any>;
    /**
      * @param {string} address
     */
    aaAddressIs(address: string): this;
    /**
      * @param {string} address
     */
    triggerAddressIs(address: string): this;
    /**
      * @param {string} unit
     */
    triggerUnitIs(unit: string): this;
    /**
      * @param {string} address
     */
    baseAaIs(address: string): this;
    /**
      * @param {string} key
     */
    responseContainsKey(key: string): this;
    /**
      * @param {string} key
      * @param {string | number} value
     */
    responseKeyIs(key: string, value: string | number): this;
    /**
      * @param {string} key
      * @param {string | number} value
     */
    responseKeyLessThan(key: string, value: string | number): this;
    /**
      * @param {string} key
      * @param {string | number} value
     */
    responseKeyMoreThan(key: string, value: string | number): this;
    triggerDataExists(): this;
    /**
      * @param {string} key
     */
    triggerDataContainsKey(key: string): this;
    /**
      * @param {string} key
      * @param {string | number} value
     */
    triggerDataKeyIs(key: string, value: string | number): this;
    /**
      * @param {string} key
      * @param {string | number} value
     */
    triggerDataKeyLessThan(key: string, value: string | number): this;
    /**
      * @param {string} key
      * @param {string | number} value
     */
    triggerDataKeyMoreThan(key: string, value: string | number): this;
    isSuccess(): this;
    isBounced(): this;
    /**
      * @param {number} value
      * @param {string} asset
      * @param {string=} address
     */
    responseOutputsAmountIs(value: number, asset: string, address?: string | undefined): this;
    /**
       * @param {number} value
       * @param {string} asset
       * @param {string=} address
     */
    responseOutputsAmountLessThan(value: number, asset: string, address?: string | undefined): this;
    /**
    * @param {number} value
    * @param {string} asset
    * @param {string=} address
   */
    responseOutputsAmountMoreThan(value: number, asset: string, address?: string | undefined): this;
    /**
    * @param {string} asset
    * @param {number} value
    * @param {string=} address
   */
    sentAmountLessThan(asset: string, value: number, address?: string | undefined): this;
    /**
    * @param {string} asset
    * @param {number} value
    * @param {string=} address
   */
    sentAmountMoreThan(asset: string, value: number, address?: string | undefined): this;
    /**
    * @param {string} asset
    * @param {number} value
    * @param {string=} address
   */
    sentAmountIs(asset: string, value: number, address?: string | undefined): this;
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
    customFilter(filter: (response: response, meta: meta) => boolean, metaKeys?: Array<string>): this;
    /**
     * Remove this hook so it stops receiving events and its filters are freed.
     */
    remove(): void;
    #private;
}
