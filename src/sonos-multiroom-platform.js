
const { Listener, DeviceDiscovery } = require('sonos');

const SonosZone = require('./sonos-zone');
const SonosApi = require('./sonos-api');
const SonosControl = require('./sonos-control');
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
    platform.globalControl = [];
    platform.devices = [];
    platform.zones = [];
    platform.groups = [];
    platform.wait = [];

    // Initializes the configuration
    platform.config.zones = platform.config.zones || [];
    platform.config.discoveryTimeout = platform.config.discoveryTimeout || 5000;
    platform.config.isApiEnabled = platform.config.isApiEnabled || false;
    platform.config.apiPort = platform.config.apiPort || 40809;
    platform.config.apiToken = platform.config.apiToken || null;
    platform.config.globalSwitch = platform.config.globalSwitch || null;

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

                // Check and add global controls
                if (platform.config.globalControl) {
                    platform.globalControl = new SonosControl(platform, platform.config.globalControl);
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
                // FIXME global controls
                unusedAccessories = unusedAccessories.filter((ua) => ua.context.name !== 'Sonos Settings');
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

SonosMultiroomPlatform.prototype.updateSonosModel = function(platform, callback) {
    if (!platform) {
        platform = this;
    }

    if (platform.wait.length != 0) {
        return;
    }

    platform.zones.forEach((z) => {
        if (z.sonos.volumeLock.length == 0) {
            z.sonos.volume = z.device.volume;
        }
        
        z.sonos.groupMember = [];

        if (z.device.currentTrack && z.device.currentTrack.split(':')[0] === 'x-rincon' && z.device.state.toLowerCase() === 'playing') {
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
                if (zs.device.currentTrack) {
                    const trackSplit = zs.device.currentTrack.split(':');
                    return trackSplit[0] === 'x-rincon' && trackSplit[1] === z.sonos.UUID;
                }

                return false;
            });

            members.forEach((m) => z.sonos.groupMember.push(m.device.UUID));

            z.sonos.isGrouped = z.sonos.groupMember.length > 0;
            z.sonos.isCoordinator = z.sonos.isGrouped;
        }
    });

    platform.setHomeKit();

    if (callback) {
        callback(platform);
    }
}

SonosMultiroomPlatform.prototype.setHomeKit = function(platform) {
    if (!platform) {
        platform = this;
    }

    const { Characteristic } = platform;

    platform.zones.forEach((z) => {
        z.sonosService.updateCharacteristic(Characteristic.On, z.sonos.state);
        z.sonosService.updateCharacteristic(Characteristic.StatusLowBattery, z.sonos.state && z.sonos.isCoordinator);
        z.sonosService.updateCharacteristic(Characteristic.Brightness, z.sonos.volume);
    });

    // update global controls
    platform.globalControl.powerService.updateCharacteristic(Characteristic.On, 
        platform.zones.some((z) => z.sonos.state));

    platform.globalControl.muteService.updateCharacteristic(Characteristic.On, 
        platform.zones.some((z) => z.device.mute));
}

SonosMultiroomPlatform.prototype.getGlobalState = function(callback, zone) {
    const platform = this;
    const { Characteristic } = platform;
    let promises = [];
    
    // get all groups
    promises.push(platform.zones[0].device.sonos.getAllGroups().then((groups) => {
        const zoneUUID = platform.zones.map((z) => z.device.UUID);
        platform.groups = groups.filter((g) => zoneUUID.some((zID) => zID === g.Coordinator));
    }, () => {
        platform.log('--- Global Get Group Error ---')
    }));

    // get volume and current state of each zone
    for (let i = 0; i < platform.zones.length; i++) {
        const device = platform.zones[i].device;

        promises.push(device.sonos.getVolume().then((volume) => {
            device.volume = Math.max(volume, device.minVolume);
        }, () => {
            platform.log('--- Global Get Volume Error ---')
        }));

        promises.push(device.sonos.getMuted().then((mute) => {
            device.mute = mute;
        }, () => {
            platform.log('--- Global Get Mute Error ---')
        }));

        promises.push(device.sonos.getCurrentState().then((state) => {
            device.state = state;
        }, () => {
            platform.log('--- Global Get State Error ---')
        }));

        // useful media data
        promises.push(device.sonos.currentTrack().then((track) => {
            if (track.uri) {
                device.currentTrack = track.uri;

                if (device.htControl) {
                    device.tvTrack = track.uri.endsWith(':spdif');
                }
            } else {
                device.currentTrack = '';
                device.tvTrack = false;
            }
        }, () => {
            platform.log('--- Global Get Track Error ---')
        }));
    }

    Promise.all(promises).then(() => {
        if (zone && callback) {
            callback(zone);
        } else if (callback) {
            callback(platform);
        }
    }, () => {
        platform.log('--- Global Get Error ---')
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
