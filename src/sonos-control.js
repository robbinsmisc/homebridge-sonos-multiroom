const { Sonos } = require("sonos");
const sonos = require("sonos");

function SonosControl(platform, config) {
    const control = this;
    const { UUIDGen, Accessory, Characteristic, Service } = platform;

    control.platform = platform;
    control.config = config;
    control.name = config.name;

    let switchAccessory = platform.accessories.find((a) => a.context.name === control.name);

    if (!switchAccessory) {
        platform.log('Adding new accessory with name "' + control.name + '" and kind SwitchAccessory.');
        switchAccessory = new Accessory(control.name, UUIDGen.generate(control.name + 'SwitchAccessory'));
        switchAccessory.context.name = control.name;
        switchAccessory.context.kind = 'SwitchAccessory';
        platform.api.registerPlatformAccessories(platform.pluginName, platform.platformName, [switchAccessory]);
    }

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
                setTimeout(() => powerService.updateCharacteristic(Characteristic.On, false), 250);
            }

            callback(null);
        });

        // store the service
        control.powerService = powerService;
    }

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

    if (config.switch.remoteVolumeOverride) {
        let remoteVolumeOverrideService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'RemoteVolumeOverride');

        if (!remoteVolumeOverrideService) {
            remoteVolumeOverrideService = switchAccessory.addService(Service.Switch, 'Remote Volume Control', 'RemoteVolumeOverride');
        }
        
        remoteVolumeOverrideService.updateCharacteristic(Characteristic.On, platform.zones.some((z) => z.config.remotelyControlled));

        // store the service
        control.remoteVolumeOverrideService = remoteVolumeOverrideService;
    }



}

/**
 * Defines the export of the file.
 */
module.exports = SonosControl;