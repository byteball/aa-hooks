import { Hooks } from '..';
import * as AaHooksNamespace from '..';
import AaHooksRequire = require('..');

interface TypedResponse {
	aa_address: string;
	bounced: number;
}

interface TypedMeta {
	payload?: { symbol?: string };
	trigger_unit?: { unit?: string };
}

const recentHooks = new Hooks(['AA1'], { newEventsOnly: true });
const parallelHooks = new Hooks(['AA2'], { parallelProcessing: true });
const diagnosticHooks = new Hooks(['AA3'], { logEvents: true });
const customLoggerHooks = new Hooks(['AA3'], { logEvents: true, logger: console.log });
const namespaceHooks = new AaHooksNamespace.Hooks(['AA4']);
const requireHooks = new AaHooksRequire.Hooks(['AA5']);

const controller = recentHooks.register(async (_triggerUnit, _responseObj) => {});
// getTriggerUnit was loosely typed in 1.0.2 and remains so for source compatibility.
const legacyTriggerUnit = controller.getTriggerUnit(123);
legacyTriggerUnit.then((unit) => unit.legacyField);

controller
	.aaAddressIs('AA1')
	.triggerAddressIs('ADDRESS')
	.triggerUnitIs('UNIT')
	.baseAaIs('BASE_AA')
	.responseContainsKey('key')
	.responseKeyIs('key', 'value')
	.responseKeyLessThan('key', 10)
	.responseKeyMoreThan('key', 1)
	.triggerDataExists()
	.triggerDataContainsKey('key')
	.triggerDataKeyIs('key', 'value')
	.triggerDataKeyLessThan('key', 10)
	.triggerDataKeyMoreThan('key', 1)
	.isSuccess()
	.isBounced()
	.responseOutputsAmountIs(1, 'base')
	.responseOutputsAmountLessThan(2, 'base', 'ADDRESS')
	.responseOutputsAmountMoreThan(0, 'base')
	.sentAmountLessThan('base', 2)
	.sentAmountMoreThan('base', 0, 'ADDRESS')
	.sentAmountIs('base', 1)
	.not.aaAddressIs('OTHER')
	.customFilter(async (response, meta) => {
		return typeof response.aa_address === 'string' && !!meta.payload?.symbol;
	}, ['payload', 'future_meta_key'])
	.customFilter(async (response: TypedResponse, meta: TypedMeta) => {
		return response.bounced === 0 && !!meta.payload?.symbol;
	}, ['payload', 'trigger_unit'])
	.remove();

// Both the legacy two-argument form and the address-specific form are public API.
controller
	.responseOutputsAmountIs(1, 'base', 'ADDRESS')
	.responseOutputsAmountLessThan(2, 'base')
	.responseOutputsAmountMoreThan(0, 'base', 'ADDRESS')
	.sentAmountLessThan('base', 2, 'ADDRESS')
	.sentAmountMoreThan('base', 0)
	.sentAmountIs('base', 1, 'ADDRESS');

parallelHooks.addWatchedAddress('AA3');
diagnosticHooks.addWatchedAddress('AA4');
customLoggerHooks.addWatchedAddress('AA4');
namespaceHooks.addWatchedAddress('AA5');
requireHooks.addWatchedAddress('AA6');

// Detaching an instance from the event bus.
const closable: void = parallelHooks.close();
