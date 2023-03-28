
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
- customHook

## Examples

```js
const { Hooks } = require("aa-hooks");

// create net of hooks
const hooks = new Hooks(["O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ"], {
    newEventsOnly: false, // default: false
});

const eventController = (requestObj) => {
    const symbol = req.messages.find((m => m.app === 'data'))?.payload?.symbol;
    console.error("Reg new symbol: ", symbol);
}

hooks.register(eventController)
    .isSuccess()
    .triggerDataContainsKey("symbol")
    .triggerDataContainsKey("asset")
    .triggerDataContainsKey("drawer")
    ...
    
// custom hook
hooks.register(eventController)
    .isSuccess()
    .customHook(async (responseObj, meta) => {
        const { payload, trigger_unit } = meta;
        // this is a filter function
        // always returns boolean value*
    }, ["payload", "trigger_unit"])
    .triggerDataContainsKey("symbol");
```



## Configuring

The default settings are in the library's [conf.js](https://github.com/byteball/ocore/blob/master/conf.js), they can be overridden in your project root's conf.js, then in conf.json in the app data folder.  The app data folder is:

* macOS: `~/Library/Application Support/<appname>`
* Linux: `~/.config/<appname>`
* Windows: `%LOCALAPPDATA%\<appname>`

`<appname>` is `name` in your `package.json`.

## Donations

To support our work, donate through kivach.org.

[![Kivach](https://kivach.org/api/banner?repo=byteball/aa-hooks)](https://kivach.org/repo/byteball/aa-hooks)