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

function resetDag() {
	dagState.joints = {};
	dagState.defs = {};
	dagState.readJointCalls = {};
	dagState.loadAAImpl = null;
}

const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);

// Minimal FIFO mutex compatible with ocore's mutex.lock (resolves to unlock fn).
const tails = {};
const mutex = {
	lock(key) {
		const prev = tails[key] || Promise.resolve();
		let release;
		const p = new Promise((res) => { release = res; });
		tails[key] = prev.then(() => p);
		return prev.then(() => () => release());
	},
};

let uuidN = 0;

const dag = {
	loadAA: async (addr) => {
		if (dagState.loadAAImpl) return dagState.loadAAImpl(addr);
		return ['autonomous agent', {}];
	},
	readJoint: async (unit) => {
		dagState.readJointCalls[unit] = (dagState.readJointCalls[unit] || 0) + 1;
		const j = dagState.joints[unit];
		if (j === 'THROW') throw new Error('unit not found: ' + unit);
		return j; // undefined => caller treats as {}
	},
	readAADefinition: async (addr) => {
		const d = dagState.defs[addr];
		if (d === 'THROW') throw new Error('definition read failed');
		return d; // may be undefined
	},
};

const mocks = {
	'ocore/conf.js': { hub: 'test-hub' },
	'ocore/event_bus.js': eventBus,
	'ocore/light_wallet.js': { setLightVendorHost: () => {} },
	'ocore/wallet_general.js': { addWatchedAddress: (addr, cb) => { if (cb) cb(); } },
	'ocore/mutex.js': mutex,
	'aabot/dag.js': dag,
	'uuid': { v4: () => 'id-' + (++uuidN) },
};

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
	const unlock = await mutex.lock('responseHandler');
	unlock();
}

module.exports = { Hooks, HookController, eventBus, mutex, dag, dagState, resetDag, drain };
