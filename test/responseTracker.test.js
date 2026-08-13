'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { ResponseTracker, RESPONSE_STATE } = require('../src/responseTracker');

function response(triggerUnit, overrides = {}) {
	return {
		aa_address: 'AA1',
		trigger_unit: triggerUnit,
		...overrides,
	};
}

test('completed responses are recognized as duplicates', () => {
	const tracker = new ResponseTracker();
	const res = response('U1');
	const first = tracker.begin(res, 'live');

	assert.strictEqual(first.state, RESPONSE_STATE.STARTED);
	assert.strictEqual(tracker.finish(first.key, true), undefined);
	assert.strictEqual(tracker.begin(res, 'history').state, RESPONSE_STATE.DUPLICATE);
});

test('an in-flight duplicate is deferred and returned for an incomplete retry', () => {
	const tracker = new ResponseTracker();
	const live = response('U1', { bounced: false });
	const history = response('U1', { bounced: 0 });
	const first = tracker.begin(live, 'light/aa_response');

	assert.strictEqual(tracker.begin(history, 'aa_response').state, RESPONSE_STATE.DEFERRED);
	assert.deepStrictEqual(tracker.finish(first.key, false), {
		res: history,
		source: 'aa_response',
	});
	assert.strictEqual(tracker.begin(history, 'aa_response').state, RESPONSE_STATE.STARTED);
});

test('completed hook ids survive an incomplete response retry', () => {
	const tracker = new ResponseTracker();
	const first = tracker.begin(response('U1'), 'live');

	tracker.markHookCompleted(first.key, 'hook-1');
	assert.strictEqual(tracker.hasCompletedHook(first.key, 'hook-1'), true);
	tracker.finish(first.key, false);
	assert.strictEqual(tracker.hasCompletedHook(first.key, 'hook-1'), true);

	const retry = tracker.begin(response('U1'), 'history');
	tracker.finish(retry.key, true);
	assert.strictEqual(tracker.hasCompletedHook(retry.key, 'hook-1'), false);
});

test('pending responses are bounded and duplicate keys replace in place', () => {
	const tracker = new ResponseTracker({ pending: 2 });

	assert.strictEqual(tracker.queuePending(response('U1'), 'live'), false);
	assert.strictEqual(tracker.queuePending(response('U1', { version: 2 }), 'history'), false);
	assert.strictEqual(tracker.queuePending(response('U2'), 'live'), false);
	assert.strictEqual(tracker.queuePending(response('U3'), 'live'), true);

	assert.deepStrictEqual(
		tracker.takePending().map(({ res }) => res.trigger_unit),
		['U2', 'U3'],
	);
	assert.strictEqual(tracker.hasPending(), false);
});

test('responses without an identity key are processed independently', () => {
	const tracker = new ResponseTracker();
	const first = tracker.begin({}, 'live');
	const second = tracker.begin({}, 'history');

	assert.strictEqual(first.state, RESPONSE_STATE.STARTED);
	assert.strictEqual(second.state, RESPONSE_STATE.STARTED);
	assert.strictEqual(first.key, undefined);
	assert.strictEqual(second.key, undefined);
});
