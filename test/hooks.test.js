'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
	Hooks,
	eventBus,
	dagState,
	walletState,
	networkState,
	headlessState,
	setHeadlessLoaded,
	enableMockTimers,
	resetDag,
	drain,
} = require('./mocks');

// Each test drives events on the shared bus; start from a single listener so
// results are attributable to the Hooks instance under test.
beforeEach(() => {
	eventBus.removeAllListeners('aa_response');
	eventBus.removeAllListeners('message_for_light');
	eventBus.removeAllListeners('headless_wallet_ready');
	resetDag();
});

function mkRes(over = {}) {
	return Object.assign({
		trigger_unit: 'U1',
		bounced: 0,
		aa_address: 'AA1',
		trigger_address: 'SENDER',
		timestamp: 1e12,
		response: { responseVars: { ok: 1 } },
		objResponseUnit: { messages: [] },
	}, over);
}

function dataJoint(payload) {
	return { unit: { messages: [{ app: 'data', payload }] } };
}

// storage.readJoint answers from an asynchronous callback (rocksdb), so giving
// unblocked work a chance to run takes several macrotask turns, not one.
async function tick(times = 8) {
	for (let i = 0; i < times; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

test('all matching hooks fire for one response', async () => {
	dagState.joints['U1'] = dataJoint({ symbol: 'ETH' });
	const hooks = new Hooks(['AA1'], { newEventsOnly: false });
	let a = 0, b = 0, c = 0;
	hooks.register(() => { a++; }).isSuccess().triggerDataContainsKey('symbol');
	hooks.register(() => { b++; }).isSuccess().triggerDataContainsKey('symbol');
	hooks.register(() => { c++; }).isSuccess().not.triggerDataContainsKey('symbol');

	eventBus.emit('aa_response', mkRes());
	await drain();

	assert.strictEqual(a, 1);
	assert.strictEqual(b, 1);      // second overlapping hook also fires
	assert.strictEqual(c, 0);      // .not hook excluded
});

test('live boolean bounced values are handled like stored numeric values', async () => {
	dagState.joints['LIVE_OK'] = { unit: { messages: [] } };
	dagState.joints['LIVE_BOUNCED'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1']);
	let successful = 0;
	let bounced = 0;
	hooks.register(() => { successful++; }).isSuccess();
	hooks.register(() => { bounced++; }).isBounced();

	// aa_composer emits booleans live, before the DB representation converts
	// them to the numeric 0/1 values returned during history synchronization.
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'LIVE_OK', bounced: false }));
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'LIVE_BOUNCED', bounced: true }));
	await drain();

	assert.strictEqual(successful, 1, 'live successful response is not skipped');
	assert.strictEqual(bounced, 1, 'live bounced response is classified correctly');
});

test('responses from addresses outside this Hooks instance are ignored', async () => {
	const hooks = new Hooks(['CURRENT_AA']);
	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();

	// ocore persists watched addresses globally, so an event from an AA used by
	// an earlier process can still arrive on the shared aa_response event bus.
	eventBus.emit('aa_response', mkRes({ aa_address: 'PREVIOUS_AA' }));
	await drain();
	assert.strictEqual(fired, 0);

	eventBus.emit('aa_response', mkRes({ aa_address: 'CURRENT_AA' }));
	await drain();
	assert.strictEqual(fired, 1);
});

test('callback receives (triggerUnit, responseObj)', async () => {
	dagState.joints['U1'] = dataJoint({ symbol: 'ETH' });
	const hooks = new Hooks(['AA1']);
	let args;
	hooks.register((triggerUnit, responseObj) => { args = { triggerUnit, responseObj }; }).aaAddressIs('AA1');

	const res = mkRes();
	eventBus.emit('aa_response', res);
	await drain();

	assert.deepStrictEqual(args.triggerUnit.messages[0].payload, { symbol: 'ETH' });
	assert.strictEqual(args.responseObj, res);
});

test('trigger unit is read from the DAG only once per response', async () => {
	dagState.joints['U1'] = dataJoint({ symbol: 'ETH', asset: 'X', drawer: 'D' });
	const hooks = new Hooks(['AA1']);
	// three filters each need the trigger unit, plus the handler reads it again
	hooks.register(() => {}).triggerDataContainsKey('symbol')
		.triggerDataContainsKey('asset').triggerDataContainsKey('drawer');

	eventBus.emit('aa_response', mkRes());
	await drain();

	assert.strictEqual(dagState.readJointCalls['U1'], 1);
});

test('a throwing callback neither breaks siblings nor deadlocks the handler', async () => {
	dagState.joints['U1'] = dataJoint({ symbol: 'ETH' });
	dagState.joints['U2'] = dataJoint({ symbol: 'ETH' });
	const hooks = new Hooks(['AA1']);
	let before = 0, after = 0;
	hooks.register(() => { before++; }).aaAddressIs('AA1');
	const broken = hooks.register(() => { throw new Error('boom'); }).aaAddressIs('AA1');
	hooks.register(() => { after++; }).aaAddressIs('AA1');

	const errors = [];
	const originalError = console.error;
	console.error = (...args) => { errors.push(args); };
	try {
		eventBus.emit('aa_response', mkRes());
		await drain();
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'U2' }));
		await drain();
	} finally {
		console.error = originalError;
	}

	assert.strictEqual(after, 2, 'sibling after the throwing hook still fired');
	assert.strictEqual(before, 2, 'no deadlock: next response processed');
	assert.strictEqual(errors.length, 2);
	assert.match(errors[0][0], new RegExp(`hook=${broken.id}`));
	assert.match(errors[0][0], /aa=AA1, trigger=U1/);
});

test('a throwing filter is logged with context and does not deadlock the handler', async () => {
	dagState.joints['U2'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1']);
	const broken = hooks.register(() => {}).customFilter(() => { throw new Error('bad filter'); });
	let siblingCalls = 0;
	hooks.register(() => { siblingCalls++; }).aaAddressIs('AA1');

	const errors = [];
	const originalError = console.error;
	console.error = (...args) => { errors.push(args); };
	try {
		eventBus.emit('aa_response', mkRes());
		await drain();
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'U2' }));
		await drain();
	} finally {
		console.error = originalError;
	}

	assert.strictEqual(siblingCalls, 2, 'later hooks and responses still run');
	assert.strictEqual(errors.length, 2);
	assert.match(errors[0][0], new RegExp(`hook=${broken.id}`));
	assert.match(errors[0][0], /filterIndex=0/);
	assert.match(errors[0][0], /aa=AA1, trigger=U1/);
});

test('serial mode does not overlap callbacks within one Hooks instance', async () => {
	dagState.joints['SERIAL_1'] = { unit: { messages: [] } };
	dagState.joints['SERIAL_2'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1']);
	let releaseFirst;
	const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
	let signalFirstStarted;
	const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
	const started = [];
	let active = 0;
	let maxActive = 0;

	hooks.register(async (_trigger, res) => {
		started.push(res.trigger_unit);
		active++;
		maxActive = Math.max(maxActive, active);
		if (res.trigger_unit === 'SERIAL_1') {
			signalFirstStarted();
			await firstGate;
		}
		active--;
	});

	eventBus.emit('aa_response', mkRes({ trigger_unit: 'SERIAL_1' }));
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'SERIAL_2' }));
	await firstStarted;
	await new Promise((resolve) => setImmediate(resolve));
	const secondStartedWhileLocked = started.includes('SERIAL_2');
	releaseFirst();
	await drain();

	assert.strictEqual(secondStartedWhileLocked, false);
	assert.deepStrictEqual(started, ['SERIAL_1', 'SERIAL_2']);
	assert.strictEqual(maxActive, 1);
});

test('serial mutexes of separate Hooks instances serialize callbacks for the same AA', async () => {
	dagState.joints['SHARED_EVENT'] = { unit: { messages: [] } };
	const firstHooks = new Hooks(['AA1']);
	const secondHooks = new Hooks(['AA1']);
	let releaseFirst;
	const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
	let signalFirstStarted;
	const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
	let secondStarted = false;

	firstHooks.register(async () => {
		signalFirstStarted();
		await firstGate;
	});
	secondHooks.register(() => { secondStarted = true; });

	eventBus.emit('aa_response', mkRes({ trigger_unit: 'SHARED_EVENT' }));
	await firstStarted;
	await new Promise((resolve) => setImmediate(resolve));
	const observedBeforeRelease = secondStarted;
	releaseFirst();
	await drain();

	assert.strictEqual(observedBeforeRelease, false, 'same-AA callback waited for the first instance');
	assert.strictEqual(secondStarted, true, 'same-AA callback ran after the first instance released its lock');
});

test('serial mutexes of separate Hooks instances do not block different AAs', async () => {
	dagState.joints['AA1_EVENT'] = { unit: { messages: [] } };
	dagState.joints['AA2_EVENT'] = { unit: { messages: [] } };
	const firstHooks = new Hooks(['AA1']);
	const secondHooks = new Hooks(['AA2']);
	let releaseFirst;
	const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
	let signalFirstStarted;
	const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
	let secondStarted = false;

	firstHooks.register(async () => {
		signalFirstStarted();
		await firstGate;
	});
	secondHooks.register(() => { secondStarted = true; });

	eventBus.emit('aa_response', mkRes({ aa_address: 'AA1', trigger_unit: 'AA1_EVENT' }));
	await firstStarted;
	eventBus.emit('aa_response', mkRes({ aa_address: 'AA2', trigger_unit: 'AA2_EVENT' }));
	await tick();
	const observedBeforeRelease = secondStarted;
	releaseFirst();
	await drain();

	assert.strictEqual(observedBeforeRelease, true, 'different-AA callback was not blocked');
});

test('missing trigger unit (readJoint throws) is handled gracefully', async () => {
	dagState.joints['GONE'] = 'THROW';
	const hooks = new Hooks(['AA1']);
	let fired = 0;
	// filter needs the (missing) trigger unit -> should simply not match
	hooks.register(() => {}).triggerDataContainsKey('symbol');
	// this one does not need the unit -> must still fire
	hooks.register(() => { fired++; }).aaAddressIs('AA1');

	const errors = [];
	const originalError = console.error;
	const originalWarn = console.warn;
	console.error = (...args) => { errors.push(args); };
	console.warn = () => {};
	try {
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'GONE' }));
		await drain();
	} finally {
		console.error = originalError;
		console.warn = originalWarn;
	}
	assert.strictEqual(fired, 1);
	assert.ok(errors.length >= 1);
	assert.ok(errors.every(([message]) => /trigger=GONE/.test(message)));
});

test('an empty DAG read is not cached and a later event retries it', async () => {
	const hooks = new Hooks(['AA1']);
	let fired = 0;
	hooks.register(() => { fired++; }).triggerDataContainsKey('symbol');

	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => { warnings.push(args); };
	try {
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'LATE_UNIT' }));
		await drain();
		dagState.joints['LATE_UNIT'] = dataJoint({ symbol: 'ETH' });
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'LATE_UNIT' }));
		await drain();
	} finally {
		console.warn = originalWarn;
	}

	assert.strictEqual(fired, 1);
	// Three storage reads: the first attempt misses locally and retries after
	// asking the vendor for history, the second attempt hits straight away.
	assert.strictEqual(dagState.readJointCalls['LATE_UNIT'], 3);
	assert.deepStrictEqual(networkState.historyRequests, ['LATE_UNIT']);
	assert.match(warnings[0][0], /DAG returned no unit.*LATE_UNIT/);
});

test('a trigger unit missing from local storage is requested from the light vendor', async () => {
	const hooks = new Hooks(['AA1']);
	let fired = 0;
	hooks.register(() => { fired++; }).triggerDataContainsKey('symbol');

	// The live notification regularly arrives before history synchronization,
	// so the unit is absent locally until the vendor supplies it.
	networkState.historyImpl = (units, cb) => {
		for (const unit of units) {
			dagState.joints[unit] = dataJoint({ symbol: 'ETH' });
		}
		setImmediate(cb);
	};

	eventBus.emit('aa_response', mkRes({ trigger_unit: 'UNSYNCED' }));
	await drain();

	assert.deepStrictEqual(networkState.historyRequests, ['UNSYNCED']);
	assert.strictEqual(fired, 1, 'the hook fires once the vendor supplies the unit');
});

test('a hanging light-vendor history request does not wedge the instance', async (t) => {
	dagState.joints['NEXT'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1']);
	let fired = 0;
	// Needs the trigger unit, so it awaits the read that will never come back.
	hooks.register(() => {}).triggerDataContainsKey('symbol');
	hooks.register(() => { fired++; }).aaAddressIs('AA1');

	// ocore's requestHistoryFor can retry forever without invoking its callback.
	networkState.historyImpl = () => {};

	const originalError = console.error;
	const originalWarn = console.warn;
	console.error = () => {};
	console.warn = () => {};
	enableMockTimers(t);
	try {
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'STUCK' }));
		await tick();
		t.mock.timers.tick(30000);
		await tick();
		t.mock.timers.reset();

		// The stalled read must have released the serial mutex, so a later
		// response is still processed instead of being lost forever.
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'NEXT' }));
		await drain();
	} finally {
		t.mock.timers.reset();
		console.error = originalError;
		console.warn = originalWarn;
	}

	assert.strictEqual(fired, 2, 'unit-independent hooks ran for both responses');
});

test('a hanging AA definition read does not wedge baseAaIs', async (t) => {
	dagState.joints['NEXT'] = { unit: { messages: [] } };
	dagState.defs['AA1'] = 'HANG';   // aabot never settles this promise
	const hooks = new Hooks(['AA1']);
	let matched = 0;
	let fired = 0;
	hooks.register(() => { matched++; }).baseAaIs('BASE1');
	hooks.register(() => { fired++; }).aaAddressIs('AA1');

	const originalError = console.error;
	console.error = () => {};
	enableMockTimers(t);
	try {
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'NEXT' }));
		await tick();
		t.mock.timers.tick(30000);
		await drain();
	} finally {
		t.mock.timers.reset();
		console.error = originalError;
	}

	assert.strictEqual(matched, 0, 'the base-AA filter gives up instead of hanging');
	assert.strictEqual(fired, 1, 'the sibling hook still runs');
});

test('retrying a missing trigger does not repeat hooks that already completed', async () => {
	const hooks = new Hooks(['AA1']);
	let independent = 0;
	let unitDependent = 0;
	hooks.register(() => { independent++; }).aaAddressIs('AA1');
	hooks.register(() => { unitDependent++; }).triggerDataContainsKey('symbol');

	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'RETRY_UNIT' }));
		await drain();
		dagState.joints.RETRY_UNIT = dataJoint({ symbol: 'ETH' });
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'RETRY_UNIT' }));
		await drain();
	} finally {
		console.warn = originalWarn;
	}

	assert.strictEqual(independent, 1);
	assert.strictEqual(unitDependent, 1);
});

test('remove() stops a hook from firing', async () => {
	dagState.joints['U2'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1']);
	let n = 0;
	const hook = hooks.register(() => { n++; }).aaAddressIs('AA1');

	eventBus.emit('aa_response', mkRes());
	await drain();
	assert.strictEqual(n, 1);

	hook.remove();
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'U2' }));
	await drain();
	assert.strictEqual(n, 1, 'removed hook no longer fires');
});

test('newEventsOnly: true ignores events older than construction time', async () => {
	dagState.joints['NEW_EVENT'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1'], { newEventsOnly: true });
	let n = 0;
	hooks.register(() => { n++; }).aaAddressIs('AA1');

	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		eventBus.emit('aa_response', mkRes({ timestamp: 1 }));      // far in the past
		await drain();
	} finally {
		console.warn = originalWarn;
	}
	assert.strictEqual(n, 0);

	eventBus.emit('aa_response', mkRes({ trigger_unit: 'NEW_EVENT', timestamp: 2e12 }));   // in the future
	await drain();
	assert.strictEqual(n, 1);
});

test('malformed fields are warnings, but expected skips are only traces', async () => {
	dagState.joints['NO_TIMESTAMP'] = { unit: { messages: [] } };
	const traces = [];
	const hooks = new Hooks(['AA1'], {
		newEventsOnly: true,
		logEvents: true,
		logger: (message) => traces.push(message),
	});
	hooks.register(() => {}).aaAddressIs('AA1');
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => { warnings.push(args[0]); };
	try {
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'OLD', timestamp: 1 }));
		await drain();
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'NO_TIMESTAMP', timestamp: undefined, bounced: 2 }));
		await drain();
	} finally {
		console.warn = originalWarn;
	}

	// Genuine anomalies stay at warn level.
	assert.ok(warnings.some((message) => /no valid timestamp.*trigger=NO_TIMESTAMP/.test(message)));
	assert.ok(warnings.some((message) => /unexpected bounced=2.*trigger=NO_TIMESTAMP/.test(message)));

	// Skipping old responses is the whole point of newEventsOnly, and the first
	// history sync of a busy AA replays every past response — so it must not
	// warn once per event.
	assert.ok(traces.some((message) => /ignored old response.*aa=AA1, trigger=OLD/.test(message)));
	assert.ok(!warnings.some((message) => /ignored old response/.test(message)));
});

test('expected skips stay silent when logEvents is off', async () => {
	const hooks = new Hooks(['AA1'], { newEventsOnly: true });
	hooks.register(() => {}).aaAddressIs('AA1');
	const logged = [];
	const originalWarn = console.warn;
	const originalError = console.error;
	console.warn = (...args) => { logged.push(args[0]); };
	console.error = (...args) => { logged.push(args[0]); };
	try {
		for (let i = 0; i < 5; i++) {
			eventBus.emit('aa_response', mkRes({ trigger_unit: `OLD_${i}`, timestamp: 1 }));
		}
		await drain();
	} finally {
		console.warn = originalWarn;
		console.error = originalError;
	}

	assert.deepStrictEqual(logged, [], 'a history replay must not spam the log');
});

test('a hook without filters catches all events', async () => {
	const hooks = new Hooks(['AA1']);
	let n = 0;
	hooks.register(() => { n++; }); // No filters attached

	eventBus.emit('aa_response', mkRes());
	await drain();
	assert.strictEqual(n, 1);
});

test('a response matching no hook is a no-op', async () => {
	const hooks = new Hooks(['AA1']);
	let n = 0;
	hooks.register(() => { n++; }).aaAddressIs('SOMETHING_ELSE');

	eventBus.emit('aa_response', mkRes());
	await drain();
	assert.strictEqual(n, 0);
});

test('parallelProcessing: true still delivers events', async () => {
	dagState.joints['U1'] = dataJoint({ symbol: 'ETH' });
	const hooks = new Hooks(['AA1'], { parallelProcessing: true });
	let n = 0;
	hooks.register(() => { n++; }).isSuccess().triggerDataContainsKey('symbol');

	eventBus.emit('aa_response', mkRes());
	// no shared mutex here; allow the async handler microtasks to settle
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	assert.strictEqual(n, 1);
});

test('parallelProcessing: true allows callbacks to overlap', async () => {
	dagState.joints['PARALLEL_1'] = { unit: { messages: [] } };
	dagState.joints['PARALLEL_2'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1'], { parallelProcessing: true });
	let releaseFirst;
	const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
	let signalFirstStarted;
	const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
	let secondStarted = false;

	hooks.register(async (_trigger, res) => {
		if (res.trigger_unit === 'PARALLEL_1') {
			signalFirstStarted();
			await firstGate;
		} else {
			secondStarted = true;
		}
	});

	eventBus.emit('aa_response', mkRes({ trigger_unit: 'PARALLEL_1' }));
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'PARALLEL_2' }));
	await firstStarted;
	await new Promise((resolve) => setImmediate(resolve));
	const observedBeforeRelease = secondStarted;
	releaseFirst();
	await new Promise((resolve) => setImmediate(resolve));

	assert.strictEqual(observedBeforeRelease, true);
});

test('addWatchedAddress accepts responses from the added address', async () => {
	const hooks = new Hooks(['AA1']);
	await assert.doesNotReject(() => hooks.addWatchedAddress('AA2'));

	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	eventBus.emit('aa_response', mkRes({ aa_address: 'AA2' }));
	await drain();

	assert.strictEqual(fired, 1);
	assert.deepStrictEqual(networkState.subscriptions, [{ aa: 'AA2', address: null }]);
});

test('light client receives a new AA response directly without waiting for history', async () => {
	const hooks = new Hooks(['AA1']);
	let received;
	hooks.register((trigger, response) => { received = { trigger, response }; })
		.isSuccess()
		.triggerDataKeyIs('action', 'new-aa');

	eventBus.emit('headless_wallet_ready');
	await new Promise((resolve) => setImmediate(resolve));
	assert.ok(networkState.subscriptions.some(({ aa }) => aa === 'AA1'));

	const trigger = {
		unit: 'DIRECT_TRIGGER',
		messages: [{ app: 'data', payload: { action: 'new-aa' } }],
	};
	eventBus.emit('message_for_light', {}, 'light/aa_request', { aa_address: 'AA1', unit: trigger });
	const response = mkRes({ trigger_unit: 'DIRECT_TRIGGER', bounced: false });
	eventBus.emit('message_for_light', {}, 'light/aa_response', response);
	await drain();

	assert.strictEqual(received.response, response);
	assert.strictEqual(received.trigger, trigger);
	assert.strictEqual(dagState.readJointCalls.DIRECT_TRIGGER, undefined, 'live trigger came from light/aa_request cache');
});

test('direct and history delivery of the same AA response is deduplicated', async () => {
	const hooks = new Hooks(['AA1']);
	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	const response = mkRes({ bounced: false });

	eventBus.emit('message_for_light', {}, 'light/aa_response', response);
	eventBus.emit('aa_response', { ...response, bounced: 0 });
	await drain();

	assert.strictEqual(fired, 1);
});

test('logEvents traces initialization, delivery source, matching, and deduplication', async () => {
	const logs = [];
	const originalLog = console.log;
	// Simulate headless-obyte redirecting console.log after wallet readiness.
	console.log = () => {};
	try {
		const hooks = new Hooks(['AA1'], {
			logEvents: true,
			logger: (message) => logs.push(message),
		});
		hooks.register(() => {}).isSuccess();
		eventBus.emit('headless_wallet_ready');
		await new Promise((resolve) => setImmediate(resolve));

		const trigger = { unit: 'LOG_TRIGGER', messages: [] };
		eventBus.emit('message_for_light', {}, 'light/aa_request', { aa_address: 'AA1', unit: trigger });
		const response = mkRes({ trigger_unit: 'LOG_TRIGGER', bounced: false });
		eventBus.emit('message_for_light', {}, 'light/aa_response', response);
		eventBus.emit('aa_response', { ...response, bounced: 0 });
		await drain();
		eventBus.emit('aa_response', { ...response, bounced: 0 });
		await drain();
	} finally {
		console.log = originalLog;
	}

	assert.ok(logs.some((message) => /sent live AA subscription.*aa=AA1/.test(message)));
	assert.ok(logs.some((message) => /loaded AA definition.*aa=AA1/.test(message)));
	assert.ok(logs.some((message) => /ensured history watch.*aa=AA1/.test(message)));
	assert.ok(logs.some((message) => /received live AA request.*trigger=LOG_TRIGGER/.test(message)));
	assert.ok(logs.some((message) => /received response.*source=light\/aa_response/.test(message)));
	assert.ok(logs.some((message) => /response matched hooks=1.*source=light\/aa_response/.test(message)));
	assert.ok(logs.some((message) => /deferred in-flight duplicate response.*source=aa_response/.test(message)));
	assert.ok(logs.some((message) => /ignored duplicate response.*source=aa_response/.test(message)));
});

test('an in-flight history duplicate retries a live response that could not read its trigger', async () => {
	delete dagState.joints.U1;
	const hooks = new Hooks(['AA1']);
	let dependent = 0;
	let independent = 0;
	let signalFilterStarted;
	let releaseFilter;
	const filterStarted = new Promise((resolve) => { signalFilterStarted = resolve; });
	const filterGate = new Promise((resolve) => { releaseFilter = resolve; });
	hooks.register(() => { dependent++; }).triggerDataContainsKey('symbol');
	hooks.register(() => { independent++; }).customFilter(async () => {
		signalFilterStarted();
		await filterGate;
		return true;
	});

	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		eventBus.emit('message_for_light', {}, 'light/aa_response', mkRes({ bounced: false }));
		await filterStarted;
		dagState.joints.U1 = dataJoint({ symbol: 'ETH' });
		eventBus.emit('aa_response', mkRes({ bounced: 0 }));
		releaseFilter();
		await drain();
	} finally {
		console.warn = originalWarn;
	}

	assert.strictEqual(independent, 1, 'hook completed during the first delivery is not repeated');
	assert.strictEqual(dependent, 1, 'deferred history delivery retries the unit-dependent hook');
});

test('a response received before the first hook registration is buffered', async () => {
	const traces = [];
	const hooks = new Hooks(['AA1'], { logEvents: true, logger: (message) => traces.push(message) });
	let fired = 0;
	const warnings = [];
	const originalWarn = console.warn;
	console.warn = (...args) => { warnings.push(args[0]); };
	try {
		eventBus.emit('aa_response', mkRes());
		hooks.register(() => { fired++; }).isSuccess();
		await new Promise((resolve) => setImmediate(resolve));
		await drain();
	} finally {
		console.warn = originalWarn;
	}

	assert.strictEqual(fired, 1);
	assert.ok(traces.some((message) => /queued response until hooks are registered/.test(message)));
	// Startup buffering is normal operation, not something to warn about.
	assert.deepStrictEqual(warnings, []);
});

test('buffered responses are delivered before responses that arrive after registration', async () => {
	dagState.joints['EARLY'] = { unit: { messages: [] } };
	dagState.joints['LATE'] = { unit: { messages: [] } };
	const hooks = new Hooks(['AA1']);
	const seen = [];

	// EARLY arrives before any hook exists, so it waits for the flush; LATE
	// arrives once registration has started and must not overtake it.
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'EARLY' }));
	hooks.register((_trigger, res) => { seen.push(res.trigger_unit); }).isSuccess();
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'LATE' }));
	await new Promise((resolve) => setImmediate(resolve));
	await drain();

	assert.deepStrictEqual(seen, ['EARLY', 'LATE']);
});

test('addWatchedAddress does not accept an address when loadAA fails', async () => {
	const hooks = new Hooks(['AA1']);
	dagState.loadAAImpl = async (address) => {
		if (address === 'BAD_AA') {
			throw new Error('unknown AA');
		}
	};

	await assert.rejects(() => hooks.addWatchedAddress('BAD_AA'), /unknown AA/);

	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	eventBus.emit('aa_response', mkRes({ aa_address: 'BAD_AA' }));
	await drain();

	assert.strictEqual(fired, 0);
});

test('addWatchedAddress keeps the live path active when persisting the history watch fails', async () => {
	const hooks = new Hooks(['AA1']);
	walletState.watchImpl = (_address, callback) => callback(new Error('watch DB failed'));
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => { errors.push(args); };
	try {
		await assert.doesNotReject(() => hooks.addWatchedAddress('AA2'));
	} finally {
		console.error = originalError;
	}

	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	eventBus.emit('aa_response', mkRes({ aa_address: 'AA2' }));
	await drain();
	assert.strictEqual(fired, 1, 'the successful live subscription keeps the address active');
	assert.ok(errors.some(([message]) => /failed to persist history watch.*aa=AA2/.test(message)));
});

test('addWatchedAddress uses history when the initial live subscription fails', async () => {
	const hooks = new Hooks(['AA1']);
	networkState.subscribeImpl = (_aa, _address, callback) => callback(new Error('vendor offline'));
	const originalError = console.error;
	console.error = () => {};
	try {
		await assert.doesNotReject(() => hooks.addWatchedAddress('AA2'));
	} finally {
		console.error = originalError;
	}

	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	eventBus.emit('aa_response', mkRes({ aa_address: 'AA2' }));
	await drain();
	assert.strictEqual(fired, 1);
	assert.deepStrictEqual(walletState.watchCalls, ['AA2']);
});

test('addWatchedAddress rejects and rolls back only when both delivery paths fail', async () => {
	const hooks = new Hooks(['AA1']);
	networkState.subscribeImpl = (_aa, _address, callback) => callback(new Error('vendor offline'));
	walletState.watchImpl = (_address, callback) => callback(new Error('watch DB failed'));
	const originalError = console.error;
	console.error = () => {};
	try {
		await assert.rejects(() => hooks.addWatchedAddress('AA2'), /watch DB failed/);
	} finally {
		console.error = originalError;
	}

	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	eventBus.emit('aa_response', mkRes({ aa_address: 'AA2' }));
	await drain();
	assert.strictEqual(fired, 0, 'address is removed only when no delivery path is available');
});

test('a failed re-add does not unwatch an address that was already watched', async () => {
	dagState.joints['BEFORE'] = { unit: { messages: [] } };
	dagState.joints['AFTER'] = { unit: { messages: [] } };
	// Live subscription fails at startup, so AA1 is delivered through history only.
	networkState.subscribeImpl = (_aa, _address, callback) => callback(new Error('vendor offline'));
	const originalError = console.error;
	console.error = () => {};
	try {
		const hooks = new Hooks(['AA1']);
		eventBus.emit('headless_wallet_ready');
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));

		let fired = 0;
		hooks.register(() => { fired++; }).isSuccess();
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'BEFORE' }));
		await drain();
		assert.strictEqual(fired, 1, 'history delivery works before the re-add');

		// Re-adding the already-watched address while both paths are down must
		// not roll back a subscription this call did not create.
		walletState.watchImpl = (_address, callback) => callback(new Error('watch DB failed'));
		await assert.rejects(() => hooks.addWatchedAddress('AA1'), /watch DB failed/);

		networkState.subscribeImpl = null;
		walletState.watchImpl = null;
		eventBus.emit('aa_response', mkRes({ trigger_unit: 'AFTER' }));
		await drain();
		assert.strictEqual(fired, 2, 'AA1 is still watched after the failed re-add');
	} finally {
		console.error = originalError;
	}
});

test('a failed live subscription can be retried instead of being cached forever', async () => {
	const hooks = new Hooks(['AA1']);
	let attempts = 0;
	networkState.subscribeImpl = (_aa, _address, callback) => {
		attempts++;
		callback(new Error('vendor offline'));
	};
	const originalError = console.error;
	console.error = () => {};
	try {
		await hooks.addWatchedAddress('AA2');   // history succeeds, live fails
		assert.strictEqual(attempts, 1);

		// The vendor recovers: a later add must actually try again rather than
		// replay the cached rejection and stay on history-only delivery.
		networkState.subscribeImpl = (_aa, _address, callback) => {
			attempts++;
			callback();
		};
		await hooks.addWatchedAddress('AA2');
	} finally {
		console.error = originalError;
	}

	assert.strictEqual(attempts, 2, 'the live subscription was retried');
});

test('a live subscription that never calls back does not hang addWatchedAddress', async (t) => {
	// ocore's sendJustsayingToLightVendor retries every second and never invokes
	// the callback while the light vendor host is unknown, so an unbounded wait
	// would leave addWatchedAddress pending forever.
	const hooks = new Hooks(['AA1']);
	networkState.subscribeImpl = () => {};   // callback is never called

	const originalError = console.error;
	console.error = () => {};
	enableMockTimers(t);
	try {
		const added = hooks.addWatchedAddress('AA2');
		await Promise.resolve();
		t.mock.timers.tick(30000);
		await added;   // resolves via the history path
	} finally {
		t.mock.timers.reset();
		console.error = originalError;
	}

	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	eventBus.emit('aa_response', mkRes({ aa_address: 'AA2' }));
	await drain();
	assert.strictEqual(fired, 1, 'history delivery still works after the live timeout');
});

test('a successful live subscription is never re-sent', async () => {
	const hooks = new Hooks(['AA1']);
	await hooks.addWatchedAddress('AA2');
	await hooks.addWatchedAddress('AA2');
	await hooks.addWatchedAddress('AA2');

	// ocore's addLightWatchedAa installs a reconnect listener on every call, so
	// repeating a subscription that already succeeded would leak listeners.
	const forAa2 = networkState.subscriptions.filter(({ aa }) => aa === 'AA2');
	assert.strictEqual(forAa2.length, 1);
});

test('headless_wallet_ready loads and watches configured addresses', async () => {
	const loaded = [];
	dagState.loadAAImpl = (addr) => { loaded.push(addr); return ['autonomous agent', {}]; };
	// eslint-disable-next-line no-new
	new Hooks(['AA1', 'AA2']);
	eventBus.emit('headless_wallet_ready');
	await drain(); // let the async ready-handler run to completion
	await new Promise((r) => setImmediate(r));
	assert.deepStrictEqual(loaded.sort(), ['AA1', 'AA2']);
	assert.deepStrictEqual(walletState.watchCalls.sort(), ['AA1', 'AA2']);
	assert.deepStrictEqual(networkState.subscriptions.map(({ aa }) => aa).sort(), ['AA1', 'AA2']);
});

test('configured addresses initialize when Hooks is constructed after wallet readiness', async () => {
	headlessState.ready = true;
	// eslint-disable-next-line no-new
	new Hooks(['NEW_AA']);
	await new Promise((resolve) => setImmediate(resolve));

	assert.deepStrictEqual(networkState.subscriptions, [{ aa: 'NEW_AA', address: null }]);
	assert.deepStrictEqual(walletState.watchCalls, ['NEW_AA']);
});

test('adding an address before wallet readiness does not duplicate its live subscription', async () => {
	const hooks = new Hooks(['AA1']);
	await hooks.addWatchedAddress('AA2');
	eventBus.emit('headless_wallet_ready');
	await new Promise((resolve) => setImmediate(resolve));

	assert.strictEqual(networkState.subscriptions.filter(({ aa }) => aa === 'AA2').length, 1);
});

test('headless-obyte is never imported; readiness falls back to the event bus', async () => {
	// An application driving ocore directly must not have a wallet booted for it
	// just because it imported this library.
	setHeadlessLoaded(false);
	// eslint-disable-next-line no-new
	new Hooks(['NO_HEADLESS_AA']);
	await new Promise((resolve) => setImmediate(resolve));

	assert.strictEqual(require.cache[require.resolve('headless-obyte')], undefined,
		'constructing Hooks must not load headless-obyte');
	assert.deepStrictEqual(walletState.watchCalls, [], 'nothing is watched before readiness');

	eventBus.emit('headless_wallet_ready');
	await new Promise((resolve) => setImmediate(resolve));

	assert.deepStrictEqual(walletState.watchCalls, ['NO_HEADLESS_AA']);
	assert.deepStrictEqual(networkState.subscriptions, [{ aa: 'NO_HEADLESS_AA', address: null }]);
});

test('close() detaches the instance from the event bus', async () => {
	dagState.joints['BEFORE_CLOSE'] = { unit: { messages: [] } };
	dagState.joints['AFTER_CLOSE'] = { unit: { messages: [] } };
	const responseListenersBefore = eventBus.listenerCount('aa_response');
	const lightListenersBefore = eventBus.listenerCount('message_for_light');

	const hooks = new Hooks(['AA1']);
	let fired = 0;
	hooks.register(() => { fired++; }).isSuccess();
	eventBus.emit('aa_response', mkRes({ trigger_unit: 'BEFORE_CLOSE' }));
	await drain();
	assert.strictEqual(fired, 1);

	hooks.close();
	hooks.close(); // idempotent

	assert.strictEqual(eventBus.listenerCount('aa_response'), responseListenersBefore);
	assert.strictEqual(eventBus.listenerCount('message_for_light'), lightListenersBefore);

	eventBus.emit('aa_response', mkRes({ trigger_unit: 'AFTER_CLOSE' }));
	eventBus.emit('message_for_light', null, 'light/aa_response', mkRes({ trigger_unit: 'AFTER_CLOSE' }));
	await drain();
	assert.strictEqual(fired, 1, 'a closed instance no longer receives responses');

	assert.throws(() => hooks.register(() => {}), /closed Hooks instance/);
});

test('a rejecting loadAA does not crash construction (unhandled rejection guard)', async () => {
	dagState.loadAAImpl = async () => { throw new Error('unknown AA'); };
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => { errors.push(args); };
	// eslint-disable-next-line no-new
	new Hooks(['BADAA']);
	try {
		eventBus.emit('headless_wallet_ready');
		await new Promise((r) => setImmediate(r));
		await new Promise((r) => setImmediate(r));
	} finally {
		console.error = originalError;
	}
	// reaching here without an unhandled rejection is the assertion
	assert.ok(errors.some(([message]) => /failed to load AA definition.*aa=BADAA/.test(message)));
});

test('a watch failure during startup is logged with its address', async () => {
	walletState.watchImpl = (_address, callback) => callback(new Error('watch failed'));
	const errors = [];
	const originalError = console.error;
	console.error = (...args) => { errors.push(args); };
	// eslint-disable-next-line no-new
	new Hooks(['AA1']);
	try {
		eventBus.emit('headless_wallet_ready');
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
	} finally {
		console.error = originalError;
	}

	assert.ok(errors.some(([message]) => /failed to watch address.*aa=AA1/.test(message)));
});
