const { readJoint } = require('./dagReader');
const { trimOldest } = require('./utils');

/**
 * Read-through repository for immutable DAG trigger units.
 *
 * Successful reads are cached. Missing units are intentionally not cached so
 * a duplicate live/history delivery can retry after synchronization catches up.
 */
class TriggerUnitRepository {
	#cache = new Map();

	#unavailable = new Set();

	#maxSize;

	constructor(maxSize = 1000) {
		this.#maxSize = maxSize;
	}

	prime(unit) {
		const unitHash = unit?.unit;
		if (!unitHash) {
			return;
		}
		this.#unavailable.delete(unitHash);
		this.#cache.set(unitHash, Promise.resolve(unit));
		trimOldest(this.#cache, this.#maxSize);
	}

	isUnavailable(unitHash) {
		return this.#unavailable.has(unitHash);
	}

	read(unitHash) {
		if (!unitHash) {
			return Promise.resolve({});
		}

		const cached = this.#cache.get(unitHash);
		if (cached) {
			return cached;
		}

		// Declared first so the body can compare itself against the cache entry
		// and avoid evicting a newer read that replaced it.
		let promise;
		promise = Promise.resolve().then(async () => {
			try {
				const objJoint = await readJoint(unitHash);
				if (!objJoint?.unit) {
					console.warn(`aa-hooks: DAG returned no unit for trigger=${unitHash}; the miss is not cached so a duplicate delivery can retry`);
					this.#forgetMissing(unitHash, promise);
					return {};
				}
				this.#unavailable.delete(unitHash);
				return objJoint.unit;
			} catch (e) {
				console.error(`aa-hooks: failed to read trigger=${unitHash} from DAG; the failure is not cached so a duplicate delivery can retry`, e);
				this.#forgetMissing(unitHash, promise);
				return {};
			}
		});

		this.#cache.set(unitHash, promise);
		trimOldest(this.#cache, this.#maxSize);
		return promise;
	}

	#forgetMissing(unitHash, promise) {
		if (this.#cache.get(unitHash) !== promise) {
			return;
		}
		this.#cache.delete(unitHash);
		this.#unavailable.add(unitHash);
		trimOldest(this.#unavailable, this.#maxSize);
	}
}

module.exports = TriggerUnitRepository;
