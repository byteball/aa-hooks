const dag = require('aabot/dag.js');


module.exports = class HookController {
  constructor(net, callback, id) {
    this.net = net;
    this.callback = callback;
    this.id = id;
    /** @private */
    this.opposite = false;
  }

  get not() {
    this.opposite = true;

    return this;
  }

  #addFilter(id, func) {
    if (this.net.filters[id]) {
      this.net.filters[id].push({ filter: func, opposite: this.opposite });
    } else {
      this.net.filters[id] = [{ filter: func, opposite: this.opposite }];
    }

    this.opposite = false;
  }

  async getTriggerUnit(trigger_unit) {
    // Delegate to the shared, per-unit cache on the Hooks instance so that the
    // same trigger unit is fetched from the DAG only once per response, no
    // matter how many filters (and the response handler itself) need it.
    return this.net.readTriggerUnit(trigger_unit);
  }

  async #getPayloadByResponse(res) {
    let payload = {};

    if (res?.trigger_unit) {
      const objUnit = await this.getTriggerUnit(res.trigger_unit);

      if (objUnit) {
        const messages = objUnit.messages;

        if (messages && messages.length > 0) {
          const dataMsg = messages.find((msgs) => msgs.app === 'data');

          if (dataMsg) {
            payload = dataMsg.payload || {};
          }
        }
      }
    }

    return payload;
  }

  async #getBaseAAByResponse(res) {
    try {
      const definition = await dag.readAADefinition(res.aa_address);

      // `readAADefinition` returns `undefined` when the AA is unknown, so guard
      // the array access to avoid crashing the whole response handler.
      return definition?.[1]?.base_aa;
    } catch (e) {
      return undefined;
    }
  }

  #getAmountByMessages(messages, asset, address) {
    let amount = 0;

    if (messages && messages.length) {

      const payments = messages.filter((m) => m.app === 'payment');

      payments.forEach((p) => {
        const outputs = p.payload.outputs;

        if (outputs && outputs.length) {
          outputs.forEach((o) => {
            if (!address || address === o.address) {
              if (o.asset === asset || (asset === 'base' || asset === 'GBYTE' || asset === 'bytes') && !('asset' in o)) {
                amount += o.amount;
              }
            }
          });
        }
      });

      return amount;

    } else {
      return 0;
    }
  }

  // ------- start filters -------
  /**
    * @param {string} address
   */

  aaAddressIs(address) {
    this.#addFilter(this.id, (res) => {
      return res.aa_address === address;
    });

    return this;
  }

  /**
    * @param {string} address
   */
  triggerAddressIs(address) {
    this.#addFilter(this.id, (res) => {
      return res.trigger_address === address
    });

    return this;
  }

  /**
    * @param {string} unit
   */
  triggerUnitIs(unit) {
    this.#addFilter(this.id, (res) => {
      return res.trigger_unit === unit;
    });

    return this;
  }

  /**
    * @param {string} address
   */
  baseAaIs(address) {
    this.#addFilter(this.id, async (res) => {
      const baseAA = await this.#getBaseAAByResponse(res);

      return address === baseAA;
    });

    return this;
  }

  /**
    * @param {string} key
   */
  responseContainsKey(key) {
    this.#addFilter(this.id, (res) => {
      const resVars = res?.response?.responseVars;
      return resVars && (key in resVars);
    });

    return this;
  }

  /**
    * @param {string} key
    * @param {string | number} value
   */
  responseKeyIs(key, value) {
    this.#addFilter(this.id, (res) => {
      const resVars = res?.response?.responseVars;

      return resVars && (key in resVars) && resVars[key] === value;
    });

    return this;
  }

  /**
    * @param {string} key
    * @param {string | number} value
   */
  responseKeyLessThan(key, value) {
    this.#addFilter(this.id, (res) => {
      const resVars = res?.response?.responseVars;

      return resVars && (key in resVars) && resVars[key] < value;
    });

    return this;
  }

  /**
    * @param {string} key
    * @param {string | number} value
   */
  responseKeyMoreThan(key, value) {
    this.#addFilter(this.id, (res) => {
      const resVars = res?.response?.responseVars;

      return resVars && (key in resVars) && resVars[key] > value;
    });

    return this;
  }

  triggerDataExists() {
    this.#addFilter(this.id, async (res) => {
      const payload = await this.#getPayloadByResponse(res);

      return !!Object.values(payload).length;
    });

    return this;
  }

  /**
    * @param {string} key
   */
  triggerDataContainsKey(key) {
    this.#addFilter(this.id, async (res) => {
      const payload = await this.#getPayloadByResponse(res);

      return key in payload;
    });

    return this;
  }

  /**
    * @param {string} key
    * @param {string | number} value
   */
  triggerDataKeyIs(key, value) {
    this.#addFilter(this.id, async (res) => {
      const payload = await this.#getPayloadByResponse(res);
      return (key in payload) && payload[key] === value;
    });

    return this;
  }

  /**
    * @param {string} key
    * @param {string | number} value
   */
  triggerDataKeyLessThan(key, value) {
    this.#addFilter(this.id, async (res) => {
      const payload = await this.#getPayloadByResponse(res);
      return (key in payload) && payload[key] < value;
    });

    return this;
  }

  /**
    * @param {string} key
    * @param {string | number} value
   */
  triggerDataKeyMoreThan(key, value) {
    this.#addFilter(this.id, async (res) => {
      const payload = await this.#getPayloadByResponse(res);
      return (key in payload) && payload[key] > value;
    });

    return this;
  }


  isSuccess() {
    this.#addFilter(this.id, (res) => {
      return res.bounced === 0;
    });

    return this;
  }

  isBounced() {
    this.#addFilter(this.id, (res) => {
      return res.bounced !== 0;
    });

    return this;
  }

  /**
    * @param {number} value
    * @param {string} asset
    * @param {string=} address
   */

  responseOutputsAmountIs(value, asset, address) {
    this.#addFilter(this.id, (res) => {
      const amount = this.#getAmountByMessages(res?.objResponseUnit?.messages, asset, address);

      return amount === value;

    });

    return this;
  }

  /**
     * @param {number} value
     * @param {string} asset
     * @param {string=} address
   */

  responseOutputsAmountLessThan(value, asset, address) {
    this.#addFilter(this.id, (res) => {
      const amount = this.#getAmountByMessages(res?.objResponseUnit?.messages, asset, address);

      return amount < value;
    });

    return this;
  }

  /**
  * @param {number} value
  * @param {string} asset
  * @param {string=} address
 */

  responseOutputsAmountMoreThan(value, asset, address) {
    this.#addFilter(this.id, (res) => {
      const amount = this.#getAmountByMessages(res?.objResponseUnit?.messages, asset, address);

      return amount > value;

    });

    return this;
  }

  /**
  * @param {string} asset
  * @param {number} value
  * @param {string=} address
 */
  sentAmountLessThan(asset, value, address) {
    this.#addFilter(this.id, async (res) => {
      const triggerUnit = await this.getTriggerUnit(res.trigger_unit);

      const amount = this.#getAmountByMessages(triggerUnit.messages, asset, address);

      return amount < value;
    });

    return this;
  }

  /**
  * @param {string} asset
  * @param {number} value
  * @param {string=} address
 */

  sentAmountMoreThan(asset, value, address) {
    this.#addFilter(this.id, async (res) => {
      const triggerUnit = await this.getTriggerUnit(res.trigger_unit);

      const amount = this.#getAmountByMessages(triggerUnit.messages, asset, address);

      return amount > value;
    });

    return this;
  }

  /**
  * @param {string} asset
  * @param {number} value
  * @param {string=} address
 */

  sentAmountIs(asset, value, address) {
    this.#addFilter(this.id, async (res) => {
      const triggerUnit = await this.getTriggerUnit(res.trigger_unit);

      const amount = this.#getAmountByMessages(triggerUnit.messages, asset, address);

      return amount === value;
    });

    return this;
  }

  /**
   * This callback is displayed as part of the Requester class.
   * @callback filterCallback
   * @param {response} response
   * @param {meta} meta
   * @returns {boolean}
   */


  /**
    * @param {filterCallback} filter
    * @param {Array.<string>} metaKeys
  */

  customFilter(filter, metaKeys = []) {

    this.#addFilter(this.id, async (res) => {
      const meta = {};

      if (metaKeys.find((key) => key === 'payload')) {
        const payload = await this.#getPayloadByResponse(res);
        meta.payload = payload;
      }

      if (metaKeys.find((key) => key === 'trigger_unit') && res.trigger_unit) {
        meta.trigger_unit = await this.getTriggerUnit(res.trigger_unit);
      }

      const result = await filter(res, meta);

      if (result === false || result === true) {
        return result;
      } else {
        throw new Error("filter must return a boolean value!");
      }
    });

    return this;
  }

  /**
   * Remove this hook so it stops receiving events and its filters are freed.
   */
  remove() {
    this.net.removeController(this.id);
  }
}