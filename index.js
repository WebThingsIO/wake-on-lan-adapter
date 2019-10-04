'use strict';

const {Adapter, Database, Device, Property} = require('gateway-addon');
const findDevices = require('local-devices');
const manifest = require('./manifest.json');
const {promise: ping} = require('ping');
const wol = require('wol');

class WakeOnLanAdapter extends Adapter {
  static getDeviceInfoFromArpTable(mac, arpDevices = []) {
    const normalizedMac = mac.toLowerCase();
    const arpDevice =
      arpDevices.find((d) => d.mac.toLowerCase() === normalizedMac);

    if (arpDevice) {
      // de-normalize mac so device ID stays the same.
      arpDevice.mac = mac;
      return arpDevice;
    }

    return {
      mac: mac,
      name: '?',
    };
  }

  constructor(addonManager) {
    super(addonManager, manifest.id, manifest.id);
    addonManager.addAdapter(this);

    const db = new Database(manifest.id);
    db.open().then(() => {
      return db.loadConfig();
    }).then((config) => {
      this.checkPing = config.hasOwnProperty('checkPing') ?
        config.checkPing :
        true;

      if (config.devices.length) {
        if (this.checkPing) {
          findDevices()
            .catch(console.warn)
            .then((devices) => {
              for (const mac of config.devices) {
                const arpDevice =
                  WakeOnLanAdapter.getDeviceInfoFromArpTable(mac, devices);
                this.addDevice(arpDevice);
              }
            })
            .then(() => {
              this.startPingChecker();
            });
        } else {
          for (const mac of config.devices) {
            const arpDevice = WakeOnLanAdapter.getDeviceInfoFromArpTable(mac);
            this.addDevice(arpDevice);
          }
        }
      }
    }).catch(console.error);
  }

  addDevice(arpDevice) {
    const deviceName = arpDevice && arpDevice.name != '?' && arpDevice.name;
    const wolDevice = new WakeOnLanDevice(this, arpDevice.mac, deviceName);
    if (this.devices.hasOwnProperty(wolDevice.id)) {
      return;
    }
    if (arpDevice.ip) {
      wolDevice.checkPing(arpDevice.ip);
    }
    this.handleDeviceAdded(wolDevice);
  }

  handleDeviceAdded(device) {
    if (this.checkPing && !this.interval) {
      this.startPingChecker();
    }
    super.handleDeviceAdded(device);
  }

  handleDeviceRemoved(device) {
    super.handleDeviceRemoved(device);
    if (!Object.keys(this.devices).length) {
      this.stopPingChecker();
    }
  }

  startPingChecker() {
    this.interval = setInterval(async () => {
      const devices = await findDevices();
      for (const device of Object.values(this.devices)) {
        const normalizedMac = device.mac.toLowerCase();
        const info = devices.find((d) => d.mac.toLowerCase() === normalizedMac);
        if (info) {
          device.checkPing(info.ip);
        } else {
          // Not in ARP table, so as far as we know the device is not on the
          // network.
          device.setOn(false);
        }
      }
    }, 30000);
  }

  stopPingChecker() {
    if (this.interval) {
      clearInterval(this.interval);
      delete this.interval;
    }
  }

  unload() {
    this.stopPingChecker();
    return super.unload();
  }
}

class WakeOnLanDevice extends Device {
  constructor(adapter, mac, name) {
    super(adapter, `wake-on-lan-${mac}`);

    this.mac = mac;
    this.name = name || `WoL (${mac})`;
    this.description = `WoL (${mac})`;
    this['@context'] = 'https://iot.mozilla.org/schemas';
    this['@type'] = [];
    this.addAction('wake', {label: 'Wake'});

    if (adapter.checkPing) {
      this.properties.set('on', new PingProperty(this, 'on', {
        type: 'boolean',
        label: 'Awake',
      }, false));
    }
  }

  async checkPing(ip) {
    try {
      const result = await ping.probe(ip);
      this.setOn(result.alive);
    } catch (e) {
      this.setOn(false);
    }
  }

  setOn(isOn) {
    const pingProperty = this.findProperty('on');
    if (pingProperty && pingProperty.value !== isOn) {
      pingProperty.setCachedValue(isOn);
      this.notifyPropertyChanged(pingProperty);
    }
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

class PingProperty extends Property {
  constructor(device, name, description, value) {
    description.readOnly = true;
    super(device, name, description, value);
  }

  setValue() {
    return Promise.reject('Read only property');
  }
}

module.exports = (addonManager) => {
  new WakeOnLanAdapter(addonManager);
};
