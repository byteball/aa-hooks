const conf = require('ocore/conf.js');
const db = require('ocore/db.js');
const storage = require('ocore/storage.js');
const network = require('ocore/network.js');
const { withTimeout } = require('./utils');

// A read can wait for a light-vendor history request, so the bound is generous;
// it exists only to guarantee the read cannot stall its caller forever.
const READ_TIMEOUT_MS = 30000;

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
function readJointFromStorage(unitHash) {
	return new Promise((resolve, reject) => {
		try {
			storage.readJoint(db, unitHash, {
				ifFound: (objJoint) => resolve(objJoint),
				ifNotFound: () => resolve(undefined),
			});
		} catch (e) {
			reject(e);
		}
	});
}

/**
 * Ask the light vendor for the history containing a unit. Always resolves: a
 * failed request simply means the retry finds nothing either.
 * @param {string} unitHash
 * @returns {Promise<void>}
 */
function requestHistoryFor(unitHash) {
	return new Promise((resolve) => {
		try {
			network.requestHistoryFor([unitHash], [], () => resolve());
		} catch (e) {
			console.error(`aa-hooks: failed to request history for trigger=${unitHash}`, e);
			resolve();
		}
	});
}

async function readJointWithHistory(unitHash) {
	const objJoint = await readJointFromStorage(unitHash);
	if (objJoint || !conf.bLight) {
		return objJoint;
	}
	// A light client may not have synced the unit yet; the live notification
	// regularly arrives before its history does.
	await requestHistoryFor(unitHash);
	return readJointFromStorage(unitHash);
}

/**
 * Read a unit, asking the light vendor for it when it is missing locally.
 *
 * Always settles, so a caller holding a lock can never be wedged by a foreign
 * callback that goes silent.
 * @param {string} unitHash
 * @returns {Promise<object | undefined>}
 */
function readJoint(unitHash) {
	return withTimeout(
		readJointWithHistory(unitHash),
		READ_TIMEOUT_MS,
		`timed out reading trigger=${unitHash}`,
	);
}

module.exports = {
	readJoint,
	readJointFromStorage,
	requestHistoryFor,
};
