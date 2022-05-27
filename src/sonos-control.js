/**
 * power                    (default false) switch to turn off all zones
 * mute                     (default false) switch to unmute currerntly muted or mute all
 * remoteVolumeOverride     (default false) 
 * remoteAutoGroupOverride  (default false) 
 */

const { Sonos } = require("sonos");
const sonos = require("sonos");

/**
 * Global control accessory; e.g., mute, powering off, etc.
 * @param platform: The SonosMultiroomPlatform instance.
 * @param config: The global config
 */
function SonosControl(platform, config) {
    const control = this;
    const { UUIDGen, Accessory, Characteristic, Service } = platform;

    // Set the name, platform, config
    control.platform = platform;
    control.config = config;
    control.name = config.name;

    // Global control is a single accessory with varying services
    let switchAccessory = platform.accessories.find((a) => a.context.name === control.name);

    if (!switchAccessory) {
        platform.log('Adding new accessory with name "' + control.name + '" and kind SwitchAccessory.');
        switchAccessory = new Accessory(control.name, UUIDGen.generate(control.name + 'SwitchAccessory'));
        switchAccessory.context.name = control.name;
        switchAccessory.context.kind = 'SwitchAccessory';
        platform.api.registerPlatformAccessories(platform.pluginName, platform.platformName, [switchAccessory]);
    }

    // Strictly powers off all of the zone
    if (config.switch.power) {
        let powerService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'Power');

        if (!powerService) {
            powerService = switchAccessory.addService(Service.Switch, 'Power', 'Power');
        }
        
        powerService.updateCharacteristic(Characteristic.On, false);
        powerService.getCharacteristic(Characteristic.On).on('set', (value, callback) => {
            if (!value) {
                platform.zones.forEach((z) => {
                    z.device.sonos.leaveGroup();
                    z.device.state = 'STOPPED';
                    z.local.state = false;
                });
            } else {
                // Ignore the on command
                setTimeout(() => powerService.updateCharacteristic(Characteristic.On, false), 250);
            }

            callback(null);
        });

        // store the service
        control.powerService = powerService;
    } else {
        config.switch.power = false;
    }

    // Global mute command
    if (config.switch.mute) {
        let muteService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'Mute');

        if (!muteService) {
            muteService = switchAccessory.addService(Service.Switch, 'Mute', 'Mute');
        }
        
        muteService.updateCharacteristic(Characteristic.On, false);
        muteService.getCharacteristic(Characteristic.On).on('set', (value, callback) => {
            platform.zones.forEach((z) => {
                z.device.sonos.setMuted(value);
                z.device.mute = value;
            });

            callback(null);
        });

        // store the service
        control.muteService = muteService;
    } else {
        config.switch.mute = false;
    }

    // Enable/Disable the remote volume control feature
    if (config.switch.remoteVolumeOverride) {
        let remoteVolumeOverrideService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'RemoteVolumeOverride');

        if (!remoteVolumeOverrideService) {
            remoteVolumeOverrideService = switchAccessory.addService(Service.Switch, 'Remote Volume', 'RemoteVolumeOverride');
        }
        
        remoteVolumeOverrideService.updateCharacteristic(Characteristic.On, platform.zones.some((z) => z.config.remotelyControlled));
        remoteVolumeOverrideService.getCharacteristic(Characteristic.On).on('set', (value, callback) => {
            if (value) {
                platform.log('Remote volume control is enabled');
                platform.zones.forEach((z) => {
                    // reset the remoteVolume
                    z.local.remoteVolume = z.local.volume;
                });
            } else {
                platform.log('Remote volume control is disabled');
            }

            callback(null);
        });

        // store the service
        control.remoteVolumeOverrideService = remoteVolumeOverrideService;
    } else {
        config.switch.remoteVolumeOverride = false;
    }

    // Global remote auto group feature
    if (config.switch.remoteAutoGroupOverride) {
        let remoteAutoGroupService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'RemoteAutoGroup');

        if (!remoteAutoGroupService) {
            remoteAutoGroupService = switchAccessory.addService(Service.Switch, 'Remote Auto Group', 'RemoteAutoGroup');
        }
        
        remoteAutoGroupService.updateCharacteristic(Characteristic.On, false);
        remoteAutoGroupService.updateCharacteristic(Characteristic.On, platform.zones.some((z) => z.config.remoteAutoGroup));

        // store the service
        control.remoteAutoGroupService = remoteAutoGroupService;
    } else {
        config.switch.remoteAutoGroupOverride = false;
    }
}

/**
 * Defines the export of the file.
 */
module.exports = SonosControl;