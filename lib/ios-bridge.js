const fs = require('fs');
const path = require('path');
const { Usbmux, getDefaultSocket } = require('appium-ios-device/build/lib/usbmux');
const { HouseArrestService } = require('appium-ios-device/build/lib/house-arrest');
const { InstallationProxyService } = require('appium-ios-device/build/lib/installation-proxy');
const { PlistService } = require('appium-ios-device/build/lib/plist-service');
const { plist: plistUtil } = require('@appium/support');
const { upgradeToSSL } = require('appium-ios-device/build/lib/ssl-helper');
const EventEmitter = require('events');

const PRODUCT_TYPE_NAMES = {
  'iPhone10,3': 'iPhone X',
  'iPhone10,6': 'iPhone X',
  'iPhone11,2': 'iPhone XS',
  'iPhone11,4': 'iPhone XS Max',
  'iPhone11,6': 'iPhone XS Max',
  'iPhone11,8': 'iPhone XR',
  'iPhone12,1': 'iPhone 11',
  'iPhone12,3': 'iPhone 11 Pro',
  'iPhone12,5': 'iPhone 11 Pro Max',
  'iPhone12,8': 'iPhone SE (2nd gen)',
  'iPhone13,1': 'iPhone 12 mini',
  'iPhone13,2': 'iPhone 12',
  'iPhone13,3': 'iPhone 12 Pro',
  'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini',
  'iPhone14,5': 'iPhone 13',
  'iPhone14,2': 'iPhone 13 Pro',
  'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,6': 'iPhone SE (3rd gen)',
  'iPhone14,7': 'iPhone 14',
  'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro',
  'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15',
  'iPhone15,5': 'iPhone 15 Plus',
  'iPhone16,1': 'iPhone 15 Pro',
  'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone17,1': 'iPhone 16 Pro',
  'iPhone17,2': 'iPhone 16 Pro Max',
  'iPhone17,3': 'iPhone 16',
  'iPhone17,4': 'iPhone 16 Plus',
};

const CATEGORIES = {
  Videos: ['.mp4', '.mkv', '.mov', '.avi', '.m4v', '.wmv', '.flv', '.webm', '.ts', '.3gp'],
  Audio: ['.mp3', '.m4a', '.flac', '.wav', '.aac', '.ogg', '.wma', '.aiff', '.alac'],
  Documents: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv', '.epub', '.pages', '.numbers', '.key'],
  Photos: ['.jpg', '.jpeg', '.png', '.heic', '.gif', '.webp', '.bmp', '.svg', '.tiff'],
  Archives: ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.iso']
};

function getFileCategory(filename) {
  const ext = path.extname(filename).toLowerCase();
  for (const [category, extensions] of Object.entries(CATEGORIES)) {
    if (extensions.includes(ext)) {
      return category;
    }
  }
  return 'Other';
}

class iOSBridge extends EventEmitter {
  constructor() {
    super();
    this.device = null;
    this.deviceInfo = null;
    this.isMonitoring = false;
    this.monitorInterval = null;
    this.lastStatus = 'disconnected';
    this.primaryApp = null;
    this.availableApps = [];
  }

  async getSocket() {
    const s = await getDefaultSocket({ socketPort: 27015, socketHost: '127.0.0.1' });
    s.setNoDelay(true);
    return s;
  }

  async getPairRecord(udid) {
    const lockdownDir = 'C:/ProgramData/Apple/Lockdown';
    const tmpPath = path.join(lockdownDir, `${udid}.plist.tmp`);
    const regPath = path.join(lockdownDir, `${udid}.plist`);

    if (fs.existsSync(tmpPath)) {
      try {
        const content = fs.readFileSync(tmpPath, 'utf8');
        const parsed = plistUtil.parsePlist(content);
        if (parsed && parsed.HostID && parsed.HostPrivateKey) {
          return parsed;
        }
      } catch (e) {}
    }

    if (fs.existsSync(regPath)) {
      try {
        const content = fs.readFileSync(regPath, 'utf8');
        const parsed = plistUtil.parsePlist(content);
        if (parsed && parsed.HostID && parsed.HostPrivateKey) {
          return parsed;
        }
      } catch (e) {}
    }

    const socket = await this.getSocket();
    const usbmux = new Usbmux(socket);
    try {
      return await usbmux.readPairRecord(udid);
    } finally {
      usbmux.close();
    }
  }

  async scanDevice() {
    try {
      const socket = await this.getSocket();
      const usbmux = new Usbmux(socket);
      const devices = await usbmux.listDevices();
      usbmux.close();

      if (!devices || devices.length === 0) {
        if (this.lastStatus !== 'disconnected') {
          this.lastStatus = 'disconnected';
          this.device = null;
          this.deviceInfo = null;
          this.primaryApp = null;
          this.availableApps = [];
          this.emit('device-disconnected');
        }
        return null;
      }

      const targetDevice = devices.find(d => d.Properties && d.Properties.ConnectionType === 'USB') || devices[0];
      const udid = targetDevice.Properties?.SerialNumber;

      if (!this.device || this.device.udid !== udid || this.device.deviceId !== targetDevice.DeviceID) {
        this.device = {
          udid,
          deviceId: targetDevice.DeviceID,
          connectionType: targetDevice.Properties?.ConnectionType || 'USB'
        };

        await this.fetchDeviceInfo(udid);
        await this.detectPrimaryApp(udid);

        this.lastStatus = 'connected';
        this.emit('device-connected', {
          device: this.device,
          info: this.deviceInfo,
          hostApp: this.primaryApp,
          availableApps: this.availableApps
        });
      }

      return {
        device: this.device,
        info: this.deviceInfo,
        hostApp: this.primaryApp,
        availableApps: this.availableApps
      };
    } catch (err) {
      if (this.lastStatus !== 'error') {
        this.emit('scan-error', err.message);
      }
      return null;
    }
  }

  async fetchDeviceInfo(udid) {
    try {
      const pairRecord = await this.getPairRecord(udid);
      const socket = await this.getSocket();
      const usbmux = new Usbmux(socket);
      const lockdown = await usbmux.connectLockdown(udid);

      if (pairRecord) {
        await lockdown.startSession(pairRecord.HostID, pairRecord.SystemBUID);
        lockdown.enableSessionSSL(pairRecord.HostPrivateKey, pairRecord.HostCertificate);
      }

      const all = await lockdown.getValue() || {};
      const deviceName = all.DeviceName || 'iPhone';
      const prodVersion = all.ProductVersion || 'iOS';
      const prodType = all.ProductType || 'iPhone';
      const friendlyName = PRODUCT_TYPE_NAMES[prodType] || prodType || 'iPhone';

      this.deviceInfo = {
        name: deviceName,
        model: prodType,
        friendlyModel: friendlyName,
        osVersion: prodVersion.startsWith('iOS') ? prodVersion : `iOS ${prodVersion}`,
        udid
      };

      lockdown.close();
      usbmux.close();
    } catch (err) {
      this.deviceInfo = {
        name: 'iPhone',
        model: 'iPhone',
        friendlyModel: 'iPhone 12',
        osVersion: 'iOS',
        udid
      };
    }
  }

  /**
   * Dynamically inspects the connected iPhone to find all installed apps with file sharing.
   * Prioritizes clean document & media apps (Chrome, VLC, Documents, Pages, etc.).
   */
  async detectPrimaryApp(udid) {
    const PREFERRED_APP_ORDER = [
      { id: 'com.google.chrome.ios', name: 'Chrome' },
      { id: 'org.videolan.vlc-ios', name: 'VLC' },
      { id: 'com.readdle.ReaddleDocs5', name: 'Documents' },
      { id: 'com.adobe.Adobe-Reader', name: 'Acrobat' },
      { id: 'com.abishkking.pdfreader', name: 'PDF Reader' },
      { id: 'com.apple.Pages', name: 'Pages' },
      { id: 'com.apple.Numbers', name: 'Numbers' },
      { id: 'com.apple.Keynote', name: 'Keynote' }
    ];

    try {
      const pairRecord = await this.getPairRecord(udid);
      const lockdownSocket = await this.getSocket();
      const usbmux1 = new Usbmux(lockdownSocket);
      const lockdown = await usbmux1.connectLockdown(udid);
      await lockdown.startSession(pairRecord.HostID, pairRecord.SystemBUID);
      lockdown.enableSessionSSL(pairRecord.HostPrivateKey, pairRecord.HostCertificate);

      const service = await lockdown.startService('com.apple.mobile.installation_proxy');
      const muxSocket = await this.getSocket();
      const usbmux2 = new Usbmux(muxSocket);
      const serviceSocket = await usbmux2.connect(this.device.deviceId, service.Port);
      const sslSocket = service.EnableServiceSSL
        ? upgradeToSSL(serviceSocket, pairRecord.HostPrivateKey, pairRecord.HostCertificate)
        : serviceSocket;

      const plistService = new PlistService(sslSocket);
      const iproxy = new InstallationProxyService(plistService);
      const apps = await iproxy.listApplications({
        applicationType: 'User',
        returnAttributes: ['CFBundleIdentifier', 'CFBundleDisplayName', 'CFBundleName', 'UIFileSharingEnabled']
      });

      lockdown.close();
      usbmux1.close();
      usbmux2.close();

      const sharingApps = [];
      for (const [bid, meta] of Object.entries(apps)) {
        if (meta.UIFileSharingEnabled) {
          sharingApps.push({
            id: bid,
            name: meta.CFBundleDisplayName || meta.CFBundleName || bid
          });
        }
      }

      // Sort by preference (known file/media containers first)
      sharingApps.sort((a, b) => {
        const indexA = PREFERRED_APP_ORDER.findIndex(p => p.id === a.id);
        const indexB = PREFERRED_APP_ORDER.findIndex(p => p.id === b.id);
        const scoreA = indexA !== -1 ? indexA : 999;
        const scoreB = indexB !== -1 ? indexB : 999;
        return scoreA - scoreB;
      });

      this.availableApps = sharingApps;

      // Keep user choice if still valid, otherwise default to top preferred
      if (this.primaryApp && sharingApps.some(a => a.id === this.primaryApp.id)) {
        return this.primaryApp;
      }

      if (sharingApps.length > 0) {
        this.primaryApp = sharingApps[0];
        return this.primaryApp;
      }
    } catch (e) {
      console.warn('Dynamic app discovery notice:', e.message);
    }

    this.availableApps = PREFERRED_APP_ORDER.slice(0, 3);
    this.primaryApp = this.availableApps[0];
    return this.primaryApp;
  }

  setHostApp(appId) {
    if (this.availableApps && this.availableApps.length > 0) {
      const found = this.availableApps.find(a => a.id === appId);
      if (found) {
        this.primaryApp = found;
        this.emit('host-app-changed', this.primaryApp);
        return this.primaryApp;
      }
    }
    return null;
  }

  startMonitoring(intervalMs = 2000) {
    if (this.isMonitoring) return;
    this.isMonitoring = true;
    this.scanDevice();
    this.monitorInterval = setInterval(() => {
      this.scanDevice();
    }, intervalMs);
  }

  stopMonitoring() {
    this.isMonitoring = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  getStatus() {
    return {
      connected: !!this.device,
      device: this.device,
      info: this.deviceInfo,
      hostApp: this.primaryApp,
      availableApps: this.availableApps || []
    };
  }

  async getPrimaryAfcClient(houseArrest) {
    const candidateBundles = [
      this.primaryApp,
      { id: 'com.google.chrome.ios', name: 'Chrome' },
      { id: 'org.videolan.vlc-ios', name: 'VLC' },
      { id: 'com.readdle.ReaddleDocs5', name: 'Documents' },
      { id: 'com.adobe.Adobe-Reader', name: 'Acrobat' },
      { id: 'com.abishkking.pdfreader', name: 'PDF Reader' },
      { id: 'com.apple.Pages', name: 'Pages' },
      { id: 'com.apple.Numbers', name: 'Numbers' },
      { id: 'com.apple.Keynote', name: 'Keynote' }
    ].filter(Boolean);

    for (const app of candidateBundles) {
      try {
        const afc = await houseArrest.vendDocuments(app.id);
        this.primaryApp = app;
        return { afc, app };
      } catch (e) {}
    }

    throw new Error('No compatible file-sharing app found on iPhone. Please ensure at least one app (like Chrome, VLC, Documents, or Pages) is installed.');
  }

  async transferFile({ filename, fileSize, readStream, onProgress }) {
    if (!this.device) {
      throw new Error('No iPhone connected. Connect your iPhone via USB cable.');
    }

    const udid = this.device.udid;
    const pairRecord = await this.getPairRecord(udid);
    if (!pairRecord) {
      throw new Error('iPhone is not paired. Please unlock your iPhone and tap "Trust This Computer".');
    }

    const category = getFileCategory(filename);

    // 1. Lockdown session
    const lockdownSocket = await this.getSocket();
    const usbmux1 = new Usbmux(lockdownSocket);
    const lockdown = await usbmux1.connectLockdown(udid);

    await lockdown.startSession(pairRecord.HostID, pairRecord.SystemBUID);
    lockdown.enableSessionSSL(pairRecord.HostPrivateKey, pairRecord.HostCertificate);

    // 2. HouseArrest service
    const service = await lockdown.startService('com.apple.mobile.house_arrest');
    const muxSocket = await this.getSocket();
    const usbmux2 = new Usbmux(muxSocket);
    const serviceSocket = await usbmux2.connect(this.device.deviceId, service.Port);
    serviceSocket.setNoDelay(true);

    const sslSocket = service.EnableServiceSSL
      ? upgradeToSSL(serviceSocket, pairRecord.HostPrivateKey, pairRecord.HostCertificate)
      : serviceSocket;

    const houseArrest = new HouseArrestService(sslSocket);
    const { afc, app: hostApp } = await this.getPrimaryAfcClient(houseArrest);

    // 3. Ensure ONE permanent iRush parent folder and category subfolder
    const parentFolder = 'Documents/iRush';
    const subFolder = `${parentFolder}/${category}`;

    try { await afc.createDirectory(parentFolder); } catch {}
    try { await afc.createDirectory(subFolder); } catch {}

    // 4. Open file handle
    const remotePath = `${subFolder}/${filename}`;
    const fileHandle = await afc.openFile(remotePath, 3);

    // 5. 2 MB write buffer for maximum USB throughput
    const BATCH_SIZE = 2 * 1024 * 1024;
    let bufferList = [];
    let bufferedLength = 0;

    let transferredBytes = 0;
    let lastTime = Date.now();
    let lastBytes = 0;
    let currentSpeed = 0;

    const flushBuffer = async () => {
      if (bufferedLength === 0) return;
      const combined = Buffer.concat(bufferList, bufferedLength);
      bufferList = [];
      bufferedLength = 0;

      await afc.writeFile(fileHandle, combined);
      transferredBytes += combined.length;

      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed >= 0.15) {
        const deltaBytes = transferredBytes - lastBytes;
        currentSpeed = deltaBytes / elapsed;
        lastBytes = transferredBytes;
        lastTime = now;

        if (onProgress) {
          const percent = fileSize > 0 ? Math.min(100, (transferredBytes / fileSize) * 100) : 0;
          onProgress({
            filename,
            category,
            appName: hostApp.name,
            transferred: transferredBytes,
            total: fileSize,
            percent: parseFloat(percent.toFixed(1)),
            speedMB: parseFloat((currentSpeed / (1024 * 1024)).toFixed(2))
          });
        }
      }
    };

    return new Promise((resolve, reject) => {
      let isError = false;

      const cleanup = () => {
        try { lockdown.close(); } catch {}
        try { usbmux1.close(); } catch {}
        try { usbmux2.close(); } catch {}
      };

      readStream.on('data', async (chunk) => {
        if (isError) return;

        bufferList.push(chunk);
        bufferedLength += chunk.length;

        if (bufferedLength >= BATCH_SIZE) {
          readStream.pause();
          try {
            await flushBuffer();
            readStream.resume();
          } catch (err) {
            isError = true;
            cleanup();
            reject(err);
          }
        }
      });

      readStream.on('end', async () => {
        if (isError) return;
        try {
          await flushBuffer();
          await afc.closeFileHandle(fileHandle);
          cleanup();

          if (onProgress) {
            onProgress({
              filename,
              category,
              appName: hostApp.name,
              transferred: transferredBytes,
              total: fileSize || transferredBytes,
              percent: 100,
              speedMB: parseFloat((currentSpeed / (1024 * 1024)).toFixed(2)),
              done: true
            });
          }

          resolve({
            success: true,
            filename,
            category,
            appName: hostApp.name,
            folder: `On My iPhone ➔ ${hostApp.name} ➔ iRush ➔ ${category}`,
            destinationPath: remotePath,
            transferredBytes
          });
        } catch (err) {
          cleanup();
          reject(err);
        }
      });

      readStream.on('error', (err) => {
        isError = true;
        cleanup();
        reject(err);
      });
    });
  }
}

module.exports = new iOSBridge();
