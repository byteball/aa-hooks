export = HookController;
declare class HookController {
    constructor(net: any, callback: any, id: any);
    /** @private */
    private opposite;
    net: any;
    callback: any;
    id: any;
    get not(): this;
    /**
     * Kept loosely typed because this method was already public in 1.0.2.
     * @param {any} triggerUnit
     * @returns {Promise<any>}
     */
    getTriggerUnit(triggerUnit: any): Promise<any>;
    /** @param {string} address */
    aaAddressIs(address: string): this;
    /** @param {string} address */
    triggerAddressIs(address: string): this;
    /** @param {string} unit */
    triggerUnitIs(unit: string): this;
    /** @param {string} address */
    baseAaIs(address: string): this;
    /** @param {string} key */
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
    /** @param {string} key */
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
     * @param {string} [address]
     */
    responseOutputsAmountIs(value: number, asset: string, address?: string): this;
    /**
     * @param {number} value
     * @param {string} asset
     * @param {string} [address]
     */
    responseOutputsAmountLessThan(value: number, asset: string, address?: string): this;
    /**
     * @param {number} value
     * @param {string} asset
     * @param {string} [address]
     */
    responseOutputsAmountMoreThan(value: number, asset: string, address?: string): this;
    /**
     * @param {string} asset
     * @param {number} value
     * @param {string} [address]
     */
    sentAmountLessThan(asset: string, value: number, address?: string): this;
    /**
     * @param {string} asset
     * @param {number} value
     * @param {string} [address]
     */
    sentAmountMoreThan(asset: string, value: number, address?: string): this;
    /**
     * @param {string} asset
     * @param {number} value
     * @param {string} [address]
     */
    sentAmountIs(asset: string, value: number, address?: string): this;
    /**
     * @template [TResponse=Record<string, any>]
     * @template [TMeta=CustomFilterMeta]
     * @param {(response: TResponse, meta: TMeta) => boolean | Promise<boolean>} filter
     * @param {string[]} [metaKeys]
     */
    customFilter<TResponse = Record<string, any>, TMeta = CustomFilterMeta>(filter: (response: TResponse, meta: TMeta) => boolean | Promise<boolean>, metaKeys?: string[]): this;
    /** Remove this hook and its filters. */
    remove(): void;
    #private;
}
declare namespace HookController {
    export { CustomFilterMeta };
}
/**
 * Extra context that can be requested by a custom filter.
 */
type CustomFilterMeta = {
    payload?: Record<string, any>;
    trigger_unit?: Record<string, any>;
};
