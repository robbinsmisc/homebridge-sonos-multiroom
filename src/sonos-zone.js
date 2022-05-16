/**
* "name": 'Sonos Zone'                  Sonos device
* "priorities": ['','']                 array of strings for the preferred Sonos zones to automatically join
* "autoGroup": ['','']                  array of strings for Sonos devices to auto join designated coordinator
* "isAutoPlayDisabled": True | False    (default false) disable autoplay 
* "defaultGroupVolume": 16              absolute volume - relative differences used when grouping volume controlled devices 
* "volumeControlled": True | False      (default false) creates a dimmable lightbulb accessory
* "groupOverride":  True | False        (default false) coordinator can turn off the entire group
* "remotelyControlled":  True | False   (default false) 
* "tvOverride": True | False            (default false) allow HT controlled devices to be turned off
*/

const { Sonos } = require("sonos");
const sonos = require("sonos");

/**
 * Represents a Sonos zone.
 * @param platform The SonosMultiroomPlatform instance.
 * @param zoneMasterDevice The master device of the zone.
 * @param config The zone configuration.
 */
function SonosZone(platform, zoneMasterDevice, config) {
    const zone = this;
    const { UUIDGen, Accessory, Characteristic, Service } = platform;

    // Sets the master device, name and platform
    zone.device = zoneMasterDevice;
    zone.name = zoneMasterDevice.zoneName;
    zone.platform = platform;
    zone.config = config;
    zone.sonos = {
        'name': zone.name,                      // string: human readable
        'UUID': zone.device.UUID,               // string
        'state': false,                         // true | false: playing = true, transitioning = previous, o.w. = off
        'volume': 10,                           // int bounded by device min/max volume
        'refVolume': config.defaultGroupVolume, // int
        'isGrouped': false,                     // true | false
        'isCoordinator': false,                 // true | false
        'groupCoordinator': '',                 // string: quick reference of coordinator UUID
        'groupMember': []                       // array of RINCON strings
    };

    // Gets all accessories from the platform that match the zone name
    let unusedDeviceAccessories = platform.accessories.filter(function(a) { return a.context.name === zone.name; });
    let newDeviceAccessories = [];
    let deviceAccessories = [];

    // Gets the lightbulb and outlet accessory
    let outletAccessory = null;
    let lightbulbAccessory = null;
    if (config.volumeControlled) {
        lightbulbAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'LightbulbAccessory'; });
        if (lightbulbAccessory) {
            unusedDeviceAccessories.splice(unusedDeviceAccessories.indexOf(lightbulbAccessory), 1);
        } else {
            platform.log('Adding new accessory with zone name ' + zone.name + ' and kind LightbulbAccessory.');
            lightbulbAccessory = new Accessory(zone.name, UUIDGen.generate(zone.name + 'LightbulbAccessory'));
            lightbulbAccessory.context.name = zone.name;
            lightbulbAccessory.context.kind = 'LightbulbAccessory';
            newDeviceAccessories.push(lightbulbAccessory);
        }
        deviceAccessories.push(lightbulbAccessory);
    } else {
        outletAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'OutletAccessory'; });
        if (outletAccessory) {
            unusedDeviceAccessories.splice(unusedDeviceAccessories.indexOf(outletAccessory), 1);
        } else {
            platform.log('Adding new accessory with zone name ' + zone.name + ' and kind OutletAccessory.');
            outletAccessory = new Accessory(zone.name, UUIDGen.generate(zone.name + 'OutletAccessory'));
            outletAccessory.context.name = zone.name;
            outletAccessory.context.kind = 'OutletAccessory';
            newDeviceAccessories.push(outletAccessory);
        }
        deviceAccessories.push(outletAccessory);
    }

    // Gets the switch accessory
    let switchAccessory = null;
    if (zone.device.htControl && (config.isNightModeEnabled || config.isSpeechEnhancementEnabled)) {
        switchAccessory = unusedDeviceAccessories.find(function(a) { return a.context.kind === 'SwitchAccessory'; });
        if (switchAccessory) {
            unusedDeviceAccessories.splice(unusedDeviceAccessories.indexOf(switchAccessory), 1);
        } else {
            platform.log('Adding new accessory with zone name ' + zone.name + ' and kind SwitchAccessory.');
            switchAccessory = new Accessory(zone.name + ' Settings', UUIDGen.generate(zone.name + 'SwitchAccessory'));
            switchAccessory.context.name = zone.name;
            switchAccessory.context.kind = 'SwitchAccessory';
            newDeviceAccessories.push(switchAccessory);
        }
        deviceAccessories.push(switchAccessory);
    }

    // Registers the newly created accessories
    platform.api.registerPlatformAccessories(platform.pluginName, platform.platformName, newDeviceAccessories);

    // Removes all unused accessories
    for (let i = 0; i < unusedDeviceAccessories.length; i++) {
        const unusedDeviceAccessory = unusedDeviceAccessories[i];
        platform.log('Removing unused accessory with zone name ' + unusedDeviceAccessory.context.name + ' and kind ' + unusedDeviceAccessory.context.kind + '.');
        platform.accessories.splice(platform.accessories.indexOf(unusedDeviceAccessory), 1);
    }
    platform.api.unregisterPlatformAccessories(platform.pluginName, platform.platformName, unusedDeviceAccessories);

    // Updates the accessory information
    for (let i = 0; i < deviceAccessories.length; i++) {
        const deviceAccessory = deviceAccessories[i];
        let accessoryInformationService = deviceAccessory.getService(Service.AccessoryInformation);
        if (!accessoryInformationService) {
            accessoryInformationService = deviceAccessory.addService(Service.AccessoryInformation);
        }
        accessoryInformationService
            .setCharacteristic(Characteristic.Manufacturer, zone.device.manufacturer)
            .setCharacteristic(Characteristic.Model, zone.device.modelName)
            .setCharacteristic(Characteristic.SerialNumber, zone.device.serialNumber)
            .setCharacteristic(Characteristic.FirmwareRevision, zone.device.softwareVersion)
            .setCharacteristic(Characteristic.HardwareRevision, zone.device.hardwareVersion);
    }


    // Updates the outlet or lightbulb
    let sonosService = null;
    if (outletAccessory) {
        sonosService = outletAccessory.getService(Service.Outlet);

        if (!sonosService) {
            sonosService = outletAccessory.addService(Service.Outlet);
        }

        sonosService.setCharacteristic(Characteristic.OutletInUse, true);
    } else {
        sonosService = lightbulbAccessory.getService(Service.Lightbulb);

        if (!sonosService) {
            sonosService = lightbulbAccessory.addService(Service.Lightbulb);
        }

        // low battery is used to indicate the zone coordinator
        sonosService.setCharacteristic(Characteristic.StatusLowBattery,0);
        
        // initialize volume/brightness
        zone.device.sonos.getVolume().then(function(volume) {
            sonosService.setCharacteristic(Characteristic.Brightness, volume);
        });
    }

    // Store service
    zone.sonosService = sonosService;

    // Updates the night mode switch
    let nightModeSwitchService = null;
    if (switchAccessory && config.isNightModeEnabled) {
        nightModeSwitchService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'NightMode');
        if (!nightModeSwitchService) {
            nightModeSwitchService = switchAccessory.addService(Service.Switch, 'Night Mode', 'NightMode');
        }

        // Stores the service
        zone.nightModeSwitchService = nightModeSwitchService;
    }

    // Updates the speech enhancement switch
    let speechEnhancementSwitchService = null;
    if (switchAccessory && config.isSpeechEnhancementEnabled) {
        speechEnhancementSwitchService = switchAccessory.getServiceByUUIDAndSubType(Service.Switch, 'SpeechEnhancement');
        if (!speechEnhancementSwitchService) {
            speechEnhancementSwitchService = switchAccessory.addService(Service.Switch, 'Speech Enhancement', 'SpeechEnhancement');
        }

        // Stores the service
        zone.speechEnhancementSwitchService = speechEnhancementSwitchService;
    }

    // Subscribes for changes of the outlet and lightbulb characteristics
    sonosService.getCharacteristic(Characteristic.On).on('set', function (value, callback) {
        if (zone.sonosService.getCharacteristic(Characteristic.On).value != value ) {
            zone.setState(value);
            console.log(zone.name + ' on set ' + value.toString())
        }

        callback(null);
    });

    if (sonosService.getCharacteristic(Characteristic.Brightness)) {
        sonosService.getCharacteristic(Characteristic.Brightness).on('set', function (value, callback) {
            zone.setVolume(value);
            console.log(zone.name + ' brightness set ' + value.toString())
            callback(null);
        });
    }

    // Subscribes for changes of the night mode
    if (nightModeSwitchService) {
        nightModeSwitchService.getCharacteristic(Characteristic.On).on('set', function (value, callback) {
            zone.platform.log(zone.name + ' - Set night mode: ' + (value ? 'ON' : 'OFF'));
            zone.device.sonos.renderingControlService()._request('SetEQ', { InstanceID: 0, EQType: 'NightMode', DesiredValue: value ? '1' : '0' }).then(function () {}, function () {
                zone.platform.log(zone.name + ' - Error switching night mode to ' + (value ? 'ON' : 'OFF') + '.');
            });
            callback(null);
        });
    }

    // Subscribes for changes of the speech enhancement
    if (speechEnhancementSwitchService) {
        speechEnhancementSwitchService.getCharacteristic(Characteristic.On).on('set', function (value, callback) {
            zone.platform.log(zone.name + ' - Set speech enhancement: ' + (value ? 'ON' : 'OFF'));
            zone.device.sonos.renderingControlService()._request('SetEQ', { InstanceID: 0, EQType: 'DialogLevel', DesiredValue: value ? '1' : '0' }).then(function () {}, function () {
                zone.platform.log(zone.name + ' - Error switching speech enhancement to ' + (value ? 'ON' : 'OFF') + '.');
            });
            callback(null);
        });
    }

    // Subscribes for changes of the transport control
    zone.device.sonos.on('AVTransport', function (eventData) {
        console.log(zone.name + ' event ' + eventData.TransportState)
        
        if (eventData.TransportState) {
            zone.device.state = eventData.TransportState;
        }

        if (eventData.CurrentTrackURI) {
            zone.device.currentTrack = eventData.CurrentTrackURI;

            if (zone.device.htControl) {
                zone.device.tvTrack = eventData.CurrentTrackURI.endsWith(':spdif');
            }
        }

        if (!platform.wait) {
            zone.platform.updateSonosModel();
            zone.platform.setHomeKit();
        }
    });

    // Subscribes for changes in the rendering control
    zone.device.sonos.on('RenderingControl', function (eventData) {
        if (eventData.Volume) {
            zone.device.volume = parseInt(eventData.Volume.find(function(obj) { return obj.channel === 'Master' }).val);
        }

        if (eventData.Mute) {
            zone.device.mute = eventData.Mute;
        }
        
        // Updates the night mode
        if (nightModeSwitchService && eventData.NightMode) {
            //zone.platform.log(zone.name + ' - Updating night mode: ' + (eventData.NightMode.val === '1' ? 'ON' : 'OFF'));
            zone.nightModeSwitchService.updateCharacteristic(Characteristic.On, eventData.NightMode.val === '1');
        }

        // Updates the speed enhancement
        if (speechEnhancementSwitchService && eventData.DialogLevel) {
            //zone.platform.log(zone.name + ' - Updating speech enhancement: ' + (eventData.DialogLevel.val === '1' ? 'ON' : 'OFF'));
            zone.speechEnhancementSwitchService.updateCharacteristic(Characteristic.On, eventData.DialogLevel.val === '1');
        }

        if (!platform.wait) {
            zone.platform.updateSonosModel();
            zone.platform.setHomeKit();
        }
    });
}

/**
 * Update volume based on lightbulb dimmer tile
 * @param volume from Homekit
 */
SonosZone.prototype.setVolume = function (volume) {
    const zone = this;
    const platform = zone.platform;
    const config = zone.config
    const { Characteristic } = platform;
    const sonos = platform.zones.map((obj) => obj.sonos);

    // guard against a minimum volume (brightness of 0)
    const cmdVolume = Math.max(Math.min(volume, zone.device.maxVolume), zone.device.minVolume);

    if (cmdVolume != volume) {
        zone.sonosService.updateCharacteristic(Characteristic.Brightness,cmdVolume);
    }

    let promises = [];

    promises.push(zone.device.sonos.setVolume(cmdVolume));

    if (zone.sonos.isCoordinator && zone.sonos.isGrouped) {
        zone.sonos.groupMember.forEach((gm) => {
            const memberZone = platform.zones.find((z) => z.sonos.UUID === gm);
            const memberVolume = Math.max(Math.min(cmdVolume - zone.sonos.volume + memberZone.sonos.volume, 
                memberZone.device.maxVolume), memberZone.device.minVolume);
            
            promises.push(memberZone.device.sonos.setVolume(memberVolume));
            memberZone.sonosService.updateCharacteristic(Characteristic.Brightness, memberVolume);
        });
    }

    Promise.all(promises).then(() => {
        setTimeout(() => {
            console.log('wait off')
            platform.wait = false;
            platform.updateSonosModel();
            platform.setHomeKit();
        }, 250);
    });
};

/**
 * On/Off function
 * @param value: True | False for on and off
 */
SonosZone.prototype.setState = function (stateValue) {
    const zone = this;
    const platform = zone.platform;
    const config = zone.config
    const { Characteristic } = platform;
    const sonos = platform.zones.map((obj) => obj.sonos);

    let promises = [];
    platform.wait = true;

    if (stateValue) {
        // check priority zone
        const priority = config.priorities.find((p) => {
            const sonosPriority = sonos.find((sp) => sp.name === p);

            return sonosPriority ? sonosPriority.state : false;
        });

        if (priority) {
            // join active priority zone
            const priorityZone = sonos.find((s) => s.name === priority);

            // turn on
            promises.push(zone.device.sonos.joinGroup(priority));

            // relative volume gains
            if (priorityZone.refVolume && zone.sonos.refVolume) {
                const memberVolume = priorityZone.volume - priorityZone.refVolume + zone.sonos.refVolume;
                promises.push(zone.device.sonos.setVolume(memberVolume));
            }  
        } else if(!config.isAutoPlayDisabled) {
            // auto play
            promises.push(zone.device.sonos.play());
            
            // auto group
            if (config.autoGroup) {
                zone.sonosService.setCharacteristic(Characteristic.StatusLowBattery, 1);

                config.autoGroup.forEach((az) => {
                    const autoZone = platform.zones.find((z) => z.name == az);

                    if (autoZone) {
                        promises.push(autoZone.device.sonos.joinGroup(zone.name));

                        // relative volume gains
                        if (autoZone.sonos.refVolume && zone.sonos.refVolume) {
                            const azVolume = zone.sonos.volume - zone.sonos.refVolume + autoZone.sonos.refVolume;
                            promises.push(autoZone.device.sonos.setVolume(azVolume));
                            autoZone.sonosService.updateCharacteristic(Characteristic.Brightness, azVolume);
                        }

                        autoZone.sonosService.updateCharacteristic(Characteristic.On, true);
                    }
                });
            }
            
        } else {
            setTimeout(() => zone.sonosService.updateCharacteristic(Characteristic.On, false), 250);
        }

        Promise.all(promises).then(() => {
            setTimeout(() => {
                console.log('wait off')
                platform.wait = false;
                platform.updateSonosModel();
                platform.setHomeKit();
            }, 500);
        });
    } else {
        // turn off group members if group override is flagged
        if (zone.sonos.isCoordinator && zone.sonos.isGrouped && config.groupOverride) {
            zone.sonos.groupMember.forEach((gm) => {
                const groupZone = platform.zones.find((z) => z.sonos.UUID === gm);

                // set brightness and leave group
                groupZone.sonosService.updateCharacteristic(Characteristic.On, false);
                groupZone.sonosService.updateCharacteristic(Characteristic.Brightness,
                    Math.max(groupZone.sonos.volume, groupZone.device.minVolume));

                promises.push(groupZone.device.sonos.leaveGroup());
            });
        }

        // set minimum HomeKit service value; i.e., brightness = 0% turns off lightbulb, which will turn on at 100%
        zone.sonosService.updateCharacteristic(Characteristic.Brightness,
                Math.max(zone.sonos.volume, zone.device.minVolume));
        zone.sonosService.updateCharacteristic(Characteristic.StatusLowBattery, false);

        if (zone.device.htControl && zone.device.tvTrack && !config.tvOverride) {
            setTimeout(() => zone.sonosService.updateCharacteristic(Characteristic.On, true), 250);
        } else {
            promises.push(zone.device.sonos.leaveGroup());
        }

        Promise.all(promises).then(() => {
            setTimeout(() => {
                console.log('wait off')
                platform.wait = false;
                platform.updateSonosModel();
                platform.setHomeKit();
            }, 500);
        });
    }
}

/**
 * Defines the export of the file.
 */
module.exports = SonosZone;

/* FIXME
- group volume to zero
- group off
- remote controlled
*/