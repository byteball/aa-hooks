'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { Hooks, eventBus, dagState, resetDag, drain } = require('./mocks');

// Each test drives events on the shared bus; start from a single listener so
// results are attributable to the Hooks instance under test.
beforeEach(() => {
	eventBus.removeAllListeners('aa_response');
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
	const hooks = new Hooks(['AA1']);
	let before = 0, after = 0;
	hooks.register(() => { before++; }).aaAddressIs('AA1');
	hooks.register(() => { throw new Error('boom'); }).aaAddressIs('AA1');
	hooks.register(() => { after++; }).aaAddressIs('AA1');

	eventBus.emit('aa_response', mkRes());
	await drain();
	assert.strictEqual(before, 1);
	assert.strictEqual(after, 1, 'sibling after the throwing hook still fired');

	// mutex must have been released -> a second event is processed normally
	eventBus.emit('aa_response', mkRes());
	await drain();
	assert.strictEqual(before, 2, 'no deadlock: next response processed');
});

test('missing trigger unit (readJoint throws) is handled gracefully', async () => {
	dagState.joints['GONE'] = 'THROW';
	const hooks = new Hooks(['AA1']);
	let fired = 0;
	// filter needs the (missing) trigger unit -> should simply not match
	hooks.register(() => {}).triggerDataContainsKey('symbol');
	// this one does not need the unit -> must still fire
	hooks.register(() => { fired++; }).aaAddressIs('AA1');

	eventBus.emit('aa_response', mkRes({ trigger_unit: 'GONE' }));
	await drain();
	assert.strictEqual(fired, 1);
});

test('remove() stops a hook from firing', async () => {
	const hooks = new Hooks(['AA1']);
	let n = 0;
	const hook = hooks.register(() => { n++; }).aaAddressIs('AA1');

	eventBus.emit('aa_response', mkRes());
	await drain();
	assert.strictEqual(n, 1);

	hook.remove();
	eventBus.emit('aa_response', mkRes());
	await drain();
	assert.strictEqual(n, 1, 'removed hook no longer fires');
});

test('newEventsOnly: true ignores events older than construction time', async () => {
	const hooks = new Hooks(['AA1'], { newEventsOnly: true });
	let n = 0;
	hooks.register(() => { n++; }).aaAddressIs('AA1');

	eventBus.emit('aa_response', mkRes({ timestamp: 1 }));      // far in the past
	await drain();
	assert.strictEqual(n, 0);

	eventBus.emit('aa_response', mkRes({ timestamp: 2e12 }));   // in the future
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

test('addWatchedAddress resolves without throwing', async () => {
	const hooks = new Hooks(['AA1']);
	await assert.doesNotReject(() => hooks.addWatchedAddress('AA2'));
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
});

test('a rejecting loadAA does not crash construction (unhandled rejection guard)', async () => {
	dagState.loadAAImpl = async () => { throw new Error('unknown AA'); };
	// eslint-disable-next-line no-new
	new Hooks(['BADAA']);
	eventBus.emit('headless_wallet_ready');
	await new Promise((r) => setImmediate(r));
	await new Promise((r) => setImmediate(r));
	// reaching here without an unhandled rejection is the assertion
	assert.ok(true);
});
