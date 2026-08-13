'use strict';

// Test harness that stubs the ocore / aabot / uuid dependencies so the real
// `src/*.js` can be loaded and exercised without a running Obyte node.
//
// It patches Module._load (idempotently) to return in-memory mocks for the bare
// specifiers the library requires, then re-exports the real Hooks/HookController
// plus handles to the mock state so tests can drive the DAG and the event bus.

const Module = require('module');
const EventEmitter = require('events');

const dagState = {
	joints: {},        // unit hash -> { unit } | 'THROW' | undefined
	defs: {},          // aa_address -> definition array | 'THROW' | undefined
	readJointCalls: {},// unit hash -> number of dag.readJoint calls
	loadAAImpl: null,  // optional (addr) => any, may throw/reject
};

const walletState = {
	watchCalls: [],
	watchImpl: null,
};

const networkState = {
	subscriptions: [],
	subscribeImpl: null,
	historyRequests: [],
	historyImpl: null,
};

const headlessState = {
	ready: false,
};

// src/aaSubscriptionManager.js deliberately never requires headless-obyte (that
// would boot a wallet as a side effect of importing the library); it only reads
// the module from require.cache when the host application has already loaded
// it. Seeding/clearing that entry simulates an application that does or does
// not use headless-obyte.
const headlessPath = require.resolve('headless-obyte');

const headlessMock = {
	isReady: () => headlessState.ready,
	waitTillReady: () => {
		if (headlessState.ready) return;
		return new Promise((resolve) => eventBus.once('headless_wallet_ready', resolve));
	},
};

/**
 * Enable node:test fake timers across Node versions.
 *
 * Node >= 21.2 takes `enable({ apis })`; earlier releases (including the Node 18
 * used in CI) only accept a bare array. Both are still honoured by current Node,
 * so try the modern form first and fall back.
 */
function enableMockTimers(t, apis = ['setTimeout']) {
	try {
		t.mock.timers.enable({ apis });
	} catch (e) {
		if (e?.code !== 'ERR_INVALID_ARG_TYPE') {
			throw e;
		}
		t.mock.timers.enable(apis);
	}
}

function setHeadlessLoaded(loaded) {
	if (loaded) {
		require.cache[headlessPath] = /** @type {any} */ ({
			id: headlessPath,
			filename: headlessPath,
			loaded: true,
			exports: headlessMock,
		});
	} else {
		delete require.cache[headlessPath];
	}
}

function resetDag() {
	dagState.joints = { U1: { unit: { messages: [] } } };
	dagState.defs = {};
	dagState.readJointCalls = {};
	dagState.loadAAImpl = null;
	walletState.watchCalls = [];
	walletState.watchImpl = null;
	networkState.subscriptions = [];
	networkState.subscribeImpl = null;
	networkState.historyRequests = [];
	networkState.historyImpl = null;
	headlessState.ready = false;
	setHeadlessLoaded(true);
}

const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);

// Minimal FIFO mutex compatible with ocore's mutex.lock (resolves to unlock fn).
const tails = {};
const mutex = {
	lock(key) {
		const keys = Array.isArray(key) ? key : [key];
		const prev = Promise.all(keys.map((item) => tails[item] || Promise.resolve()));
		let release;
		const p = new Promise((res) => { release = res; });
		const tail = prev.then(() => p);
		for (const item of keys) {
			tails[item] = tail;
		}
		return prev.then(() => () => release());
	},
};

let uuidN = 0;

const dag = {
	loadAA: async (addr) => {
		if (dagState.loadAAImpl) return dagState.loadAAImpl(addr);
		return ['autonomous agent', {}];
	},
	readAADefinition: (addr) => {
		const d = dagState.defs[addr];
		if (d === 'THROW') return Promise.reject(new Error('definition read failed'));
		// aabot leaves this pending forever when the light vendor replies with
		// nothing, so the filter must not depend on it settling.
		if (d === 'HANG') return new Promise(() => {});
		return Promise.resolve(d); // may be undefined
	},
};

// Mirrors ocore's storage.readJoint: a miss is an `ifNotFound` callback, and
// both callbacks fire asynchronously (rocksdb).
const storage = {
	readJoint: (_conn, unit, callbacks) => {
		dagState.readJointCalls[unit] = (dagState.readJointCalls[unit] || 0) + 1;
		if (dagState.joints[unit] === 'THROW') throw new Error('storage failure: ' + unit);
		setImmediate(() => {
			const j = dagState.joints[unit];
			if (!j) return callbacks.ifNotFound();
			callbacks.ifFound(j);
		});
	},
};

const mocks = {
	'ocore/conf.js': { hub: 'test-hub', bLight: true },
	'ocore/event_bus.js': eventBus,
	'ocore/light_wallet.js': { setLightVendorHost: () => {} },
	'ocore/network.js': {
		light_vendor_url: 'wss://test-hub',
		addLightWatchedAa: (aa, address, cb) => {
			networkState.subscriptions.push({ aa, address });
			if (networkState.subscribeImpl) return networkState.subscribeImpl(aa, address, cb);
			if (cb) cb();
		},
		requestHistoryFor: (units, addresses, cb) => {
			networkState.historyRequests.push(...units);
			if (networkState.historyImpl) return networkState.historyImpl(units, cb);
			setImmediate(cb);
		},
	},
	'ocore/db.js': {},
	'ocore/storage.js': storage,
	// Safety net: nothing in src/ requires this, but a stray require must never
	// boot the real wallet.
	'headless-obyte': headlessMock,
	'ocore/wallet_general.js': {
		addWatchedAddress: (addr, cb) => {
			walletState.watchCalls.push(addr);
			if (walletState.watchImpl) return walletState.watchImpl(addr, cb);
			if (cb) cb();
		},
	},
	'ocore/mutex.js': mutex,
	'aabot/dag.js': dag,
	'uuid': { v4: () => 'id-' + (++uuidN) },
};

setHeadlessLoaded(true);

if (!Module._load.__aaHooksPatched) {
	const orig = Module._load;
	Module._load = function (request) {
		if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
		return orig.apply(this, arguments);
	};
	Module._load.__aaHooksPatched = true;
}

// Loaded AFTER the patch so their bare requires hit the mocks above.
const { Hooks } = require('../src/index.js');
const HookController = require('../src/hookController.js');

// Wait until the (serial) response handler has drained its work queue.
async function drain() {
	// Every Hooks instance has its own mutex key. Await the latest tail for all
	// keys, repeating in case settling one handler queued more work.
	while (true) {
		const snapshot = Object.values(tails);
		await Promise.all(snapshot);
		const latest = Object.values(tails);
		if (snapshot.length === latest.length && snapshot.every((p, i) => p === latest[i])) {
			return;
		}
	}
}

module.exports = {
	Hooks,
	HookController,
	eventBus,
	mutex,
	dag,
	dagState,
	walletState,
	networkState,
	headlessState,
	setHeadlessLoaded,
	enableMockTimers,
	resetDag,
	drain,
};
