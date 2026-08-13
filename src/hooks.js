const { v4: uuidv4 } = require('uuid');
const eventBus = require('ocore/event_bus.js');
const mutex = require('ocore/mutex.js');
const HookController = require('./hookController');
const AaSubscriptionManager = require('./aaSubscriptionManager');
const TriggerUnitRepository = require('./triggerUnitRepository');
const { ResponseTracker, RESPONSE_STATE } = require('./responseTracker');
const { createEventLogger, formatResponseContext } = require('./utils');

const defaultConfig = Object.freeze({
	newEventsOnly: false,
	parallelProcessing: false,
	logEvents: false,
});

/**
 * Public facade for registering AA response filters and callbacks.
 *
 * Transport subscriptions, trigger-unit storage, and delivery state are
 * delegated to focused collaborators. This class only coordinates them.
 */
class Hooks {
	#controllers = new Map();

	#registrationStarted = false;

	#pendingFlushScheduled = false;

	#closed = false;

	#onResponse;

	#onLightMessage;

	#addresses;

	#subscriptions;

	#logEvent;

	#triggerUnits = new TriggerUnitRepository();

	#responses = new ResponseTracker();

	/**
	 * ocore mutex keys are process-global. The instance key preserves ordering
	 * across all responses handled by this instance. A second, per-AA key makes
	 * separate instances watching the same AA sequential too.
	 * @private
	 */
	#mutexKey = `aa-hooks:responseHandler:${uuidv4()}`;

	/** @private @type {Record<string, Array<{filter: Function, opposite: boolean}>>} */
	filters = {};

	/** @private @type {number} */
	startTs;

	/** @private @type {boolean} */
	parallelProcessing;

	/** @private @type {boolean} */
	logEvents;

	/**
	 * @param {string[]} addresses
	 * @param {{newEventsOnly?: boolean, parallelProcessing?: boolean, logEvents?: boolean, logger?: (message: string) => void}} [config]
	 */
	constructor(addresses, config = defaultConfig) {
		this.#addresses = new Set(addresses);
		this.startTs = Math.floor(config?.newEventsOnly ? Date.now() / 1000 : 0);
		this.parallelProcessing = config?.parallelProcessing || false;
		this.logEvents = config?.logEvents || false;
		this.#logEvent = createEventLogger(this.logEvents, config?.logger);
		this.#subscriptions = new AaSubscriptionManager(this.#addresses, {
			logEvent: this.#logEvent,
		});

		// Kept on the instance so close() can detach them again.
		this.#onResponse = (res) => this.#responseHandler(res);
		this.#onLightMessage = (ws, subject, body) => this.#handleLightMessage(ws, subject, body);
		eventBus.on('aa_response', this.#onResponse);
		eventBus.on('message_for_light', this.#onLightMessage);
		this.#subscriptions.start();
	}

	/**
	 * Detach this instance from the event bus and drop its hooks.
	 *
	 * ocore has no way to unwatch an AA, so the underlying subscriptions stay in
	 * place; this only stops the instance from consuming events. Idempotent.
	 */
	close() {
		if (this.#closed) {
			return;
		}
		this.#closed = true;
		eventBus.removeListener('aa_response', this.#onResponse);
		eventBus.removeListener('message_for_light', this.#onLightMessage);
		this.#controllers.clear();
		this.filters = {};
	}

	/**
	 * Read a trigger unit from the shared read-through repository.
	 * @param {string} triggerUnit
	 * @returns {Promise<object>}
	 */
	readTriggerUnit(triggerUnit) {
		return this.#triggerUnits.read(triggerUnit);
	}

	/**
	 * Remove a registered hook by its id.
	 * @param {string} id
	 */
	removeController(id) {
		delete this.filters[id];
		this.#controllers.delete(id);
	}

	/**
	 * @callback eventCallback
	 * @param {object} triggerUnit
	 * @param {object} responseObj
	 */

	/**
	 * Register an event callback and return its fluent filter controller.
	 * @param {eventCallback} callback
	 */
	register(callback) {
		if (this.#closed) {
			throw new Error('aa-hooks: cannot register a hook on a closed Hooks instance');
		}

		const id = uuidv4();
		const controller = new HookController(this, callback, id);

		this.#controllers.set(id, controller);
		this.#registrationStarted = true;
		this.#schedulePendingFlush();

		return controller;
	}

	/**
	 * Add an AA address at runtime using both live and history delivery paths.
	 * @param {string} address
	 */
	addWatchedAddress(address) {
		return this.#subscriptions.add(address);
	}

	#handleLightMessage(_ws, subject, body) {
		if (this.#closed) {
			return;
		}

		if (subject === 'light/aa_request' && this.#addresses.has(body?.aa_address)) {
			this.#triggerUnits.prime(body.unit);
			this.#logEvent(`aa-hooks: received live AA request (aa=${body.aa_address}, trigger=${body.unit?.unit || '<missing>'})`);
			return;
		}

		if (subject !== 'light/aa_response' || !this.#addresses.has(body?.aa_address)) {
			return;
		}

		this.#triggerUnits.prime(body.objResponseUnit);
		void this.#responseHandler(body, 'light/aa_response');
	}

	#schedulePendingFlush() {
		if (this.#pendingFlushScheduled || !this.#registrationStarted || !this.#responses.hasPending()) {
			return;
		}
		this.#pendingFlushScheduled = true;
		setImmediate(() => {
			// Cleared before dispatching so the flushed responses are handled
			// rather than queued again. Nothing can arrive in between: the loop
			// runs to completion synchronously, and each handler claims its
			// mutex slot before its first await, which preserves the order.
			this.#pendingFlushScheduled = false;
			for (const { res, source } of this.#responses.takePending()) {
				void this.#responseHandler(res, source);
			}
		});
	}

	async #findMatchingHookIds(res) {
		const ids = [];

		for (const hookId of this.#controllers.keys()) {
			let matched = true;
			const filters = this.filters[hookId];

			if (filters) {
				for (let filterIndex = 0; filterIndex < filters.length; filterIndex++) {
					const { filter, opposite } = filters[filterIndex];
					let result;
					try {
						result = await filter(res);
					} catch (e) {
						console.error(`aa-hooks: filter failed (hook=${hookId}, filterIndex=${filterIndex}, ${formatResponseContext(res)})`, e);
						matched = false;
						break;
					}

					if (opposite ? result : !result) {
						matched = false;
						break;
					}
				}
			}

			if (matched) {
				ids.push(hookId);
			}
		}

		return ids;
	}

	async #responseHandler(res, source = 'aa_response') {
		if (this.#closed) {
			return;
		}

		if (!res || typeof res !== 'object') {
			console.error('aa-hooks: received invalid aa_response payload', res);
			return;
		}

		if (!this.#addresses.has(res.aa_address)) {
			return;
		}

		this.#logEvent(`aa-hooks: received response (source=${source}, ${formatResponseContext(res)})`);

		// Buffer until the first hook is registered, and keep buffering while a
		// flush is pending so the queued responses stay ahead of newer ones.
		if (!this.#registrationStarted || this.#pendingFlushScheduled) {
			const dropped = this.#responses.queuePending(res, source);
			if (dropped) {
				console.warn('aa-hooks: pending response buffer is full; dropped the oldest response');
			}
			this.#logEvent(`aa-hooks: queued response until hooks are registered (source=${source}, ${formatResponseContext(res)})`);
			this.#schedulePendingFlush();
			return;
		}

		const delivery = this.#responses.begin(res, source);
		if (delivery.state === RESPONSE_STATE.DUPLICATE) {
			this.#logEvent(`aa-hooks: ignored duplicate response (source=${source}, ${formatResponseContext(res)})`);
			return;
		}
		if (delivery.state === RESPONSE_STATE.DEFERRED) {
			this.#logEvent(`aa-hooks: deferred in-flight duplicate response (source=${source}, ${formatResponseContext(res)})`);
			return;
		}

		let unlock;
		let completed = false;

		try {
			if (!this.parallelProcessing) {
				unlock = await mutex.lock([
					this.#mutexKey,
					`aa-hooks:responseHandler:aa:${res.aa_address}`,
				]);
			}

			let timestamp = res.timestamp;
			if (!Number.isFinite(timestamp) || timestamp <= 0) {
				console.warn(`aa-hooks: response has no valid timestamp (${formatResponseContext(res)}); falling back to current time`);
				timestamp = Math.floor(Date.now() / 1000);
			}

			if (timestamp < this.startTs) {
				// Expected in newEventsOnly mode: the first history sync of a busy
				// AA replays everything, so this is a trace, not an anomaly.
				this.#logEvent(`aa-hooks: ignored old response (${formatResponseContext(res)}, timestamp=${timestamp}, startTs=${this.startTs})`);
				completed = true;
				return;
			}

			if (![false, true, 0, 1].includes(res.bounced)) {
				console.warn(`aa-hooks: response has unexpected bounced=${String(res.bounced)} (${formatResponseContext(res)}); isSuccess/isBounced filters will not match`);
			}

			const hookIds = await this.#findMatchingHookIds(res);
			let unitUnavailable = this.#triggerUnits.isUnavailable(res.trigger_unit);
			let trigger = {};
			if (hookIds.length > 0 && !unitUnavailable) {
				trigger = await this.readTriggerUnit(res.trigger_unit);
				unitUnavailable = this.#triggerUnits.isUnavailable(res.trigger_unit);
			}

			this.#logEvent(`aa-hooks: response matched hooks=${hookIds.length} (source=${source}, ${formatResponseContext(res)})`);

			await this.#runCallbacks(hookIds, delivery.key, trigger, res);

			if (unitUnavailable) {
				console.warn(`aa-hooks: trigger unit is unavailable (${formatResponseContext(res)}); unit-independent hooks ran, and a duplicate delivery can retry the remaining hooks`);
				return;
			}
			completed = true;
		} catch (e) {
			console.error(`aa-hooks: response handler failed (${formatResponseContext(res)})`, e);
		} finally {
			if (unlock) {
				try {
					await unlock();
				} catch (e) {
					console.error(`aa-hooks: failed to release response mutex (${formatResponseContext(res)})`, e);
				}
			}

			const deferred = this.#responses.finish(delivery.key, completed);
			if (deferred) {
				void this.#responseHandler(deferred.res, deferred.source);
			}
		}
	}

	async #runCallbacks(hookIds, responseKey, trigger, res) {
		for (const hookId of hookIds) {
			if (this.#responses.hasCompletedHook(responseKey, hookId)) {
				continue;
			}
			const controller = this.#controllers.get(hookId);
			if (!controller) {
				continue;
			}

			try {
				await controller.callback(trigger, res);
			} catch (e) {
				console.error(`aa-hooks: hook callback failed (hook=${hookId}, ${formatResponseContext(res)})`, e);
			} finally {
				this.#responses.markHookCompleted(responseKey, hookId);
			}
		}
	}
}

module.exports = Hooks;
