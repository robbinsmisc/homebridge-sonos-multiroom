/**
* "name": 'Sonos Zone'                  Sonos device
* "priorities": ['','']                 array of strings for the preferred Sonos zones to automatically join
* "autoGroup": ['','']                  array of strings for Sonos devices to auto join designated coordinator
* "isAutoPlayDisabled": True | False    (default false) disable autoplay 
* "defaultGroupVolume": 16              absolute volume - relative differences used when grouping volume controlled devices 
* "volumeControlled": True | False      (default false) creates a dimmable lightbulb accessory
* "groupOverride":  True | False        (default false) coordinator can turn off the entire group
* "tvOverride": True | False            (default false) allow HT controlled devices to be turned off
* "remotelyControlled":  True | False   (default false) 
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
    zone.timeout = {"global": 4000, "volumeControl": 2000, "homekit": 250}; // milliseconds
    zone.sonos = {
        'name': zone.name,                          // string: human readable
        'UUID': zone.device.UUID,                   // string
        'state': false,                             // true | false: playing = true, transitioning = previous, o.w. = off
        'volume': 10,                               // int bounded by device min/max volume
        'refVolume': config.defaultGroupVolume,     // int
        'remoteVolume': config.defaultGroupVolume,  // int
        'volumeLock': [],                           // array of booleans
        'isGrouped': false,                         // true | false
        'isCoordinator': false,                     // true | false
        'groupCoordinator': '',                     // string: quick reference of coordinator UUID
        'groupMember': []                           // array of RINCON strings
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

    // Removes all unused accessories associated with the zone
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
            zone.sonos.remoteVolume = volume;
            zone.sonos.volume = volume;
            sonosService.setCharacteristic(Characteristic.Brightness, volume);
        });
    }

    zone.device.sonos.getCurrentState().then((state) => {
        let onState = state.toLowerCase() === 'playing';

        zone.device.sonos.currentTrack().then((track) => {
            if (track.uri) {
                // strictly coordinators initialize on
                onState &&= !track.uri.startsWith('x-rincon');
            }

            sonosService.setCharacteristic(Characteristic.On, onState);
        });
    });

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
            platform.log(zone.name + ' set to ' + value.toString())
        }

        callback(null);
    });

    if (sonosService.getCharacteristic(Characteristic.Brightness)) {
        sonosService.getCharacteristic(Characteristic.Brightness).on('set', function (value, callback) {
            zone.setVolume(value);
            platform.log(zone.name + ' brightness set to ' + value.toString())
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
        platform.log(zone.name + ' event ' + eventData.TransportState)
        
        if (eventData.TransportState) {
            zone.device.state = eventData.TransportState;
        }

        if (eventData.CurrentTrackURI) {
            zone.device.currentTrack = eventData.CurrentTrackURI;

            if (zone.device.htControl) {
                zone.device.tvTrack = eventData.CurrentTrackURI.endsWith(':spdif');
            }
        }

        platform.updateSonosModel();
    });

    // Subscribes for changes in the rendering control
    zone.device.sonos.on('RenderingControl', function (eventData) {
        if (eventData.Volume) {
            const volume = parseInt(eventData.Volume.find(function(obj) { return obj.channel === 'Master' }).val);

            if (zone.device.volume != volume) {
                // update volume
                zone.device.volume = volume;
                platform.log(zone.name + ' volume set to ' + zone.device.volume.toString());

                // remote volume control
                let zoneCoordinator = zone;

                if (!zone.sonos.isCoordinator && zone.sonos.isGrouped) {
                    zoneCoordinator = platform.zones.find((z) => z.sonos.UUID === zone.sonos.groupCoordinator);   
                }

                let remotelyControlled = zoneCoordinator.config.remotelyControlled;
                remotelyControlled &&= zoneCoordinator.sonos.isCoordinator;
                remotelyControlled &&= zoneCoordinator.sonos.isGrouped;
                remotelyControlled &&= platform.globalControl.remoteVolumeOverrideService.getCharacteristic(Characteristic.On).value;
                remotelyControlled &&= platform.wait.length == 0; // ignore HomeKit-invoked events

                if (remotelyControlled) {
                    console.log(zone.name + ' is remotely controlled') // FIXME

                    // push volume lock promise
                    zoneCoordinator.sonos.volumeLock.push(true);
                    zoneCoordinator.sonos.groupMember.forEach((gm) => {
                        platform.zones.find((z) => z.sonos.UUID === gm).sonos.volumeLock.push(true);
                    });

                    let volumeLockTimer = new Promise((resolve) => {
                        setTimeout(() => {
                            console.log('lock volume promise resolved'); // FIXME
                            resolve(true);
                        }, zone.timeout.volumeControl);
                    });

                    volumeLockTimer.then(() => {
                        // update group prior to removing last volumeLock
                        // note that the coordinator calls the update function
                        zoneCoordinator.updateRemoteVolumeControl();

                        zoneCoordinator.sonos.volumeLock.shift();
                        zoneCoordinator.sonos.groupMember.forEach((gm) => {
                            platform.zones.find((z) => z.sonos.UUID === gm).sonos.volumeLock.shift();
                        });  

                        if (zoneCoordinator.sonos.volumeLock.length == 0) {
                            platform.updateSonosModel(); 
                        }                  
                    }, () => {
                        // error handling
                    });
                }
            }
        }

        if (eventData.Mute) {
            zone.device.mute = parseInt(eventData.Mute.find(function(obj) { return obj.channel === 'Master' }).val);
            platform.log(zone.name + ' mute: ' + zone.device.mute.toString());
        }
        
        // Updates the night mode
        if (nightModeSwitchService && eventData.NightMode) {
            if (zone.nightModeSwitchService.getCharacteristic(Characteristic.On).value.toString() !== eventData.NightMode.val) {
                zone.platform.log(zone.name + ' - Updating night mode: ' + (eventData.NightMode.val === '1' ? 'ON' : 'OFF'));
            }
            zone.nightModeSwitchService.updateCharacteristic(Characteristic.On, eventData.NightMode.val === '1');
        }

        // Updates the speed enhancement
        if (speechEnhancementSwitchService && eventData.DialogLevel) {
            if (zone.speechEnhancementSwitchService.getCharacteristic(Characteristic.On).value.toString() !== eventData.DialogLevel.val) {
                zone.platform.log(zone.name + ' - Updating speech enhancement: ' + (eventData.DialogLevel.val === '1' ? 'ON' : 'OFF'));
            }
            zone.speechEnhancementSwitchService.updateCharacteristic(Characteristic.On, eventData.DialogLevel.val === '1');
        }

        platform.updateSonosModel();
    });
}

/**
 * 
 */
SonosZone.prototype.updateRemoteVolumeControl = function () {
    const zone = this;
    const platform = zone.platform;

    if (zone.sonos.volumeLock.length > 1) {
        return;
    } else {
        // compare volumes and update the entire group
        const group = JSON.parse(JSON.stringify(zone.sonos.groupMember));
        group.push(zone.sonos.UUID);
        const zones = platform.zones.filter((z) => group.some((g) => g === z.sonos.UUID));

        // volumes
        const deviceVolume = zones.map((z) => z.device.volume);     // updated every time sonos reports and event
        const modelVolume = zones.map((z) => z.sonos.volume);       // updated internally and synced after HomeKit actions are complete
        const refVolume = zones.map((z) => z.sonos.remoteVolume);   // snapshot when the group was created

        // exit if relative gain is the same for every zone
         if (deviceVolume.map((dv,idx) => dv - refVolume[idx]).every((val, idx, arr) => val === arr[0])) {
            // volumes are correct - break event feedback loop
            return;
         }

        let volumeDiff = deviceVolume.map((dv,idx) => dv - modelVolume[idx]);
        const num = volumeDiff.reduce((sum, next) => sum + next);
        const den = Math.max(volumeDiff.reduce((sum, next) => sum + ((next == 0) ? 0 : 1), 0), 1);

        // update volume
        let newVolume = modelVolume.map((mv, idx) => {
            var nv = mv + Math.floor(num/den);
            nv = Math.max(Math.min(nv, zones[idx].device.maxVolume), zones[idx].device.minVolume);
            
            return (nv) ? nv : deviceVolume[idx];
        });

        // check against reference; i.e., bugs or bounds
        if (!newVolume.map((dv,idx) => dv - refVolume[idx]).every((val, idx, arr) => val === arr[0])) {
            // calculate smallest difference
            volumeDiff = newVolume.map((dv,idx) => dv - refVolume[idx]).reduce((prev,next) => {
                // minimum magnitude
                return (Math.abs(prev) < Math.abs(next)) ? prev : next;
            }); 
            newVolume = refVolume.map((rf, idx) => {
                var nv = rf + volumeDiff;
                nv = Math.max(Math.min(nv, zones[idx].device.maxVolume), zones[idx].device.minVolume);
                
                return (nv) ? nv : deviceVolume[idx];
            });
         }

        let promises = [];

        zones.forEach((z,idx) => {
            if (deviceVolume[idx] != newVolume[idx]) {
                z.sonos.volume = newVolume[idx];

                promises.push(z.device.sonos.setVolume(newVolume[idx]).then(() => {
                    platform.log(z.name + ' volume updated to ' + newVolume[idx].toString() + ' (volume controlled)');
                }));
            }
        });

        Promise.all(promises).then(() => {
            if (platform.wait.length == 0) {
                platform.log('Sonos --- Global Sync (volume controlled) ---');
                platform.getGlobalState(platform.updateSonosModel);
            }
        }, () => {
            platform.log('--- Remote Volume Control Error ---');
        });
    }
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

    // guard against a minimum volume (brightness of 0)
    const cmdVolume = Math.max(Math.min(volume, zone.device.maxVolume), zone.device.minVolume);

    if (cmdVolume != volume) {
        zone.sonosService.updateCharacteristic(Characteristic.Brightness,cmdVolume);
    }

    let promises = [];
    platform.wait.push(true);

    promises.push(zone.device.sonos.setVolume(cmdVolume));

    if (zone.sonos.isCoordinator && zone.sonos.isGrouped) {
        zone.sonos.groupMember.forEach((gm) => {
            const memberZone = platform.zones.find((z) => z.sonos.UUID === gm);
            const memberVolume = Math.max(Math.min(cmdVolume - zone.sonos.volume + memberZone.sonos.volume, 
                memberZone.device.maxVolume), memberZone.device.minVolume);
            
            promises.push(memberZone.device.sonos.setVolume(memberVolume));
            memberZone.sonosService.updateCharacteristic(Characteristic.Brightness, memberVolume);
            memberZone.sonos.volume = memberVolume;
            memberZone.sonos.remoteVolume = memberZone.sonos.volume;
        });
    }

    zone.sonos.volume = cmdVolume;
    zone.sonos.remoteVolume = zone.sonos.volume;

    Promise.all(promises).then(() => {
        setTimeout(() => {
            platform.wait.shift();

            if (platform.wait.length == 0) {
                platform.log('Sonos --- Global Sync ---')
                platform.getGlobalState(platform.updateSonosModel);
            }
        }, zone.timeout.global);
    });
};

/**
 * On/Off function
 * @param stateValue: True | False for on and off
 */
SonosZone.prototype.setState = function (stateValue) {
    const zone = this;
    const platform = zone.platform;
    const config = zone.config
    const { Characteristic } = platform;
    const sonos = platform.zones.map((obj) => obj.sonos);

    let promises = [];
    platform.wait.push(true);

    if (stateValue) {
        // check priority zone
        const priority = config.priorities.find((p) => {
            const sonosPriority = sonos.find((sp) => sp.name === p);

            return sonosPriority ? sonosPriority.state : false;
        });

        if (priority) {
            // join active priority zone
            const prioritySonos = sonos.find((s) => s.name === priority);

            // turn on
            promises.push(zone.device.sonos.joinGroup(priority));
            zone.sonos.state = false;
            zone.sonos.isCoordinator = false;
            zone.sonos.isGrouped = true;
            zone.sonos.groupCoordinator = prioritySonos.UUID;
            zone.sonos.groupMember = [];

            // relative volume gains
            if (prioritySonos.refVolume && zone.sonos.refVolume) {
                const memberVolume = prioritySonos.volume - prioritySonos.refVolume + zone.sonos.refVolume;
                promises.push(zone.device.sonos.setVolume(memberVolume));
                zone.sonos.volume = memberVolume;
            }

            prioritySonos.remoteVolume = prioritySonos.volume;
            zone.sonos.remoteVolume = sonos.volume;

            if (zone.device.mute) {
                promises.push(zone.device.sonos.setMuted(false));
            }
        } else if(!config.isAutoPlayDisabled) {
            // auto play
            promises.push(zone.device.sonos.play());
            zone.sonos.state = true;
            zone.remoteVolume = zone.sonos.volume;
            zone.sonos.isCoordinator = false;
            zone.sonos.isGrouped = false;
            zone.sonos.groupCoordinator = '';
            zone.sonos.groupMember = [];

            if (zone.device.mute) {
                promises.push(zone.device.sonos.setMuted(false));
            }
            
            // auto group
            if (config.autoGroup) {
                const autoGroup = config.autoGroup.filter((ag) => platform.zones.find((z) => ag === z.name && !z.sonos.state));

                if (autoGroup) {
                    zone.sonosService.setCharacteristic(Characteristic.StatusLowBattery, 1);
                    zone.sonos.isCoordinator = true;
                    zone.sonos.isGrouped = true;

                    autoGroup.forEach((ag) => {
                        const autoZone = platform.zones.find((z) => z.name === ag);

                        promises.push(autoZone.device.sonos.joinGroup(zone.name));
                        autoZone.sonos.state = true;
                        autoZone.sonos.isCoordinator = false;
                        autoZone.sonos.isGrouped = true;
                        autoZone.sonos.groupCoordinator = zone.sonos.UUID;
                        autoZone.sonos.groupMember = [];

                        if (zone.sonos.groupMember.indexOf(autoZone.sonos.UUID) == -1) {
                            zone.sonos.groupMember.push(autoZone.sonos.UUID);
                        }

                        // relative volume gains
                        let azVolume = Math.max(autoZone.sonos.volume, autoZone.device.minVolume);

                        if (autoZone.sonos.refVolume && zone.sonos.refVolume) {
                            azVolume = zone.sonos.volume - zone.sonos.refVolume + autoZone.sonos.refVolume;
                            azVolume = Math.max(Math.min(azVolume, autoZone.device.maxVolume), autoZone.device.minVolume);

                            promises.push(autoZone.device.sonos.setVolume(azVolume));
                            autoZone.sonos.volume = azVolume;   
                        }

                        autoZone.sonos.remoteVolume = autoZone.sonos.volume;

                        if (autoZone.device.mute) {
                            promises.push(autoZone.device.sonos.setMuted(false));
                        }

                        autoZone.sonosService.updateCharacteristic(Characteristic.Brightness, azVolume);
                        autoZone.sonosService.updateCharacteristic(Characteristic.On, true);
                    });
                }
            }
        } else {
            // remain off
            zone.sonos.state = false;
            zone.sonos.isCoordinator = false;
            zone.sonos.isGrouped = false;
            zone.sonos.groupCoordinator = '';
            zone.sonos.groupMember = [];

            setTimeout(() => zone.sonosService.updateCharacteristic(Characteristic.On, false), zone.timeout.homekit);
        }
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
                groupZone.sonos.state = false;
                groupZone.sonos.isCoordinator = false;
                groupZone.sonos.isGrouped = false;
                groupZone.sonos.groupCoordinator = '';
                groupZone.sonos.groupMember = [];
                groupZone.device.currentTrack = '';
            });
        }

        // set minimum HomeKit service value; i.e., brightness = 0% turns off lightbulb, which will turn on at 100%
        zone.sonosService.updateCharacteristic(Characteristic.Brightness,
                Math.max(zone.sonos.volume, zone.device.minVolume));
        zone.sonosService.updateCharacteristic(Characteristic.StatusLowBattery, false);

        if (zone.device.htControl && zone.device.tvTrack && !config.tvOverride) {
            setTimeout(() => zone.sonosService.updateCharacteristic(Characteristic.On, true), zone.timeout.homekit);
            zone.sonos.state = true;
            zone.sonos.isCoordinator = false;
            zone.sonos.isGrouped = false;
            zone.sonos.groupCoordinator = '';
            zone.sonos.groupMember = [];  
        } else {
            // remove from coordinator's group tracking
            const coordinatorZone = platform.zones.find((z) => z.sonos.UUID === zone.sonos.groupCoordinator);

            if (coordinatorZone) {
                coordinatorZone.sonos.groupMember = coordinatorZone.sonos.groupMember.filter((z) => z !== zone.sonos.UUID);

                // the coordinator is the only device playing
                if (coordinatorZone.sonos.groupMember.length == 0) {
                    coordinatorZone.sonos.isCoordinator = false;
                    coordinatorZone.sonos.isGrouped = false;
                    coordinatorZone.sonos.groupCoordinator = '';
                }
            }

            promises.push(zone.device.sonos.leaveGroup());
            zone.sonos.state = false;
            zone.sonos.isCoordinator = false;
            zone.sonos.isGrouped = false;
            zone.sonos.groupCoordinator = '';
            zone.sonos.groupMember = [];
        }
    }

    Promise.all(promises).then(() => {
        setTimeout(() => {
            platform.wait.shift();
            
            if (platform.wait.length == 0) {
                platform.log('Sonos --- Global Sync ---')
                platform.getGlobalState(platform.updateSonosModel);
            }
        }, zone.timeout.global);
    });
}

/**
 * Defines the export of the file.
 */
module.exports = SonosZone;