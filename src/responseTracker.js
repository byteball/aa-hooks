const { getResponseKey, trimOldest } = require('./utils');

const RESPONSE_STATE = Object.freeze({
	STARTED: 'started',
	DUPLICATE: 'duplicate',
	DEFERRED: 'deferred',
});

/**
 * Tracks the delivery lifecycle of AA responses.
 *
 * The same response can arrive through the direct light channel and through
 * history synchronization. This registry keeps transport concerns out of the
 * Hooks coordinator and makes retries idempotent per hook.
 */
class ResponseTracker {
	#pending = new Map();

	#pendingSequence = 0;

	#seen = new Set();

	#inFlight = new Set();

	#deferred = new Map();

	#completedHookIds = new Map();

	#limits;

	constructor(limits = {}) {
		this.#limits = {
			pending: limits.pending || 1000,
			seen: limits.seen || 5000,
			deferred: limits.deferred || 1000,
			completed: limits.completed || 1000,
		};
	}

	queuePending(res, source) {
		const responseKey = getResponseKey(res);
		const key = responseKey || `unkeyed:${this.#pendingSequence++}`;
		const willEvict = !this.#pending.has(key) && this.#pending.size >= this.#limits.pending;
		this.#pending.set(key, { res, source });
		trimOldest(this.#pending, this.#limits.pending);
		return willEvict;
	}

	hasPending() {
		return this.#pending.size > 0;
	}

	takePending() {
		const pending = [...this.#pending.values()];
		this.#pending.clear();
		return pending;
	}

	begin(res, source) {
		const key = getResponseKey(res);
		if (key && this.#seen.has(key)) {
			return { state: RESPONSE_STATE.DUPLICATE, key };
		}
		if (key && this.#inFlight.has(key)) {
			this.#deferred.set(key, { res, source });
			trimOldest(this.#deferred, this.#limits.deferred);
			return { state: RESPONSE_STATE.DEFERRED, key };
		}
		if (key) {
			this.#inFlight.add(key);
		}
		return { state: RESPONSE_STATE.STARTED, key };
	}

	hasCompletedHook(responseKey, hookId) {
		return Boolean(responseKey && this.#completedHookIds.get(responseKey)?.has(hookId));
	}

	markHookCompleted(responseKey, hookId) {
		if (!responseKey) {
			return;
		}
		let hookIds = this.#completedHookIds.get(responseKey);
		if (!hookIds) {
			hookIds = new Set();
			this.#completedHookIds.set(responseKey, hookIds);
			trimOldest(this.#completedHookIds, this.#limits.completed);
		}
		hookIds.add(hookId);
	}

	finish(responseKey, completed) {
		if (!responseKey) {
			return undefined;
		}

		const deferred = this.#deferred.get(responseKey);
		this.#deferred.delete(responseKey);
		this.#inFlight.delete(responseKey);

		if (completed) {
			this.#seen.add(responseKey);
			trimOldest(this.#seen, this.#limits.seen);
			this.#completedHookIds.delete(responseKey);
			return undefined;
		}

		return deferred;
	}
}

module.exports = {
	ResponseTracker,
	RESPONSE_STATE,
};
