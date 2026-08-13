'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const {
	formatResponseContext,
	getResponseKey,
	toError,
	trimOldest,
	withTimeout,
} = require('../src/utils');

test('response helpers format context and identity consistently', () => {
	const response = {
		aa_address: 'AA1',
		trigger_unit: 'TRIGGER',
		response_unit: 'RESPONSE',
	};

	assert.strictEqual(formatResponseContext(response), 'aa=AA1, trigger=TRIGGER, response=RESPONSE');
	assert.strictEqual(formatResponseContext(), 'aa=<missing>, trigger=<missing>, response=<none>');
	assert.strictEqual(getResponseKey(response), 'AA1:TRIGGER');
	assert.strictEqual(getResponseKey({ aa_address: 'AA1' }), undefined);
});

test('toError preserves Error instances and normalizes callback errors', () => {
	const error = new Error('failure');
	assert.strictEqual(toError(error), error);
	assert.match(toError('failure').message, /failure/);
});

test('trimOldest supports insertion-ordered Maps and Sets', () => {
	const map = new Map([['a', 1], ['b', 2], ['c', 3]]);
	const set = new Set(['a', 'b', 'c']);

	trimOldest(map, 2);
	trimOldest(set, 1);

	assert.deepStrictEqual([...map.keys()], ['b', 'c']);
	assert.deepStrictEqual([...set], ['c']);
});

test('event logger writes to stdout even when console.log is redirected', () => {
	const result = spawnSync(process.execPath, ['-e', [
		"const { createEventLogger } = require('./src/utils')",
		'console.log = () => {}',
		"createEventLogger(true)('visible')",
		"createEventLogger(false)('hidden')",
	].join(';')], {
		cwd: path.resolve(__dirname, '..'),
		encoding: 'utf8',
	});

	assert.strictEqual(result.status, 0, result.stderr);
	assert.strictEqual(result.stdout, 'visible\n');
});

test('withTimeout resolves, rejects, or gives up after the bound', async () => {
	// Real timers here on purpose: this is the guard that keeps a silent ocore
	// callback from wedging an instance, so it must be verified on every Node
	// version, including those without the node:test mock timer API.
	assert.strictEqual(await withTimeout(Promise.resolve('ok'), 1000, 'too slow'), 'ok');

	await assert.rejects(
		() => withTimeout(Promise.reject(new Error('original failure')), 1000, 'too slow'),
		/original failure/,
		'a real rejection is passed through rather than masked by the timeout',
	);

	// The timeout timer is unref'd so a pending read cannot hold a shutting-down
	// process open, which also means it only fires while the loop has other work.
	// A real node always has sockets and a database keeping it alive; this test
	// has to supply that itself, or the loop drains before the timer runs.
	const keepAlive = setTimeout(() => {}, 5000);
	try {
		await assert.rejects(
			() => withTimeout(new Promise(() => {}), 25, 'too slow'),
			/too slow/,
			'a promise that never settles is rejected with the given message',
		);
	} finally {
		clearTimeout(keepAlive);
	}
});
