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
				dag.loadAA(addresses[i]);
			}

			for (let i = 0; i < addresses.length; i++) {
				this.#watch(addresses[i]);
			}
		});


		eventBus.on('aa_response', this.#responseHandler.bind(this));
	}

	async #findId(res) {
		let id;
		const entries = Object.entries(this.filters);

		for (let i = 0; i < entries.length; i++) {
			const [filtersId, filters] = entries[i];
			let successFilters = 0;

			for (let filterIndex = 0; filterIndex < filters.length; filterIndex++) {
				const { filter, asymmetric } = filters[filterIndex];
				const result = await filter(res);

				if (asymmetric ? result : !result) {
					break;
				} else {
					successFilters++;
				}
			}

			if (successFilters === filters.length) {
				id = filtersId;

				break;
			}
		}

		return id;
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

		if (res.timestamp >= this.startTs) {
			const eventId = await this.#findId(res);

			if (eventId) {
				const HookController = this.#controllers.get(eventId);
				const trigger = await HookController.getTriggerUnit(res.trigger_unit);
				await HookController.callback(trigger, res);
			}
		}

		if (unlock) {
			return await unlock();
		}
	}
}

module.exports.Hooks = Hooks;