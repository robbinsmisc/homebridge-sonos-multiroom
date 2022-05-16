
const { Listener, DeviceDiscovery } = require('sonos');

const SonosZone = require('./sonos-zone');
const SonosApi = require('./sonos-api');
const sonos = require('sonos');

/**
 * Initializes a new platform instance for the Sonos multiroom plugin.
 * @param log The logging function.
 * @param config The configuration that is passed to the plugin (from the config.json file).
 * @param api The API instance of homebridge (may be null on older homebridge versions).
 */
function SonosMultiroomPlatform(log, config, api) {
    const platform = this;

    // Saves objects for functions
    platform.Accessory = api.platformAccessory;
    platform.Categories = api.hap.Accessory.Categories;
    platform.Service = api.hap.Service;
    platform.Characteristic = api.hap.Characteristic;
    platform.UUIDGen = api.hap.uuid;
    platform.hap = api.hap;
    platform.pluginName = 'homebridge-sonos-multiroom';
    platform.platformName = 'SonosMultiroomPlatform';

    // Checks whether a configuration is provided, otherwise the plugin should not be initialized
    if (!config) {
        return;
    }

    // Defines the variables that are used throughout the platform
    platform.log = log;
    platform.config = config;
    platform.accessories = [];
    platform.devices = [];
    platform.zones = [];
    platform.groups = [];
    platform.wait = false;

    // Initializes the configuration
    platform.config.zones = platform.config.zones || [];
    platform.config.discoveryTimeout = platform.config.discoveryTimeout || 5000;
    platform.config.isApiEnabled = platform.config.isApiEnabled || false;
    platform.config.apiPort = platform.config.apiPort || 40809;
    platform.config.apiToken = platform.config.apiToken || null;

    // Checks whether the API object is available
    if (!api) {
        platform.log('Homebridge API not available, please update your homebridge version!');
        return;
    }

    // Saves the API object to register new devices later on
    platform.log('Homebridge API available.');
    platform.api = api;

    // Subscribes to the event that is raised when homebridge finished loading cached accessories
    platform.api.on('didFinishLaunching', function () {
        platform.log('Cached accessories loaded.');

        // Registers the shutdown event
        platform.api.on('shutdown', function () {
            Listener.stopListener().then(function() {}, function() {});
        });
        
        // Discovers the Sonos devices
        const discovery = DeviceDiscovery({ timeout: platform.config.discoveryTimeout });
        discovery.on('DeviceAvailable', function (sonos) {
            platform.log('Device discovered: ' + sonos.host);
            platform.devices.push({
                sonos: sonos
            });
        })
        discovery.once('timeout', function () {
            platform.log('Discovery completed, ' + platform.devices.length + ' device(s) found.');

            // Checks if any devices have been found
            if (!platform.devices.length) {
                return;
            }

            // Gets the device information
            let promises = [];
            for (let i = 0; i < platform.devices.length; i++) {
                const device = platform.devices[i];

                // Gets the zone attributes of the device
                promises.push(device.sonos.getZoneAttrs().then(function(zoneAttrs) {
                    device.zoneName = zoneAttrs.CurrentZoneName;
                }, function() {
                    platform.log('Error while getting zone attributes of ' + device.sonos.host + '.');
                }));

                // Gets the zone group attributes of the zone
                promises.push(device.sonos.zoneGroupTopologyService().GetZoneGroupAttributes().then(function(zoneGroupAttrs) {
                    device.isZoneMaster = zoneGroupAttrs.CurrentZoneGroupID !== '';
                }, function() {
                    platform.log('Error while getting zone group attributes of ' + device.sonos.host + '.');
                }));

                // Gets the device description
                promises.push(device.sonos.deviceDescription().then(function(deviceDescription) {
                    device.manufacturer = deviceDescription.manufacturer;
                    device.modelNumber = deviceDescription.modelNumber;
                    device.modelName = deviceDescription.modelName;
                    device.serialNumber = deviceDescription.serialNum;
                    device.softwareVersion = deviceDescription.softwareVersion;
                    device.hardwareVersion = deviceDescription.hardwareVersion;
                    device.UUID = deviceDescription.UDN.replace('uuid:','');
                    device.state = 'STOPPED';
                    device.mute = false;
                    device.volume = 10;
                    device.minVolume = 2;
                    device.maxVolume = 40;
                    device.currentTrack = '';
                    device.tvTrack = false;
                    device.isCoordinator = false;
                    device.isGrouped = false;
                    device.group = [];

                    // Gets the possible inputs
                    for (let j = 0; j < deviceDescription.serviceList.service.length; j++) {
                        const service = deviceDescription.serviceList.service[j];
                        if (service.serviceId.split(':')[3] === 'AudioIn') {
                            device.audioIn = true;
                        }
                        if (service.serviceId.split(':')[3] === 'HTControl') {
                            device.htControl = true;
                        }
                    }
                }, function() {
                    platform.log('Error while getting device description of ' + device.sonos.host + '.');
                }));
            }

            // Creates the zone objects
            Promise.all(promises).then(function() {
                const zoneMasterDevices = platform.devices.filter(function(d) { return d.isZoneMaster; });
                for (let i = 0; i < zoneMasterDevices.length; i++) {
                    const zoneMasterDevice = zoneMasterDevices[i];

                    // Gets the corresponding zone configuration
                    const config = platform.config.zones.find(function(z) { return z.name === zoneMasterDevice.zoneName; });
                    if (!config) {
                        platform.log('No configuration provided for zone with name ' + zoneMasterDevice.zoneName + '.');
                        continue;
                    }

                    // Creates the zone instance and adds it to the list of all zones
                    platform.log('Create zone with name ' + zoneMasterDevice.zoneName + '.');
                    platform.zones.push(new SonosZone(platform, zoneMasterDevice, config));
                }

                // Removes the accessories that are not bound to a zone
                let unusedAccessories = [];
                let undiscoveredAccessories = platform.accessories.filter(function(a) { return !platform.zones.some(function(z) { return z.name === a.context.name; }); });
                for (let i = 0; i < undiscoveredAccessories.length; i++) {
                    const undiscoveredAccessory = undiscoveredAccessories[i];

                    // In case the discovery hasn't found the Sonos device, its corresponding accessories are not removed if they are present in the configuration
                    const config = platform.config.zones.find(function(z) { return z.name === undiscoveredAccessory.context.name; });
                    if (!config) {
                        platform.log('Removing accessory with name ' + undiscoveredAccessory.context.name + ' and kind ' + undiscoveredAccessory.context.kind + '.');
                        unusedAccessories.push(undiscoveredAccessory);
                    } else {
                        platform.log('No device discovered for accessory with name ' + undiscoveredAccessory.context.name + ' and kind ' + undiscoveredAccessory.context.kind + '. Try increasing the discovery timeout.');
                    }

                    platform.accessories.splice(platform.accessories.indexOf(undiscoveredAccessory), 1);
                }
                platform.api.unregisterPlatformAccessories(platform.pluginName, platform.platformName, unusedAccessories);
                platform.log('Initialization completed.');
            }, function() {
                platform.log('Error while initializing plugin.');
            });
        });

        // Starts the API if requested
        if (platform.config.isApiEnabled) {
            platform.sonosApi = new SonosApi(platform);
        }
    });
}

SonosMultiroomPlatform.prototype.updateSonosModel = function() {
    const platform = this;

    platform.zones.forEach((z) => {
        z.sonos.volume = z.device.volume;
        z.sonos.groupMember = [];

        if (z.device.currentTrack.split(':')[0] === 'x-rincon' && z.device.state.toLowerCase() === 'playing') {
            z.sonos.isGrouped = true;
            z.sonos.isCoordinator = false;
            z.sonos.groupCoordinator = z.device.currentTrack.split(':')[1];

            // check if coordinator is playing
            if (z.platform.zones.find((zs) => zs.device.UUID === z.sonos.groupCoordinator).device.state.toLowerCase() !== 'transitioning') {
                z.sonos.state = z.platform.zones.find((zs) => zs.device.UUID === z.sonos.groupCoordinator).device.state.toLowerCase() === 'playing';
            }
        } else {
            if (z.device.state.toLowerCase() !== 'transitioning') {
                z.sonos.state = z.device.state.toLowerCase() === 'playing';
            }

            // check if any other zones reference this one
            const members = z.platform.zones.filter((zs) => { 
                const trackSplit = zs.device.currentTrack.split(':');
                return trackSplit[0] === 'x-rincon' && trackSplit[1] === z.sonos.UUID;
            });

            members.forEach((m) => z.sonos.groupMember.push(m.device.UUID));

            z.sonos.isGrouped = z.sonos.groupMember.length > 0;
            z.sonos.isCoordinator = z.sonos.isGrouped;
        }
    });
}

SonosMultiroomPlatform.prototype.setHomeKit = function() {
    const platform = this;
    const { Characteristic } = platform;

    platform.zones.forEach((z) => {
        z.sonosService.updateCharacteristic(Characteristic.On, z.sonos.state);
        z.sonosService.updateCharacteristic(Characteristic.StatusLowBattery, z.sonos.state && z.sonos.isCoordinator); // FIXME check for zones playing
        z.sonosService.updateCharacteristic(Characteristic.Brightness, z.sonos.volume);
    });
}

SonosMultiroomPlatform.prototype.updateGlobalState = function() {
    const platform = this;
    platform.getGlobalState(platform.setGlobalState);
}

SonosMultiroomPlatform.prototype.getGlobalState = function(callback, zone) {
    const platform = this;
    const { Characteristic } = platform;
    let promises = [];

    // get all groups
    promises.push(platform.zones[0].device.sonos.getAllGroups().then(function(groups) {
        const zoneUUID = platform.zones.map(function(z) { return z.device.UUID; });
        platform.groups = groups.filter(function(g) { return zoneUUID.some(function(zID) { return zID === g.Coordinator; }); });
    }, function() {
        // error handling
    }));

    // get volume and current state of each zone
    for (let i = 0; i < platform.zones.length; i++) {
        const device = platform.zones[i].device;

        promises.push(device.sonos.getVolume().then(function(volume) {
            device.volume = Math.max(volume, device.minVolume);
        }, function() {
            // error handling
        }));

        promises.push(device.sonos.getCurrentState().then(function(state) {
            device.state = state;
        }, function() {
            // error handling
        }));

        // useful media data
        if (device.htControl && !platform.zones[i].config.tvOverride) {
            promises.push(device.sonos.currentTrack().then(function(track) {
                device.tvTrack = currentTrack && currentTrack.uri && currentTrack.uri.endsWith(':spdif');
            }));
        }
    }

    Promise.all(promises).then(function() {
        if (zone && callback) {
            callback(zone);
        } else if (callback) {
            callback(platform);
        }
        platform.wait = false;
    }, function() {
        // error handling
    });
}

SonosMultiroomPlatform.prototype.setGlobalState = function(platform) {
    if (!platform) {
        platform = this;
    }

    const { Characteristic } = platform;

    platform.zones.forEach(function(z) {
        const device = z.device;
        const group = platform.groups.find(function(g) { return g.ZoneGroupMember.find(function(gm) { return gm.UUID === device.UUID; }); });
        let state = '';

        // power - conditioned on group coordinator
        if (device.state !== 'transitioning') {
            if (device.UUID === group.Coordinator) {
                state = device.state;
            } else {
                state = platform.zones.find(function(z) { return z.device.UUID === group.Coordinator; }).device.state
            }
            
            z.sonosService.updateCharacteristic(Characteristic.On, state === 'playing');
        }

        // volume
        if (z.config.volumeControlled) {
            z.sonosService.updateCharacteristic(Characteristic.Brightness, device.volume);
            z.sonosService.updateCharacteristic(Characteristic.StatusLowBattery,
                state === 'playing' && device.UUID === group.Coordinator && group.ZoneGroupMember.length > 1);
        }
    });
}

SonosMultiroomPlatform.prototype.setGroupVolume = function(zone) {
    const platform = this;
    platform.getGlobalState(platform.updateGroupVolume, zone);
}

SonosMultiroomPlatform.prototype.updateGroupVolume = function (zone) {
    const platform = zone.platform;
    const device = zone.device;
    const { Characteristic } = platform;

    let promises = [];

    const group = platform.groups.find(function(g) { return g.ZoneGroupMember.find(function(gm) { return gm.UUID === device.UUID; }); });
    const volume = zone.sonosService.getCharacteristic(Characteristic.Brightness).value;
    const volumeDiff = volume - device.volume;

    if (volumeDiff != 0) {
        if (device.UUID === group.Coordinator && group.ZoneGroupMember.length > 1) {
            for (let i = 0; i < group.ZoneGroupMember.length; i++) {
                const memberZone = platform.zones.find(function(z) { return z.name === group.ZoneGroupMember[i].ZoneName; })
                const zoneDevice = memberZone.device;
                const zoneVolume = Math.max(Math.min(zoneDevice.volume + volumeDiff, zoneDevice.maxVolume), zoneDevice.minVolume);

                promises.push(zoneDevice.sonos.setVolume(zoneVolume).then(function() {
                    memberZone.platform.log(memberZone.name + ' - volume set to: ' + zoneVolume.toString());
                    zoneDevice.volume = zoneVolume;
                }, function() {
                    // error handling
                }));
            }
        } else {
            promises.push(device.sonos.setVolume(volume).then(function() {
                zone.platform.log(zone.name + ' - volume set to: ' + volume.toString());
                device.volume = volume;
            }, function() {
                // error handling
            }));
        }
    }

    Promise.all(promises).then(function() {
        platform.setGlobalState();
        platform.wait = false;
    }, function() {
        // error handling
    });
}

/**
 * Gets the coordinator for the group of the specified device.
 * @param device The device.
 * @returns Returns a promise with the group coordinator of the device.
 */
SonosMultiroomPlatform.prototype.getGroupCoordinator = function (device) {
    const platform = this;

    // Gets the coordinator based on all groups
    return device.sonos.getAllGroups().then(function(groups) {
        const group = groups.find(function(g) { return g.ZoneGroupMember.some(function(m) { return m.ZoneName === device.zoneName; }); });
        const coordinatorDevice = platform.devices.find(function(d) { return d.sonos.host === group.host; });
        return coordinatorDevice.sonos;
    });
}

/**
 * Configures a previously cached accessory.
 * @param accessory The cached accessory.
 */
SonosMultiroomPlatform.prototype.configureAccessory = function (accessory) {
    const platform = this;

    // Adds the cached accessory to the list
    platform.accessories.push(accessory);
}

/**
 * Defines the export of the file.
 */
module.exports = SonosMultiroomPlatform;
