import { Hooks } from '..';

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

const controller = recentHooks.register(async (_triggerUnit, _responseObj) => {});

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

parallelHooks.addWatchedAddress('AA3');
