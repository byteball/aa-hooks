/**
 * Read a unit, asking the light vendor for it when it is missing locally.
 *
 * Always settles, so a caller holding a lock can never be wedged by a foreign
 * callback that goes silent.
 * @param {string} unitHash
 * @returns {Promise<object | undefined>}
 */
export function readJoint(unitHash: string): Promise<object | undefined>;
/**
 * Read a unit from local storage, reporting a miss as a value.
 *
 * aabot's `dag.readJoint` is deliberately not used: it reports "unit not found"
 * by throwing from an asynchronous storage callback, so the throw escapes as an
 * uncaughtException while the promise it returned stays pending forever.
 * `storage.readJoint` exposes the miss as an `ifNotFound` callback instead.
 * @param {string} unitHash
 * @returns {Promise<object | undefined>} undefined when the unit is not stored
 */
export function readJointFromStorage(unitHash: string): Promise<object | undefined>;
/**
 * Ask the light vendor for the history containing a unit. Always resolves: a
 * failed request simply means the retry finds nothing either.
 * @param {string} unitHash
 * @returns {Promise<void>}
 */
export function requestHistoryFor(unitHash: string): Promise<void>;
