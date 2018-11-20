'use strict';

const {Adapter, Device} = require('gateway-addon');
const wol = require('wol');

class WakeOnLanAdapter extends Adapter {
  constructor(addonManager, manifest) {
    super(addonManager, manifest.name, manifest.name);
    addonManager.addAdapter(this);

    for (const mac of manifest.moziot.config.devices) {
      this.handleDeviceAdded(new WakeOnLanDevice(this, mac));
    }
  }
}

class WakeOnLanDevice extends Device {
  constructor(adapter, mac) {
    super(adapter, `wake-on-lan-${mac}`);

    this.mac = mac;
    this.name = `WoL (${mac})`;
    this.description = `WoL (${mac})`;
    this['@context'] = 'https://iot.mozilla.org/schemas';
    this['@type'] = [];
    this.addAction('wake', {label: 'Wake'});
  }

  performAction(action) {
    if (action.name !== 'wake') {
      return Promise.reject('Unknown action');
    }

    return new Promise((resolve, reject) => {
      wol.wake(this.mac, (err, res) => {
        if (err || !res) {
          reject('Wake failed');
          return;
        }

        resolve();
      });
    });
  }
}

module.exports = (addonManager, manifest) => {
  new WakeOnLanAdapter(addonManager, manifest);
};
