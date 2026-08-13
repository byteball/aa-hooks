
![AA hooks](/public/img.svg)

# aa-hooks

A small library for reacting to [Obyte](https://obyte.org) Autonomous Agent (AA) responses. You watch one or more AA addresses, describe the responses you care about with a chain of filters, and get a callback whenever a matching response appears on the DAG.

It runs inside an [ocore](https://github.com/byteball/ocore)/headless-wallet process and uses [aabot](https://github.com/byteball/aabot) to read the DAG.

## Installation

```sh
npm install aa-hooks
# or
yarn add aa-hooks
```

`ocore` is a **peer dependency** (it must be a single shared instance in your app, alongside your headless wallet), so install it too if it isn't already present:

```sh
npm install ocore
```

`headless-obyte` is an **optional peer dependency**. Importing `aa-hooks` never loads it — that would boot a wallet as a side effect of a bare `require` (reading or creating `keys.json`, possibly prompting for a passphrase, connecting to the hub, and redirecting `console.log`). If your application loads it, `aa-hooks` detects that and uses its readiness state; otherwise it simply waits for the `headless_wallet_ready` event on ocore's event bus.

Requires Node.js 16.9+ (the test suite requires Node 18+).

## Quick start

```js
const { Hooks } = require("aa-hooks");

// Watch a set of AA addresses
const hooks = new Hooks(["O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ"], {
    newEventsOnly: false,     // default: false — also process past responses
    parallelProcessing: false, // default: false — process responses one at a time
    logEvents: false           // set true to log delivery source and match decisions
});

const onNewSymbol = async (triggerUnit, responseObj) => {
    const symbol = triggerUnit.messages.find((m) => m.app === "data")?.payload?.symbol;
    console.error("New symbol registered:", symbol);
    console.error("Response unit:", responseObj.response_unit);

    await hooks.addWatchedAddress("..."); // start watching another AA at runtime
};

// Register a hook: the callback fires only when ALL filters pass
hooks.register(onNewSymbol)
    .isSuccess()
    .triggerDataContainsKey("symbol")
    .triggerDataContainsKey("asset")
    .triggerDataContainsKey("drawer")
    .not.triggerDataContainsKey("decimals"); // `.not` negates the next filter only
```

The callback receives `(triggerUnit, responseObj)`:

- `triggerUnit` — the full unit that triggered the AA (see the example below), or `{}` if it can't be read.
- `responseObj` — the AA response object (see the example below).

## How it works

- **Filters are combined with AND.** A hook fires only if every filter in its chain passes.
- **`.not` negates the next filter only**, then the chain continues normally.
- **Every matching hook fires.** If several registered hooks match the same response, all of their callbacks run.
- **Light clients use two delivery paths.** Each AA is subscribed through `light/new_aa_to_watch` for immediate `light/aa_response` notifications and is also persisted as a history watch.
- **Duplicate live/history delivery is safe.** A response is deduplicated by `(aa_address, trigger_unit)`, the same uniqueness key used by ocore's `aa_responses` table. The delivery guarantee is at-least-once: the set of already-delivered responses is bounded at 5000 entries, so a third delivery arriving after more than 5000 further responses would run the callbacks again.
- **Startup events are buffered.** A response received before the first hook is registered is retained until synchronous hook/filter registration finishes, and it is delivered ahead of responses that arrive afterwards.
- **Serial by default.** Responses are processed one at a time within each `Hooks` instance, and separate instances watching the same AA are serialized too. Instances that watch different AAs do not block each other. Set `parallelProcessing: true` to opt out for that instance.
- **Errors are contained.** An error thrown by a filter or a callback is caught and logged — it never freezes processing or stops the other hooks.
- **Trigger units are cached** in a bounded cache per `Hooks` instance, so the same unit is read from the DAG only once while multiple filters and callbacks process it. A unit missing from local storage is requested from the light vendor and re-read once; if it is still unavailable, unit-independent hooks run anyway and the unit-dependent ones are retried on the next delivery of the same response.
- **No foreign call can stall an instance.** Reads of trigger units and AA definitions are bounded by a timeout. ocore and aabot report some failures by throwing from an asynchronous callback, which leaves their promise pending forever; without the timeout that would hold the response mutex and silently stop the instance.
- **Filters decline on unknown data rather than guessing.** A filter that needs the trigger unit or the response unit does not match when that unit cannot be read, instead of treating it as empty.

Internally, `Hooks` is a facade over four focused components: an AA subscription manager for live/history delivery, a DAG reader that turns ocore's callback API into promises that always settle, a read-through trigger-unit repository layered on top of it, and a response lifecycle tracker for buffering, deduplication, and retry state. `HookController` remains the fluent filter builder.

## API

### `new Hooks(addresses, config?)`

| Argument | Type | Description |
| --- | --- | --- |
| `addresses` | `string[]` | AA addresses to watch. |
| `config.newEventsOnly` | `boolean` | Default `false`. When `true`, only responses with a timestamp at/after construction time are processed. |
| `config.parallelProcessing` | `boolean` | Default `false`. When `true`, responses are handled concurrently instead of one at a time. |
| `config.logEvents` | `boolean` | Default `false`. Logs live subscription requests, incoming source (`light/aa_response` or `aa_response`), deduplication, startup buffering, responses skipped by `newEventsOnly`, and the number of matching hooks. Diagnostic logs go directly to stdout so `headless-obyte` cannot redirect them. Genuine anomalies (malformed `timestamp` or `bounced`, a full buffer, failed reads) are always logged as warnings or errors. |
| `config.logger` | `(message: string) => void` | Optional diagnostic log handler used when `logEvents` is enabled. Useful for Pino, Winston, or tests. |

### `hooks.register(callback) → HookController`

Creates a hook and returns its controller so you can chain filters. `callback` is `(triggerUnit, responseObj) => void | Promise<void>`.

### `hooks.addWatchedAddress(address) → Promise<void>`

Loads an AA definition and starts watching the address at runtime through both live AA notifications and history synchronization on light clients. Rejects if the definition can't be loaded, or if neither delivery path can be established — an address that was already being watched stays watched in that case. A live subscription that fails is retried by a later call; one that succeeded is never re-sent.

### `hooks.close()`

Detaches the instance from ocore's event bus and drops its hooks, so a long-lived process can discard a `Hooks` instance without leaking event listeners. Idempotent; `register()` throws afterwards. ocore offers no way to unwatch an AA, so the underlying subscriptions remain in place.

### `controller.remove()`

Unregisters the hook: it stops receiving events and its filters are released.

## Filters

All filters return the controller, so they are chainable. Prefix any filter with `.not` to negate it.

### AA / address / unit

| Filter | Matches when |
| --- | --- |
| `aaAddressIs(address)` | the response is from AA `address`. |
| `triggerAddressIs(address)` | the trigger unit was sent by `address`. |
| `triggerUnitIs(unit)` | the trigger unit hash equals `unit`. |
| `baseAaIs(address)` | the responding AA's `base_aa` equals `address`. |

### Response status

| Filter | Matches when |
| --- | --- |
| `isSuccess()` | the response did not bounce (`bounced === false` live or `bounced === 0` from storage). |
| `isBounced()` | the response bounced (`bounced === true` live or `bounced === 1` from storage). |

### Response variables (`response.responseVars`)

| Filter | Matches when |
| --- | --- |
| `responseContainsKey(key)` | `key` exists in the response vars. |
| `responseKeyIs(key, value)` | `responseVars[key] === value`. |
| `responseKeyLessThan(key, value)` | `responseVars[key] < value`. |
| `responseKeyMoreThan(key, value)` | `responseVars[key] > value`. |

### Trigger data (the `data` message of the trigger unit)

Key filters test **own keys only**, so an inherited name such as `toString` or `constructor` never matches.

| Filter | Matches when |
| --- | --- |
| `triggerDataExists()` | the trigger unit has a non-empty `data` payload. |
| `triggerDataContainsKey(key)` | `key` exists in the trigger data. |
| `triggerDataKeyIs(key, value)` | `data[key] === value`. |
| `triggerDataKeyLessThan(key, value)` | `data[key] < value`. |
| `triggerDataKeyMoreThan(key, value)` | `data[key] > value`. |

### Amounts sent to the AA (outputs of the trigger unit)

Note the argument order: **`asset` comes first**.

| Filter | Matches when |
| --- | --- |
| `sentAmountIs(asset, value, address?)` | the amount of `asset` sent equals `value`. |
| `sentAmountLessThan(asset, value, address?)` | the amount of `asset` sent is `< value`. |
| `sentAmountMoreThan(asset, value, address?)` | the amount of `asset` sent is `> value`. |

### Amounts paid out by the AA (outputs of the response unit)

Note the argument order: **`value` comes first**. A response whose `response_unit` is set but whose unit could not be read matches none of these filters, since the amount is unknown; a response that posted no unit at all is evaluated against `0`.

| Filter | Matches when |
| --- | --- |
| `responseOutputsAmountIs(value, asset, address?)` | the amount of `asset` paid out equals `value`. |
| `responseOutputsAmountLessThan(value, asset, address?)` | the amount of `asset` paid out is `< value`. |
| `responseOutputsAmountMoreThan(value, asset, address?)` | the amount of `asset` paid out is `> value`. |

For the amount filters:

- `value` is an integer in the asset's smallest unit (e.g. bytes for GBYTE).
- `asset` is an asset id; use `"base"`, `"GBYTE"`, or `"bytes"` for the base currency.
- `address` is optional — when given, only outputs to that address are summed.

### Custom filter

`customFilter(filter, metaKeys?)` runs your own predicate. It **must** return a boolean (otherwise it throws). Request extra context via `metaKeys`:

```js
hooks.register(handler)
    .isSuccess()
    .customFilter(async (responseObj, meta) => {
        const { payload, trigger_unit } = meta; // only the keys you requested
        return payload.symbol?.startsWith("ETH");
    }, ["payload", "trigger_unit"]) // available meta keys: "payload", "trigger_unit"
    .triggerDataContainsKey("symbol");
```

### `.not`

Negates the **next** filter in the chain:

```js
hooks.register(handler)
    .isSuccess()
    .not.triggerDataContainsKey("decimals"); // fires when `decimals` is NOT present
```

<details>
  <summary>Example triggerUnit</summary>

  ```json
{
	"version": "3.0t",
	"alt": "2",
	"messages": [
		{
			"app": "data",
			"payload_location": "inline",
			"payload": {
				"asset": "tZgXWTAv+1v1Ow4pMEVFFNlZAobGxMm2kIcr2dVR68c=",
				"symbol": "ETH3",
				"decimals": 8,
				"description": "ETH on Obyte"
			},
			"payload_hash": "SLL9ew+vIImeuk88nh78xav/kNsp5DgvZU/JwW8g+9w="
		},
		{
			"app": "payment",
			"payload_location": "inline",
			"payload_hash": "aEoZ8aNjru503wcW8D2FtfEVlJ0vI8H138afFegz5kI=",
			"payload": {
				"inputs": [
					{
						"unit": "EgJcb2OejlGnCceBGy/ToQMl4AGJpcMfnvzqLA7le+k=",
						"message_index": 0,
						"output_index": 1
					}
				],
				"outputs": [
					{
						"address": "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ",
						"amount": 100000000
					},
					{
						"address": "TNM2YRTJOANVGXMCFOH2FBVC3KYHZ4O6",
						"amount": 999999047
					}
				]
			}
		}
	],
	"authors": [
		{
			"address": "TNM2YRTJOANVGXMCFOH2FBVC3KYHZ4O6",
			"authentifiers": {
				"r": "eypr8bDqB5GGj+yVZgGJajMtUfrI6KxFBFh+olGG6XF8EaBtSsss4sryd45oBU7TZB1L9QWZRJeHKWytoIPQRQ=="
			}
			}
	],
	"parent_units": [
		"v+Yp106wJ03H5B/iUET6qIL4ZA/urwckH9y2iaRdnN4="
	],
	"last_ball": "iaI+7i0vUjvxjj5Qyhpv8vcYi8eJE78J5KGRd7ppTSc=",
	"last_ball_unit": "Mf1h7ObKs1unBiKCcnluHZjKa6qO+ODdDMMh/zS+wz0=",
	"timestamp": 1624754674,
	"witness_list_unit": "TvqutGPz3T4Cs6oiChxFlclY92M2MvCvfXR5/FETato=",
	"headers_commission": 452,
	"payload_commission": 501,
	"unit": "o+Xe1O4MfEBz2/3UOPTgc+5PNnpdhEPhhho52Iyf1HM=",
	"main_chain_index": 2045972
}
  ```

</details>

<details>
  <summary>Example responseObj</summary>

  ```json
{
	"mci": 2045972,
	"trigger_address": "TNM2YRTJOANVGXMCFOH2FBVC3KYHZ4O6",
	"aa_address": "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ",
	"trigger_unit": "o+Xe1O4MfEBz2/3UOPTgc+5PNnpdhEPhhho52Iyf1HM=",
	"bounced": 0,
	"response_unit": "qYfdrDF0yFtaXv3iM1r0SBOruHAdp4A1rDhpJwXcC1U=",
	"response": {
		"responseVars": {
			"ETH3": "tZgXWTAv+1v1Ow4pMEVFFNlZAobGxMm2kIcr2dVR68c=",
			"tZgXWTAv+1v1Ow4pMEVFFNlZAobGxMm2kIcr2dVR68c=": "ETH3",
			"TNM2YRTJOANVGXMCFOH2FBVC3KYHZ4O6_0_ETH3_tZgXWTAv+1v1Ow4pMEVFFNlZAobGxMm2kIcr2dVR68c=": 100000000,
			"message": "Your description is now the current"
		}
	},
	"timestamp": 1624754674,
	"creation_date": "2021-06-27 00:45:48",
	"objResponseUnit": {
		"version": "3.0t",
		"alt": "2",
		"timestamp": 1624754674,
		"messages": [
			{
				"app": "data",
				"payload": {
					"asset": "tZgXWTAv+1v1Ow4pMEVFFNlZAobGxMm2kIcr2dVR68c=",
					"name": "ETH3",
					"decimals": 8
				},
				"payload_location": "inline",
				"payload_hash": "gRcVodd+gpMN/AMh0e7QsUhhYD2F04ppNBrMaCDUiKc="
			},
			{
				"app": "payment",
				"payload": {
					"outputs": [
						{
							"address": "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ",
							"amount": 99999227
						}
					],
					"inputs": [
						{
							"unit": "FF7QEM1urqVa3nsbyPga6z6duE3gZK2nU3yG5x7Nkw8=",
							"message_index": 1,
							"output_index": 0
						}
					]
				},
				"payload_location": "inline",
				"payload_hash": "6ZJLUc4CleXBDL8E38gUXTsG7oPpebMvCM0PZ0DinWk="
			}
		],
		"authors": [
			{
				"address": "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ"
			}
		],
		"last_ball_unit": "Mf1h7ObKs1unBiKCcnluHZjKa6qO+ODdDMMh/zS+wz0=",
		"last_ball": "iaI+7i0vUjvxjj5Qyhpv8vcYi8eJE78J5KGRd7ppTSc=",
		"witness_list_unit": "TvqutGPz3T4Cs6oiChxFlclY92M2MvCvfXR5/FETato=",
		"parent_units": [
			"o+Xe1O4MfEBz2/3UOPTgc+5PNnpdhEPhhho52Iyf1HM="
		],
		"headers_commission": 350,
		"payload_commission": 423,
		"unit": "qYfdrDF0yFtaXv3iM1r0SBOruHAdp4A1rDhpJwXcC1U=",
		"main_chain_index": 2046004
	}
}
  ```

</details>

## Testing

```sh
npm test
```

The suite uses the built-in Node test runner (`node --test`) with in-memory mocks of `ocore`/`aabot`, so no running node is required.

## Configuring

The default settings are in the library's [conf.js](https://github.com/byteball/ocore/blob/master/conf.js), they can be overridden in your project root's conf.js, then in conf.json in the app data folder.  The app data folder is:

* macOS: `~/Library/Application Support/<appname>`
* Linux: `~/.config/<appname>`
* Windows: `%LOCALAPPDATA%\<appname>`

`<appname>` is `name` in your `package.json`.

## Donations

To support our work, donate through kivach.org.

[![Kivach](https://kivach.org/api/banner?repo=byteball/aa-hooks)](https://kivach.org/repo/byteball/aa-hooks)
