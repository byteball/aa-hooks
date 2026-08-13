const conf = require('ocore/conf.js');
const eventBus = require('ocore/event_bus.js');
const lightWallet = require('ocore/light_wallet.js');
const walletGeneral = require('ocore/wallet_general.js');
const network = require('ocore/network.js');
const dag = require('aabot/dag.js');
const { toError, withTimeout } = require('./utils');

// `network.addLightWatchedAa` never calls back while the light vendor host is
// unknown, so an unbounded wait would hang `addWatchedAddress` forever.
const LIVE_SUBSCRIPTION_TIMEOUT_MS = 30000;

let lightVendorInitializationScheduled = false;

/**
 * Return headless-obyte only when the host application has already loaded it.
 *
 * Requiring it here would boot a wallet as a side effect of importing this
 * library: its module body reads or creates keys.json, may prompt for a
 * passphrase on stdin, connects to the hub, and redirects console.log.
 * Applications that drive ocore directly must stay unaffected, so readiness
 * falls back to the `headless_wallet_ready` event instead.
 * @returns {{isReady?: () => boolean} | undefined}
 */
function getLoadedHeadlessWallet() {
	try {
		const cached = require.cache[require.resolve('headless-obyte')];
		return cached ? cached.exports : undefined;
	} catch (e) {
		return undefined;
	}
}

function waitForWalletReady() {
	// Checked and subscribed in the same synchronous block so readiness cannot
	// be announced between the two.
	const headlessWallet = getLoadedHeadlessWallet();
	if (headlessWallet?.isReady?.()) {
		return Promise.resolve();
	}
	return new Promise((resolve) => eventBus.once('headless_wallet_ready', resolve));
}


function scheduleLightVendorInitialization() {
	if (lightVendorInitializationScheduled || network.light_vendor_url) {
		return;
	}
	lightVendorInitializationScheduled = true;
	setImmediate(() => {
		try {
			if (!network.light_vendor_url) {
				lightWallet.setLightVendorHost(conf.hub);
			}
		} catch (e) {
			console.error('aa-hooks: failed to initialize light vendor', e);
		}
	});
}

function settle(promise) {
	return promise.then(
		() => ({ ok: true }),
		(error) => ({ ok: false, error }),
	);
}

/**
 * Coordinates the two light-client delivery strategies for a set of AAs:
 * direct live notifications and persisted history synchronization.
 */
class AaSubscriptionManager {
	#addresses;

	#logEvent;

	#liveSubscriptions = new Map();

	constructor(addresses, { logEvent = () => {} } = {}) {
		this.#addresses = addresses;
		this.#logEvent = logEvent;
	}

	start() {
		scheduleLightVendorInitialization();
		waitForWalletReady()
			.then(() => this.#initializeConfiguredAddresses())
			.catch((e) => console.error('aa-hooks: failed to initialize configured AA watches', e));
	}

	async add(address) {
		await dag.loadAA(address);
		// Only a newly watched address may be rolled back below; removing one
		// that was already delivering responses would silently unwatch it.
		const wasWatched = this.#addresses.has(address);
		this.#addresses.add(address);

		const [liveResult, historyResult] = await Promise.all([
			conf.bLight
				? settle(this.#subscribeLive(address))
				: Promise.resolve({ ok: false }),
			settle(this.#watchHistory(address)),
		]);

		if (!liveResult.ok && liveResult.error) {
			console.error(`aa-hooks: failed to subscribe to live AA responses (aa=${address}); history watch will be used`, liveResult.error);
		}
		if (!historyResult.ok) {
			const fallback = liveResult.ok ? '; live AA subscription remains active' : '';
			console.error(`aa-hooks: failed to persist history watch (aa=${address})${fallback}`, historyResult.error);
		}

		if (!liveResult.ok && !historyResult.ok) {
			if (!wasWatched) {
				this.#addresses.delete(address);
			}
			throw historyResult.error;
		}
	}

	async #initializeConfiguredAddresses() {
		await Promise.all([...this.#addresses].map((address) => this.#initializeAddress(address)));
	}

	async #initializeAddress(address) {
		await Promise.all([
			this.#subscribeLive(address).catch((e) => {
				console.error(`aa-hooks: failed to subscribe to live AA responses (aa=${address})`, e);
			}),
			this.#loadDefinition(address),
			this.#watchHistory(address).catch((e) => {
				console.error(`aa-hooks: failed to watch address (aa=${address})`, e);
			}),
		]);
	}

	async #loadDefinition(address) {
		try {
			await dag.loadAA(address);
			this.#logEvent(`aa-hooks: loaded AA definition (aa=${address})`);
		} catch (e) {
			// A definition can be temporarily unavailable while the address itself
			// is still valid and watchable through the light vendor.
			console.error(`aa-hooks: failed to load AA definition (aa=${address})`, e);
		}
	}

	#watchHistory(address) {
		return new Promise((resolve, reject) => {
			try {
				walletGeneral.addWatchedAddress(address, (error) => {
					if (error) {
						reject(toError(error));
						return;
					}
					this.#logEvent(`aa-hooks: ensured history watch (aa=${address})`);
					resolve();
				});
			} catch (e) {
				reject(e);
			}
		});
	}

	#subscribeLive(address) {
		if (!conf.bLight) {
			return Promise.resolve();
		}
		const existing = this.#liveSubscriptions.get(address);
		if (existing) {
			return existing;
		}

		const subscription = withTimeout(
			new Promise((resolve, reject) => {
				try {
					network.addLightWatchedAa(address, null, (error) => {
						if (error) {
							reject(toError(error));
							return;
						}
						// The callback confirms sending the justsaying message, not
						// acceptance of the subscription by the light vendor.
						this.#logEvent(`aa-hooks: sent live AA subscription (aa=${address})`);
						resolve();
					});
				} catch (e) {
					reject(e);
				}
			}),
			LIVE_SUBSCRIPTION_TIMEOUT_MS,
			`timed out subscribing to live AA responses (aa=${address})`,
		);

		// addLightWatchedAa installs its own reconnect listener. Cache the call
		// so overlapping startup/runtime registration doesn't add more listeners.
		this.#liveSubscriptions.set(address, subscription);

		// Drop a failed attempt so a later add() can retry instead of replaying
		// the stale rejection forever. A retry re-registers ocore's reconnect
		// listener, which is why only failures — never successes — are evicted.
		subscription.catch(() => {
			if (this.#liveSubscriptions.get(address) === subscription) {
				this.#liveSubscriptions.delete(address);
			}
		});

		return subscription;
	}
}

module.exports = AaSubscriptionManager;
