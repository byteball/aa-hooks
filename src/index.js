const { v4: uuidv4 } = require('uuid');
const conf = require('ocore/conf.js');
const eventBus = require('ocore/event_bus.js');
const lightWallet = require('ocore/light_wallet.js');
const wallet_general = require('ocore/wallet_general.js');
const dag = require('aabot/dag.js');
const mutex = require('ocore/mutex.js');
const HookController = require('./hookController');

lightWallet.setLightVendorHost(conf.hub);

const defaultConfig = {
	newEventsOnly: false,
	parallelProcessing: false
};

class Hooks {
	#watch(aa) {
		return new Promise(async function (resolve) {
			wallet_general.addWatchedAddress(aa, resolve);
		});
	}

	#controllers = new Map();

	/**
	 * Cache of trigger units already read from the DAG within the process,
	 * keyed by unit hash. DAG units are immutable, so caching is always correct;
	 * the size is bounded to avoid unbounded memory growth.
	 * @private
	 */
	#unitCache = new Map();

	/**
	 * Create a instance.
		* @param {Array.<string>} addresses
	 */

	constructor(addresses, config = defaultConfig) {
		/** @private */
		this.filters = {};
		/** @private */
		this.startTs = Math.floor(config.newEventsOnly ? new Date().getTime() / 1000 : 0);
		/** @private */
		this.parallelProcessing = config.parallelProcessing || false;

		eventBus.on('headless_wallet_ready', async () => {
			for (let i = 0; i < addresses.length; i++) {
				try {
					await dag.loadAA(addresses[i]);
				} catch (e) {
					// loadAA rejects for unknown AAs; log instead of leaving an
					// unhandled rejection, and still watch the address below.
					console.error('aa-hooks: failed to load AA', addresses[i], e);
				}
			}

			for (let i = 0; i < addresses.length; i++) {
				this.#watch(addresses[i]);
			}
		});


		eventBus.on('aa_response', this.#responseHandler.bind(this));
	}

	/**
	 * Read a trigger unit from the DAG, deduplicated and cached per unit hash.
	 * Returns an empty object when the unit is missing or cannot be read, so a
	 * transient DAG read never crashes the response handler.
	 * @param {string} trigger_unit
	 * @returns {Promise<object>}
	 */
	readTriggerUnit(trigger_unit) {
		if (!trigger_unit) {
			return Promise.resolve({});
		}

		const cached = this.#unitCache.get(trigger_unit);
		if (cached) {
			return cached;
		}

		const promise = (async () => {
			try {
				const objJoint = await dag.readJoint(trigger_unit);
				return objJoint?.unit || {};
			} catch (e) {
				// Missing/unsynced units make dag.readJoint throw; drop from the
				// cache so a later read can retry once the unit is available.
				this.#unitCache.delete(trigger_unit);
				return {};
			}
		})();

		this.#unitCache.set(trigger_unit, promise);

		// Bound the cache to the most recently seen units.
		if (this.#unitCache.size > 1000) {
			this.#unitCache.delete(this.#unitCache.keys().next().value);
		}

		return promise;
	}

	/**
	 * Remove a registered hook by its id.
	 * @param {string} id
	 */
	removeController(id) {
		delete this.filters[id];
		this.#controllers.delete(id);
	}

	async #findIds(res) {
		const ids = [];
		const entries = Object.entries(this.filters);

		for (let i = 0; i < entries.length; i++) {
			const [filtersId, filters] = entries[i];
			let matched = true;

			for (let filterIndex = 0; filterIndex < filters.length; filterIndex++) {
				const { filter, opposite } = filters[filterIndex];
				const result = await filter(res);

				if (opposite ? result : !result) {
					matched = false;
					break;
				}
			}

			if (matched) {
				ids.push(filtersId);
			}
		}

		return ids;
	}

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
	register(callback) {
		const id = uuidv4();

		const controller = new HookController(this, callback, id);

		this.#controllers.set(id, controller);

		return controller;
	}

	/**
	* @param {string} address
   */
	async addWatchedAddress(address) {
		await dag.loadAA(address);
		await this.#watch(address);
	}

	async #responseHandler(res) {
		let unlock;

		if (!this.parallelProcessing) {
			unlock = await mutex.lock('responseHandler');
		}

		try {
			if (res.timestamp >= this.startTs) {
				const eventIds = await this.#findIds(res);

				for (let i = 0; i < eventIds.length; i++) {
					const controller = this.#controllers.get(eventIds[i]);
					if (!controller) {
						continue;
					}

					// Isolate each hook: a throwing callback must not skip the
					// remaining matched hooks for this response.
					try {
						const trigger = await controller.getTriggerUnit(res.trigger_unit);
						await controller.callback(trigger, res);
					} catch (e) {
						console.error('aa-hooks: error in hook callback', e);
					}
				}
			}
		} catch (e) {
			// Never let a filter error escape: with the mutex held it would
			// otherwise deadlock all further response processing.
			console.error('aa-hooks: error while handling aa_response', e);
		} finally {
			if (unlock) {
				await unlock();
			}
		}
	}
}

module.exports.Hooks = Hooks;