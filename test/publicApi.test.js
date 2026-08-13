'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { Hooks, HookController } = require('./mocks');
const commonJsApi = require('../src');

const EXPECTED_HOOKS_METHODS = {
	readTriggerUnit: 1,
	removeController: 1,
	register: 1,
	addWatchedAddress: 1,
	close: 0,
};

const EXPECTED_CONTROLLER_METHODS = {
	getTriggerUnit: 1,
	aaAddressIs: 1,
	triggerAddressIs: 1,
	triggerUnitIs: 1,
	baseAaIs: 1,
	responseContainsKey: 1,
	responseKeyIs: 2,
	responseKeyLessThan: 2,
	responseKeyMoreThan: 2,
	triggerDataExists: 0,
	triggerDataContainsKey: 1,
	triggerDataKeyIs: 2,
	triggerDataKeyLessThan: 2,
	triggerDataKeyMoreThan: 2,
	isSuccess: 0,
	isBounced: 0,
	responseOutputsAmountIs: 3,
	responseOutputsAmountLessThan: 3,
	responseOutputsAmountMoreThan: 3,
	sentAmountLessThan: 3,
	sentAmountMoreThan: 3,
	sentAmountIs: 3,
	customFilter: 1,
	remove: 0,
};

function assertMethods(ctor, expectedMethods) {
	for (const [method, arity] of Object.entries(expectedMethods)) {
		assert.strictEqual(typeof ctor.prototype[method], 'function', `${method} must remain public`);
		assert.strictEqual(ctor.prototype[method].length, arity, `${method} arity changed`);
	}
}

test('CommonJS and native ESM keep the named Hooks export', async () => {
	assert.strictEqual(commonJsApi.Hooks, Hooks);
	const esmApi = await import('../src/index.js');
	assert.strictEqual(esmApi.Hooks, Hooks);
});

test('the 1.0.2 public runtime surface remains available', () => {
	assert.strictEqual(Hooks.length, 1);
	assert.strictEqual(HookController.length, 3);
	assertMethods(Hooks, EXPECTED_HOOKS_METHODS);
	assertMethods(HookController, EXPECTED_CONTROLLER_METHODS);

	const notDescriptor = Object.getOwnPropertyDescriptor(HookController.prototype, 'not');
	assert.strictEqual(typeof notDescriptor?.get, 'function');
});
