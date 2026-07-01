
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

Requires Node.js 14+ (the test suite requires Node 18+).

## Quick start

```js
const { Hooks } = require("aa-hooks");

// Watch a set of AA addresses
const hooks = new Hooks(["O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ"], {
    newEventsOnly: false,     // default: false — also process past responses
    parallelProcessing: false // default: false — process responses one at a time
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
- **Serial by default.** Responses are processed one at a time; set `parallelProcessing: true` to process them concurrently.
- **Errors are contained.** An error thrown by a filter or a callback is caught and logged — it never freezes processing or stops the other hooks.
- **Trigger units are cached** per unit hash for the duration of the process, so the same unit is read from the DAG only once no matter how many filters need it.

## API

### `new Hooks(addresses, config?)`

| Argument | Type | Description |
| --- | --- | --- |
| `addresses` | `string[]` | AA addresses to watch. |
| `config.newEventsOnly` | `boolean` | Default `false`. When `true`, only responses with a timestamp at/after construction time are processed. |
| `config.parallelProcessing` | `boolean` | Default `false`. When `true`, responses are handled concurrently instead of one at a time. |

### `hooks.register(callback) → HookController`

Creates a hook and returns its controller so you can chain filters. `callback` is `(triggerUnit, responseObj) => void | Promise<void>`.

### `hooks.addWatchedAddress(address) → Promise<void>`

Loads an AA definition and starts watching the address at runtime. Rejects if the AA definition can't be loaded.

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
| `isSuccess()` | the response did not bounce (`bounced === 0`). |
| `isBounced()` | the response bounced (`bounced !== 0`). |

### Response variables (`response.responseVars`)

| Filter | Matches when |
| --- | --- |
| `responseContainsKey(key)` | `key` exists in the response vars. |
| `responseKeyIs(key, value)` | `responseVars[key] === value`. |
| `responseKeyLessThan(key, value)` | `responseVars[key] < value`. |
| `responseKeyMoreThan(key, value)` | `responseVars[key] > value`. |

### Trigger data (the `data` message of the trigger unit)

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

Note the argument order: **`value` comes first**.

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
