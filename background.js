// MaxVideo Pro - Background Service Worker
// Manages Clean Windows (Popup mode without tabs/URL), commands, and context menus

// Setup Context Menus on Installation
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.contextMenus.removeAll();

    chrome.contextMenus.create({
      id: 'maxvideo-parent',
      title: 'MaxVideo Pro',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      parentId: 'maxvideo-parent',
      id: 'maxvideo-clean-window',
      title: '🗖 Alternar Janela Limpa (Sem abas nem URL)',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      parentId: 'maxvideo-parent',
      id: 'maxvideo-maximize',
      title: '🔲 Maximizar Vídeo na Janela',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      parentId: 'maxvideo-parent',
      id: 'maxvideo-fullscreen',
      title: '📺 Alternar Tela Cheia Imersiva',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      parentId: 'maxvideo-parent',
      id: 'maxvideo-pip',
      title: '🖼️ Alternar Picture-in-Picture (PiP)',
      contexts: ['all']
    });

    chrome.contextMenus.create({
      parentId: 'maxvideo-parent',
      id: 'maxvideo-download',
      title: '📥 Baixar Vídeo',
      contexts: ['all']
    });
  } catch (err) {
    console.error('Error creating context menus:', err);
  }
});

// Handle Context Menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || !tab.id) return;

  try {
    if (info.menuItemId === 'maxvideo-clean-window') {
      await toggleCleanWindow(tab);
    } else if (info.menuItemId === 'maxvideo-maximize') {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle-maximize' });
    } else if (info.menuItemId === 'maxvideo-fullscreen') {
      await toggleWindowFullscreen(tab);
    } else if (info.menuItemId === 'maxvideo-pip') {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle-pip' });
    } else if (info.menuItemId === 'maxvideo-download') {
      await chrome.tabs.sendMessage(tab.id, { action: 'trigger-download' });
    }
  } catch (err) {
    console.error('Error executing context menu action:', err);
  }
});

// Handle Keyboard Shortcuts defined in manifest commands
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;

    if (command === 'toggle-clean-window') {
      await toggleCleanWindow(tab);
    } else if (command === 'toggle-maximize') {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle-maximize' });
    } else if (command === 'toggle-fullscreen') {
      await toggleWindowFullscreen(tab);
    } else if (command === 'toggle-pip') {
      await chrome.tabs.sendMessage(tab.id, { action: 'toggle-pip' });
    } else if (command === 'download-video') {
      await chrome.tabs.sendMessage(tab.id, { action: 'trigger-download' });
    }
  } catch (err) {
    console.error('Error handling shortcut command:', err);
  }
});

// Toggle Clean Window (Pop-out without tabs, address bar, or bookmarks)
async function toggleCleanWindow(tab) {
  if (!tab || !tab.id) return;

  try {
    const currentWindow = await chrome.windows.get(tab.windowId);
    const originKey = `tabOrigin_${tab.id}`;
    const stored = await chrome.storage.session.get(originKey);
    const originData = stored[originKey];

    if (currentWindow.type === 'popup') {
      // It is already in Clean Window (popup) mode -> Restore to normal tabbed window
      let restored = false;
      if (originData && originData.originalWindowId) {
        try {
          const origWin = await chrome.windows.get(originData.originalWindowId);
          if (origWin && origWin.type === 'normal') {
            await chrome.tabs.move(tab.id, {
              windowId: originData.originalWindowId,
              index: typeof originData.originalIndex === 'number' ? originData.originalIndex : -1
            });
            await chrome.windows.update(originData.originalWindowId, { focused: true });
            restored = true;
          }
        } catch {
          // Original window was closed or not found
          restored = false;
        }
      }

      if (!restored) {
        // Fallback: convert to new normal window with tabs
        await chrome.windows.create({
          tabId: tab.id,
          type: 'normal',
          focused: true
        });
      }

      await chrome.storage.session.remove(originKey);

      // Notify content script
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'toast',
            message: 'Restaurado para a janela padrão com abas'
          });
        } catch {}
      }, 500);

    } else {
      // Normal window -> Move tab into Clean Popup Window (stripping tabs, URL, bookmarks bar)
      await chrome.storage.session.set({
        [originKey]: {
          originalWindowId: tab.windowId,
          originalIndex: tab.index
        }
      });

      const width = currentWindow.width || 1280;
      const height = currentWindow.height || 720;
      const left = currentWindow.left;
      const top = currentWindow.top;

      await chrome.windows.create({
        tabId: tab.id,
        type: 'popup',
        focused: true,
        width,
        height,
        left,
        top
      });

      // After moving, trigger video maximize in content script
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'maximize-video',
            cleanWindow: true
          });
          await chrome.tabs.sendMessage(tab.id, {
            action: 'toast',
            message: 'Modo Janela Limpa Ativo: Abas, URL e Favoritos ocultados'
          });
        } catch {}
      }, 400);
    }
  } catch (err) {
    console.error('Error toggling clean window:', err);
  }
}

// Toggle browser-level fullscreen
async function toggleWindowFullscreen(tab) {
  if (!tab || !tab.id) return;

  try {
    const win = await chrome.windows.get(tab.windowId);
    const newState = win.state === 'fullscreen' ? 'normal' : 'fullscreen';
    await chrome.windows.update(tab.windowId, { state: newState });

    const message = newState === 'fullscreen'
      ? 'Tela Cheia Imersiva Ativada'
      : 'Tela Cheia Desativada';

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'toast', message });
    } catch {}
  } catch (err) {
    console.error('Error toggling window fullscreen:', err);
  }
}

// Configure dynamic declarativeNetRequest rules so YouTube Innertube queries
// from the extension service worker send Origin: https://www.youtube.com, preventing 403 Forbidden
async function setupYouTubeDeclarativeRules() {
  try {
    if (chrome.declarativeNetRequest && chrome.declarativeNetRequest.updateDynamicRules) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1001, 1002],
        addRules: [
          {
            id: 1001,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: [
                { header: 'Origin', operation: 'set', value: 'https://www.youtube.com' },
                { header: 'Referer', operation: 'set', value: 'https://www.youtube.com/' }
              ]
            },
            condition: {
              urlFilter: '||youtube.com/youtubei/v1/*',
              resourceTypes: ['xmlhttprequest', 'other']
            }
          }
        ]
      });
    }
  } catch (err) {
    console.warn('DeclarativeNetRequest rule setup error:', err);
  }
}
setupYouTubeDeclarativeRules();

let cachedVisitorData = null;
let cachedVisitorDataTime = 0;

// Fetch or reuse a clean guest visitorData directly from YouTube's official visitor_id endpoint
async function getInnertubeVisitorData(forceFresh = false) {
  const now = Date.now();
  if (!forceFresh && cachedVisitorData && (now - cachedVisitorDataTime < 1800000)) {
    return cachedVisitorData;
  }

  try {
    const resp = await fetch('https://www.youtube.com/youtubei/v1/visitor_id', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'omit',
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: '2.20240901.01.00',
            hl: 'pt',
            gl: 'BR'
          }
        }
      })
    });

    if (resp.ok) {
      const data = await resp.json();
      const v = data?.responseContext?.visitorData;
      if (v) {
        cachedVisitorData = v;
        cachedVisitorDataTime = now;
        return v;
      }
    }
  } catch (err) {
    console.warn('Innertube visitor_id endpoint error:', err);
  }

  return cachedVisitorData;
}

// Fetch direct formats from YouTube Innertube API and in-page player response (100% Native Extension Engine)
async function fetchYouTubeFormats(videoId, inPageData = null) {
  let title = (inPageData && inPageData.title) || 'YouTube Video';
  const allFormats = [];

  // 1. If in-page player data was supplied by the content script, ingest it first
  if (inPageData && inPageData.streamingData) {
    const s = inPageData.streamingData;
    (s.formats || []).forEach((f) => {
      if (f.url && !allFormats.some((x) => x.url === f.url)) {
        allFormats.push({ ...f, isMuxed: true });
      }
    });
    (s.adaptiveFormats || []).forEach((f) => {
      if (f.url && !allFormats.some((x) => x.url === f.url)) {
        allFormats.push({ ...f, isMuxed: false });
      }
    });
  }

  // 2. Query Innertube client helper
  async function queryInnertubeClient(clientConfig) {
    try {
      const body = { context: { client: clientConfig }, videoId };
      const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'omit',
        body: JSON.stringify(body)
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  // Helper to ingest response formats
  function ingestResponse(resp, clientName) {
    if (!resp || resp?.playabilityStatus?.status !== 'OK' || !resp.streamingData) return false;
    if (!title || title === 'YouTube Video') {
      title = resp?.videoDetails?.title || title;
    }
    const s = resp.streamingData;
    let count = 0;
    (s.formats || []).forEach((f) => {
      if (f.url && !allFormats.some((x) => x.url === f.url || x.itag === f.itag)) {
        allFormats.push({ ...f, isMuxed: true, client: clientName });
        count++;
      }
    });
    (s.adaptiveFormats || []).forEach((f) => {
      if (f.url && !allFormats.some((x) => x.url === f.url || x.itag === f.itag)) {
        allFormats.push({ ...f, isMuxed: false, client: clientName });
        count++;
      }
    });
    return count > 0;
  }

  // 3. Obtain visitorData directly from YouTube's official visitor_id endpoint
  let visitorData = await getInnertubeVisitorData();

  // Step A: Primary query -> VISIONOS (unthrottled, no 60-second mobile buffer caps)
  let visionosResp = await queryInnertubeClient({
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    osName: 'visionOS',
    hl: 'pt',
    gl: 'BR',
    visitorData: visitorData || undefined
  });

  // If VISIONOS returned LOGIN_REQUIRED or was rejected, refresh visitorData and retry once
  if (!visionosResp || visionosResp?.playabilityStatus?.status !== 'OK' || !visionosResp?.streamingData?.adaptiveFormats?.length) {
    visitorData = await getInnertubeVisitorData(true);
    if (visitorData) {
      visionosResp = await queryInnertubeClient({
        clientName: 'VISIONOS',
        clientVersion: '1.02',
        deviceMake: 'Apple',
        deviceModel: 'RealityDevice17,1',
        osName: 'visionOS',
        hl: 'pt',
        gl: 'BR',
        visitorData: visitorData
      });
    }
  }

  ingestResponse(visionosResp, 'VISIONOS');

  // Step B: Secondary query -> ANDROID (formats & adaptive streams: 1080p, 720p, etc.)
  const androidResp = await queryInnertubeClient({
    clientName: 'ANDROID',
    clientVersion: '20.10.34',
    hl: 'pt',
    gl: 'BR',
    visitorData: visitorData || undefined
  });
  ingestResponse(androidResp, 'ANDROID');

  // Step C: Tertiary query -> IOS (formats & adaptive streams)
  const iosResp = await queryInnertubeClient({
    clientName: 'IOS',
    clientVersion: '21.26.4',
    deviceMake: 'Apple',
    deviceModel: 'iPhone16,2',
    userAgent: 'com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    osName: 'iPhone',
    osVersion: '18.3.2.22D82',
    hl: 'pt',
    gl: 'BR',
    visitorData: visitorData || undefined
  });
  ingestResponse(iosResp, 'IOS');

  // 3. Robust categorization: Support 60fps, 4K, 1440p, 1080p, 720p, 480p, 360p, AV1, VP9, H264
  const videoFormats = allFormats.filter((f) => f.mimeType && f.mimeType.startsWith('video/'));
  const audioFormats = allFormats.filter((f) => f.mimeType && f.mimeType.startsWith('audio/'));
  const muxedFormats = allFormats.filter((f) => f.isMuxed || (f.mimeType && f.mimeType.includes('avc1') && f.audioQuality));

  const parsedVideos = videoFormats.map((f) => {
    const qLabel = f.qualityLabel || `${f.height}p` || 'Vídeo';
    const resNum = parseInt(qLabel, 10) || f.height || 0;
    return {
      qualityLabel: qLabel,
      resNum: resNum,
      fps: f.fps || (qLabel.includes('60') ? 60 : 30),
      mimeType: f.mimeType || 'video/mp4',
      isMp4: (f.mimeType || '').includes('mp4'),
      isAvc: (f.mimeType || '').includes('avc1'),
      size: f.contentLength ? parseInt(f.contentLength, 10) : null,
      url: f.url,
      itag: f.itag
    };
  });

  // Sort by resolution descending, then prefer VISIONOS unthrottled streams, then AVC (H.264), then MP4
  parsedVideos.sort((a, b) => {
    if (b.resNum !== a.resNum) return b.resNum - a.resNum;
    const aVision = (a.url || '').includes('c=VISIONOS') ? 1 : 0;
    const bVision = (b.url || '').includes('c=VISIONOS') ? 1 : 0;
    if (aVision !== bVision) return bVision - aVision;
    const aAvc = a.isAvc ? 1 : 0;
    const bAvc = b.isAvc ? 1 : 0;
    if (aAvc !== bAvc) return bAvc - aAvc;
    const aMp4 = a.isMp4 ? 1 : 0;
    const bMp4 = b.isMp4 ? 1 : 0;
    if (aMp4 !== bMp4) return bMp4 - aMp4;
    return (b.size || 0) - (a.size || 0);
  });

  const results = [];
  let muxedUrl = null;
  if (muxedFormats.length > 0) {
    muxedUrl = muxedFormats[0].url;
  }

  // Find the best audio track (AAC M4A itag 140 from VISIONOS preferred for pure MP4 container muxing)
  let bestAudio = null;
  if (audioFormats.length > 0) {
    audioFormats.sort((a, b) => {
      const aVision = (a.url || '').includes('c=VISIONOS') ? 4 : 0;
      const bVision = (b.url || '').includes('c=VISIONOS') ? 4 : 0;
      if (aVision !== bVision) return bVision - aVision;
      const aAac = a.itag === 140 ? 2 : ((a.mimeType || '').includes('audio/mp4') ? 1 : 0);
      const bAac = b.itag === 140 ? 2 : ((b.mimeType || '').includes('audio/mp4') ? 1 : 0);
      if (aAac !== bAac) return bAac - aAac;
      return (parseInt(b.bitrate || 0, 10)) - (parseInt(a.bitrate || 0, 10));
    });
    bestAudio = audioFormats[0];
  }
  const audioSize = bestAudio && bestAudio.contentLength ? parseInt(bestAudio.contentLength, 10) : 0;

  // Collect all unique resolutions from the video streams
  const uniqueHeights = [];
  parsedVideos.forEach((v) => {
    if (v.resNum && v.resNum >= 144 && !uniqueHeights.includes(v.resNum)) {
      uniqueHeights.push(v.resNum);
    }
  });
  uniqueHeights.sort((a, b) => b - a);

  let hasRecommended = false;
  const has1080p = uniqueHeights.some((h) => h >= 1000 && h <= 1080);

  uniqueHeights.forEach((height) => {
    const candidates = parsedVideos.filter((v) => v.resNum === height);
    if (candidates.length === 0) return;

    // Prefer MP4 candidates with unthrottled VISIONOS streams so in-browser fMP4 muxer works natively
    const best = candidates.find((c) => c.isMp4 && (c.url || '').includes('c=VISIONOS')) ||
                 candidates.find((c) => (c.url || '').includes('c=VISIONOS')) ||
                 candidates.find((c) => c.isMp4) ||
                 candidates[0];
    const isMux = muxedFormats.some((m) => m.itag === best.itag || m.url === best.url);

    let badge = `${best.qualityLabel}`;
    let qualityTitle = `${best.qualityLabel}`;
    let isRec = false;

    if (height >= 3800) {
      badge = '8K 4320p';
      qualityTitle = `${best.qualityLabel} Ultra HD`;
    } else if (height >= 2000) {
      badge = '4K 2160p';
      qualityTitle = `${best.qualityLabel} Ultra HD`;
    } else if (height >= 1400) {
      badge = '2K 1440p';
      qualityTitle = `${best.qualityLabel} Quad HD`;
    } else if (height >= 1000 && height <= 1080) {
      badge = best.fps && best.fps >= 50 ? `${best.qualityLabel} Full HD` : '1080p Full HD';
      qualityTitle = `${best.qualityLabel} Full HD`;
      if (!hasRecommended) {
        isRec = true;
        hasRecommended = true;
      }
    } else if (height >= 700 && height < 1000) {
      badge = best.fps && best.fps >= 50 ? `${best.qualityLabel} HD` : '720p HD';
      qualityTitle = `${best.qualityLabel} HD`;
      if (!has1080p && !hasRecommended) {
        isRec = true;
        hasRecommended = true;
      }
    } else if (height >= 460) {
      badge = '480p';
      qualityTitle = `${best.qualityLabel} SD`;
    } else if (height >= 340) {
      badge = '360p';
      qualityTitle = `${best.qualityLabel} SD`;
    } else {
      badge = `${best.qualityLabel}`;
      qualityTitle = `${best.qualityLabel}`;
    }

    results.push({
      quality: qualityTitle,
      badge: badge,
      recommended: isRec,
      type: isMux ? 'muxed' : 'adaptive_video',
      size: (best.size || 0) + (isMux ? 0 : audioSize),
      videoSize: best.size || 0,
      url: best.url,
      itag: best.itag,
      height: height,
      isMp4: best.isMp4,
      audioUrl: isMux ? null : (bestAudio ? bestAudio.url : null),
      audioItag: isMux ? null : (bestAudio ? bestAudio.itag : null),
      audioSize: isMux ? 0 : audioSize,
      fallbackMuxedUrl: muxedUrl
    });
  });

  if (!hasRecommended && results.length > 0) {
    results[0].recommended = true;
  }

  // Audio format (M4A)
  if (audioFormats.length > 0) {
    const a = bestAudio || audioFormats[0];
    results.push({
      quality: 'Áudio M4A (Alta Fidelidade)',
      badge: 'Áudio M4A',
      type: 'audio',
      size: a.contentLength ? parseInt(a.contentLength, 10) : null,
      url: a.url,
      itag: a.itag
    });
  }

  return { title, formats: results };
}

// Message Listener for Content Scripts and Popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === 'toggle-clean-window') {
        const targetTab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (targetTab) {
          await toggleCleanWindow(targetTab);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No tab found' });
        }
      } else if (message.action === 'toggle-fullscreen') {
        const targetTab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (targetTab) {
          await toggleWindowFullscreen(targetTab);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: 'No tab found' });
        }
      } else if (message.action === 'get-youtube-formats') {
        const videoId = message.videoId;
        if (!videoId) {
          sendResponse({ success: false, error: 'No videoId provided' });
          return;
        }
        const data = await fetchYouTubeFormats(videoId, message.inPageData);
        sendResponse({
          success: true,
          title: data.title,
          formats: data.formats
        });
      } else if (message.action === 'download-video') {
        const url = message.url;
        let filename = message.filename || 'video.mp4';

        // Clean filename of invalid characters and strip web extensions
        filename = filename.replace(/[\\/*?:"<>|\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim();
        filename = filename.replace(/\.(htm|html|php|asp|aspx)$/i, '');
        if (!filename.match(/\.(mp4|webm|mkv|mov|m4a|mp3)$/i)) {
          filename += '.mp4';
        }

        // Only do pre-flight check for googlevideo URLs to avoid 403 HTML files
        if (url.includes('googlevideo.com')) {
          try {
            const testResp = await fetch(url, {
              method: 'GET',
              headers: { Range: 'bytes=0-1024' }
            });

            const cType = (testResp.headers.get('content-type') || '').toLowerCase();
            const isErrorStatus = testResp.status >= 400;
            const isErrorType = cType.includes('xml') || cType.includes('html');

            if (isErrorStatus || isErrorType) {
              sendResponse({
                success: false,
                error: `O servidor retornou erro (${testResp.status}). Formato não disponível para download direto.`
              });
              return;
            }
          } catch (fetchErr) {
            // Ignore pre-flight fetch errors
          }
        }

        try {
          const downloadId = await chrome.downloads.download({
            url: url,
            filename: filename,
            saveAs: false
          });
          sendResponse({ success: true, downloadId });
        } catch (downloadErr) {
          console.warn('chrome.downloads failed:', downloadErr);
          sendResponse({ success: false, error: downloadErr.message });
        }
      } else if (message.action === 'get-window-status') {
        const targetTab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
        if (targetTab) {
          const win = await chrome.windows.get(targetTab.windowId);
          sendResponse({
            isCleanWindow: win.type === 'popup',
            isFullscreen: win.state === 'fullscreen',
            windowId: win.id
          });
        } else {
          sendResponse({ isCleanWindow: false, isFullscreen: false });
        }
      } else if (message.action === 'fetch-stream-chunk') {
        // High-reliability background chunk proxy: completely immune to page-level CORS/CSP restrictions
        try {
          const resp = await fetch(message.url, { cache: 'no-store', credentials: 'omit' });
          if (!resp.ok) {
            sendResponse({ success: false, status: resp.status });
            return;
          }
          const ab = await resp.arrayBuffer();
          const bytes = new Uint8Array(ab);
          let binary = '';
          const sz = 8192;
          for (let i = 0; i < bytes.length; i += sz) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + sz, bytes.length)));
          }
          sendResponse({ success: true, status: resp.status, b64: btoa(binary) });
        } catch (fErr) {
          sendResponse({ success: false, error: fErr.message });
        }
      } else {
        sendResponse({ success: true });
      }
    } catch (err) {
      console.error('Message handler error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();
  return true; // Keep message channel open for async response
});

// Clean up stored session data when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await chrome.storage.session.remove(`tabOrigin_${tabId}`);
  } catch {}
});
