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
  } catch (err) {
    console.error('Error querying active tab:', err);
  }

  // Check Window Status (Clean Window / Fullscreen)
  try {
    const winStatus = await chrome.runtime.sendMessage({ action: 'get-window-status' });
    if (winStatus && winStatus.isCleanWindow) {
      btnCleanWindow.classList.add('active-state');
      cleanWindowTitle.textContent = 'Restaurar Janela Padrão';
    }
  } catch (err) {
    console.warn('Could not retrieve window status:', err);
  }

  // Check Page Video Info
  if (activeTab && activeTab.id) {
    try {
      const pageInfo = await chrome.tabs.sendMessage(activeTab.id, { action: 'get-page-video-info' });
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
    await chrome.runtime.sendMessage({ action: 'toggle-clean-window' });
    window.close();
  });

  // Action: Maximize Video
  btnMaximize.addEventListener('click', async () => {
    if (!activeTab || !activeTab.id) return;
    try {
      const res = await chrome.tabs.sendMessage(activeTab.id, { action: 'toggle-maximize' });
      if (res && res.isMaximized) {
        btnMaximize.classList.add('active-state');
        maximizeTitle.textContent = 'Restaurar Vídeo';
      } else {
        btnMaximize.classList.remove('active-state');
        maximizeTitle.textContent = 'Maximizar Vídeo';
      }
    } catch (err) {
      console.warn('Could not maximize video:', err);
    }
    window.close();
  });

  // Action: Download Video
  if (btnDownloadPopup) {
    btnDownloadPopup.addEventListener('click', async () => {
      if (!activeTab || !activeTab.id) return;
      try {
        await chrome.tabs.sendMessage(activeTab.id, { action: 'trigger-download' });
      } catch (err) {
        console.warn('Could not trigger download:', err);
      }
      window.close();
    });
  }

  // Action: Fullscreen
  btnFullscreen.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'toggle-fullscreen' });
    window.close();
  });

  // Action: Picture-in-Picture
  btnPip.addEventListener('click', async () => {
    if (!activeTab || !activeTab.id) return;
    try {
      await chrome.tabs.sendMessage(activeTab.id, { action: 'toggle-pip' });
    } catch {}
    window.close();
  });

  // Aspect Ratio Pills
  fitModesGroup.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn || !activeTab || !activeTab.id) return;

    const mode = btn.getAttribute('data-fit');
    updateActivePill(fitModesGroup, 'data-fit', mode);
    await chrome.tabs.sendMessage(activeTab.id, { action: 'set-fit-mode', mode });
    await chrome.storage.local.set({ defaultFitMode: mode });
  });

  // Speed Pills
  speedPills.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn || !activeTab || !activeTab.id) return;

    const speed = parseFloat(btn.getAttribute('data-speed'));
    updateActivePill(speedPills, 'data-speed', String(speed));
    speedDisplay.textContent = `${speed}x`;
    await chrome.tabs.sendMessage(activeTab.id, { action: 'set-speed', speed });
  });

  // Audio Boost Pills
  boostPills.addEventListener('click', async (e) => {
    const btn = e.target.closest('.pill-btn');
    if (!btn || !activeTab || !activeTab.id) return;

    const boost = parseFloat(btn.getAttribute('data-boost'));
    updateActivePill(boostPills, 'data-boost', String(boost));
    boostDisplay.textContent = `${Math.round(boost * 100)}%`;
    await chrome.tabs.sendMessage(activeTab.id, { action: 'set-audio-boost', boost });
  });

  // Flip & Rotate
  if (btnSnapshotPopup) {
    btnSnapshotPopup.addEventListener('click', async () => {
      if (!activeTab || !activeTab.id) return;
      await chrome.tabs.sendMessage(activeTab.id, { action: 'capture-frame' });
    });
  }

  btnFlipVideo.addEventListener('click', async () => {
    if (!activeTab || !activeTab.id) return;
    await chrome.tabs.sendMessage(activeTab.id, { action: 'toggle-flip' });
  });

  btnRotateVideo.addEventListener('click', async () => {
    if (!activeTab || !activeTab.id) return;
    await chrome.tabs.sendMessage(activeTab.id, { action: 'rotate-video' });
  });

  // Settings Toggles
  chkShowHud.addEventListener('change', async () => {
    const val = chkShowHud.checked;
    await chrome.storage.local.set({ showFloatingHud: val });
    if (activeTab && activeTab.id) {
      await chrome.tabs.sendMessage(activeTab.id, {
        action: 'update-settings',
        showFloatingHud: val
      });
    }
  });

  chkRememberSpeed.addEventListener('change', async () => {
    await chrome.storage.local.set({ rememberSpeed: chkRememberSpeed.checked });
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
