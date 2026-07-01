'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { Hooks, dagState, resetDag } = require('./mocks');

// One shared instance is enough: every register() gets a unique id, so the
// filters of different controllers never collide. We inspect predicates via the
// public `filters` map and call them directly.
const hooks = new Hooks([], { newEventsOnly: false });

// Return the predicate + opposite flag of the last filter added to a controller.
function last(controller) {
	const arr = hooks.filters[controller.id];
	return arr[arr.length - 1];
}
const predOf = (c) => last(c).filter;

// Build a controller carrying a single filter, applied by `fn`.
function withFilter(fn) {
	const c = hooks.register(() => {});
	fn(c);
	return c;
}

// Trigger unit whose data message carries `payload`.
function jointWithData(payload) {
	return { unit: { messages: [{ app: 'data', payload }] } };
}
// Trigger unit carrying payment outputs.
function jointWithPayments(outputs) {
	return { unit: { messages: [{ app: 'payment', payload: { outputs } }] } };
}

test('aaAddressIs', async () => {
	const p = predOf(withFilter((c) => c.aaAddressIs('AA1')));
	assert.strictEqual(!!(await p({ aa_address: 'AA1' })), true);
	assert.strictEqual(!!(await p({ aa_address: 'OTHER' })), false);
});

test('triggerAddressIs', async () => {
	const p = predOf(withFilter((c) => c.triggerAddressIs('SENDER')));
	assert.strictEqual(!!(await p({ trigger_address: 'SENDER' })), true);
	assert.strictEqual(!!(await p({ trigger_address: 'X' })), false);
});

test('triggerUnitIs', async () => {
	const p = predOf(withFilter((c) => c.triggerUnitIs('U1')));
	assert.strictEqual(!!(await p({ trigger_unit: 'U1' })), true);
	assert.strictEqual(!!(await p({ trigger_unit: 'U2' })), false);
});

test('baseAaIs', async () => {
	resetDag();
	dagState.defs['AA1'] = ['autonomous agent', { base_aa: 'BASE1' }];
	dagState.defs['AA2'] = ['autonomous agent', {}];      // no base_aa
	const p = predOf(withFilter((c) => c.baseAaIs('BASE1')));
	assert.strictEqual(!!(await p({ aa_address: 'AA1' })), true);
	assert.strictEqual(!!(await p({ aa_address: 'AA2' })), false);
});

test('baseAaIs does not throw on unknown / failing definition', async () => {
	resetDag();
	dagState.defs['GHOST'] = undefined; // readAADefinition -> undefined
	dagState.defs['BAD'] = 'THROW';     // readAADefinition rejects
	const p = predOf(withFilter((c) => c.baseAaIs('BASE1')));
	assert.strictEqual(!!(await p({ aa_address: 'GHOST' })), false);
	assert.strictEqual(!!(await p({ aa_address: 'BAD' })), false);
});

test('responseContainsKey', async () => {
	const p = predOf(withFilter((c) => c.responseContainsKey('price')));
	assert.strictEqual(!!(await p({ response: { responseVars: { price: 5 } } })), true);
	assert.strictEqual(!!(await p({ response: { responseVars: { other: 1 } } })), false);
	assert.strictEqual(!!(await p({ response: {} })), false);
	assert.strictEqual(!!(await p({})), false);
});

test('responseKeyIs', async () => {
	const p = predOf(withFilter((c) => c.responseKeyIs('status', 'ok')));
	assert.strictEqual(!!(await p({ response: { responseVars: { status: 'ok' } } })), true);
	assert.strictEqual(!!(await p({ response: { responseVars: { status: 'no' } } })), false);
	assert.strictEqual(!!(await p({ response: { responseVars: {} } })), false);
});

test('responseKeyLessThan / responseKeyMoreThan', async () => {
	const lt = predOf(withFilter((c) => c.responseKeyLessThan('n', 10)));
	assert.strictEqual(!!(await lt({ response: { responseVars: { n: 5 } } })), true);
	assert.strictEqual(!!(await lt({ response: { responseVars: { n: 15 } } })), false);
	assert.strictEqual(!!(await lt({ response: { responseVars: {} } })), false);

	const gt = predOf(withFilter((c) => c.responseKeyMoreThan('n', 10)));
	assert.strictEqual(!!(await gt({ response: { responseVars: { n: 15 } } })), true);
	assert.strictEqual(!!(await gt({ response: { responseVars: { n: 5 } } })), false);
});

test('triggerDataExists', async () => {
	resetDag();
	dagState.joints['HAS'] = jointWithData({ a: 1 });
	dagState.joints['EMPTY'] = jointWithData({});
	dagState.joints['NODATA'] = { unit: { messages: [{ app: 'payment', payload: { outputs: [] } }] } };
	const p = predOf(withFilter((c) => c.triggerDataExists()));
	assert.strictEqual(!!(await p({ trigger_unit: 'HAS' })), true);
	assert.strictEqual(!!(await p({ trigger_unit: 'EMPTY' })), false);
	assert.strictEqual(!!(await p({ trigger_unit: 'NODATA' })), false);
	assert.strictEqual(!!(await p({})), false); // no trigger_unit
});

test('triggerDataContainsKey', async () => {
	resetDag();
	dagState.joints['U_contains'] = jointWithData({ symbol: 'ETH', decimals: 8 });
	const p = predOf(withFilter((c) => c.triggerDataContainsKey('symbol')));
	assert.strictEqual(!!(await p({ trigger_unit: 'U_contains' })), true);
	const p2 = predOf(withFilter((c) => c.triggerDataContainsKey('missing')));
	assert.strictEqual(!!(await p2({ trigger_unit: 'U_contains' })), false);
});

test('triggerDataKeyIs', async () => {
	resetDag();
	dagState.joints['U_keyis'] = jointWithData({ symbol: 'ETH' });
	const p = predOf(withFilter((c) => c.triggerDataKeyIs('symbol', 'ETH')));
	assert.strictEqual(!!(await p({ trigger_unit: 'U_keyis' })), true);
	const p2 = predOf(withFilter((c) => c.triggerDataKeyIs('symbol', 'BTC')));
	assert.strictEqual(!!(await p2({ trigger_unit: 'U_keyis' })), false);
});

test('triggerDataKeyLessThan / triggerDataKeyMoreThan', async () => {
	resetDag();
	dagState.joints['U_num'] = jointWithData({ amount: 100 });
	const lt = predOf(withFilter((c) => c.triggerDataKeyLessThan('amount', 200)));
	assert.strictEqual(!!(await lt({ trigger_unit: 'U_num' })), true);
	const lt2 = predOf(withFilter((c) => c.triggerDataKeyLessThan('amount', 50)));
	assert.strictEqual(!!(await lt2({ trigger_unit: 'U_num' })), false);

	const gt = predOf(withFilter((c) => c.triggerDataKeyMoreThan('amount', 50)));
	assert.strictEqual(!!(await gt({ trigger_unit: 'U_num' })), true);
	const gt2 = predOf(withFilter((c) => c.triggerDataKeyMoreThan('amount', 200)));
	assert.strictEqual(!!(await gt2({ trigger_unit: 'U_num' })), false);
});

test('isSuccess / isBounced', async () => {
	const ok = predOf(withFilter((c) => c.isSuccess()));
	assert.strictEqual(!!(await ok({ bounced: 0 })), true);
	assert.strictEqual(!!(await ok({ bounced: 1 })), false);

	const bad = predOf(withFilter((c) => c.isBounced()));
	assert.strictEqual(!!(await bad({ bounced: 1 })), true);
	assert.strictEqual(!!(await bad({ bounced: 0 })), false);
});

test('responseOutputsAmountIs / LessThan / MoreThan (base asset + address filter)', async () => {
	const res = {
		objResponseUnit: {
			messages: [{
				app: 'payment',
				payload: { outputs: [ { address: 'R1', amount: 100 }, { address: 'R2', amount: 50 } ] },
			}],
		},
	};
	// base asset: outputs have no `asset` field
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountIs(150, 'base')))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountIs(999, 'base')))(res)), false);
	// address-scoped sum
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountIs(100, 'base', 'R1')))(res)), true);
	// less / more than
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountLessThan(200, 'base')))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountMoreThan(100, 'base')))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountMoreThan(200, 'base')))(res)), false);
});

test('responseOutputsAmountIs (custom asset)', async () => {
	const res = {
		objResponseUnit: {
			messages: [{
				app: 'payment',
				payload: { outputs: [ { address: 'R1', amount: 42, asset: 'ASSET1' } ] },
			}],
		},
	};
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountIs(42, 'ASSET1')))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.responseOutputsAmountIs(42, 'base')))(res)), false);
});

test('sentAmountIs / LessThan / MoreThan', async () => {
	resetDag();
	dagState.joints['S1'] = jointWithPayments([ { address: 'AA1', amount: 300 } ]);
	const res = { trigger_unit: 'S1' };
	assert.strictEqual(!!(await predOf(withFilter((c) => c.sentAmountIs('base', 300)))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.sentAmountIs('base', 1)))(res)), false);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.sentAmountLessThan('base', 400)))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.sentAmountMoreThan('base', 100)))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.sentAmountMoreThan('base', 400)))(res)), false);
	// address-scoped
	assert.strictEqual(!!(await predOf(withFilter((c) => c.sentAmountIs('base', 300, 'AA1')))(res)), true);
	assert.strictEqual(!!(await predOf(withFilter((c) => c.sentAmountIs('base', 300, 'OTHER')))(res)), false);
});

test('customFilter returns the boolean result', async () => {
	const yes = predOf(withFilter((c) => c.customFilter(() => true)));
	assert.strictEqual(await yes({}), true);
	const no = predOf(withFilter((c) => c.customFilter(() => false)));
	assert.strictEqual(await no({}), false);
});

test('customFilter throws when the filter does not return a boolean', async () => {
	const bad = predOf(withFilter((c) => c.customFilter(() => 'nope')));
	await assert.rejects(() => bad({}), /filter must return a boolean/);
});

test('customFilter receives requested meta (payload + trigger_unit)', async () => {
	resetDag();
	dagState.joints['U_meta'] = jointWithData({ k: 'v' });
	let seen;
	const p = predOf(withFilter((c) => c.customFilter(async (res, meta) => {
		seen = meta;
		return true;
	}, ['payload', 'trigger_unit'])));
	await p({ trigger_unit: 'U_meta' });
	assert.deepStrictEqual(seen.payload, { k: 'v' });
	assert.ok(seen.trigger_unit && seen.trigger_unit.messages);
});

test('not inverts the next filter and resets afterwards', async () => {
	const c = hooks.register(() => {});
	c.not.aaAddressIs('AA1');   // opposite = true for this filter
	c.triggerUnitIs('U1');      // opposite must be back to false
	const arr = hooks.filters[c.id];
	assert.strictEqual(arr[0].opposite, true, 'first filter marked opposite');
	assert.strictEqual(arr[1].opposite, false, 'opposite flag reset after use');
});

test('filter methods are chainable (return the controller)', () => {
	const c = hooks.register(() => {});
	assert.strictEqual(c.isSuccess(), c);
	assert.strictEqual(c.aaAddressIs('AA1'), c);
	assert.strictEqual(c.not, c);
});
