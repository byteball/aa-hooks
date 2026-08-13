const dag = require('aabot/dag.js');
const { withTimeout } = require('./utils');

// aabot's readAADefinition dereferences the light vendor's reply without a
// guard and throws from its network callback when the reply is empty, leaving
// the promise pending. Bound the wait so a filter cannot stall forever.
const DEFINITION_TIMEOUT_MS = 30000;

/**
 * Extra context that can be requested by a custom filter.
 * @typedef {object} CustomFilterMeta
 * @property {Record<string, any>} [payload]
 * @property {Record<string, any>} [trigger_unit]
 */

const BASE_ASSETS = new Set(['base', 'GBYTE', 'bytes']);

/**
 * Response variables and trigger payloads are plain JSON data, so only own keys
 * count: the `in` operator would also match inherited names like `toString`.
 */
function hasOwnKey(object, key) {
	return Boolean(object) && Object.hasOwn(object, key);
}

module.exports = class HookController {
	/** @private */
	opposite = false;

	constructor(net, callback, id) {
		this.net = net;
		this.callback = callback;
		this.id = id;
	}

	get not() {
		this.opposite = true;
		return this;
	}

	#addFilter(filter) {
		const filters = this.net.filters[this.id] || (this.net.filters[this.id] = []);
		filters.push({ filter, opposite: this.opposite });
		this.opposite = false;
	}

	#addResponseVariableFilter(key, predicate) {
		this.#addFilter((res) => {
			const responseVars = res?.response?.responseVars;
			return hasOwnKey(responseVars, key) && predicate(responseVars[key]);
		});
		return this;
	}

	#addTriggerDataFilter(key, predicate) {
		this.#addFilter(async (res) => {
			const payload = await this.#getPayloadByResponse(res);
			return hasOwnKey(payload, key) && predicate(payload[key]);
		});
		return this;
	}

	#addResponseAmountFilter(value, asset, address, predicate) {
		this.#addFilter((res) => {
			// An AA that posted a response unit which could not be read leaves the
			// paid-out amount unknown — light clients miss it when the unit has not
			// synced. Treating that as 0 would make `LessThan` fire on a guess, so
			// the filter declines instead. A response with no response unit at all
			// genuinely paid out nothing and is still evaluated against 0.
			if (res?.response_unit && !res?.objResponseUnit) {
				return false;
			}
			const amount = this.#getAmountByMessages(res?.objResponseUnit?.messages, asset, address);
			return predicate(amount, value);
		});
		return this;
	}

	#addSentAmountFilter(asset, value, address, predicate) {
		this.#addFilter(async (res) => {
			const triggerUnit = await this.getTriggerUnit(res.trigger_unit);
			const amount = this.#getAmountByMessages(triggerUnit.messages, asset, address);
			return predicate(amount, value);
		});
		return this;
	}

	/**
	 * Kept loosely typed because this method was already public in 1.0.2.
	 * @param {any} triggerUnit
	 * @returns {Promise<any>}
	 */
	async getTriggerUnit(triggerUnit) {
		return this.net.readTriggerUnit(triggerUnit);
	}

	async #getPayloadByResponse(res) {
		if (!res?.trigger_unit) {
			return {};
		}
		const triggerUnit = await this.getTriggerUnit(res.trigger_unit);
		return triggerUnit?.messages?.find(({ app }) => app === 'data')?.payload || {};
	}

	async #getBaseAAByResponse(res) {
		try {
			const definition = await withTimeout(
				Promise.resolve(dag.readAADefinition(res.aa_address)),
				DEFINITION_TIMEOUT_MS,
				`timed out reading AA definition (aa=${res.aa_address})`,
			);
			return definition?.[1]?.base_aa;
		} catch (e) {
			console.error(`aa-hooks: failed to read AA definition (aa=${res.aa_address}, trigger=${res.trigger_unit || '<missing>'}); base-AA filters will not match`, e);
			return undefined;
		}
	}

	#getAmountByMessages(messages, asset, address) {
		let amount = 0;
		for (const message of messages || []) {
			if (message.app !== 'payment') {
				continue;
			}
			for (const output of message.payload?.outputs || []) {
				if (address && output.address !== address) {
					continue;
				}
				const matchesAsset = output.asset === asset
					|| (BASE_ASSETS.has(asset) && !('asset' in output));
				if (matchesAsset) {
					amount += output.amount;
				}
			}
		}
		return amount;
	}

	/** @param {string} address */
	aaAddressIs(address) {
		this.#addFilter((res) => res.aa_address === address);
		return this;
	}

	/** @param {string} address */
	triggerAddressIs(address) {
		this.#addFilter((res) => res.trigger_address === address);
		return this;
	}

	/** @param {string} unit */
	triggerUnitIs(unit) {
		this.#addFilter((res) => res.trigger_unit === unit);
		return this;
	}

	/** @param {string} address */
	baseAaIs(address) {
		this.#addFilter(async (res) => address === await this.#getBaseAAByResponse(res));
		return this;
	}

	/** @param {string} key */
	responseContainsKey(key) {
		return this.#addResponseVariableFilter(key, () => true);
	}

	/**
	 * @param {string} key
	 * @param {string | number} value
	 */
	responseKeyIs(key, value) {
		return this.#addResponseVariableFilter(key, (actual) => actual === value);
	}

	/**
	 * @param {string} key
	 * @param {string | number} value
	 */
	responseKeyLessThan(key, value) {
		return this.#addResponseVariableFilter(key, (actual) => actual < value);
	}

	/**
	 * @param {string} key
	 * @param {string | number} value
	 */
	responseKeyMoreThan(key, value) {
		return this.#addResponseVariableFilter(key, (actual) => actual > value);
	}

	triggerDataExists() {
		this.#addFilter(async (res) => Object.keys(await this.#getPayloadByResponse(res)).length > 0);
		return this;
	}

	/** @param {string} key */
	triggerDataContainsKey(key) {
		return this.#addTriggerDataFilter(key, () => true);
	}

	/**
	 * @param {string} key
	 * @param {string | number} value
	 */
	triggerDataKeyIs(key, value) {
		return this.#addTriggerDataFilter(key, (actual) => actual === value);
	}

	/**
	 * @param {string} key
	 * @param {string | number} value
	 */
	triggerDataKeyLessThan(key, value) {
		return this.#addTriggerDataFilter(key, (actual) => actual < value);
	}

	/**
	 * @param {string} key
	 * @param {string | number} value
	 */
	triggerDataKeyMoreThan(key, value) {
		return this.#addTriggerDataFilter(key, (actual) => actual > value);
	}

	isSuccess() {
		// Live responses use booleans; history responses use database 0/1 values.
		this.#addFilter((res) => res.bounced === false || res.bounced === 0);
		return this;
	}

	isBounced() {
		this.#addFilter((res) => res.bounced === true || res.bounced === 1);
		return this;
	}

	/**
	 * @param {number} value
	 * @param {string} asset
	 * @param {string} [address]
	 */
	responseOutputsAmountIs(value, asset, address) {
		return this.#addResponseAmountFilter(value, asset, address, (actual, expected) => actual === expected);
	}

	/**
	 * @param {number} value
	 * @param {string} asset
	 * @param {string} [address]
	 */
	responseOutputsAmountLessThan(value, asset, address) {
		return this.#addResponseAmountFilter(value, asset, address, (actual, expected) => actual < expected);
	}

	/**
	 * @param {number} value
	 * @param {string} asset
	 * @param {string} [address]
	 */
	responseOutputsAmountMoreThan(value, asset, address) {
		return this.#addResponseAmountFilter(value, asset, address, (actual, expected) => actual > expected);
	}

	/**
	 * @param {string} asset
	 * @param {number} value
	 * @param {string} [address]
	 */
	sentAmountLessThan(asset, value, address) {
		return this.#addSentAmountFilter(asset, value, address, (actual, expected) => actual < expected);
	}

	/**
	 * @param {string} asset
	 * @param {number} value
	 * @param {string} [address]
	 */
	sentAmountMoreThan(asset, value, address) {
		return this.#addSentAmountFilter(asset, value, address, (actual, expected) => actual > expected);
	}

	/**
	 * @param {string} asset
	 * @param {number} value
	 * @param {string} [address]
	 */
	sentAmountIs(asset, value, address) {
		return this.#addSentAmountFilter(asset, value, address, (actual, expected) => actual === expected);
	}

	/**
	 * @template [TResponse=Record<string, any>]
	 * @template [TMeta=CustomFilterMeta]
	 * @param {(response: TResponse, meta: TMeta) => boolean | Promise<boolean>} filter
	 * @param {string[]} [metaKeys]
	 */
	customFilter(filter, metaKeys = []) {
		this.#addFilter(async (res) => {
			const meta = {};
			if (metaKeys.includes('payload')) {
				meta.payload = await this.#getPayloadByResponse(res);
			}
			if (metaKeys.includes('trigger_unit') && res.trigger_unit) {
				meta.trigger_unit = await this.getTriggerUnit(res.trigger_unit);
			}

			const result = await filter(res, meta);
			if (typeof result !== 'boolean') {
				throw new Error('filter must return a boolean value!');
			}
			return result;
		});
		return this;
	}

	/** Remove this hook and its filters. */
	remove() {
		this.net.removeController(this.id);
	}
};
