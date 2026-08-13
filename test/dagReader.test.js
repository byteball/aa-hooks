'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { dagState, networkState, resetDag, enableMockTimers } = require('./mocks');
const { readJoint, readJointFromStorage, requestHistoryFor } = require('../src/dagReader');

beforeEach(() => {
	resetDag();
});

test('readJointFromStorage resolves the joint, or undefined when it is not stored', async () => {
	dagState.joints['STORED'] = { unit: { unit: 'STORED', messages: [] } };

	assert.deepStrictEqual(await readJointFromStorage('STORED'), { unit: { unit: 'STORED', messages: [] } });

	// ocore reports a miss through ifNotFound, which must surface as a value —
	// aabot turns the same case into an uncaughtException and a pending promise.
	assert.strictEqual(await readJointFromStorage('ABSENT'), undefined);
});

test('readJointFromStorage rejects when storage fails outright', async () => {
	dagState.joints['BROKEN'] = 'THROW';
	await assert.rejects(() => readJointFromStorage('BROKEN'), /storage failure: BROKEN/);
});

test('requestHistoryFor resolves once ocore calls back', async () => {
	await requestHistoryFor('WANTED');
	assert.deepStrictEqual(networkState.historyRequests, ['WANTED']);
});

test('requestHistoryFor resolves even when ocore throws synchronously', async () => {
	networkState.historyImpl = () => { throw new Error('light vendor unreachable'); };
	const originalError = console.error;
	console.error = () => {};
	try {
		await requestHistoryFor('WANTED');   // must not reject
	} finally {
		console.error = originalError;
	}
});

test('readJoint asks the light vendor for a unit that is missing locally', async () => {
	networkState.historyImpl = (units, cb) => {
		for (const unit of units) {
			dagState.joints[unit] = { unit: { unit, messages: [] } };
		}
		setImmediate(cb);
	};

	const objJoint = await readJoint('UNSYNCED');

	assert.deepStrictEqual(networkState.historyRequests, ['UNSYNCED']);
	assert.deepStrictEqual(objJoint, { unit: { unit: 'UNSYNCED', messages: [] } });
	assert.strictEqual(dagState.readJointCalls['UNSYNCED'], 2, 'local miss, then a retry');
});

test('readJoint does not ask for history when the unit is already stored', async () => {
	dagState.joints['LOCAL'] = { unit: { unit: 'LOCAL', messages: [] } };

	await readJoint('LOCAL');

	assert.deepStrictEqual(networkState.historyRequests, []);
	assert.strictEqual(dagState.readJointCalls['LOCAL'], 1);
});

test('readJoint resolves to undefined when the vendor cannot supply the unit', async () => {
	const objJoint = await readJoint('NOWHERE');

	assert.strictEqual(objJoint, undefined);
	assert.deepStrictEqual(networkState.historyRequests, ['NOWHERE']);
});

test('readJoint rejects instead of hanging when the vendor never answers', async (t) => {
	networkState.historyImpl = () => {};   // callback is never invoked

	enableMockTimers(t);
	try {
		const reading = readJoint('STUCK');
		const settled = assert.rejects(() => reading, /timed out reading trigger=STUCK/);
		await Promise.resolve();
		t.mock.timers.tick(30000);
		await settled;
	} finally {
		t.mock.timers.reset();
	}
});
