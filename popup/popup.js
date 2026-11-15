// MaxVideo Pro - Popup Logic

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusChip = document.getElementById('statusChip');
  const statusText = document.getElementById('statusText');
  const btnCleanWindow = document.getElementById('btnCleanWindow');
  const cleanWindowTitle = document.getElementById('cleanWindowTitle');
  const btnMaximize = document.getElementById('btnMaximize');
  const maximizeTitle = document.getElementById('maximizeTitle');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnPip = document.getElementById('btnPip');
  const btnDownloadPopup = document.getElementById('btnDownloadPopup');
  const btnSnapshotPopup = document.getElementById('btnSnapshotPopup');

  // Tabs
  const tabBtnTools = document.getElementById('tabBtnTools');
  const tabBtnSettings = document.getElementById('tabBtnSettings');
  const tabTools = document.getElementById('tabTools');
  const tabSettings = document.getElementById('tabSettings');

  // Controls
  const fitModesGroup = document.getElementById('fitModesGroup');
  const speedPills = document.getElementById('speedPills');
  const speedDisplay = document.getElementById('speedDisplay');
  const boostPills = document.getElementById('boostPills');
  const boostDisplay = document.getElementById('boostDisplay');
  const btnFlipVideo = document.getElementById('btnFlipVideo');
  const btnRotateVideo = document.getElementById('btnRotateVideo');

  // Settings
  const chkShowHud = document.getElementById('chkShowHud');
  const chkRememberSpeed = document.getElementById('chkRememberSpeed');

  // Get active tab
  let activeTab = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
  } catch {}

  // Safe messaging to active tab with auto-injection fallback if content script was invalidated or not yet injected
  async function sendTabMessageSafe(action, payload = {}) {
    if (!activeTab || !activeTab.id) return null;
    try {
      return await chrome.tabs.sendMessage(activeTab.id, { action, ...payload });
    } catch {
      // If content script is missing or was invalidated by an extension update, attempt injection once
      try {
        if (chrome.scripting && chrome.scripting.executeScript) {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content/content.js']
          });
          return await chrome.tabs.sendMessage(activeTab.id, { action, ...payload });
        }
      } catch {}
      return null;
    }
  }

  // Check Window Status (Clean Window / Fullscreen)
  try {
    const winStatus = await chrome.runtime.sendMessage({ action: 'get-window-status' });
    if (winStatus && winStatus.isCleanWindow) {
      btnCleanWindow.classList.add('active-state');
      cleanWindowTitle.textContent = 'Restaurar Janela Padrão';
    }
  } catch {}

  // Check Page Video Info
  if (activeTab && activeTab.id) {
    try {
      const pageInfo = await sendTabMessageSafe('get-page-video-info');
      if (pageInfo) {
        const count = pageInfo.count || 0;
        if (count > 0) {
          statusChip.classList.add('active');
          statusText.textContent = `${count} ${count === 1 ? 'vídeo pronto' : 'vídeos prontos'}`;
        } else {
          statusText.textContent = 'Nenhum vídeo ativo';
        }

        if (pageInfo.isMaximized) {
          btnMaximize.classList.add('active-state');
          maximizeTitle.textContent = 'Restaurar Vídeo';
        }

        if (pageInfo.fitMode) {
          updateActivePill(fitModesGroup, 'data-fit', pageInfo.fitMode);
        }

        if (pageInfo.speed) {
          speedDisplay.textContent = `${pageInfo.speed}x`;
          updateActivePill(speedPills, 'data-speed', String(pageInfo.speed));
        }

        if (pageInfo.audioBoost) {
          boostDisplay.textContent = `${Math.round(pageInfo.audioBoost * 100)}%`;
          updateActivePill(boostPills, 'data-boost', String(pageInfo.audioBoost));
        }
      }
    } catch {
      // Content script may not be loaded or page is restricted (e.g. chrome://)
      if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('about:'))) {
        statusText.textContent = 'Página do navegador restrita';
      } else {
        statusText.textContent = 'Pronto para uso';
      }
    }
  }

  // Load Settings
  const settings = await chrome.storage.local.get({
    showFloatingHud: true,
    rememberSpeed: false
  });
  chkShowHud.checked = settings.showFloatingHud;
  chkRememberSpeed.checked = settings.rememberSpeed;

  // Tab Switching
  tabBtnTools.addEventListener('click', () => {
    tabBtnTools.classList.add('active');
    tabBtnSettings.classList.remove('active');
    tabTools.classList.remove('hidden');
    tabSettings.classList.add('hidden');
  });

  tabBtnSettings.addEventListener('click', () => {
    tabBtnSettings.classList.add('active');
    tabBtnTools.classList.remove('active');
    tabSettings.classList.remove('hidden');
    tabTools.classList.add('hidden');
  });

  // Action: Clean Window (Hide tabs/URL)
  btnCleanWindow.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'toggle-clean-window' });
    } catch {}
    window.close();
  });

  // Action: Maximize Video
  btnMaximize.addEventListener('click', async () => {
    const res = await sendTabMessageSafe('toggle-maximize');
    if (res && res.isMaximized) {
      btnMaximize.classList.add('active-state');
      maximizeTitle.textContent = 'Restaurar Vídeo';
    } else {
      btnMaximize.classList.remove('active-state');
      maximizeTitle.textContent = 'Maximizar Vídeo';
    }
    window.close();
  });

  // Action: Download Video
  if (btnDownloadPopup) {
    btnDownloadPopup.addEventListener('click', async () => {
      await sendTabMessageSafe('trigger-download');
      window.close();
    });
  }

  // Action: Fullscreen
  btnFullscreen.addEventListener('click', async () => {
    try {
      await chrome.runtime.sendMessage({ action: 'toggle-fullscreen' });
    } catch {}
    window.close();
  });

  // Action: Picture-in-Picture
  btnPip.addEventListener('click', async () => {
    await sendTabMessageSafe('toggle-pip');
    window.close();
  });

  // Aspect Ratio Pills
  fitModesGroup.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;

    const mode = btn.getAttribute('data-fit');
    updateActivePill(fitModesGroup, 'data-fit', mode);
    await sendTabMessageSafe('set-fit-mode', { mode });
    try {
      await chrome.storage.local.set({ defaultFitMode: mode });
    } catch {}
  });

  // Speed Pills
  speedPills.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;

    const speed = parseFloat(btn.getAttribute('data-speed'));
    updateActivePill(speedPills, 'data-speed', String(speed));
    speedDisplay.textContent = `${speed}x`;
    await sendTabMessageSafe('set-speed', { speed });
  });

  // Audio Boost Pills
  boostPills.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn) return;

    const boost = parseFloat(btn.getAttribute('data-boost'));
    updateActivePill(boostPills, 'data-boost', String(boost));
    boostDisplay.textContent = `${Math.round(boost * 100)}%`;
    await sendTabMessageSafe('set-audio-boost', { boost });
  });

  // Flip & Rotate
  if (btnSnapshotPopup) {
    btnSnapshotPopup.addEventListener('click', async () => {
      await sendTabMessageSafe('capture-frame');
    });
  }

  btnFlipVideo.addEventListener('click', async () => {
    await sendTabMessageSafe('toggle-flip');
  });

  btnRotateVideo.addEventListener('click', async () => {
    await sendTabMessageSafe('rotate-video');
  });

  // Settings Toggles
  chkShowHud.addEventListener('change', async () => {
    const val = chkShowHud.checked;
    try {
      await chrome.storage.local.set({ showFloatingHud: val });
    } catch {}
    await sendTabMessageSafe('update-settings', { showFloatingHud: val });
  });

  chkRememberSpeed.addEventListener('change', async () => {
    try {
      await chrome.storage.local.set({ rememberSpeed: chkRememberSpeed.checked });
    } catch {}
  });

  function updateActivePill(group, attribute, value) {
    const btns = group.querySelectorAll('.pill-btn');
    btns.forEach((b) => {
      if (b.getAttribute(attribute) === value) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }
});
