// iRush Frontend Controller

const statusPill = document.getElementById('statusPill');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const appSelector = document.getElementById('appSelector');
const bannerAppName = document.getElementById('bannerAppName');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const browseBtn = document.getElementById('browseBtn');

const transferCard = document.getElementById('transferCard');
const transferFileName = document.getElementById('transferFileName');
const categoryBadge = document.getElementById('categoryBadge');
const speedValue = document.getElementById('speedValue');
const progressBar = document.getElementById('progressBar');
const transferredAmount = document.getElementById('transferredAmount');
const transferETA = document.getElementById('transferETA');
const percentValue = document.getElementById('percentValue');

const historySection = document.getElementById('historySection');
const fileItems = document.getElementById('fileItems');
const historyCount = document.getElementById('historyCount');

let isDeviceConnected = false;
let currentTransferQueue = [];
let isTransferring = false;
let transferredCount = 0;
let currentHostApp = 'Chrome';

window.addEventListener('beforeunload', () => {
  try {
    navigator.sendBeacon('/api/shutdown');
  } catch (e) {}
});

function formatBytes(bytes) {
  if (bytes === 0 || !bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileCategory(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    Videos: ['mp4', 'mkv', 'mov', 'avi', 'm4v', 'wmv', 'flv', 'webm', 'ts', '3gp'],
    Audio: ['mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'wma', 'aiff'],
    Documents: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'epub'],
    Photos: ['jpg', 'jpeg', 'png', 'heic', 'gif', 'webp', 'bmp', 'svg'],
    Archives: ['zip', 'rar', '7z', 'tar', 'gz', 'iso']
  };

  for (const [cat, exts] of Object.entries(map)) {
    if (exts.includes(ext)) return cat;
  }
  return 'Other';
}

function getCategoryIcon(cat) {
  const icons = {
    Videos: '🎬',
    Audio: '🎵',
    Documents: '📄',
    Photos: '🖼️',
    Archives: '📦',
    Other: '📁'
  };
  return icons[cat] || '📁';
}

function updateDeviceUI(status) {
  if (status && status.connected) {
    isDeviceConnected = true;
    statusPill.classList.add('connected');
    const info = status.info || {};
    const model = info.friendlyModel || info.name || 'iPhone';
    statusText.textContent = `${model} Connected (USB)`;

    if (status.hostApp && status.hostApp.name) {
      currentHostApp = status.hostApp.name;
      if (bannerAppName) bannerAppName.textContent = currentHostApp;
    }

    if (status.availableApps && status.availableApps.length > 0 && appSelector) {
      const currentSelectedVal = appSelector.value;
      appSelector.innerHTML = '';
      status.availableApps.forEach(app => {
        const opt = document.createElement('option');
        opt.value = app.id;
        opt.textContent = app.name;
        if (status.hostApp && status.hostApp.id === app.id) {
          opt.selected = true;
        }
        appSelector.appendChild(opt);
      });
      if (status.hostApp) {
        appSelector.value = status.hostApp.id;
      }
    }
  } else {
    isDeviceConnected = false;
    statusPill.classList.remove('connected');
    statusText.textContent = 'Waiting for iPhone...';
  }
}

if (appSelector) {
  appSelector.addEventListener('change', async (e) => {
    const selectedId = e.target.value;
    try {
      const res = await fetch('/api/set-app', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedId })
      });
      const data = await res.json();
      if (data && data.app) {
        currentHostApp = data.app.name;
        if (bannerAppName) bannerAppName.textContent = currentHostApp;
      }
    } catch (err) {
      console.error('Failed to update destination app:', err);
    }
  });
}

async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateDeviceUI(data);
  } catch (err) {}
}

function initEvents() {
  const evtSource = new EventSource('/api/events');

  evtSource.addEventListener('device-connected', (e) => {
    const data = JSON.parse(e.data);
    updateDeviceUI({ connected: true, ...data });
  });

  evtSource.addEventListener('device-disconnected', () => {
    updateDeviceUI({ connected: false });
  });

  evtSource.addEventListener('host-app-changed', (e) => {
    const app = JSON.parse(e.data);
    if (app && app.name) {
      currentHostApp = app.name;
      if (bannerAppName) bannerAppName.textContent = currentHostApp;
      if (appSelector && appSelector.value !== app.id) {
        appSelector.value = app.id;
      }
    }
  });

  evtSource.addEventListener('transfer-progress', (e) => {
    const p = JSON.parse(e.data);
    if (p.speedMB !== undefined) {
      speedValue.textContent = p.speedMB.toFixed(1);
    }
  });

  evtSource.onerror = () => {};
}

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleSelectedFiles(Array.from(e.dataTransfer.files));
  }
});

browseBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropzone.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) {
    handleSelectedFiles(Array.from(fileInput.files));
    fileInput.value = '';
  }
});

function handleSelectedFiles(files) {
  if (!isDeviceConnected) {
    alert('Please connect your iPhone via USB cable first and tap "Trust This Computer" if prompted.');
    return;
  }

  currentTransferQueue.push(...files);
  processNextInQueue();
}

async function processNextInQueue() {
  if (isTransferring || currentTransferQueue.length === 0) return;

  isTransferring = true;
  const file = currentTransferQueue.shift();
  const category = getFileCategory(file.name);
  const icon = getCategoryIcon(category);

  transferCard.style.display = 'flex';
  categoryBadge.textContent = `${icon} ${category}`;
  transferFileName.textContent = file.name;
  progressBar.style.width = '0%';
  percentValue.textContent = '0%';
  transferredAmount.textContent = `0 MB / ${formatBytes(file.size)}`;
  transferETA.textContent = 'Transferring over USB cable...';
  speedValue.textContent = '0.0';

  const startTime = Date.now();
  let lastLoaded = 0;
  let lastTime = startTime;

  try {
    const result = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const uploadUrl = `/api/upload-raw?filename=${encodeURIComponent(file.name)}`;

      xhr.open('POST', uploadUrl, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-File-Size', file.size.toString());
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percent = ((e.loaded / e.total) * 100).toFixed(1);
          progressBar.style.width = `${percent}%`;
          percentValue.textContent = `${percent}%`;
          transferredAmount.textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;

          const now = Date.now();
          const elapsed = (now - lastTime) / 1000;
          if (elapsed >= 0.15) {
            const delta = e.loaded - lastLoaded;
            const currentSpeedMB = (delta / elapsed) / (1024 * 1024);
            speedValue.textContent = currentSpeedMB.toFixed(1);
            lastLoaded = e.loaded;
            lastTime = now;

            const remainingBytes = e.total - e.loaded;
            const etaSeconds = currentSpeedMB > 0 ? Math.ceil((remainingBytes / (1024 * 1024)) / currentSpeedMB) : 0;
            transferETA.textContent = etaSeconds > 0 ? `${etaSeconds}s remaining` : 'Finalizing...';
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          progressBar.style.width = '100%';
          percentValue.textContent = '100%';
          transferredAmount.textContent = `${formatBytes(file.size)} / ${formatBytes(file.size)}`;
          resolve(JSON.parse(xhr.responseText));
        } else {
          let errText = xhr.responseText;
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed.error) errText = parsed.error;
          } catch {}
          reject(new Error(errText || `Transfer error HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('USB connection interrupted. Check cable.'));
      xhr.send(file);
    });

    addCompletedFile(file, category, result?.file?.appName);
  } catch (err) {
    alert(`Transfer failed for "${file.name}":\n${err.message}`);
  } finally {
    isTransferring = false;
    if (currentTransferQueue.length > 0) {
      processNextInQueue();
    } else {
      setTimeout(() => {
        transferCard.style.display = 'none';
      }, 3000);
    }
  }
}

function addCompletedFile(file, category, appName) {
  historySection.style.display = 'block';
  transferredCount++;
  historyCount.textContent = `${transferredCount} file${transferredCount > 1 ? 's' : ''}`;

  const li = document.createElement('li');
  li.className = 'file-row';

  const icon = getCategoryIcon(category);
  const app = appName || currentHostApp || 'Chrome';

  li.innerHTML = `
    <div class="file-row-left">
      <span>${icon}</span>
      <span class="file-name-text" title="${file.name}">${file.name}</span>
    </div>
    <div class="file-row-right">
      <span class="folder-tag">${app} ➔ iRush ➔ ${category}</span>
      <span class="success-check">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
      <span>${formatBytes(file.size)}</span>
    </div>
  `;

  fileItems.prepend(li);
}

fetchStatus();
initEvents();
