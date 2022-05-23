const { Sonos } = require("sonos");
const sonos = require("sonos");

/**
 * Global control accessory; e.g., mute, powering off, etc.
 * @param platform: The SonosMultiroomPlatform instance.
 * @param config: The globalControl config
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
                    z.sonos.state = false;
                });
            } else {
                // Ignore the on command
                setTimeout(() => powerService.updateCharacteristic(Characteristic.On, false), 250);
            }

            callback(null);
        });

        // store the service
        control.powerService = powerService;
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
    }

    // Enable/Disable the remote volume control feature
    if (config.switch.remoteVolumeOverride) {
        let remoteVolumeOverrideService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'RemoteVolumeOverride');

        if (!remoteVolumeOverrideService) {
            remoteVolumeOverrideService = switchAccessory.addService(Service.Switch, 'Remote Volume Control', 'RemoteVolumeOverride');
        }
        
        remoteVolumeOverrideService.updateCharacteristic(Characteristic.On, platform.zones.some((z) => z.config.remotelyControlled));
        remoteVolumeOverrideService.getCharacteristic(Characteristic.On).on('set', (value, callback) => {
            if (value) {
                platform.log('Remote volume control is enabled');
                platform.zones.forEach((z) => {
                    // reset the remoteVolume
                    z.sonos.remoteVolume = z.sonos.volume;
                });
            } else {
                platform.log('Remote volume control is disabled');
            }

            callback(null);
        });

        // store the service
        control.remoteVolumeOverrideService = remoteVolumeOverrideService;
    }
}

/**
 * Defines the export of the file.
 */
module.exports = SonosControl;