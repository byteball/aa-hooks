
![AA hooks](/public/img.svg)


## Hook list
- aaAddressIs
- triggerAaAddressIs
- triggerUnitIs
- baseAaIs
- responseKeyContains
- responseKeyIs
- responseKeyLessThan
- responseKeyMoreThan
- triggerDataContainsKey
- triggerDataKeyIs
- triggerDataKeyLessThan
- triggerDataKeyMoreThan
- responseOutputsAmountLessThan
- responseOutputsAmountMoreThan
- responseOutputsAmountIs
- sentAmountLessThan
- sentAmountMoreThan
- sentAmountIs
- isSuccess
- isBounced
- customFilter

## Examples

```js
const { Hooks } = require("aa-hooks");

// create net of hooks
const hooks = new Hooks(["O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ"], {
    newEventsOnly: false, // default: false
	parallelProcessing: false  // default: false
});

const regSymbolHandler = async (triggerUnit, responseObj) => {
    const symbol = triggerUnit.messages.find((m => m.app === 'data'))?.payload?.symbol;
    console.error("Reg new symbol: ", symbol);
    console.error("Response unit: ", responseObj.response_unit);

	await hooks.addWatchedAddress("..."); // watch new agent
}

hooks.register(regSymbolHandler)
    .isSuccess()
    .triggerDataContainsKey("symbol")
    .triggerDataContainsKey("asset")
    .triggerDataContainsKey("drawer")
    ...
    
// custom filter
hooks.register(regSymbolHandler)
    .isSuccess()
    .customFilter(async (responseObj, meta) => {
        const { payload, trigger_unit } = meta;
        // this is a filter function
        // always returns boolean value
    }, ["payload", "trigger_unit"])
    .triggerDataContainsKey("symbol");
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

## Configuring

The default settings are in the library's [conf.js](https://github.com/byteball/ocore/blob/master/conf.js), they can be overridden in your project root's conf.js, then in conf.json in the app data folder.  The app data folder is:

* macOS: `~/Library/Application Support/<appname>`
* Linux: `~/.config/<appname>`
* Windows: `%LOCALAPPDATA%\<appname>`

`<appname>` is `name` in your `package.json`.

## Donations

To support our work, donate through kivach.org.

[![Kivach](https://kivach.org/api/banner?repo=byteball/aa-hooks)](https://kivach.org/repo/byteball/aa-hooks)