/**
 * @param {any} res
 * @returns {string}
 */
function formatResponseContext(res) {
	const aa = res?.aa_address || '<missing>';
	const trigger = res?.trigger_unit || '<missing>';
	const response = res?.response_unit || '<none>';
	return `aa=${aa}, trigger=${trigger}, response=${response}`;
}

/**
 * Create an opt-in diagnostic logger that is not affected when headless-obyte
 * replaces console.log with a file writer after wallet initialization.
 * @param {boolean} enabled
 * @param {(message: string) => void} [output]
 * @returns {(message: string) => void}
 */
function createEventLogger(enabled, output) {
	if (!enabled) {
		return () => {};
	}
	if (output) {
		return output;
	}
	return (message) => {
		process.stdout.write(`${message}\n`);
	};
}

/**
 * Identity of a response, matching the `UNIQUE (trigger_unit, aa_address)`
 * constraint on ocore's `aa_responses` table.
 * @param {any} res
 * @returns {string | undefined} undefined when the response cannot be identified
 */
function getResponseKey(res) {
	if (!res?.aa_address || !res?.trigger_unit) {
		return undefined;
	}
	return `${res.aa_address}:${res.trigger_unit}`;
}

/**
 * @param {any} error
 * @returns {Error}
 */
function toError(error) {
	return error instanceof Error ? error : new Error(String(error));
}

/**
 * Reject if `promise` has not settled within `timeoutMs`.
 *
 * ocore and aabot report some failures by throwing from an asynchronous
 * callback rather than by rejecting. The throw escapes as an uncaughtException
 * and leaves the promise pending forever, which would otherwise stall a filter
 * while it holds the response mutex and silently kill the instance.
 * @param {Promise<any>} promise
 * @param {number} timeoutMs
 * @param {string} message
 * @returns {Promise<any>}
 */
function withTimeout(promise, timeoutMs, message) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
		if (typeof timer.unref === 'function') {
			timer.unref();
		}
		promise.then(resolve, reject).finally(() => clearTimeout(timer));
	});
}

/**
 * Evict the oldest entries of an insertion-ordered Map or Set.
 * @param {Map<any, any> | Set<any>} collection
 * @param {number} maxSize
 */
function trimOldest(collection, maxSize) {
	while (collection.size > maxSize) {
		collection.delete(collection.keys().next().value);
	}
}

module.exports = {
	createEventLogger,
	formatResponseContext,
	getResponseKey,
	toError,
	trimOldest,
	withTimeout,
};
