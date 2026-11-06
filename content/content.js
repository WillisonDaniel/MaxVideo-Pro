// MaxVideo Pro - Content Script
// High-compatibility video maximizer with Clean Window, HUD controls, and iframe bridging

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__maxvideo_initialized) return;
  window.__maxvideo_initialized = true;

  // Extension State
  const state = {
    activeVideo: null,
    activeContainer: null,
    isMaximized: false,
    fitMode: 'contain', // 'contain' (normal), 'cover' (cortar barras), 'fill' (esticar), 'ultrawide'
    customZoom: 1.0,
    speed: 1.0,
    audioBoost: 1.0,
    brightness: 100,
    contrast: 100,
    isFlipped: false,
    rotation: 0,
    showHud: true,
    audioCtx: null,
    gainNode: null,
    audioSource: null,
    originalStyles: null,
    ancestorsLocked: []
  };

  // Load user settings from chrome.storage.local
  chrome.storage.local.get(
    {
      showFloatingHud: true,
      defaultFitMode: 'contain',
      rememberSpeed: false,
      savedSpeed: 1.0
    },
    (items) => {
      state.showHud = items.showFloatingHud;
      state.fitMode = items.defaultFitMode;
      if (items.rememberSpeed && items.savedSpeed) {
        state.speed = items.savedSpeed;
      }
    }
  );

  // -------------------------------------------------------------
  // Video & Player Container Detection
  // -------------------------------------------------------------

  function getBestPlayerContainer(video) {
    if (!video) return null;

    // 1. YouTube
    const ytPlayer = video.closest('#movie_player') || video.closest('.html5-video-player');
    if (ytPlayer) return ytPlayer;

    // 2. Instagram
    const igContainer = video.closest('article') ||
                        video.closest('[role="dialog"]') ||
                        video.closest('div[style*="aspect-ratio"]') ||
                        video.closest('.x10l6tqk');
    if (window.location.hostname.includes('instagram.com') && igContainer) return igContainer;

    // 3. Twitter / X
    const twContainer = video.closest('article[data-testid="tweet"]') ||
                        video.closest('div[data-testid="videoPlayer"]') ||
                        video.closest('div[data-testid="videoComponent"]');
    if ((window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com')) && twContainer) return twContainer;

    // 4. Facebook
    const fbContainer = video.closest('[role="article"]') ||
                        video.closest('[data-pagelet*="FeedUnit"]') ||
                        video.closest('div[data-video-id]') ||
                        video.closest('.x1yztbdb');
    if (window.location.hostname.includes('facebook.com') && fbContainer) return fbContainer;

    // 5. Twitch
    const twitchPlayer = video.closest('.video-player__container') ||
                         video.closest('.highwind-video-player') ||
                         video.closest('[data-a-target="player-container"]');
    if (twitchPlayer) return twitchPlayer;

    // 6. Vimeo
    const vimeoPlayer = video.closest('.vp-video-wrapper') || video.closest('.player');
    if (vimeoPlayer) return vimeoPlayer;

    // 7. Netflix / Prime / Disney+
    const netflixPlayer = video.closest('.watch-video--player-view') || video.closest('.AkiraPlayer');
    if (netflixPlayer) return netflixPlayer;

    // 8. Common Video Players (Video.js, Plyr, JWPlayer, Dailymotion)
    const commonPlayer = video.closest('.video-js') ||
                         video.closest('.plyr') ||
                         video.closest('.jwplayer') ||
                         video.closest('.dmp_Player');
    if (commonPlayer) return commonPlayer;

    // 6. Generic detection: Traverse up 3 levels to find a container with controls/aspect ratio
    let current = video.parentElement;
    let best = video;
    let depth = 0;

    while (current && depth < 3 && current !== document.body && current !== document.documentElement) {
      const rect = current.getBoundingClientRect();
      const videoRect = video.getBoundingClientRect();

      // If parent has roughly same dimensions or contains video controls
      const hasControls = current.querySelector('.controls, [class*="control"], [class*="player-ui"]');
      if (hasControls || (Math.abs(rect.width - videoRect.width) < 40 && Math.abs(rect.height - videoRect.height) < 40)) {
        best = current;
      }
      current = current.parentElement;
      depth++;
    }

    return best;
  }

  function findAllVideos() {
    const videos = Array.from(document.querySelectorAll('video'));

    // Check open Shadow Roots
    function checkShadowRoots(node) {
      if (!node) return;
      if (node.shadowRoot) {
        const shadowVideos = node.shadowRoot.querySelectorAll('video');
        videos.push(...Array.from(shadowVideos));
        node.shadowRoot.querySelectorAll('*').forEach(checkShadowRoots);
      }
      node.childNodes.forEach(checkShadowRoots);
    }
    checkShadowRoots(document.body);

    return videos.filter((v) => {
      // Filter out tiny 1px tracking videos or hidden thumbnails
      const rect = v.getBoundingClientRect();
      return (rect.width > 40 && rect.height > 40) || (v.offsetWidth > 40 && v.offsetHeight > 40) || v.readyState > 0 || !v.paused;
    });
  }

  function getPrimaryVideo() {
    const videos = findAllVideos();
    if (videos.length === 0) return null;

    // 1. Return currently playing video
    const playing = videos.find((v) => !v.paused && !v.ended && v.currentTime > 0);
    if (playing) return playing;

    // 2. Return largest video by visible area
    let largest = videos[0];
    let maxArea = 0;
    videos.forEach((v) => {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > maxArea) {
        maxArea = area;
        largest = v;
      }
    });

    return largest;
  }

  // -------------------------------------------------------------
  // Maximize / Restore Core Logic
  // -------------------------------------------------------------

  function maximizeVideo(targetVideo) {
    const video = targetVideo || getPrimaryVideo();
    if (!video) {
      showToast('Nenhum vídeo reproduzível encontrado nesta página.');
      return;
    }

    const container = getBestPlayerContainer(video);
    if (!container) return;

    if (state.isMaximized && state.activeContainer === container) {
      // Already maximized -> Toggle off
      restoreVideo();
      return;
    }

    // Restore any previous video if switching
    if (state.isMaximized) {
      restoreVideo();
    }

    state.activeVideo = video;
    state.activeContainer = container;
    state.isMaximized = true;

    // Store original styles to restore seamlessly later
    state.originalStyles = {
      containerPosition: container.style.position,
      containerTop: container.style.top,
      containerLeft: container.style.left,
      containerWidth: container.style.width,
      containerHeight: container.style.height,
      containerZIndex: container.style.zIndex,
      containerTransform: container.style.transform,
      htmlOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow
    };

    // Unlock any ancestor overflow/clipping that would clip a fixed element
    state.ancestorsLocked = [];
    let p = container.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const style = window.getComputedStyle(p);
      if (style.overflow !== 'visible' || style.transform !== 'none' || style.filter !== 'none') {
        state.ancestorsLocked.push({
          element: p,
          overflow: p.style.overflow,
          transform: p.style.transform,
          filter: p.style.filter
        });
        p.style.setProperty('overflow', 'visible', 'important');
        p.style.setProperty('transform', 'none', 'important');
        p.style.setProperty('filter', 'none', 'important');
      }
      p = p.parentElement;
    }

    // Apply Maximized Classes & Styles
    document.documentElement.classList.add('__maxvideo-body-lock');
    document.body.classList.add('__maxvideo-body-lock');
    container.classList.add('__maxvideo-maximized-container');

    applyFitMode();
    applyFilters();

    // If inside an iframe, tell parent window to expand this iframe
    if (window !== window.top) {
      try {
        window.parent.postMessage({ type: 'MAXVIDEO_EXPAND_IFRAME' }, '*');
      } catch {}
    }

    // Trigger video resize event so custom players re-render controls properly
    window.dispatchEvent(new Event('resize'));
    video.dispatchEvent(new Event('resize'));

    showToast('Vídeo Maximizado na Janela (Pressione Esc para sair)');
  }

  function restoreVideo() {
    if (!state.isMaximized || !state.activeContainer) return;

    const container = state.activeContainer;
    const video = state.activeVideo;

    // Remove Maximized classes
    document.documentElement.classList.remove('__maxvideo-body-lock');
    document.body.classList.remove('__maxvideo-body-lock');
    container.classList.remove(
      '__maxvideo-maximized-container',
      '__maxvideo-fit-contain',
      '__maxvideo-fit-cover',
      '__maxvideo-fit-fill',
      '__maxvideo-fit-ultrawide'
    );

    if (video) {
      video.classList.remove(
        '__maxvideo-fit-contain',
        '__maxvideo-fit-cover',
        '__maxvideo-fit-fill',
        '__maxvideo-fit-ultrawide'
      );
      video.style.transform = '';
      video.style.filter = '';
    }

    // Restore ancestors styles
    state.ancestorsLocked.forEach((item) => {
      item.element.style.overflow = item.overflow;
      item.element.style.transform = item.transform;
      item.element.style.filter = item.filter;
    });
    state.ancestorsLocked = [];

    // Restore original styles
    if (state.originalStyles) {
      container.style.position = state.originalStyles.containerPosition;
      container.style.top = state.originalStyles.containerTop;
      container.style.left = state.originalStyles.containerLeft;
      container.style.width = state.originalStyles.containerWidth;
      container.style.height = state.originalStyles.containerHeight;
      container.style.zIndex = state.originalStyles.containerZIndex;
      container.style.transform = state.originalStyles.containerTransform;
      document.documentElement.style.overflow = state.originalStyles.htmlOverflow;
      document.body.style.overflow = state.originalStyles.bodyOverflow;
    }

    // If inside an iframe, tell parent window to restore iframe
    if (window !== window.top) {
      try {
        window.parent.postMessage({ type: 'MAXVIDEO_RESTORE_IFRAME' }, '*');
      } catch {}
    }

    state.isMaximized = false;
    state.activeVideo = null;
    state.activeContainer = null;
    state.originalStyles = null;

    window.dispatchEvent(new Event('resize'));
    showToast('Vídeo Restaurado ao Tamanho Normal');
  }

  function toggleMaximize(video) {
    if (state.isMaximized) {
      restoreVideo();
    } else {
      maximizeVideo(video);
    }
  }

  // -------------------------------------------------------------
  // Aspect Ratio & Zoom Management
  // -------------------------------------------------------------

  function setFitMode(mode) {
    state.fitMode = mode;
    applyFitMode();
    const names = {
      contain: 'Ajustar à Janela (Padrão)',
      cover: 'Cortar Barras Pretas (Zoom to Fill)',
      fill: 'Esticar para Preencher',
      ultrawide: 'Modo Ultrawide 21:9'
    };
    showToast(`Proporção: ${names[mode] || mode}`);
  }

  function cycleFitMode() {
    const modes = ['contain', 'cover', 'ultrawide', 'fill'];
    const nextIdx = (modes.indexOf(state.fitMode) + 1) % modes.length;
    setFitMode(modes[nextIdx]);
  }

  function applyFitMode() {
    const container = state.activeContainer;
    const video = state.activeVideo;
    if (!container || !video) return;

    // Reset classes
    ['__maxvideo-fit-contain', '__maxvideo-fit-cover', '__maxvideo-fit-fill', '__maxvideo-fit-ultrawide'].forEach(
      (cls) => {
        container.classList.remove(cls);
        video.classList.remove(cls);
      }
    );

    const fitClass = `__maxvideo-fit-${state.fitMode}`;
    container.classList.add(fitClass);
    video.classList.add(fitClass);

    applyVideoTransforms();
  }

  // -------------------------------------------------------------
  // Video Enhancements (Speed, Filters, Audio Boost)
  // -------------------------------------------------------------

  function setPlaybackSpeed(newSpeed) {
    const video = state.activeVideo || getPrimaryVideo();
    if (!video) return;

    const clamped = Math.max(0.25, Math.min(5.0, Math.round(newSpeed * 100) / 100));
    video.playbackRate = clamped;
    state.speed = clamped;

    chrome.storage.local.get({ rememberSpeed: false }, (items) => {
      if (items.rememberSpeed) {
        chrome.storage.local.set({ savedSpeed: clamped });
      }
    });

    showToast(`Velocidade: ${clamped}x`);
  }

  function adjustPlaybackSpeed(delta) {
    const current = (state.activeVideo || getPrimaryVideo())?.playbackRate || state.speed || 1.0;
    setPlaybackSpeed(current + delta);
  }

  function setAudioBoost(multiplier) {
    const video = state.activeVideo || getPrimaryVideo();
    if (!video) return;

    try {
      if (!state.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        state.audioCtx = new AudioContext();
        state.audioSource = state.audioCtx.createMediaElementSource(video);
        state.gainNode = state.audioCtx.createGain();
        state.audioSource.connect(state.gainNode);
        state.gainNode.connect(state.audioCtx.destination);
      }

      if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
      }

      state.gainNode.gain.value = multiplier;
      state.audioBoost = multiplier;
      showToast(`Amplificador de Áudio: ${Math.round(multiplier * 100)}%`);
    } catch (e) {
      console.warn('AudioContext boost not supported on this video stream (e.g. CORS):', e);
      showToast('Amplificação de áudio bloqueada pelas restrições do player');
    }
  }

  function applyVideoTransforms() {
    const video = state.activeVideo || getPrimaryVideo();
    if (!video) return;

    const transforms = [];
    if (state.fitMode === 'ultrawide') {
      transforms.push('scale(1.33)');
    } else if (state.customZoom !== 1.0) {
      transforms.push(`scale(${state.customZoom})`);
    }

    if (state.isFlipped) {
      transforms.push('scaleX(-1)');
    }

    if (state.rotation !== 0) {
      transforms.push(`rotate(${state.rotation}deg)`);
    }

    video.style.transform = transforms.join(' ');
  }

  function toggleFlip() {
    state.isFlipped = !state.isFlipped;
    applyVideoTransforms();
    showToast(state.isFlipped ? 'Espelhar Horizontal: Ativado' : 'Espelhar Horizontal: Normal');
  }

  function rotateVideo() {
    state.rotation = (state.rotation + 90) % 360;
    applyVideoTransforms();
    showToast(`Rotação do Vídeo: ${state.rotation}°`);
  }

  function applyFilters() {
    const video = state.activeVideo || getPrimaryVideo();
    if (!video) return;

    video.style.filter = `brightness(${state.brightness}%) contrast(${state.contrast}%)`;
  }

  function setBrightness(val) {
    state.brightness = val;
    applyFilters();
  }

  function setContrast(val) {
    state.contrast = val;
    applyFilters();
  }

  async function togglePiP(targetVideo) {
    const video = targetVideo || state.activeVideo || getPrimaryVideo();
    if (!video) {
      showToast('Nenhum vídeo encontrado para Picture-in-Picture');
      return;
    }

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showToast('Picture-in-Picture Encerrado');
      } else {
        await video.requestPictureInPicture();
        showToast('Picture-in-Picture Ativado');
      }
    } catch (err) {
      console.error('PiP Error:', err);
      showToast('Não foi possível ativar Picture-in-Picture');
    }
  }

  function toggleCleanWindow() {
    chrome.runtime.sendMessage({ action: 'toggle-clean-window' });
  }

  function toggleFullscreen() {
    chrome.runtime.sendMessage({ action: 'toggle-fullscreen' });
  }

  // -------------------------------------------------------------
  // Video Downloader & Stream Sniffer
  // -------------------------------------------------------------

  let activeRecorder = null;
  let recordedChunks = [];
  let recordTimerInterval = null;
  let recordSeconds = 0;

  // Sniffed media store from page-hook.js (Main World)
  const sniffedMedia = [];
  window.addEventListener('MAXVIDEO_SNIFFED_MEDIA', (e) => {
    if (e.detail && e.detail.url) {
      sniffedMedia.push(e.detail);
    }
  });

  function cleanUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    return rawUrl
      .replace(/\\\//g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/&amp;/g, '&')
      .trim();
  }

  function stripByteRangeParams(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return '';
    try {
      const parsed = new URL(urlStr);
      parsed.searchParams.delete('bytestart');
      parsed.searchParams.delete('byteend');
      parsed.searchParams.delete('range');
      return parsed.toString();
    } catch {
      return urlStr
        .replace(/([?&])bytestart=\d+(&|$)/g, '$1')
        .replace(/([?&])byteend=\d+(&|$)/g, '$1')
        .replace(/([?&])range=\d+-\d+(&|$)/g, '$1')
        .replace(/[?&]$/, '')
        .replace(/\?&/, '?');
    }
  }

  function isValidMediaUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    // Reject blob, data, and web page URLs
    if (lower.startsWith('blob:') || lower.startsWith('data:')) return false;
    if (lower.includes('/embed/') || lower.includes('.htm') || lower.includes('.html') || lower.includes('.php') || lower.includes('/watch?v=')) {
      return false;
    }
    // Reject static branding/promo clips, tracking pixels, and assets
    if (lower.includes('static.cdninstagram.com') || lower.includes('/rsrc.php/') || lower.includes('instagram_branding')) {
      return false;
    }
    if (lower.includes('static.xx.fbcdn.net')) return false;

    // Reject static images
    if (lower.match(/\.(jpg|jpeg|png|webp|gif|ico|svg)(\?.*)?$/i)) return false;

    // NEVER pass googlevideo directly to chrome.downloads because Google returns 403 Forbidden (1KB corrupt file)
    if (lower.includes('googlevideo.com')) return false;

    // Accept valid direct video URLs
    if (lower.match(/\.(mp4|webm|mkv|mov|m4v)(\?.*)?$/i)) return true;
    if (lower.includes('video.twimg.com')) return true;
    if (lower.includes('cdninstagram.com')) return true;
    if (lower.includes('fbcdn.net')) return true;
    return false;
  }

  function getYouTubeVideoId(targetVideo) {
    try {
      // 1. Se um elemento de vídeo específico foi fornecido (ex: card de preview no feed ou busca)
      if (targetVideo) {
        const card = targetVideo.closest(
          'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
          'ytd-grid-video-renderer, ytd-rich-grid-media, ytd-inline-preview-renderer, ' +
          'ytd-video-preview, ytd-notification-renderer, [class*="ytd-rich-item"]'
        );
        if (card) {
          const link = card.querySelector('a#thumbnail[href*="v="], a#video-title-link[href*="v="], a[href*="/watch?v="], a[href*="/shorts/"]');
          if (link && link.href) {
            const cardUrl = new URL(link.href, window.location.origin);
            if (cardUrl.searchParams.has('v')) return cardUrl.searchParams.get('v');
            const matchShort = cardUrl.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
            if (matchShort) return matchShort[1];
          }
        }
      }

      // 2. URL ativa da página
      const url = new URL(window.location.href);
      if (url.searchParams.has('v')) return url.searchParams.get('v');
      const match = url.pathname.match(/\/(shorts|embed|v)\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[2];

      // 3. Player principal
      const moviePlayer = document.getElementById('movie_player');
      if (moviePlayer && typeof moviePlayer.getVideoData === 'function') {
        const data = moviePlayer.getVideoData();
        if (data && data.video_id) return data.video_id;
      }
    } catch {}
    return null;
  }

  function resolveIsoLanguage(trackObj) {
    if (!trackObj) return 'und';
    const id = (trackObj.id || '').toLowerCase();
    const name = (trackObj.displayName || '').toLowerCase();
    if (id.startsWith('por') || id.startsWith('pt') || name.includes('portugu')) return 'por';
    if (id.startsWith('eng') || id.startsWith('en') || name.includes('ingl') || name.includes('english')) return 'eng';
    if (id.startsWith('spa') || id.startsWith('es') || name.includes('espa') || name.includes('spanish')) return 'spa';
    if (id.startsWith('fra') || id.startsWith('fr') || name.includes('franc') || name.includes('french')) return 'fra';
    if (id.startsWith('deu') || id.startsWith('de') || name.includes('alem') || name.includes('german')) return 'deu';
    if (id.startsWith('ita') || id.startsWith('it') || name.includes('ital')) return 'ita';
    if (id.startsWith('jpn') || id.startsWith('ja') || name.includes('japon') || name.includes('japanese')) return 'jpn';
    if (id.startsWith('kor') || id.startsWith('ko') || name.includes('corean') || name.includes('korean')) return 'kor';
    if (id.startsWith('zho') || id.startsWith('zh') || name.includes('chin') || name.includes('chinese')) return 'zho';
    if (id.startsWith('rus') || id.startsWith('ru') || name.includes('russ')) return 'rus';
    return 'und';
  }

  function packIso639Language(langStr) {
    if (!langStr || typeof langStr !== 'string' || langStr.length < 3) return 0x55c4; // 'und'
    const s = langStr.toLowerCase().slice(0, 3);
    const c0 = s.charCodeAt(0) - 0x60;
    const c1 = s.charCodeAt(1) - 0x60;
    const c2 = s.charCodeAt(2) - 0x60;
    if (c0 < 1 || c0 > 26 || c1 < 1 || c1 > 26 || c2 < 1 || c2 > 26) return 0x55c4;
    return (((c0 & 0x1f) << 10) | ((c1 & 0x1f) << 5) | (c2 & 0x1f)) >>> 0;
  }

  function getAudioTrackScore(f) {
    let score = 0;
    const track = f.audioTrack || {};
    const dispName = (track.displayName || '').toLowerCase();
    const trackId = (track.id || '').toLowerCase();
    const urlStr = (f.url || '').toLowerCase();

    const isPt = dispName.includes('portugu') || dispName.includes('brasil') || dispName.includes('brazil') ||
                 trackId.startsWith('por') || trackId.startsWith('pt') ||
                 urlStr.includes('btrack%3dpor') || urlStr.includes('btrack%3dpt') || urlStr.includes('btrack:por') || urlStr.includes('btrack:pt');

    const isOriginal = dispName.includes('original') ||
                       trackId.includes('.main') || trackId.includes('.original') ||
                       trackId.includes('orig') ||
                       urlStr.includes('.main') || urlStr.includes('original') ||
                       (!f.audioTrack);

    const isDubbed = dispName.includes('dub') || dispName.includes('auto-dubbed') || dispName.includes('dublado') || dispName.includes('dublagem') ||
                     trackId.includes('dubbed') || trackId.includes('dub') ||
                     urlStr.includes('dubbed');

    // 1. Original em Português (+500)
    if (isPt && isOriginal) score += 500;
    // 2. Faixa em Português (+300)
    else if (isPt) score += 300;
    // 3. Faixa Original não-dublada de qualquer idioma (+200)
    else if (isOriginal && !isDubbed) score += 200;

    // Penalidade drástica para dublagem automática na seleção primária
    if (isDubbed) score -= 300;

    // Default oficial do player
    if (track.audioIsDefault && !isDubbed) score += 50;

    // Stream VISIONOS direto sem throttling
    if (urlStr.includes('c=visionos')) score += 30;

    // AAC itag 140 para MP4
    if (f.itag === 140) score += 20;
    else if ((f.mimeType || '').includes('audio/mp4')) score += 10;

    score += Math.min(20, Math.round((parseInt(f.bitrate || 0, 10)) / 10000));
    return score;
  }

  function parseYouTubeFormats(streamingData, videoDetails = {}) {
    const allFormats = [];
    const title = videoDetails.title || 'YouTube Video';
    const s = streamingData || {};

    (s.formats || []).forEach((f) => {
      if (f.url && !allFormats.some((x) => x.url === f.url)) {
        allFormats.push({ ...f, isMuxed: true });
      }
    });

    (s.adaptiveFormats || []).forEach((f) => {
      if (!f.url) return;
      const isAudio = (f.mimeType || '').startsWith('audio/');
      const fTrackKey = f.audioTrack ? `${f.audioTrack.id || ''}:${f.audioTrack.displayName || ''}` : '';
      const isDuplicate = allFormats.some((x) => {
        if (x.url === f.url) return true;
        const xIsAudio = (x.mimeType || '').startsWith('audio/');
        if (isAudio && xIsAudio) {
          const xTrackKey = x.audioTrack ? `${x.audioTrack.id || ''}:${x.audioTrack.displayName || ''}` : '';
          return x.itag === f.itag && xTrackKey === fTrackKey;
        }
        return false;
      });
      if (!isDuplicate) {
        allFormats.push({ ...f, isMuxed: false });
      }
    });

    const videoFormats = allFormats.filter((f) => f.mimeType && f.mimeType.startsWith('video/'));
    const audioFormats = allFormats.filter((f) => f.mimeType && f.mimeType.startsWith('audio/'));
    const muxedFormats = allFormats.filter((f) => f.isMuxed || (f.mimeType && f.mimeType.includes('avc1') && f.audioQuality));

    const parsedVideos = videoFormats.map((f) => {
      const qLabel = f.qualityLabel || (f.height ? `${f.height}p` : 'Vídeo');
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

    // Identifica e prioriza a faixa de áudio original / pt-BR como primária (default)
    let bestAudio = null;
    let secondaryAudio = null;
    if (audioFormats.length > 0) {
      audioFormats.sort((a, b) => getAudioTrackScore(b) - getAudioTrackScore(a));
      bestAudio = audioFormats[0];

      // Faixa secundária para Dual Áudio (ex: dublagem em inglês ou idioma alternativo)
      const bestId = bestAudio.audioTrack?.id || '';
      const bestName = bestAudio.audioTrack?.displayName || '';
      const secondaryCandidates = audioFormats.filter((f) => {
        if (f === bestAudio || f.url === bestAudio.url) return false;
        const fId = f.audioTrack?.id || '';
        const fName = f.audioTrack?.displayName || '';
        if (bestId && fId && bestId === fId) return false;
        if (bestName && fName && bestName === fName) return false;
        return true;
      });

      if (secondaryCandidates.length > 0) {
        secondaryCandidates.sort((a, b) => {
          const aAac = a.itag === 140 ? 2 : ((a.mimeType || '').includes('audio/mp4') ? 1 : 0);
          const bAac = b.itag === 140 ? 2 : ((b.mimeType || '').includes('audio/mp4') ? 1 : 0);
          if (aAac !== bAac) return bAac - aAac;
          return (parseInt(b.bitrate || 0, 10)) - (parseInt(a.bitrate || 0, 10));
        });
        secondaryAudio = secondaryCandidates[0];
      }
    }

    const audioSize = bestAudio && bestAudio.contentLength ? parseInt(bestAudio.contentLength, 10) : 0;
    const secondaryAudioSize = secondaryAudio && secondaryAudio.contentLength ? parseInt(secondaryAudio.contentLength, 10) : 0;

    // Coleta todas as resoluções únicas dos fluxos de vídeo
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

      const best = candidates.find((c) => (c.url || '').includes('c=VISIONOS') && c.isMp4) ||
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
        badge = '1080p Full HD';
        qualityTitle = `${best.qualityLabel} Full HD`;
        if (!hasRecommended) {
          isRec = true;
          hasRecommended = true;
        }
      } else if (height >= 700 && height < 1000) {
        badge = '720p HD';
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

      const isDual = Boolean(!isMux && secondaryAudio);
      const audio1Name = bestAudio?.audioTrack?.displayName || 'Original';
      const audio2Name = secondaryAudio?.audioTrack?.displayName || 'Dublado';
      const dualLabel = isDual ? ` • Dual Áudio (${audio1Name} + ${audio2Name})` : '';

      results.push({
        quality: `${qualityTitle}${dualLabel}`,
        badge: badge,
        recommended: isRec,
        type: isMux ? 'muxed' : 'adaptive_video',
        size: (best.size || 0) + (isMux ? 0 : audioSize) + (isDual ? secondaryAudioSize : 0),
        videoSize: best.size || 0,
        url: best.url,
        itag: best.itag,
        height: height,
        isMp4: best.isMp4,
        audioUrl: isMux ? null : (bestAudio ? bestAudio.url : null),
        audioItag: isMux ? null : (bestAudio ? bestAudio.itag : null),
        audioSize: isMux ? 0 : audioSize,
        audioTrack: bestAudio?.audioTrack || null,
        audioTrackName: audio1Name,
        secondaryAudioUrl: isDual ? secondaryAudio.url : null,
        secondaryAudioItag: isDual ? secondaryAudio.itag : null,
        secondaryAudioSize: isDual ? secondaryAudioSize : 0,
        secondaryAudioTrack: isDual ? secondaryAudio.audioTrack : null,
        secondaryAudioTrackName: isDual ? audio2Name : null,
        isDualAudio: isDual,
        fallbackMuxedUrl: muxedUrl
      });
    });

    if (!hasRecommended && results.length > 0) {
      results[0].recommended = true;
    }

    // Formatos de áudio puro (M4A)
    if (audioFormats.length > 0) {
      const a = bestAudio || audioFormats[0];
      const origName = a?.audioTrack?.displayName || 'Original (Português)';
      results.push({
        quality: `Áudio M4A (${origName} - Alta Fidelidade)`,
        badge: 'Áudio M4A',
        type: 'audio',
        size: a.contentLength ? parseInt(a.contentLength, 10) : null,
        url: a.url,
        itag: a.itag
      });

      if (secondaryAudio) {
        const secName = secondaryAudio?.audioTrack?.displayName || 'Dublagem Secundária';
        results.push({
          quality: `Áudio M4A (${secName} - Alta Fidelidade)`,
          badge: 'Áudio M4A',
          type: 'audio',
          size: secondaryAudio.contentLength ? parseInt(secondaryAudio.contentLength, 10) : null,
          url: secondaryAudio.url,
          itag: secondaryAudio.itag
        });
      }
    }

    return { title, formats: results };
  }

  // File saving helpers
  function saveBlobAsFile(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 60000);
  }

  function saveUrlAsFile(url, filename) {
    chrome.runtime.sendMessage({
      action: 'download-video',
      url: url,
      filename: filename
    }, (resp) => {
      if (!resp || !resp.success) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 10000);
      }
    });
  }

  // Unified Download Modal with Format Selector and Live Progress Bar
  function createDownloadModal({ title = 'Vídeo', platform = 'YouTube' }) {
    let modalHost = document.getElementById('__maxvideo_dl_modal_host');
    if (modalHost) modalHost.remove();

    modalHost = document.createElement('div');
    modalHost.id = '__maxvideo_dl_modal_host';
    modalHost.style.cssText = `
      all: initial;
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
      pointer-events: auto;
    `;
    document.body.appendChild(modalHost);

    const shadow = modalHost.attachShadow ? modalHost.attachShadow({ mode: 'open' }) : modalHost;
    shadow.innerHTML = `
      <style>
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.78);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-sizing: border-box;
          z-index: 2147483647;
        }
        .modal-box {
          background: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 18px;
          padding: 24px;
          width: 480px;
          max-width: 92vw;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85);
          color: #f8fafc;
          animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          box-sizing: border-box;
        }
          background: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 18px;
          padding: 24px;
          width: 480px;
          max-width: 92vw;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85);
          color: #f8fafc;
          animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          box-sizing: border-box;
        }
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        .modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }
        .modal-title {
          font-size: 16px;
          font-weight: 700;
          color: #fff;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .modal-close {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          font-size: 24px;
          line-height: 1;
          padding: 0 4px;
        }
        .modal-close:hover { color: #fff; }
        .video-name {
          font-size: 13px;
          color: #94a3b8;
          margin-bottom: 18px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .loading-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          gap: 12px;
          color: #94a3b8;
          font-size: 13px;
        }
        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(255,255,255,0.1);
          border-top-color: #ef4444;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .options-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dl-option {
          all: unset;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.08);
          padding: 12px 16px;
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.15s;
          box-sizing: border-box;
        }
        .dl-option:hover {
          background: #334155;
          border-color: rgba(99, 102, 241, 0.5);
          transform: translateY(-1px);
        }
        .dl-option.recommended {
          background: rgba(99, 102, 241, 0.14);
          border-color: rgba(129, 140, 248, 0.4);
        }
        .dl-option.recommended:hover {
          background: rgba(99, 102, 241, 0.25);
          border-color: rgba(129, 140, 248, 0.7);
        }
        .opt-info {
          display: flex;
          align-items: center;
          gap: 10px;
          overflow: hidden;
        }
        .opt-badge {
          background: #4f46e5;
          color: #fff;
          padding: 3px 8px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          white-space: nowrap;
        }
        .opt-badge.fhd { background: #2563eb; }
        .opt-badge.hd { background: #059669; }
        .opt-badge.sd { background: #64748b; }
        .opt-badge.audio { background: #d97706; }
        .opt-badge.rec {
          background: linear-gradient(135deg, #8b5cf6, #ec4899);
          box-shadow: 0 0 10px rgba(236, 72, 153, 0.4);
        }
        .opt-title {
          font-size: 13px;
          font-weight: 600;
          color: #f1f5f9;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .opt-size {
          font-size: 11px;
          color: #94a3b8;
          white-space: nowrap;
        }
        .opt-btn-text {
          font-size: 12px;
          font-weight: 600;
          color: #818cf8;
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }
        /* Progress View Elements */
        .progress-view {
          display: flex;
          flex-direction: column;
          gap: 14px;
          animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .progress-meta-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .progress-badge-tag {
          font-size: 11px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 6px;
          background: #334155;
          color: #cbd5e1;
        }
        .progress-badge-tag.rec {
          background: rgba(99, 102, 241, 0.25);
          color: #a5b4fc;
          border: 1px solid rgba(129, 140, 248, 0.4);
        }
        .progress-badge-tag.warn {
          background: rgba(245, 158, 11, 0.2);
          color: #fcd34d;
          border: 1px solid rgba(245, 158, 11, 0.4);
        }
        .progress-bar-container {
          background: #1e293b;
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 10px;
          height: 14px;
          overflow: hidden;
          position: relative;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
        }
        .progress-bar-fill {
          height: 100%;
          width: 0%;
          border-radius: 8px;
          background: linear-gradient(90deg, #6366f1, #8b5cf6, #ec4899);
          transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }
        .progress-bar-fill.success {
          background: linear-gradient(90deg, #10b981, #059669);
        }
        .progress-bar-fill.fallback {
          background: linear-gradient(90deg, #f59e0b, #d97706);
        }
        .progress-bar-fill::after {
          content: '';
          position: absolute;
          top: 0; left: -100%; bottom: 0; width: 60%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent);
          animation: shimmer 1.6s infinite;
        }
        @keyframes shimmer {
          100% { left: 150%; }
        }
        .progress-stats-row {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
        }
        .progress-pct {
          font-size: 22px;
          font-weight: 700;
          color: #818cf8;
          letter-spacing: -0.5px;
        }
        .progress-pct.success {
          color: #34d399;
        }
        .progress-bytes {
          font-size: 13px;
          color: #94a3b8;
          font-weight: 500;
        }
        .progress-status-box {
          background: rgba(15, 23, 42, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 12px;
          line-height: 1.5;
          color: #cbd5e1;
        }
        .progress-status-box.warn {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(245, 158, 11, 0.35);
          color: #fde68a;
        }
        .progress-status-box.success {
          background: rgba(16, 185, 129, 0.12);
          border-color: rgba(16, 185, 129, 0.35);
          color: #a7f3d0;
        }
        .progress-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 4px;
        }
        .btn-cancel-dl {
          background: #334155;
          color: #f1f5f9;
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-cancel-dl:hover {
          background: #475569;
        }
        .btn-done-dl {
          background: #059669;
          color: #fff;
          border: none;
          padding: 8px 20px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-done-dl:hover {
          background: #10b981;
        }
        .modal-footer {
          margin-top: 16px;
          text-align: center;
          font-size: 11px;
          color: #64748b;
        }
      </style>
      <div class="modal-backdrop" id="modalBackdrop">
        <div class="modal-box" id="modalBox">
          <div class="modal-header">
            <div class="modal-title">
              <svg style="width:22px; height:22px; fill:#ef4444;" viewBox="0 0 24 24"><path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/></svg>
              <span id="modalHeaderTitle">${platform === 'YouTube' ? 'Baixar Vídeo do YouTube' : 'Baixar Vídeo'}</span>
            </div>
            <button class="modal-close" id="btnCloseModal">&times;</button>
          </div>
          <div class="video-name" id="modalVideoName">${title || 'Vídeo'}</div>
          <div id="modalBody">
            <div class="loading-state">
              <div class="spinner"></div>
              <span>Localizando streams reais de alta qualidade...</span>
            </div>
          </div>
          <div class="modal-footer" id="modalFooter">
            Processado diretamente pela extensão — Download direto sem intermediários
          </div>
        </div>
      </div>
    `;

    let cancelCallback = null;
    let isClosed = false;
    const closeListeners = [];

    function closeModal() {
      if (isClosed) return;
      isClosed = true;
      if (cancelCallback) {
        try { cancelCallback(); } catch {}
      }
      closeListeners.forEach((fn) => {
        try { fn(); } catch {}
      });
      modalHost.remove();
    }

    const backdrop = shadow.getElementById('modalBackdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }
    const box = shadow.getElementById('modalBox');
    if (box) {
      box.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
    const btnClose = shadow.getElementById('btnCloseModal');
    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeModal();
      });
    }

    const controls = {
      close: closeModal,
      setTitle: (newTitle) => {
        const el = shadow.getElementById('modalVideoName');
        if (el && newTitle) el.textContent = newTitle;
      },
      setFooter: (text, isGreen = false) => {
        const el = shadow.getElementById('modalFooter');
        if (el && text) {
          el.innerHTML = text;
          if (isGreen) el.style.color = '#34d399';
        }
      },
      showLoading: (msg) => {
        const body = shadow.getElementById('modalBody');
        if (!body) return;
        body.innerHTML = `
          <div class="loading-state">
            <div class="spinner"></div>
            <span>${msg || 'Processando...'}</span>
          </div>
        `;
      },
      showError: (msg) => {
        const body = shadow.getElementById('modalBody');
        if (!body) return;
        body.innerHTML = `
          <div class="loading-state" style="color: #f87171;">
            <span>${msg || 'Ocorreu um erro ao carregar as opções de download.'}</span>
          </div>
        `;
      },
      showFormats: (formats, onSelect) => {
        const body = shadow.getElementById('modalBody');
        if (!body) return;

        let optionsHtml = '<div class="options-list">';
        formats.forEach((fmt, idx) => {
          let badgeClass = 'sd';
          if (fmt.recommended) badgeClass = 'rec';
          else if (fmt.badge.includes('1080') || fmt.badge.includes('2160') || fmt.badge.includes('1440')) badgeClass = 'fhd';
          else if (fmt.badge.includes('720')) badgeClass = 'hd';
          else if (fmt.badge.includes('Áudio') || fmt.badge.includes('MP3') || (fmt.type && fmt.type.includes('audio'))) badgeClass = 'audio';

          const sizeStr = fmt.size ? ` • ${Math.round(fmt.size / (1024 * 1024))} MB` : '';
          const isRec = fmt.recommended ? ' recommended' : '';

          optionsHtml += `
            <button class="dl-option${isRec}" data-idx="${idx}">
              <div class="opt-info">
                <span class="opt-badge ${badgeClass}">${fmt.badge}</span>
                <span class="opt-title">${fmt.quality}</span>
                <span class="opt-size">${sizeStr}</span>
              </div>
              <span class="opt-btn-text">Baixar &darr;</span>
            </button>
          `;
        });
        optionsHtml += '</div>';

        body.innerHTML = optionsHtml;

        const buttons = body.querySelectorAll('.dl-option');
        buttons.forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(btn.getAttribute('data-idx'), 10);
            const chosen = formats[idx];
            if (chosen && onSelect) onSelect(chosen);
          });
        });
      },
      switchToProgress: ({ badge, badgeClass = 'rec', totalBytes = 0 }) => {
        const headerTitle = shadow.getElementById('modalHeaderTitle');
        if (headerTitle) headerTitle.textContent = 'Baixando Vídeo';

        const body = shadow.getElementById('modalBody');
        if (!body) return;

        const totalMbStr = totalBytes > 0 ? `${(totalBytes / (1024 * 1024)).toFixed(1)} MB` : '-- MB';

        body.innerHTML = `
          <div class="progress-view">
            <div class="progress-meta-row">
              <span class="progress-badge-tag ${badgeClass}" id="pbBadgeTag">${badge}</span>
              <span style="font-size: 11px; color: #94a3b8;" id="pbFormatInfo">MP4 Nativo</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="pbFill" style="width: 0%;"></div>
            </div>
            <div class="progress-stats-row">
              <span class="progress-pct" id="pbPct">0%</span>
              <span class="progress-bytes" id="pbBytes">0 MB / ${totalMbStr}</span>
            </div>
            <div class="progress-status-box" id="pbStatusBox">
              <span id="pbStatusText">Iniciando download seguro...</span>
            </div>
            <div class="progress-actions">
              <button class="btn-cancel-dl" id="btnCancelDownloadAction">Cancelar Download</button>
            </div>
          </div>
        `;

        const cancelBtn = body.querySelector('#btnCancelDownloadAction');
        if (cancelBtn) {
          cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closeModal();
          });
        }
      },
      setProgress: (percent, bytesNow, bytesTotal) => {
        const fill = shadow.getElementById('pbFill');
        const pctEl = shadow.getElementById('pbPct');
        const bytesEl = shadow.getElementById('pbBytes');

        if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
        if (pctEl) pctEl.textContent = `${percent}%`;

        if (bytesEl) {
          const nowMb = (bytesNow / (1024 * 1024)).toFixed(1);
          const totalMb = bytesTotal > 0 ? (bytesTotal / (1024 * 1024)).toFixed(1) : '--';
          bytesEl.textContent = `${nowMb} MB / ${totalMb} MB`;
        }
      },
      setStatus: (htmlText, type = 'normal') => {
        const box = shadow.getElementById('pbStatusBox');
        const textEl = shadow.getElementById('pbStatusText');
        if (box) {
          box.className = 'progress-status-box';
          if (type === 'warn') box.classList.add('warn');
          if (type === 'success') box.classList.add('success');
        }
        if (textEl) textEl.innerHTML = htmlText;
      },
      setBadge: (badgeText, badgeClass = 'rec') => {
        const tag = shadow.getElementById('pbBadgeTag');
        if (tag) {
          tag.textContent = badgeText;
          tag.className = `progress-badge-tag ${badgeClass}`;
        }
      },
      finishSuccess: (msg) => {
        const fill = shadow.getElementById('pbFill');
        const pctEl = shadow.getElementById('pbPct');
        const actions = shadow.querySelector('.progress-actions');

        if (fill) {
          fill.style.width = '100%';
          fill.className = 'progress-bar-fill success';
        }
        if (pctEl) {
          pctEl.textContent = '100%';
          pctEl.className = 'progress-pct success';
        }
        controls.setStatus(msg || '✅ Download concluído com sucesso! Salvo em Downloads.', 'success');

        if (actions) {
          actions.innerHTML = '<button class="btn-done-dl" id="btnDoneClose">Concluído</button>';
          const doneBtn = actions.querySelector('#btnDoneClose');
          if (doneBtn) {
            doneBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              closeModal();
            });
          }
        }

        setTimeout(() => {
          closeModal();
        }, 2600);
      },
      finishError: (msg) => {
        controls.setStatus(`❌ Erro no download: ${msg || 'Falha na conexão'}`, 'warn');
        const actions = shadow.querySelector('.progress-actions');
        if (actions) {
          actions.innerHTML = '<button class="btn-cancel-dl" id="btnErrClose">Fechar</button>';
          const errBtn = actions.querySelector('#btnErrClose');
          if (errBtn) {
            errBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              closeModal();
            });
          }
        }
      },
      onCancel: (fn) => {
        cancelCallback = fn;
      },
      onClose: (fn) => {
        if (typeof fn === 'function') closeListeners.push(fn);
      }
    };

    return { host: modalHost, shadow, controls };
  }

  // -------------------------------------------------------------
  // Pure JavaScript Standard ISO MP4 Box Multiplexer (Zero-External Dependencies)
  // Converts YouTube DASH video (H.264 itags 137/136/135) and audio (AAC itag 140)
  // into a 100% compliant, standard non-fragmented MP4 (ftyp + mdat + moov)
  // Guaranteed smooth playback & instant seeking in VLC, Windows Media, QuickTime, TVs, etc.
  // -------------------------------------------------------------
  function muxToStandardMp4(videoU8, audioU8, formatInfo, secondaryAudioU8 = null) {
    const u32 = (b, o) => ((b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0);
    const i32 = (b, o) => ((b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]));
    const u16 = (b, o) => ((b[o] << 8 | b[o + 1]) >>> 0);

    const setU16 = (b, o, v) => {
      b[o] = (v >> 8) & 0xff;
      b[o + 1] = v & 0xff;
    };

    const setU32 = (b, o, v) => {
      b[o] = (v >>> 24) & 0xff;
      b[o + 1] = (v >>> 16) & 0xff;
      b[o + 2] = (v >>> 8) & 0xff;
      b[o + 3] = v & 0xff;
    };

    function makeBox(type, contentU8) {
      const box = new Uint8Array(8 + contentU8.length);
      setU32(box, 0, 8 + contentU8.length);
      box[4] = type.charCodeAt(0);
      box[5] = type.charCodeAt(1);
      box[6] = type.charCodeAt(2);
      box[7] = type.charCodeAt(3);
      box.set(contentU8, 8);
      return box;
    }

    function concatU8(arrays) {
      let total = 0;
      for (let i = 0; i < arrays.length; i++) total += arrays[i].length;
      const res = new Uint8Array(total);
      let off = 0;
      for (let i = 0; i < arrays.length; i++) {
        res.set(arrays[i], off);
        off += arrays[i].length;
      }
      return res;
    }

    function findBox(u8, typeStr, start = 0, end = u8.length) {
      let off = start;
      while (off + 8 <= end) {
        const size = u32(u8, off);
        if (size < 8 || off + size > end) break;
        const t = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
        if (t === typeStr) return { off, size, end: off + size };
        off += size;
      }
      return null;
    }

    function findBoxRecursive(u8, targetType, start = 0, end = u8.length) {
      let off = start;
      while (off + 8 <= end) {
        const size = u32(u8, off);
        if (size < 8 || off + size > end) break;
        const t = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
        if (t === targetType) return { off, size, end: off + size };
        if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'mvex'].includes(t)) {
          const found = findBoxRecursive(u8, targetType, off + 8, off + size);
          if (found) return found;
        }
        off += size;
      }
      return null;
    }

    const vMoovBox = findBox(videoU8, 'moov');
    const aMoovBox = findBox(audioU8, 'moov');
    if (!vMoovBox || !aMoovBox) throw new Error('Cabeçalhos moov ausentes nos fluxos de vídeo ou áudio');

    const vStsdBox = findBoxRecursive(videoU8, 'stsd', vMoovBox.off, vMoovBox.end);
    const aStsdBox = findBoxRecursive(audioU8, 'stsd', aMoovBox.off, aMoovBox.end);
    if (!vStsdBox || !aStsdBox) throw new Error('stsd ausente nos fluxos');

    const vStsd = videoU8.subarray(vStsdBox.off, vStsdBox.end);
    const aStsd = audioU8.subarray(aStsdBox.off, aStsdBox.end);

    const vMdhdBox = findBoxRecursive(videoU8, 'mdhd', vMoovBox.off, vMoovBox.end);
    const aMdhdBox = findBoxRecursive(audioU8, 'mdhd', aMoovBox.off, aMoovBox.end);

    let vTimescale = 60000;
    if (vMdhdBox) {
      const ver = videoU8[vMdhdBox.off + 8];
      vTimescale = u32(videoU8, vMdhdBox.off + (ver === 1 ? 28 : 20)) || 60000;
    }

    let aTimescale = 44100;
    if (aMdhdBox) {
      const ver = audioU8[aMdhdBox.off + 8];
      aTimescale = u32(audioU8, aMdhdBox.off + (ver === 1 ? 28 : 20)) || 44100;
    }

    // Processamento opcional da segunda faixa de áudio (Dual Áudio / Dublagem)
    let a2Stsd = null;
    let a2Timescale = 44100;
    let secondaryAudioMoovBox = null;
    if (secondaryAudioU8 && secondaryAudioU8.length > 0) {
      try {
        secondaryAudioMoovBox = findBox(secondaryAudioU8, 'moov');
        if (secondaryAudioMoovBox) {
          const a2StsdBox = findBoxRecursive(secondaryAudioU8, 'stsd', secondaryAudioMoovBox.off, secondaryAudioMoovBox.end);
          if (a2StsdBox) {
            a2Stsd = secondaryAudioU8.subarray(a2StsdBox.off, a2StsdBox.end);
          }
          const a2MdhdBox = findBoxRecursive(secondaryAudioU8, 'mdhd', secondaryAudioMoovBox.off, secondaryAudioMoovBox.end);
          if (a2MdhdBox) {
            const ver = secondaryAudioU8[a2MdhdBox.off + 8];
            a2Timescale = u32(secondaryAudioU8, a2MdhdBox.off + (ver === 1 ? 28 : 20)) || 44100;
          }
        }
      } catch (e2) {
        console.warn('Erro ao processar cabeçalhos da segunda faixa de áudio:', e2);
        secondaryAudioMoovBox = null;
      }
    }

    let width = formatInfo?.width || 1920;
    let height = formatInfo?.height || 1080;
    for (let i = vStsdBox.off; i + 36 <= vStsdBox.end; i++) {
      if (videoU8[i + 4] === 97 && videoU8[i + 5] === 118 && videoU8[i + 6] === 99 && videoU8[i + 7] === 49) { // 'avc1'
        const w = u16(videoU8, i + 32);
        const h = u16(videoU8, i + 34);
        if (w > 0 && h > 0) {
          width = w;
          height = h;
          break;
        }
      }
    }

    function parseTrackFragments(u8, startOffset, isVideo) {
      const samples = [];
      let off = startOffset;
      while (off + 8 <= u8.length) {
        const moofSize = u32(u8, off);
        if (moofSize < 8 || off + moofSize > u8.length) break;
        const t = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
        if (t !== 'moof') {
          off += moofSize;
          continue;
        }

        let tfFlags = 0, defDur = 0, defSz = 0, defFl = 0;
        let tfdtTime = 0;
        let trunOff = 0;

        for (let i = off + 8; i + 8 <= off + moofSize; i++) {
          const subT = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
          if (subT === 'tfhd') {
            tfFlags = (u8[i + 9] << 16) | (u8[i + 10] << 8) | u8[i + 11];
            let p = i + 16;
            if (tfFlags & 0x01) p += 8;
            if (tfFlags & 0x02) p += 4;
            if (tfFlags & 0x08) { defDur = u32(u8, p); p += 4; }
            if (tfFlags & 0x10) { defSz = u32(u8, p); p += 4; }
            if (tfFlags & 0x20) { defFl = u32(u8, p); p += 4; }
          } else if (subT === 'tfdt') {
            const ver = u8[i + 8];
            tfdtTime = ver === 1 ? (u32(u8, i + 12) * 4294967296 + u32(u8, i + 16)) : u32(u8, i + 12);
          } else if (subT === 'trun') {
            trunOff = i;
          }
        }

        const mdatHead = off + moofSize;
        if (mdatHead + 8 > u8.length) break;
        const mdatSize = u32(u8, mdatHead);

        if (trunOff > 0) {
          const trFlags = (u8[trunOff + 9] << 16) | (u8[trunOff + 10] << 8) | u8[trunOff + 11];
          const count = u32(u8, trunOff + 12);
          let p = trunOff + 16;
          let dataOffset = 0;
          let firstSampleFlags = 0;
          if (trFlags & 0x01) { dataOffset = i32(u8, p); p += 4; }
          if (trFlags & 0x04) { firstSampleFlags = u32(u8, p); p += 4; }

          let dataPayloadOff = (trFlags & 0x01) ? (off + dataOffset) : (mdatHead + 8);
          let sampleDataCursor = dataPayloadOff;
          let curDts = tfdtTime;

          for (let s = 0; s < count; s++) {
            let dur = defDur;
            let sz = defSz;
            let fl = (s === 0 && (trFlags & 0x04)) ? firstSampleFlags : defFl;
            let cto = 0;
            if (trFlags & 0x100) { dur = u32(u8, p); p += 4; }
            if (trFlags & 0x200) { sz = u32(u8, p); p += 4; }
            if (trFlags & 0x400) { fl = u32(u8, p); p += 4; }
            if (trFlags & 0x800) { cto = i32(u8, p); p += 4; }

            const isKeyframe = isVideo ? ((fl & 0x10000) === 0) : true;

            samples.push({
              buf: u8.subarray(sampleDataCursor, sampleDataCursor + sz),
              sz,
              dur,
              dts: curDts,
              cto,
              isKeyframe
            });

            sampleDataCursor += sz;
            curDts += dur;
          }
        }

        off += moofSize + mdatSize;
      }
      return samples;
    }

    const videoSamples = parseTrackFragments(videoU8, vMoovBox.end, true);
    const audioSamples = parseTrackFragments(audioU8, aMoovBox.end, false);
    const secondaryAudioSamples = (secondaryAudioMoovBox && a2Stsd) ? parseTrackFragments(secondaryAudioU8, secondaryAudioMoovBox.end, false) : [];

    if (videoSamples.length === 0 || audioSamples.length === 0) {
      throw new Error('Nenhum fragmento de vídeo ou áudio encontrado para conversão');
    }

    // Intercala blocos de 1 segundo de vídeo e faixas de áudio em sincronia temporal
    const CHUNK_DURATION_SEC = 1.0;
    const vChunkTicks = vTimescale * CHUNK_DURATION_SEC;
    const aChunkTicks = aTimescale * CHUNK_DURATION_SEC;
    const a2ChunkTicks = a2Timescale * CHUNK_DURATION_SEC;

    const mdatParts = [];
    let mdatTotalPayload = 0;

    const vChunks = [];
    const aChunks = [];
    const a2Chunks = [];

    let vIdx = 0;
    let aIdx = 0;
    let a2Idx = 0;

    while (vIdx < videoSamples.length || aIdx < audioSamples.length || (secondaryAudioSamples.length > 0 && a2Idx < secondaryAudioSamples.length)) {
      if (vIdx < videoSamples.length) {
        const startV = vIdx;
        const dtsStart = videoSamples[startV].dts;
        let chunkSz = 0;
        while (vIdx < videoSamples.length && (videoSamples[vIdx].dts - dtsStart < vChunkTicks || vIdx === startV)) {
          chunkSz += videoSamples[vIdx].sz;
          vIdx++;
        }
        vChunks.push({
          startSample: startV,
          count: vIdx - startV,
          chunkOffset: 0,
          size: chunkSz
        });
        for (let i = startV; i < vIdx; i++) {
          mdatParts.push(videoSamples[i].buf);
        }
        mdatTotalPayload += chunkSz;
      }

      if (aIdx < audioSamples.length) {
        const startA = aIdx;
        const dtsStart = audioSamples[startA].dts;
        let chunkSz = 0;
        while (aIdx < audioSamples.length && (audioSamples[aIdx].dts - dtsStart < aChunkTicks || aIdx === startA)) {
          chunkSz += audioSamples[aIdx].sz;
          aIdx++;
        }
        aChunks.push({
          startSample: startA,
          count: aIdx - startA,
          chunkOffset: 0,
          size: chunkSz
        });
        for (let i = startA; i < aIdx; i++) {
          mdatParts.push(audioSamples[i].buf);
        }
        mdatTotalPayload += chunkSz;
      }

      if (secondaryAudioSamples.length > 0 && a2Idx < secondaryAudioSamples.length) {
        const startA2 = a2Idx;
        const dtsStart = secondaryAudioSamples[startA2].dts;
        let chunkSz = 0;
        while (a2Idx < secondaryAudioSamples.length && (secondaryAudioSamples[a2Idx].dts - dtsStart < a2ChunkTicks || a2Idx === startA2)) {
          chunkSz += secondaryAudioSamples[a2Idx].sz;
          a2Idx++;
        }
        a2Chunks.push({
          startSample: startA2,
          count: a2Idx - startA2,
          chunkOffset: 0,
          size: chunkSz
        });
        for (let i = startA2; i < a2Idx; i++) {
          mdatParts.push(secondaryAudioSamples[i].buf);
        }
        mdatTotalPayload += chunkSz;
      }
    }

    const ftypHead = new Uint8Array([
      0x00, 0x00, 0x00, 0x20, // size 32
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x69, 0x73, 0x6f, 0x6d, // 'isom'
      0x00, 0x00, 0x02, 0x00, // minor: 512
      0x69, 0x73, 0x6f, 0x6d, // compatible: isom
      0x69, 0x73, 0x6f, 0x32, // iso2
      0x61, 0x76, 0x63, 0x31, // avc1
      0x6d, 0x70, 0x34, 0x31  // mp41
    ]);

    const isLargeMdat = (mdatTotalPayload + 8 > 0xFFFFFFFF);
    let mdatHead;
    if (!isLargeMdat) {
      mdatHead = new Uint8Array(8);
      setU32(mdatHead, 0, 8 + mdatTotalPayload);
      mdatHead[4] = 109; mdatHead[5] = 100; mdatHead[6] = 97; mdatHead[7] = 116; // 'mdat'
    } else {
      mdatHead = new Uint8Array(16);
      setU32(mdatHead, 0, 1);
      mdatHead[4] = 109; mdatHead[5] = 100; mdatHead[6] = 97; mdatHead[7] = 116; // 'mdat'
      const total64 = mdatTotalPayload + 16;
      setU32(mdatHead, 8, Math.floor(total64 / 4294967296));
      setU32(mdatHead, 12, total64 >>> 0);
    }

    let currentFileOffset = ftypHead.length + mdatHead.length;
    let vC = 0, aC = 0, a2C = 0;
    while (vC < vChunks.length || aC < aChunks.length || a2C < a2Chunks.length) {
      if (vC < vChunks.length) {
        vChunks[vC].chunkOffset = currentFileOffset;
        currentFileOffset += vChunks[vC].size;
        vC++;
      }
      if (aC < aChunks.length) {
        aChunks[aC].chunkOffset = currentFileOffset;
        currentFileOffset += aChunks[aC].size;
        aC++;
      }
      if (a2C < a2Chunks.length) {
        a2Chunks[a2C].chunkOffset = currentFileOffset;
        currentFileOffset += a2Chunks[a2C].size;
        a2C++;
      }
    }

    function buildStbl(isAudio, samples, chunks, stsdU8) {
      const sttsEntries = [];
      let curDur = -1;
      let curCount = 0;
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].dur === curDur) {
          curCount++;
        } else {
          if (curCount > 0) sttsEntries.push({ count: curCount, dur: curDur });
          curDur = samples[i].dur;
          curCount = 1;
        }
      }
      if (curCount > 0) sttsEntries.push({ count: curCount, dur: curDur });

      const sttsBuf = new Uint8Array(8 + sttsEntries.length * 8);
      setU32(sttsBuf, 0, 0);
      setU32(sttsBuf, 4, sttsEntries.length);
      for (let i = 0; i < sttsEntries.length; i++) {
        setU32(sttsBuf, 8 + i * 8, sttsEntries[i].count);
        setU32(sttsBuf, 12 + i * 8, sttsEntries[i].dur);
      }
      const stts = makeBox('stts', sttsBuf);

      let stss = null;
      if (!isAudio) {
        const keyframes = [];
        for (let i = 0; i < samples.length; i++) {
          if (samples[i].isKeyframe) keyframes.push(i + 1);
        }
        const stssBuf = new Uint8Array(8 + keyframes.length * 4);
        setU32(stssBuf, 0, 0);
        setU32(stssBuf, 4, keyframes.length);
        for (let i = 0; i < keyframes.length; i++) {
          setU32(stssBuf, 8 + i * 4, keyframes[i]);
        }
        stss = makeBox('stss', stssBuf);
      }

      let ctts = null;
      if (!isAudio) {
        const cttsEntries = [];
        let curCto = -999999999;
        let curCtoCount = 0;
        for (let i = 0; i < samples.length; i++) {
          if (samples[i].cto === curCto) {
            curCtoCount++;
          } else {
            if (curCtoCount > 0) cttsEntries.push({ count: curCtoCount, cto: curCto });
            curCto = samples[i].cto;
            curCtoCount = 1;
          }
        }
        if (curCtoCount > 0) cttsEntries.push({ count: curCtoCount, cto: curCto });

        const cttsBuf = new Uint8Array(8 + cttsEntries.length * 8);
        setU32(cttsBuf, 0, 0);
        setU32(cttsBuf, 4, cttsEntries.length);
        for (let i = 0; i < cttsEntries.length; i++) {
          setU32(cttsBuf, 8 + i * 8, cttsEntries[i].count);
          setU32(cttsBuf, 12 + i * 8, cttsEntries[i].cto);
        }
        ctts = makeBox('ctts', cttsBuf);
      }

      const stscEntries = [];
      let prevCount = -1;
      for (let i = 0; i < chunks.length; i++) {
        if (chunks[i].count !== prevCount) {
          stscEntries.push({ firstChunk: i + 1, samplesPerChunk: chunks[i].count, desc: 1 });
          prevCount = chunks[i].count;
        }
      }
      const stscBuf = new Uint8Array(8 + stscEntries.length * 12);
      setU32(stscBuf, 0, 0);
      setU32(stscBuf, 4, stscEntries.length);
      for (let i = 0; i < stscEntries.length; i++) {
        setU32(stscBuf, 8 + i * 12, stscEntries[i].firstChunk);
        setU32(stscBuf, 12 + i * 12, stscEntries[i].samplesPerChunk);
        setU32(stscBuf, 16 + i * 12, stscEntries[i].desc);
      }
      const stsc = makeBox('stsc', stscBuf);

      const stszBuf = new Uint8Array(12 + samples.length * 4);
      setU32(stszBuf, 0, 0);
      setU32(stszBuf, 4, 0);
      setU32(stszBuf, 8, samples.length);
      for (let i = 0; i < samples.length; i++) {
        setU32(stszBuf, 12 + i * 4, samples[i].sz);
      }
      const stsz = makeBox('stsz', stszBuf);

      const needs64 = chunks.some((c) => c.chunkOffset > 0xFFFFFFFF);
      let chunkBox;
      if (!needs64) {
        const stcoBuf = new Uint8Array(8 + chunks.length * 4);
        setU32(stcoBuf, 0, 0);
        setU32(stcoBuf, 4, chunks.length);
        for (let i = 0; i < chunks.length; i++) {
          setU32(stcoBuf, 8 + i * 4, chunks[i].chunkOffset);
        }
        chunkBox = makeBox('stco', stcoBuf);
      } else {
        const co64Buf = new Uint8Array(8 + chunks.length * 8);
        setU32(co64Buf, 0, 0);
        setU32(co64Buf, 4, chunks.length);
        for (let i = 0; i < chunks.length; i++) {
          setU32(co64Buf, 8 + i * 8, Math.floor(chunks[i].chunkOffset / 4294967296));
          setU32(co64Buf, 12 + i * 8, chunks[i].chunkOffset >>> 0);
        }
        chunkBox = makeBox('co64', co64Buf);
      }

      const stblParts = [stsdU8, stts];
      if (stss) stblParts.push(stss);
      if (ctts) stblParts.push(ctts);
      stblParts.push(stsc, stsz, chunkBox);

      return makeBox('stbl', concatU8(stblParts));
    }

    function buildTrak(trackId, isAudio, samples, chunks, stsdU8, movieTimescale, trackTimescale, w, h, isDefaultAudio = false, alternateGroup = 0, langCode = 0x55c4) {
      let trackDur = 0;
      for (let i = 0; i < samples.length; i++) trackDur += samples[i].dur;
      const movieDur = Math.round((trackDur / trackTimescale) * movieTimescale);

      const tkhdBuf = new Uint8Array(84);
      setU32(tkhdBuf, 0, 0x00000003); // enabled | in_movie
      setU32(tkhdBuf, 12, trackId);
      setU32(tkhdBuf, 20, movieDur);
      setU16(tkhdBuf, 34, alternateGroup || 0); // alternate_group
      setU16(tkhdBuf, 36, isAudio ? (isDefaultAudio ? 0x0100 : 0x0000) : 0x0000); // volume
      setU32(tkhdBuf, 40, 0x00010000);
      setU32(tkhdBuf, 56, 0x00010000);
      setU32(tkhdBuf, 72, 0x40000000);
      setU32(tkhdBuf, 76, isAudio ? 0 : (w << 16));
      setU32(tkhdBuf, 80, isAudio ? 0 : (h << 16));
      const tkhd = makeBox('tkhd', tkhdBuf);

      const mdhdBuf = new Uint8Array(24);
      setU32(mdhdBuf, 0, 0);
      setU32(mdhdBuf, 12, trackTimescale);
      setU32(mdhdBuf, 16, trackDur);
      setU16(mdhdBuf, 20, langCode || 0x55c4);
      const mdhd = makeBox('mdhd', mdhdBuf);

      const hdlrBuf = new Uint8Array(24);
      const hdlrType = isAudio ? 'soun' : 'vide';
      for (let i = 0; i < 4; i++) hdlrBuf[8 + i] = hdlrType.charCodeAt(i);
      const hdlr = makeBox('hdlr', hdlrBuf);

      let mhd;
      if (isAudio) {
        mhd = makeBox('smhd', new Uint8Array(8));
      } else {
        const vmhdBuf = new Uint8Array(12);
        setU32(vmhdBuf, 0, 1);
        mhd = makeBox('vmhd', vmhdBuf);
      }

      const drefEntry = new Uint8Array([0x00, 0x00, 0x00, 0x0c, 0x75, 0x72, 0x6c, 0x20, 0x00, 0x00, 0x00, 0x01]);
      const drefBuf = new Uint8Array(8 + drefEntry.length);
      setU32(drefBuf, 4, 1);
      drefBuf.set(drefEntry, 8);
      const dinf = makeBox('dinf', makeBox('dref', drefBuf));

      const stbl = buildStbl(isAudio, samples, chunks, stsdU8);
      const minf = makeBox('minf', concatU8([mhd, dinf, stbl]));
      const mdia = makeBox('mdia', concatU8([mdhd, hdlr, minf]));

      return makeBox('trak', concatU8([tkhd, mdia]));
    }

    const MOVIE_TIMESCALE = 60000;
    const langCode1 = packIso639Language(resolveIsoLanguage(formatInfo?.audioTrack));
    const langCode2 = packIso639Language(resolveIsoLanguage(formatInfo?.secondaryAudioTrack));
    const hasDual = Boolean(secondaryAudioSamples.length > 0 && a2Stsd);

    const vTrak = buildTrak(1, false, videoSamples, vChunks, vStsd, MOVIE_TIMESCALE, vTimescale, width, height, false, 0, 0x55c4);
    // Faixa 2: Áudio Original (Padrão, volume 1.0, default ativo)
    const aTrak = buildTrak(2, true, audioSamples, aChunks, aStsd, MOVIE_TIMESCALE, aTimescale, 0, 0, true, hasDual ? 1 : 0, langCode1);
    // Faixa 3: Áudio Secundário / Dublado (volume 0.0, alternate_group 1 para troca pelo player)
    const a2Trak = hasDual ? buildTrak(3, true, secondaryAudioSamples, a2Chunks, a2Stsd, MOVIE_TIMESCALE, a2Timescale, 0, 0, false, 1, langCode2) : null;

    let vTotalDur = 0;
    for (let i = 0; i < videoSamples.length; i++) vTotalDur += videoSamples[i].dur;
    let aTotalDur = 0;
    for (let i = 0; i < audioSamples.length; i++) aTotalDur += audioSamples[i].dur;
    let a2TotalDur = 0;
    for (let i = 0; i < secondaryAudioSamples.length; i++) a2TotalDur += secondaryAudioSamples[i].dur;

    const totalMovieDur = Math.max(
      Math.round((vTotalDur / vTimescale) * MOVIE_TIMESCALE),
      Math.round((aTotalDur / aTimescale) * MOVIE_TIMESCALE),
      hasDual ? Math.round((a2TotalDur / a2Timescale) * MOVIE_TIMESCALE) : 0
    );

    const mvhdBuf = new Uint8Array(100);
    setU32(mvhdBuf, 0, 0);
    setU32(mvhdBuf, 12, MOVIE_TIMESCALE);
    setU32(mvhdBuf, 16, totalMovieDur);
    setU32(mvhdBuf, 20, 0x00010000);
    setU16(mvhdBuf, 24, 0x0100);
    setU32(mvhdBuf, 36, 0x00010000);
    setU32(mvhdBuf, 52, 0x00010000);
    setU32(mvhdBuf, 72, 0x40000000);
    setU32(mvhdBuf, 96, hasDual ? 4 : 3);
    const mvhd = makeBox('mvhd', mvhdBuf);

    const traks = [vTrak, aTrak];
    if (a2Trak) traks.push(a2Trak);

    const moov = makeBox('moov', concatU8([mvhd, ...traks]));

    const finalParts = [ftypHead, mdatHead];
    for (let i = 0; i < mdatParts.length; i++) {
      finalParts.push(mdatParts[i]);
    }
    finalParts.push(moov);

    return new Blob(finalParts, { type: 'video/mp4' });
  }

  // Stream Downloader (Handles progressive streams and adaptive dual-stream chunking with live fMP4 muxing)
  async function downloadYouTubeStream(format, filename, modal, allFormats = []) {
    const abortCtrl = new AbortController();
    let isAborted = false;

    modal.onCancel(() => {
      isAborted = true;
      abortCtrl.abort();
    });

    const isMuxed = format.type === 'muxed' || format.itag === 18 || format.itag === 22;
    const hasAudioTrack = Boolean(format.audioUrl);

    // Build URL with safe range query (cleanly sets range parameter without injecting ratebypass)
    function buildRangeUrl(url, start, end) {
      try {
        const u = new URL(url);
        u.searchParams.set('range', start + '-' + end);
        return u.toString();
      } catch {
        let u = url;
        if (/[?&]range=/i.test(u)) {
          u = u.replace(/([?&]range=)[^&]*/i, function (m, p1) { return p1 + start + '-' + end; });
        } else {
          u += (u.indexOf('?') >= 0 ? '&' : '?') + 'range=' + start + '-' + end;
        }
        return u;
      }
    }

    // High-resilience chunk fetcher: tries in-page fetch, falls back to background proxy
    async function fetchChunkWithFallback(chunkUrl, signal) {
      try {
        const res = await fetch(chunkUrl, {
          signal,
          cache: 'no-store',
          credentials: 'omit',
          mode: 'cors'
        });
        if (res.ok) {
          const ab = await res.arrayBuffer();
          return new Uint8Array(ab);
        }
      } catch (e) {
        if (signal && signal.aborted) throw e;
      }

      // Background proxy fallback: completely bypasses page-level CORS and CSP
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'fetch-stream-chunk', url: chunkUrl }, (resp) => {
          if (signal && signal.aborted) return reject(new Error('Aborted'));
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (resp && resp.success && resp.b64) {
            try {
              const bin = atob(resp.b64);
              const u8 = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
              resolve(u8);
            } catch (convErr) {
              reject(convErr);
            }
          } else {
            reject(new Error(resp?.error || `Falha HTTP ${resp?.status || 'rede'}`));
          }
        });
      });
    }

    // Stream download helper for progressive/muxed URLs (direct single stream)
    async function streamFetchDirect(targetUrl, targetName, targetBadge) {
      modal.setBadge(targetBadge, 'rec');
      modal.setStatus('Conectando ao stream e baixando vídeo...');
      modal.setProgress(0, 0, 0);

      let resp;
      try {
        resp = await fetch(targetUrl, { signal: abortCtrl.signal, cache: 'no-store' });
      } catch (fErr) {
        // Direct page fetch failed (e.g. CSP), hand off to browser download
        modal.setStatus('Iniciando download pelo navegador...');
        saveUrlAsFile(targetUrl, targetName);
        modal.finishSuccess('✅ Download iniciado no navegador!');
        return true;
      }

      if (!resp || !resp.ok) {
        saveUrlAsFile(targetUrl, targetName);
        modal.finishSuccess('✅ Download iniciado no navegador!');
        return true;
      }

      const totalBytes = parseInt(resp.headers.get('content-length') || '0', 10);
      const reader = resp.body.getReader();
      const chunks = [];
      let receivedBytes = 0;
      let lastUpdate = 0;

      while (true) {
        if (isAborted) return false;
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.byteLength;

        const now = Date.now();
        if (now - lastUpdate > 120 || receivedBytes >= totalBytes) {
          lastUpdate = now;
          const pct = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 50;
          modal.setProgress(pct, receivedBytes, totalBytes);
        }
      }

      if (isAborted) return false;

      modal.setProgress(100, receivedBytes, receivedBytes);
      modal.setStatus('Finalizando e salvando arquivo MP4...');

      const blob = new Blob(chunks, { type: 'video/mp4' });
      saveBlobAsFile(blob, targetName);

      modal.finishSuccess('✅ Download concluído com sucesso! Vídeo salvo em Downloads.');
      return true;
    }

    // Path 1: Format is progressive muxed (video + audio already merged)
    if (isMuxed && format.url && !hasAudioTrack) {
      try {
        await streamFetchDirect(format.url, filename, format.badge || 'Vídeo');
        return;
      } catch (err) {
        if (isAborted) return;
        console.warn('Direct stream fetch failed, falling back to browser download:', err);
        modal.setStatus('Finalizando download pelo navegador...');
        saveUrlAsFile(format.url, filename);
        modal.finishSuccess('✅ Download iniciado no navegador!');
        return;
      }
    }

    // Path 2: Adaptive Video (4K, 2K, 1080p, 720p, etc.) + Audio Muxing
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB high-speed chunks
    const totalVideoBytes = format.videoSize || format.size || 0;
    const totalAudioBytes = hasAudioTrack ? (format.audioSize || 0) : 0;
    const hasSecondaryAudio = Boolean(format.isDualAudio && format.secondaryAudioUrl);
    const totalSecondaryAudioBytes = hasSecondaryAudio ? (format.secondaryAudioSize || 0) : 0;
    const combinedTotal = totalVideoBytes + totalAudioBytes + totalSecondaryAudioBytes;

    // Helper to fetch a stream in chunks
    async function fetchStreamBytes(streamUrl, streamSize, streamName, progressOffset, progressScale) {
      // 1. Sempre descobre o tamanho exato real do arquivo no servidor para nunca pedir bytes além do fim (previne erro 416)
      try {
        const testRes = await fetch(buildRangeUrl(streamUrl, 0, 0), { signal: abortCtrl.signal, cache: 'no-store' });
        const cr = testRes.headers.get('content-range');
        if (cr && cr.includes('/')) {
          const parsedTotal = parseInt(cr.split('/')[1], 10);
          if (!isNaN(parsedTotal) && parsedTotal > 0) {
            streamSize = parsedTotal;
          }
        }
      } catch {}

      if (!streamSize || streamSize <= 0) {
        const fullBytes = await fetchChunkWithFallback(streamUrl, abortCtrl.signal);
        return fullBytes;
      }

      const totalChunks = Math.max(1, Math.ceil(streamSize / CHUNK_SIZE));
      const chunks = new Array(totalChunks);
      let downloadedBytes = 0;
      let nextChunkIndex = 0;
      const CONCURRENCY = Math.min(6, totalChunks); // 6 parallel workers for ~20-30 MB/s speed

      let lastBytes = 0;
      let lastTime = Date.now();
      let smoothedSpeed = 0;

      async function worker() {
        while (true) {
          if (isAborted) break;
          const idx = nextChunkIndex++;
          if (idx >= totalChunks) break;

          const start = idx * CHUNK_SIZE;
          if (start >= streamSize) break;
          const end = Math.min(start + CHUNK_SIZE - 1, streamSize - 1);
          const expectedBytes = (end - start + 1);
          let receivedForThisChunk = 0;
          const chunkParts = [];

          // Loop de sub-blocos: garante que se o servidor retornar um pedaço menor, todos os bytes restantes do intervalo sejam baixados
          while (receivedForThisChunk < expectedBytes && !isAborted) {
            const subStart = start + receivedForThisChunk;
            const subEnd = end;
            const subUrl = buildRangeUrl(streamUrl, subStart, subEnd);

            let subPart = null;
            let retries = 0;
            let lastErr = null;
            while (retries < 4 && !isAborted) {
              try {
                subPart = await fetchChunkWithFallback(subUrl, abortCtrl.signal);
                if (subPart && subPart.byteLength > 0) break;
              } catch (e) {
                lastErr = e;
              }
              retries++;
              await new Promise((r) => setTimeout(r, 350 * retries));
            }

            if (isAborted) break;

            if (!subPart || subPart.byteLength === 0) {
              throw new Error(`Erro ao baixar bloco ${idx + 1}/${totalChunks} de ${streamName} (${lastErr ? lastErr.message : 'falha de rede'})`);
            }

            chunkParts.push(subPart);
            receivedForThisChunk += subPart.byteLength;
          }

          if (isAborted) break;

          let chunkU8;
          if (chunkParts.length === 1) {
            chunkU8 = chunkParts[0];
          } else {
            chunkU8 = new Uint8Array(receivedForThisChunk);
            let off = 0;
            for (const p of chunkParts) {
              chunkU8.set(p, off);
              off += p.byteLength;
            }
          }

          chunks[idx] = chunkU8;
          downloadedBytes += chunkU8.byteLength;

          const now = Date.now();
          const dt = (now - lastTime) / 1000;
          if (dt >= 0.4) {
            const currentSpeed = (downloadedBytes - lastBytes) / dt / (1024 * 1024);
            smoothedSpeed = smoothedSpeed === 0 ? currentSpeed : (smoothedSpeed * 0.7 + currentSpeed * 0.3);
            lastBytes = downloadedBytes;
            lastTime = now;
          }

          const streamPct = downloadedBytes / streamSize;
          const overallPct = Math.min(95, Math.round(progressOffset + (streamPct * progressScale)));
          const currentTotalDownloaded = (progressOffset === 0 ? downloadedBytes : totalVideoBytes + downloadedBytes);
          modal.setProgress(overallPct, currentTotalDownloaded, combinedTotal);
          const speedStr = smoothedSpeed > 0 ? ` • ${smoothedSpeed.toFixed(1)} MB/s` : '';
          modal.setStatus(`⚡ Baixando ${streamName}${speedStr} (${(downloadedBytes / (1024 * 1024)).toFixed(1)} MB / ${(streamSize / (1024 * 1024)).toFixed(1)} MB)...`);
        }
      }

      const workers = [];
      for (let w = 0; w < CONCURRENCY; w++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      if (isAborted) return null;

      let totalLen = 0;
      for (const c of chunks) {
        if (!c) throw new Error(`Bloco incompleto durante o download de ${streamName}`);
        totalLen += c.byteLength;
      }
      const resultU8 = new Uint8Array(totalLen);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        resultU8.set(chunks[i], offset);
        offset += chunks[i].byteLength;
        chunks[i] = null; // Libera imediatamente o bloco de 5MB da memória RAM
      }
      chunks.length = 0;
      return resultU8;
    }

    try {
      modal.setStatus(`Baixando vídeo ${format.badge}...`);
      // Phase 1: Video stream
      const videoScale = hasSecondaryAudio ? 75 : 85;
      let videoU8 = await fetchStreamBytes(format.url, totalVideoBytes, format.badge || 'Vídeo em Alta Definição', 0, videoScale);
      if (isAborted || !videoU8) return;

      let finalBlob = null;

      if (hasAudioTrack && format.audioUrl) {
        // Phase 2a: Primary Audio stream (Original - Português)
        const audio1Name = format.audioTrackName ? `Áudio (${format.audioTrackName})` : 'Áudio Original M4A';
        const audio1Scale = hasSecondaryAudio ? 12 : 10;
        modal.setStatus(`Baixando ${audio1Name}...`);
        let audioU8 = await fetchStreamBytes(format.audioUrl, totalAudioBytes, audio1Name, videoScale, audio1Scale);
        if (isAborted || !audioU8) return;

        // Phase 2b: Secondary Audio stream (Dual Áudio / Dublagem)
        let secondaryAudioU8 = null;
        if (hasSecondaryAudio && format.secondaryAudioUrl) {
          try {
            const audio2Name = format.secondaryAudioTrackName ? `Áudio Secundário (${format.secondaryAudioTrackName})` : 'Áudio Secundário M4A';
            modal.setStatus(`Baixando faixa secundária: ${audio2Name}...`);
            secondaryAudioU8 = await fetchStreamBytes(format.secondaryAudioUrl, totalSecondaryAudioBytes, audio2Name, videoScale + audio1Scale, 8);
          } catch (secErr) {
            console.warn('Erro ao transferir faixa secundária de áudio, prosseguindo com áudio primário:', secErr);
            secondaryAudioU8 = null;
          }
        }

        // Phase 3: Muxing (95% -> 99%)
        modal.setProgress(98, combinedTotal, combinedTotal);
        const muxStatus = secondaryAudioU8 ?
          `⚡ Fundindo vídeo e Dual Áudio (Original + Dublagem) em arquivo MP4 único...` :
          `⚡ Fundindo vídeo ${format.badge} e áudio original em arquivo MP4 único...`;
        modal.setStatus(muxStatus);
        await new Promise((r) => setTimeout(r, 80));

        try {
          finalBlob = muxToStandardMp4(videoU8, audioU8, format, secondaryAudioU8);
        } catch (muxErr) {
          console.warn('In-browser MP4 multiplexing exception, falling back to video-only blob:', muxErr);
          finalBlob = new Blob([videoU8], { type: 'video/mp4' });
        }
        // Desaloca imediatamente os buffers grandes de vídeo e áudio da memória heap
        videoU8 = null;
        audioU8 = null;
        secondaryAudioU8 = null;
      } else {
        const mime = format.type === 'audio' ? 'audio/mp4' : 'video/mp4';
        finalBlob = new Blob([videoU8], { type: mime });
        videoU8 = null;
      }

      modal.setProgress(100, combinedTotal, combinedTotal);
      modal.setStatus('Salvando arquivo final em Downloads...');
      saveBlobAsFile(finalBlob, filename);
      const successMsg = format.isDualAudio ?
        `✅ Download de ${format.badge} concluído com sucesso em Dual Áudio (Original Padrão)!` :
        `✅ Download de ${format.badge} com áudio original concluído! Salvo em Downloads.`;
      modal.finishSuccess(successMsg);
    } catch (err) {
      if (isAborted) return;
      console.error('Download error:', err);
      modal.finishError(err.message || 'Falha ao transferir vídeo na resolução selecionada.');
    }
  }

  // Direct In-Page YouTube Formats Extractor (Pure browser native, same-origin fetch)
  async function fetchYouTubeFormatsInContent(videoId, initialTitle = 'YouTube Video') {
    let title = initialTitle;
    const allFormats = [];

    async function queryInnertube(clientConfig, withCredentials = false) {
      try {
        const body = { context: { client: clientConfig }, videoId };
        const resp = await fetch('https://www.youtube.com/youtubei/v1/player', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: withCredentials ? 'include' : 'omit',
          body: JSON.stringify(body)
        });
        if (!resp.ok) return null;
        return await resp.json();
      } catch {
        return null;
      }
    }

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
        if (!f.url) return;
        const isAudio = (f.mimeType || '').startsWith('audio/');
        const fTrackKey = f.audioTrack ? `${f.audioTrack.id || ''}:${f.audioTrack.displayName || ''}` : '';
        const isDuplicate = allFormats.some((x) => {
          if (x.url === f.url) return true;
          const xIsAudio = (x.mimeType || '').startsWith('audio/');
          if (isAudio && xIsAudio) {
            const xTrackKey = x.audioTrack ? `${x.audioTrack.id || ''}:${x.audioTrack.displayName || ''}` : '';
            return x.itag === f.itag && xTrackKey === fTrackKey;
          }
          return !isAudio && !xIsAudio && x.itag === f.itag;
        });
        if (!isDuplicate) {
          allFormats.push({ ...f, isMuxed: false, client: clientName });
          count++;
        }
      });
      return count > 0;
    }

    // 1. Fetch guest visitorData from official visitor_id endpoint
    let visitorData = null;
    try {
      const vResp = await fetch('https://www.youtube.com/youtubei/v1/visitor_id', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      if (vResp.ok) {
        const vd = await vResp.json();
        visitorData = vd?.responseContext?.visitorData;
      }
    } catch {}

    // 2. Query VISIONOS with unthrottled direct streams (guest first)
    let visionResp = await queryInnertube({
      clientName: 'VISIONOS',
      clientVersion: '1.02',
      deviceMake: 'Apple',
      deviceModel: 'RealityDevice17,1',
      osName: 'visionOS',
      hl: 'pt',
      gl: 'BR',
      visitorData: visitorData || undefined
    }, false);

    // If VISIONOS returned LOGIN_REQUIRED or empty, retry with active browser session cookies
    if (!visionResp || visionResp?.playabilityStatus?.status !== 'OK' || !visionResp?.streamingData) {
      visionResp = await queryInnertube({
        clientName: 'VISIONOS',
        clientVersion: '1.02',
        deviceMake: 'Apple',
        deviceModel: 'RealityDevice17,1',
        osName: 'visionOS',
        hl: 'pt',
        gl: 'BR',
        visitorData: visitorData || undefined
      }, true);
    }
    ingestResponse(visionResp, 'VISIONOS');

    // 3. Query ANDROID client for progressive and adaptive streams (1080p, 720p, etc.)
    let androidResp = await queryInnertube({
      clientName: 'ANDROID',
      clientVersion: '20.10.34',
      hl: 'pt',
      gl: 'BR',
      visitorData: visitorData || undefined
    }, false);

    if (!androidResp || androidResp?.playabilityStatus?.status !== 'OK' || !androidResp?.streamingData) {
      androidResp = await queryInnertube({
        clientName: 'ANDROID',
        clientVersion: '20.10.34',
        hl: 'pt',
        gl: 'BR',
        visitorData: visitorData || undefined
      }, true);
    }
    ingestResponse(androidResp, 'ANDROID');

    // 4. Query IOS client as additional high-resolution fallback
    const iosResp = await queryInnertube({
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
    }, false);
    ingestResponse(iosResp, 'IOS');

    if (allFormats.length === 0) return null;

    const streamingData = {
      formats: allFormats.filter((f) => f.isMuxed),
      adaptiveFormats: allFormats.filter((f) => !f.isMuxed)
    };
    return parseYouTubeFormats(streamingData, { title });
  }

  function scoreAudioUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      const xtags = decodeURIComponent(u.searchParams.get('xtags') || '');
      const btrack = decodeURIComponent(u.searchParams.get('btrack') || '');
      const all = `${xtags} ${btrack} ${urlStr}`.toLowerCase();
      let score = 0;
      const itag = parseInt(u.searchParams.get('itag'), 10);
      if (itag === 140) score += 30;
      if (all.includes('main') || all.includes('original')) score += 200;
      if (all.includes('por') || all.includes('pt') || all.includes('bra')) score += 300;
      if (all.includes('dub') || all.includes('auto-dub') || all.includes('dublado')) score -= 250;
      return score;
    } catch {
      return 0;
    }
  }

  // Sniffed media fallback for YouTube (Full aitags expansion & live playback stream extractor)
  function getSniffedYouTubeFormats(title) {
    const ytItems = sniffedMedia.filter((m) => m.platform === 'youtube' && m.url && m.url.includes('googlevideo.com/videoplayback'));
    if (ytItems.length === 0) return null;

    let aitagsVideoUrl = null;
    let sniffedAudioUrl = null;
    let sniffedAudioItag = 140;
    let sniffedSecondaryAudioUrl = null;
    let sniffedSecondaryAudioItag = 140;
    let videoDuration = 0;

    // Direct streams by itag that were explicitly sniffed
    const directStreamsByItag = new Map();
    const audioCandidates = [];

    ytItems.forEach((item) => {
      try {
        const u = new URL(item.url);
        const itag = parseInt(u.searchParams.get('itag'), 10);
        const mime = (u.searchParams.get('mime') || '').toLowerCase();
        const dur = parseFloat(u.searchParams.get('dur') || '0');
        if (dur > videoDuration) videoDuration = dur;

        const isAudio = mime.startsWith('audio/') || itag === 140 || itag === 251 || itag === 249 || itag === 250;
        if (isAudio) {
          const score = scoreAudioUrl(item.url);
          audioCandidates.push({
            url: item.url,
            itag: itag,
            score: score,
            xtags: item.xtags || u.searchParams.get('xtags') || ''
          });
        } else {
          if (itag) {
            directStreamsByItag.set(itag, item.url);
          }
          if (u.searchParams.has('aitags') && !aitagsVideoUrl) {
            aitagsVideoUrl = item.url;
          }
        }
      } catch {}
    });

    if (audioCandidates.length > 0) {
      audioCandidates.sort((a, b) => b.score - a.score);
      sniffedAudioUrl = audioCandidates[0].url;
      sniffedAudioItag = audioCandidates[0].itag;

      const secAudio = audioCandidates.find((c) => c.url !== sniffedAudioUrl && (c.score < audioCandidates[0].score || c.itag !== sniffedAudioItag));
      if (secAudio) {
        sniffedSecondaryAudioUrl = secAudio.url;
        sniffedSecondaryAudioItag = secAudio.itag;
      }
    }

    const itagMeta = {
      // 4K Ultra HD
      313: { badge: '2160p 4K', quality: '2160p 4K Ultra HD', height: 2160, mime: 'video/webm', bps: 15000000 },
      401: { badge: '2160p 4K', quality: '2160p 4K Ultra HD', height: 2160, mime: 'video/mp4', bps: 15000000 },
      // 2K Quad HD
      271: { badge: '1440p 2K', quality: '1440p 2K Quad HD', height: 1440, mime: 'video/webm', bps: 8000000 },
      400: { badge: '1440p 2K', quality: '1440p 2K Quad HD', height: 1440, mime: 'video/mp4', bps: 8000000 },
      // 1080p Full HD
      299: { badge: '1080p60', quality: '1080p60 Full HD', height: 1080, fps: 60, mime: 'video/mp4', bps: 4500000 },
      303: { badge: '1080p60', quality: '1080p60 Full HD', height: 1080, fps: 60, mime: 'video/webm', bps: 4500000 },
      137: { badge: '1080p Full HD', quality: '1080p Full HD', height: 1080, mime: 'video/mp4', bps: 3000000 },
      248: { badge: '1080p', quality: '1080p Full HD', height: 1080, mime: 'video/webm', bps: 3000000 },
      399: { badge: '1080p', quality: '1080p Full HD', height: 1080, mime: 'video/mp4', bps: 3000000 },
      // 720p HD
      298: { badge: '720p60', quality: '720p60 HD', height: 720, fps: 60, mime: 'video/mp4', bps: 2500000 },
      302: { badge: '720p60', quality: '720p60 HD', height: 720, fps: 60, mime: 'video/webm', bps: 2500000 },
      136: { badge: '720p HD', quality: '720p HD', height: 720, mime: 'video/mp4', bps: 1500000 },
      247: { badge: '720p', quality: '720p HD', height: 720, mime: 'video/webm', bps: 1500000 },
      398: { badge: '720p', quality: '720p HD', height: 720, mime: 'video/mp4', bps: 1500000 },
      22: { badge: '720p HD', quality: '720p HD', height: 720, mime: 'video/mp4', isMuxed: true, bps: 1800000 },
      // 480p SD
      135: { badge: '480p', quality: '480p SD', height: 480, mime: 'video/mp4', bps: 800000 },
      244: { badge: '480p', quality: '480p SD', height: 480, mime: 'video/webm', bps: 800000 },
      // 360p SD
      134: { badge: '360p', quality: '360p SD', height: 360, mime: 'video/mp4', bps: 500000 },
      18: { badge: '360p SD', quality: '360p SD', height: 360, mime: 'video/mp4', isMuxed: true, bps: 600000 },
      // 240p SD
      133: { badge: '240p', quality: '240p SD', height: 240, mime: 'video/mp4', bps: 300000 },
      242: { badge: '240p', quality: '240p SD', height: 240, mime: 'video/webm', bps: 300000 },
      // 144p SD
      160: { badge: '144p', quality: '144p SD', height: 144, mime: 'video/mp4', bps: 150000 },
      278: { badge: '144p', quality: '144p SD', height: 144, mime: 'video/webm', bps: 150000 }
    };

    const audioSize = (videoDuration > 0) ? Math.round((videoDuration * 128000) / 8) : 0;
    const results = [];
    const heightsSeen = new Set();
    const itagsAdded = new Set();

    // 1. Expand aitags from authorized playback URL
    if (aitagsVideoUrl) {
      try {
        const u = new URL(aitagsVideoUrl);
        u.searchParams.delete('range');
        u.searchParams.delete('clen');
        u.searchParams.delete('rn');
        u.searchParams.delete('rbuf');

        const aitagsStr = u.searchParams.get('aitags') || '';
        const aitags = aitagsStr.split(',').map((t) => t.trim()).filter(Boolean);

        // Sort descending by height
        const sortedTags = [...aitags].sort((a, b) => (itagMeta[b]?.height || 0) - (itagMeta[a]?.height || 0));

        let hasRec = false;
        for (const tag of sortedTags) {
          const meta = itagMeta[tag];
          if (!meta) continue;

          // Deduplicate by height (e.g. only one 1080p, one 720p, etc.)
          if (heightsSeen.has(meta.height)) continue;
          heightsSeen.add(meta.height);
          itagsAdded.add(parseInt(tag, 10));

          const streamUrl = new URL(u.toString());
          streamUrl.searchParams.set('itag', tag);

          let isRec = false;
          if (meta.height >= 1000 && !hasRec) {
            isRec = true;
            hasRec = true;
          }

          const vSize = (videoDuration > 0 && meta.bps) ? Math.round((videoDuration * meta.bps) / 8) : 0;
          const isDual = Boolean(!meta.isMuxed && sniffedSecondaryAudioUrl);
          const totalEstSize = vSize + (meta.isMuxed ? 0 : audioSize) + (isDual ? audioSize : 0);
          const dualLabel = isDual ? ' • Dual Áudio' : '';

          results.push({
            quality: `${meta.quality}${dualLabel}`,
            badge: meta.badge,
            recommended: isRec,
            type: meta.isMuxed ? 'muxed' : 'adaptive_video',
            height: meta.height,
            fps: meta.fps || 30,
            url: streamUrl.toString(),
            itag: parseInt(tag, 10),
            size: totalEstSize || null,
            videoSize: vSize || null,
            audioSize: audioSize || null,
            audioUrl: meta.isMuxed ? null : sniffedAudioUrl,
            audioItag: meta.isMuxed ? null : sniffedAudioItag,
            audioTrackName: 'Original (Português)',
            secondaryAudioUrl: isDual ? sniffedSecondaryAudioUrl : null,
            secondaryAudioItag: isDual ? sniffedSecondaryAudioItag : null,
            secondaryAudioSize: isDual ? audioSize : 0,
            secondaryAudioTrackName: isDual ? 'Dublagem Secundária' : null,
            isDualAudio: isDual
          });
        }
      } catch (e) {
        console.warn('Error expanding aitags:', e);
      }
    }

    // 2. Also incorporate any directly sniffed itags not yet added (e.g. 4K 313, 1440p 271, 1080p60 299)
    directStreamsByItag.forEach((streamUrl, itag) => {
      if (itagsAdded.has(itag)) return;
      const meta = itagMeta[itag];
      if (!meta || heightsSeen.has(meta.height)) return;
      heightsSeen.add(meta.height);
      itagsAdded.add(itag);

      const vSize = (videoDuration > 0 && meta.bps) ? Math.round((videoDuration * meta.bps) / 8) : 0;
      const isDual = Boolean(!meta.isMuxed && sniffedSecondaryAudioUrl);
      const totalEstSize = vSize + (meta.isMuxed ? 0 : audioSize) + (isDual ? audioSize : 0);
      const dualLabel = isDual ? ' • Dual Áudio' : '';

      results.push({
        quality: `${meta.quality}${dualLabel}`,
        badge: meta.badge,
        recommended: false,
        type: meta.isMuxed ? 'muxed' : 'adaptive_video',
        height: meta.height,
        fps: meta.fps || 30,
        url: streamUrl,
        itag: itag,
        size: totalEstSize || null,
        videoSize: vSize || null,
        audioSize: audioSize || null,
        audioUrl: meta.isMuxed ? null : sniffedAudioUrl,
        audioItag: meta.isMuxed ? null : sniffedAudioItag,
        audioTrackName: 'Original (Português)',
        secondaryAudioUrl: isDual ? sniffedSecondaryAudioUrl : null,
        secondaryAudioItag: isDual ? sniffedSecondaryAudioItag : null,
        secondaryAudioSize: isDual ? audioSize : 0,
        secondaryAudioTrackName: isDual ? 'Dublagem Secundária' : null,
        isDualAudio: isDual
      });
    });

    // 3. Mark the highest resolution as Recommended if none marked yet
    if (results.length > 0 && !results.some((r) => r.recommended)) {
      results[0].recommended = true;
    }

    // 4. Add standalone Audio M4A options
    if (sniffedAudioUrl) {
      results.push({
        quality: 'Áudio M4A (Original - Alta Fidelidade)',
        badge: 'Áudio M4A',
        recommended: false,
        type: 'audio',
        height: 0,
        fps: 0,
        url: sniffedAudioUrl,
        itag: sniffedAudioItag,
        size: audioSize || null
      });

      if (sniffedSecondaryAudioUrl) {
        results.push({
          quality: 'Áudio M4A (Dublagem Secundária - Alta Fidelidade)',
          badge: 'Áudio M4A',
          recommended: false,
          type: 'audio',
          height: 0,
          fps: 0,
          url: sniffedSecondaryAudioUrl,
          itag: sniffedSecondaryAudioItag,
          size: audioSize || null
        });
      }
    }

    if (results.length === 0) return null;
    return {
      success: true,
      title: title || 'YouTube Video',
      formats: results
    };
  }

  // 1. YouTube Extractor & Modal Helper (100% In-Browser Native - No External Sites)
  function showYouTubeDownloadModal(videoId, title) {
    const modalObj = createDownloadModal({ title, platform: 'YouTube' });
    const modal = modalObj.controls;

    let hasRendered = false;
    let currentMaxHeight = 0;
    let renderedFormatCount = 0;
    let inPageFallbackFormats = null;
    let fallbackTimeout = null;

    function renderFormats(resp) {
      if (!resp || !resp.success || !resp.formats || resp.formats.length === 0) return false;

      const newMaxHeight = Math.max(...resp.formats.map((f) => f.height || 0));

      // If we already rendered formats with higher or equal max resolution and more/equal formats, skip
      if (hasRendered && newMaxHeight <= currentMaxHeight && resp.formats.length <= renderedFormatCount) {
        return true;
      }

      hasRendered = true;
      currentMaxHeight = Math.max(currentMaxHeight, newMaxHeight);
      renderedFormatCount = resp.formats.length;
      if (fallbackTimeout) clearTimeout(fallbackTimeout);

      if (resp.title) modal.setTitle(resp.title);

      modal.showFormats(resp.formats, (chosen) => {
        const ext = chosen.type === 'audio' ? 'm4a' : 'mp4';
        const rawTitle = resp.title || title || 'youtube_video';
        // Clean Windows NTFS filename of forbidden characters: \ / : * ? " < > |
        const cleanName = rawTitle.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);
        const cleanBadge = (chosen.badge || 'video').replace(/[^\w-]/g, '');
        const filename = `${cleanName}_${cleanBadge}.${ext}`;

        modal.switchToProgress({
          badge: chosen.badge,
          badgeClass: chosen.recommended ? 'rec' : (chosen.badge.includes('Áudio') ? 'audio' : 'fhd'),
          totalBytes: chosen.size || 0
        });

        downloadYouTubeStream(chosen, filename, modal, resp.formats);
      });

      return true;
    }

    function showExtractionError(customMsg) {
      if (hasRendered) return;
      if (fallbackTimeout) clearTimeout(fallbackTimeout);

      // Check if sniffedMedia captured any playback streams
      const sniffed = getSniffedYouTubeFormats(title);
      if (sniffed && sniffed.formats && sniffed.formats.length > 0) {
        renderFormats(sniffed);
        return;
      }

      // If in-page fallback exists, render it
      if (inPageFallbackFormats && inPageFallbackFormats.formats && inPageFallbackFormats.formats.length > 0) {
        renderFormats(inPageFallbackFormats);
        return;
      }

      modal.showError(customMsg || 'Não foi possível extrair os formatos deste vídeo. Dê play por alguns segundos e clique novamente.');
    }

    // Dynamic sniffer listener: if higher-resolution streams are intercepted while modal is open, upgrade automatically
    const onLiveSniff = (e) => {
      if (e?.detail?.url && e.detail.platform === 'youtube') {
        const latestSniffed = getSniffedYouTubeFormats(title);
        if (latestSniffed && latestSniffed.formats && latestSniffed.formats.length > 0) {
          const hasHD = latestSniffed.formats.some((f) => (f.height || 0) >= 700);
          if (hasHD || !hasRendered) {
            renderFormats(latestSniffed);
          }
        }
      }
    };
    window.addEventListener('MAXVIDEO_SNIFFED_MEDIA', onLiveSniff);
    modal.onClose(() => {
      window.removeEventListener('MAXVIDEO_SNIFFED_MEDIA', onLiveSniff);
    });
    modal.onCancel(() => {
      window.removeEventListener('MAXVIDEO_SNIFFED_MEDIA', onLiveSniff);
    });

    // Channel 1: In-page playerResponse & sniffed media listener from page-hook.js
    const onInPageResponse = (e) => {
      window.removeEventListener('MAXVIDEO_RESPONSE_YT_INPAGE', onInPageResponse);
      const pr = e?.detail?.playerResponse || e?.detail;
      const incomingSniffed = e?.detail?.sniffedMedia || [];

      // Ingest sniffed media from page-hook.js into content.js store
      if (Array.isArray(incomingSniffed)) {
        incomingSniffed.forEach((item) => {
          if (item && item.url && !sniffedMedia.some((m) => m.url === item.url)) {
            sniffedMedia.push(item);
          }
        });
      }

      // Check if sniffed media has formats (including expanded aitags 1080p/720p/etc.)
      const sniffedResult = getSniffedYouTubeFormats(title);
      if (sniffedResult && sniffedResult.formats && sniffedResult.formats.length > 0) {
        const hasHD = sniffedResult.formats.some((f) => (f.height || 0) >= 700);
        if (hasHD) {
          renderFormats(sniffedResult);
          return;
        }
      }

      // If in-page playerResponse has streamingData, parse it
      if (pr && pr.streamingData) {
        const parsed = parseYouTubeFormats(pr.streamingData, pr.videoDetails || { title });
        if (parsed && parsed.formats && parsed.formats.length > 0) {
          const hasHD = parsed.formats.some((f) => (f.height || 0) >= 700);
          if (hasHD) {
            renderFormats({ success: true, title: parsed.title || title, formats: parsed.formats });
            return;
          } else {
            inPageFallbackFormats = { success: true, title: parsed.title || title, formats: parsed.formats };
          }
        }
      }
    };
    window.addEventListener('MAXVIDEO_RESPONSE_YT_INPAGE', onInPageResponse);
    window.dispatchEvent(new CustomEvent('MAXVIDEO_REQUEST_YT_INPAGE'));

    // Channel 2: Direct In-Page Innertube Fetch (same origin, unthrottled VisionOS streams)
    fetchYouTubeFormatsInContent(videoId, title)
      .then((res) => {
        if (res && res.formats && res.formats.length > 0) {
          renderFormats({ success: true, title: res.title, formats: res.formats });
        }
      })
      .catch((err) => {
        console.warn('In-page YouTube fetch error:', err);
      });

    // Channel 3: Extension Service Worker Query (with declarativeNetRequest Origin spoofing)
    try {
      chrome.runtime.sendMessage({
        action: 'get-youtube-formats',
        videoId
      }, (resp) => {
        if (resp && resp.success && resp.formats && resp.formats.length > 0) {
          renderFormats(resp);
        }
      });
    } catch {}

    // Channel 4: Sniffed media immediate check
    const immediateSniffed = getSniffedYouTubeFormats(title);
    if (immediateSniffed && immediateSniffed.formats && immediateSniffed.formats.length > 0) {
      const hasHD = immediateSniffed.formats.some((f) => (f.height || 0) >= 700);
      if (hasHD) {
        renderFormats(immediateSniffed);
      }
    }

    // Channel 5: Fast polling retries for buffering playback streams
    setTimeout(() => {
      if (!hasRendered) {
        const retry1 = getSniffedYouTubeFormats(title);
        if (retry1 && retry1.formats && retry1.formats.some((f) => (f.height || 0) >= 700)) {
          renderFormats(retry1);
        }
      }
    }, 600);

    setTimeout(() => {
      if (!hasRendered) {
        const retry2 = getSniffedYouTubeFormats(title);
        if (retry2 && retry2.formats && retry2.formats.some((f) => (f.height || 0) >= 700)) {
          renderFormats(retry2);
        }
      }
    }, 1400);

    fallbackTimeout = setTimeout(() => {
      if (!hasRendered) {
        showExtractionError();
      }
    }, 9000);
  }

  // 2. Twitter / X Extractor (Strictly scoped to the target video/tweet)
  function extractTwitterVideoUrl(video) {
    if (!video) return null;

    // A. Direct src on video (if direct twimg.com MP4)
    if (video.currentSrc && video.currentSrc.includes('video.twimg.com') && video.currentSrc.includes('.mp4')) {
      return video.currentSrc;
    }
    if (video.src && video.src.includes('video.twimg.com') && video.src.includes('.mp4')) {
      return video.src;
    }

    // B. Find target media ID from poster or tweet container
    let targetMediaId = null;
    let targetTweetId = null;

    // Check video poster: e.g. /ext_tw_video_thumb/1803816664538743142/pu/img/...jpg
    const poster = video.poster || '';
    const posterMatch = poster.match(/\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//);
    if (posterMatch) {
      targetMediaId = posterMatch[1];
    }

    // Check parent tweet article
    const tweet = video.closest('article[data-testid="tweet"]') || video.closest('article');
    if (tweet) {
      // Find tweet status link: /username/status/1803816664538743142
      const statusLink = tweet.querySelector('a[href*="/status/"]');
      if (statusLink) {
        const sm = statusLink.href.match(/\/status\/(\d+)/);
        if (sm) targetTweetId = sm[1];
      }

      // Check any thumbnail images in this tweet for mediaId
      if (!targetMediaId) {
        const thumbImg = tweet.querySelector('img[src*="video_thumb"]');
        if (thumbImg) {
          const tm = thumbImg.src.match(/\/(?:ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//);
          if (tm) targetMediaId = tm[1];
        }
      }
    }

    if (!targetTweetId) {
      const pageMatch = window.location.pathname.match(/\/status\/(\d+)/);
      if (pageMatch) targetTweetId = pageMatch[1];
    }

    const targetIds = [targetMediaId, targetTweetId].filter(Boolean);

    // C. Search sniffedMedia matching targetIds
    if (targetIds.length > 0) {
      const matched = sniffedMedia.filter((m) => {
        if (m.platform !== 'twitter' && !m.url.includes('video.twimg.com')) return false;
        return targetIds.some((id) => (m.mediaId && m.mediaId === id) || (m.tweetId && m.tweetId === id) || m.url.includes(id));
      });

      if (matched.length > 0) {
        // Sort by highest bitrate or resolution
        matched.sort((a, b) => {
          const bitA = a.bitrate || 0;
          const bitB = b.bitrate || 0;
          if (bitA !== bitB) return bitB - bitA;
          const getRes = (u) => {
            const m = u.match(/\/(\d+)x(\d+)\//);
            return m ? parseInt(m[1], 10) * parseInt(m[2], 10) : 0;
          };
          return getRes(b.url) - getRes(a.url);
        });
        return matched[0].url;
      }
    }

    // D. Search HTML strictly inside THIS tweet (NOT document.documentElement!)
    if (tweet) {
      const tweetMatches = tweet.innerHTML.match(/https:\\?\/\\?\/video\.twimg\.com\\?\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
      if (tweetMatches && tweetMatches.length > 0) {
        const cleanUrls = tweetMatches.map((u) => u.replace(/\\\//g, '/').replace(/\\u0026/g, '&'));
        cleanUrls.sort((a, b) => {
          const getRes = (u) => {
            const m = u.match(/\/(\d+)x(\d+)\//);
            return m ? parseInt(m[1], 10) * parseInt(m[2], 10) : 0;
          };
          return getRes(b) - getRes(a);
        });
        return cleanUrls[0];
      }
    }

    // E. Fallback: If only 1 video exists on the entire page, use sniffedMedia
    const allVideos = findAllVideos();
    if (allVideos.length === 1) {
      const twSniffed = sniffedMedia.filter((m) => m.platform === 'twitter' || m.url.includes('video.twimg.com'));
      if (twSniffed.length > 0) {
        twSniffed.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return twSniffed[0].url;
      }
    }

    return null;
  }

  // 3. Instagram Extractor (Strictly scoped to the target video/post)
  function extractInstagramVideoUrl(video) {
    if (!video) return null;

    // A. Direct src on video (if direct scontent or fbcdn MP4)
    if (video.currentSrc && isValidMediaUrl(video.currentSrc)) {
      return stripByteRangeParams(cleanUrl(video.currentSrc));
    }
    if (video.src && isValidMediaUrl(video.src)) {
      return stripByteRangeParams(cleanUrl(video.src));
    }

    // Check <source> children
    const sources = video.querySelectorAll('source');
    for (const s of sources) {
      const srcVal = s.src || s.getAttribute('src');
      if (srcVal && isValidMediaUrl(srcVal)) {
        return stripByteRangeParams(cleanUrl(srcVal));
      }
    }

    // B. Identify post container and target shortcode
    const post = video.closest('article') || video.closest('[role="dialog"]') || video.closest('section') || video.parentElement;
    let shortcode = null;
    if (post) {
      const postLink = post.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
      if (postLink) {
        const m = postLink.href.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
        if (m) shortcode = m[1];
      }
    }
    if (!shortcode) {
      const urlMatch = window.location.pathname.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
      if (urlMatch) shortcode = urlMatch[1];
    }

    // C. Search HTML strictly inside THIS post
    if (post) {
      const matches = post.innerHTML.match(/https:\\?\/\\?\/[^\s"'<>]*(?:cdninstagram\.com|fbcdn\.net)\\?\/[^\s"'<>]*(?:\.mp4|\/v\/)[^\s"'<>]*/g);
      if (matches && matches.length > 0) {
        for (const raw of matches) {
          const clean = cleanUrl(raw);
          if (isValidMediaUrl(clean)) {
            return stripByteRangeParams(clean);
          }
        }
      }
    }

    // D. Search sniffedMedia matching shortcode
    const igSniffed = sniffedMedia.filter((m) => {
      if (m.platform === 'instagram') return true;
      const u = m.url || '';
      return (u.includes('cdninstagram.com') || u.includes('fbcdn.net')) && isValidMediaUrl(u);
    });

    if (shortcode && igSniffed.length > 0) {
      const match = igSniffed.find((x) => x.shortcode === shortcode || (x.url && x.url.includes(shortcode)));
      if (match) return stripByteRangeParams(cleanUrl(match.url));
    }

    // E. Search inline scripts on page if shortcode is known
    if (shortcode) {
      const scripts = document.querySelectorAll('script:not([src])');
      for (const s of scripts) {
        const txt = s.textContent || '';
        if (txt.includes(shortcode) && txt.includes('.mp4')) {
          const sMatches = txt.match(/https:\\?\/\\?\/[^\s"'<>]*(?:cdninstagram\.com|fbcdn\.net)\\?\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
          if (sMatches) {
            for (const sm of sMatches) {
              const clean = cleanUrl(sm);
              if (isValidMediaUrl(clean)) {
                return stripByteRangeParams(clean);
              }
            }
          }
        }
      }
    }

    // F. Fallback: Most recent sniffed Instagram media
    if (igSniffed.length > 0) {
      return stripByteRangeParams(cleanUrl(igSniffed[igSniffed.length - 1].url));
    }

    return null;
  }

  // 4. Facebook Extractor (Strictly scoped to the target video/post)
  function extractFacebookVideoUrl(video) {
    if (!video) return null;

    if (video.currentSrc && isValidMediaUrl(video.currentSrc)) {
      return stripByteRangeParams(cleanUrl(video.currentSrc));
    }
    if (video.src && isValidMediaUrl(video.src)) {
      return stripByteRangeParams(cleanUrl(video.src));
    }

    const fbPost = video.closest('[role="article"]') || video.closest('[data-pagelet*="FeedUnit"]') || video.parentElement;
    if (fbPost) {
      const hdMatch = fbPost.innerHTML.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/) ||
                      fbPost.innerHTML.match(/"playable_url(?:_quality_hd)?"\s*:\s*"([^"]+)"/) ||
                      fbPost.innerHTML.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/);
      if (hdMatch) {
        return stripByteRangeParams(cleanUrl(hdMatch[1]));
      }

      const matches = fbPost.innerHTML.match(/https:\\?\/\\?\/video[^\s"'<>]+\.fbcdn\.net\\?\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
      if (matches && matches.length > 0) {
        for (const m of matches) {
          const clean = cleanUrl(m);
          if (isValidMediaUrl(clean)) {
            return stripByteRangeParams(clean);
          }
        }
      }
    }

    const fbSniffed = sniffedMedia.filter((m) => (m.platform === 'facebook' || m.url.includes('fbcdn.net')) && isValidMediaUrl(m.url));
    if (fbSniffed.length > 0) {
      return stripByteRangeParams(cleanUrl(fbSniffed[fbSniffed.length - 1].url));
    }

    return null;
  }

  // 5. Unified Direct Video URL Detector
  function findDirectVideoUrl(video) {
    const host = window.location.hostname;

    // Platform specific handlers
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      return null; // Handled directly by showYouTubeDownloadModal
    } else if (host.includes('twitter.com') || host.includes('x.com')) {
      const twUrl = extractTwitterVideoUrl(video);
      if (twUrl) return twUrl;
    } else if (host.includes('instagram.com')) {
      const igUrl = extractInstagramVideoUrl(video);
      if (igUrl) return igUrl;
    } else if (host.includes('facebook.com')) {
      const fbUrl = extractFacebookVideoUrl(video);
      if (fbUrl) return fbUrl;
    }

    // Generic HTML5 video checking
    if (video) {
      if (isValidMediaUrl(video.currentSrc)) return stripByteRangeParams(cleanUrl(video.currentSrc));
      if (isValidMediaUrl(video.src)) return stripByteRangeParams(cleanUrl(video.src));

      const sources = video.querySelectorAll('source');
      for (const srcEl of sources) {
        const s = srcEl.src || srcEl.getAttribute('src');
        if (isValidMediaUrl(s)) return stripByteRangeParams(cleanUrl(s));
      }

      const dataAttrs = ['data-src', 'data-video-src', 'data-original-src', 'data-url'];
      for (const attr of dataAttrs) {
        const val = video.getAttribute(attr);
        if (isValidMediaUrl(val)) return stripByteRangeParams(cleanUrl(val));
      }
    }

    return null;
  }

  function getInstagramTitle(video) {
    let username = '';
    let snippet = '';
    let shortcode = '';

    const urlMatch = window.location.pathname.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) shortcode = urlMatch[1];

    const post = video ? (video.closest('article') || video.closest('[role="dialog"]') || video.closest('section') || video.parentElement) : null;
    if (post) {
      if (!shortcode) {
        const link = post.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
        if (link) {
          const m = link.href.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
          if (m) shortcode = m[1];
        }
      }

      // Author username
      const authorEl = post.querySelector('header a[href^="/"], a[role="link"][href^="/"] span, header h2');
      if (authorEl) {
        const txt = (authorEl.textContent || authorEl.innerText || '').trim().replace(/^@/, '');
        if (txt && !txt.includes(' ') && txt.length < 35) {
          username = txt;
        }
      }
      if (!username) {
        const headerA = post.querySelector('header a[href^="/"]');
        if (headerA) {
          const handle = headerA.getAttribute('href').replace(/\//g, '').trim();
          if (handle && !handle.includes('explore') && !handle.includes('reels')) {
            username = handle;
          }
        }
      }

      // Caption
      const captionEl = post.querySelector('h1, span._aacl._aaco._aacu, div[data-testid="post-comment-root"] span');
      if (captionEl) {
        const cTxt = (captionEl.textContent || captionEl.innerText || '').trim();
        if (cTxt) {
          snippet = cTxt.slice(0, 40).replace(/[\r\n\t]+/g, ' ');
        }
      }
    }

    if (!username) {
      const metaDesc = document.querySelector('meta[property="og:description"], meta[name="description"]')?.content || '';
      const m = metaDesc.match(/([a-zA-Z0-9_.]+) on Instagram/i) || metaDesc.match(/from ([a-zA-Z0-9_.]+)/i);
      if (m) username = m[1];
    }

    const parts = ['Instagram'];
    if (username) parts.push(username);
    if (snippet) parts.push(snippet);
    else if (shortcode) parts.push(shortcode);

    if (parts.length === 1) {
      if (shortcode) parts.push(shortcode);
      else parts.push(Date.now().toString().slice(-6));
    }

    return parts.join('_').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  }

  function getTwitterTitle(video) {
    const tweet = video ? (video.closest('article[data-testid="tweet"]') || video.closest('article')) : null;
    let handle = '';
    let tweetText = '';
    let tweetId = '';

    if (tweet) {
      const statusLink = tweet.querySelector('a[href*="/status/"]');
      if (statusLink) {
        const m = statusLink.href.match(/\/([a-zA-Z0-9_]+)\/status\/(\d+)/);
        if (m) {
          handle = m[1];
          tweetId = m[2];
        }
      }

      const textEl = tweet.querySelector('div[data-testid="tweetText"]');
      if (textEl) {
        tweetText = (textEl.textContent || textEl.innerText || '').trim().replace(/[\r\n\t]+/g, ' ').slice(0, 45);
      }
    }

    if (!handle) {
      const urlM = window.location.pathname.match(/\/([a-zA-Z0-9_]+)\/status\/(\d+)/);
      if (urlM) {
        handle = urlM[1];
        tweetId = urlM[2];
      }
    }

    const parts = ['Twitter'];
    if (handle) parts.push(`@${handle}`);
    if (tweetText) parts.push(tweetText);
    else if (tweetId) parts.push(tweetId);

    if (parts.length === 1) {
      parts.push(Date.now().toString().slice(-6));
    }

    return parts.join('_').replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  }

  function getFacebookTitle(video) {
    let title = 'Facebook_Video';
    const docTitle = (document.title || '').replace(/\s*[-–|•]\s*Facebook.*$/i, '').trim();
    if (docTitle && docTitle.toLowerCase() !== 'facebook') {
      title = `Facebook_${docTitle}`;
    } else {
      title = `Facebook_${Date.now().toString().slice(-6)}`;
    }
    return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_').slice(0, 80);
  }

  function getCleanVideoTitle(video) {
    const host = window.location.hostname;
    if (host.includes('youtube.com') && video) {
      const card = video.closest(
        'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ' +
        'ytd-grid-video-renderer, ytd-rich-grid-media, ytd-inline-preview-renderer, ' +
        'ytd-video-preview, ytd-notification-renderer'
      );
      if (card) {
        const titleElem = card.querySelector('#video-title, #video-title-link, .ytd-video-renderer #title, h3');
        if (titleElem && titleElem.textContent && titleElem.textContent.trim()) {
          return titleElem.textContent.trim().replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
        }
      }
    }
    if (host.includes('instagram.com')) {
      return getInstagramTitle(video);
    }
    if (host.includes('twitter.com') || host.includes('x.com')) {
      return getTwitterTitle(video);
    }
    if (host.includes('facebook.com')) {
      return getFacebookTitle(video);
    }

    let raw = (document.title || 'video').trim();
    raw = raw.replace(/\s*[-–|•]\s*(YouTube|Twitch|Vimeo|Netflix|Twitter|X|Facebook|Instagram|Dailymotion).*$/i, '').trim();
    const clean = raw.replace(/[<>:"/\\|?*]/g, '_').trim().slice(0, 80);
    if (!clean || clean.toLowerCase() === 'video' || clean.toLowerCase() === 'instagram' || clean.toLowerCase() === 'twitter' || clean.toLowerCase() === 'facebook') {
      return `video_${Date.now().toString().slice(-6)}`;
    }
    return clean;
  }

  async function downloadVideo(targetVideo) {
    const video = targetVideo || state.activeVideo || getPrimaryVideo();
    const title = getCleanVideoTitle(video);
    const host = window.location.hostname;

    // Trigger on-demand media search in main world
    window.dispatchEvent(new CustomEvent('MAXVIDEO_QUERY_PAGE_MEDIA'));

    // On YouTube: Show dedicated native download modal with 1080p, 720p, and Audio
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const videoId = getYouTubeVideoId(video);
      if (videoId) {
        showYouTubeDownloadModal(videoId, title);
        return;
      }
    }

    // On Twitter, Facebook, Instagram, and other social media sites:
    // Direct download with toast notification (no modal, preserving native fast experience)
    let directUrl = findDirectVideoUrl(video);
    if (!directUrl) {
      await new Promise((r) => setTimeout(r, 300));
      directUrl = findDirectVideoUrl(video);
    }

    if (!directUrl) {
      showToast('⚠️ Dê play no vídeo por 2 segundos e tente baixar novamente.');
      return;
    }

    const cleanTitle = (title || 'video').replace(/[<>:"/\\|?*]/g, '_').slice(0, 70);
    const filename = `${cleanTitle}.mp4`;

    showToast('📥 Baixando vídeo (MP4)...');
    chrome.runtime.sendMessage({
      action: 'download-video',
      url: directUrl,
      filename: filename
    }, (resp) => {
      if (resp && resp.success) {
        showToast('✅ Download do vídeo iniciado!');
      } else {
        saveUrlAsFile(directUrl, filename);
        showToast('✅ Download iniciado!');
      }
    });
  }

  function toggleStreamRecorder(video, title) {
    if (activeRecorder && activeRecorder.state === 'recording') {
      stopStreamRecorder();
      return;
    }
    startStreamRecorder(video, title);
  }

  function startStreamRecorder(video, title) {
    try {
      const stream = video.captureStream ? video.captureStream() : (video.mozCaptureStream ? video.mozCaptureStream() : null);
      if (!stream) {
        showToast('Este player não suporta captura direta de stream.');
        return;
      }

      recordedChunks = [];
      recordSeconds = 0;

      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      activeRecorder = new MediaRecorder(stream, { mimeType });

      activeRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      activeRecorder.onstop = () => {
        clearInterval(recordTimerInterval);
        removeRecorderBanner();

        if (recordedChunks.length === 0) {
          showToast('Nenhum dado de vídeo foi capturado.');
          return;
        }

        const blob = new Blob(recordedChunks, { type: mimeType });
        const downloadUrl = URL.createObjectURL(blob);
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        const filename = `${title || 'gravacao'}_${Date.now()}.${ext}`;

        chrome.runtime.sendMessage({
          action: 'download-video',
          url: downloadUrl,
          filename: filename
        }, () => {
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          showToast('✅ Vídeo gravado e salvo com sucesso!');
        });
      };

      activeRecorder.start(1000);
      showToast('🔴 Gravação do vídeo iniciada! Clique novamente para parar e baixar.');
      showRecorderBanner(video);

      if (video.paused) {
        video.play();
      }
    } catch (err) {
      console.error('Error starting stream recorder:', err);
      showToast('Não foi possível capturar o stream deste vídeo.');
    }
  }

  function stopStreamRecorder() {
    if (activeRecorder && activeRecorder.state !== 'inactive') {
      activeRecorder.stop();
      showToast('Finalizando e preparando arquivo para download...');
    }
  }

  function showRecorderBanner(video) {
    let banner = document.getElementById('__maxvideo_recorder_banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = '__maxvideo_recorder_banner';
      banner.style.cssText = `
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: rgba(15, 23, 42, 0.95);
        color: #fff;
        padding: 10px 18px;
        border-radius: 999px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5), 0 0 0 2px rgba(239, 68, 68, 0.6);
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        font-weight: 600;
      `;
      document.body.appendChild(banner);
    }

    recordTimerInterval = setInterval(() => {
      recordSeconds++;
      const mins = String(Math.floor(recordSeconds / 60)).padStart(2, '0');
      const secs = String(recordSeconds % 60).padStart(2, '0');
      banner.innerHTML = `
        <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#ef4444;"></span>
        <span>Gravando Vídeo: ${mins}:${secs}</span>
        <button id="__maxvideo_stop_rec" style="background:#ef4444; color:#fff; border:none; padding:4px 12px; border-radius:999px; cursor:pointer; font-size:12px; font-weight:600;">Parar e Baixar</button>
      `;
      const btn = banner.querySelector('#__maxvideo_stop_rec');
      if (btn) {
        btn.onclick = (e) => {
          e.stopPropagation();
          stopStreamRecorder();
        };
      }
    }, 1000);
  }

  function removeRecorderBanner() {
    const banner = document.getElementById('__maxvideo_recorder_banner');
    if (banner) banner.remove();
  }

  function captureVideoFrame(targetVideo) {
    const video = targetVideo || state.activeVideo || getPrimaryVideo();
    if (!video) {
      showToast('Nenhum vídeo para capturar imagem.');
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || video.clientWidth || 1280;
      canvas.height = video.videoHeight || video.clientHeight || 720;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const title = getCleanVideoTitle();
      const time = Math.floor(video.currentTime || 0);
      const dataUrl = canvas.toDataURL('image/png');

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${title}_frame_${time}s.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      showToast('📸 Foto do momento capturada e salva com sucesso!');
    } catch (err) {
      console.warn('Canvas capture error:', err);
      showToast('Captura de imagem bloqueada pelas políticas de segurança do site.');
    }
  }

  // -------------------------------------------------------------
  // Toast Notification HUD
  // -------------------------------------------------------------

  let toastTimeout = null;
  function showToast(message) {
    let host = document.getElementById('__maxvideo_toast_host');
    if (!host) {
      host = document.createElement('div');
      host.id = '__maxvideo_toast_host';
      host.className = '__maxvideo-toast-host';
      document.body.appendChild(host);
      host.attachShadow({ mode: 'open' });
    }

    const shadow = host.shadowRoot;
    shadow.innerHTML = `
      <style>
        .toast {
          background: rgba(15, 23, 42, 0.94);
          color: #ffffff;
          padding: 10px 20px;
          border-radius: 9999px;
          font-size: 13px;
          font-weight: 500;
          letter-spacing: 0.2px;
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(12px);
          animation: slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          user-select: none;
        }
        .icon {
          width: 18px;
          height: 18px;
          fill: #818cf8;
          flex-shrink: 0;
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-16px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      </style>
      <div class="toast">
        <svg class="icon" viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
        <span>${message}</span>
      </div>
    `;

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      shadow.innerHTML = '';
    }, 2800);
  }

  // -------------------------------------------------------------
  // Floating HUD (Quick Action Pill on Video Hover)
  // -------------------------------------------------------------

  function isYouTubePreviewVideo(video) {
    if (!video || !video.isConnected) return false;
    // Se o vídeo estiver em tela cheia ou maximizado, nunca é tratado como miniatura de preview
    if (state.isMaximized || document.fullscreenElement) return false;

    // Apenas no YouTube a barra flutuante vai para o canto superior esquerdo (para não sobrepor o botão de som)
    const host = window.location.hostname;
    if (!host.includes('youtube.com') && !host.includes('youtu.be')) {
      return false;
    }

    // No YouTube: o player principal (/watch) e o player do /shorts/ usam a posição padrão (canto superior direito)
    const isMainWatchPlayer = video.closest('#movie_player') && !video.closest('ytd-inline-preview-renderer, ytd-video-preview, #inline-preview-player');
    const isShortsPlayer = video.closest('ytd-reel-video-renderer, ytd-shorts');
    if (isMainWatchPlayer || isShortsPlayer) {
      return false;
    }

    // Qualquer outro vídeo no YouTube (miniaturas e previews do feed da home, busca, canais, etc.) é preview
    return true;
  }

  function isMouseOverVideo(e, v) {
    if (!v || !v.isConnected) return false;
    const r = v.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      if (
        e.clientX >= r.left - 4 &&
        e.clientX <= r.right + 4 &&
        e.clientY >= r.top - 4 &&
        e.clientY <= r.bottom + 4
      ) {
        return true;
      }
    }
    const container = v.parentElement;
    if (container && container.isConnected) {
      const cr = container.getBoundingClientRect();
      if (cr.width > 0 && cr.height > 0 && cr.width < window.innerWidth * 0.98 && cr.height < window.innerHeight * 0.98) {
        if (
          e.clientX >= cr.left &&
          e.clientX <= cr.right &&
          e.clientY >= cr.top &&
          e.clientY <= cr.bottom
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function attachHudToVideo(video) {
    if (video.__maxvideo_hud_attached) return;
    video.__maxvideo_hud_attached = true;

    const container = getBestPlayerContainer(video) || video.parentElement;
    if (!container) return;

    // Check if container or document already has a host for this video
    if (video.__maxvideo_hud_host) return;

    const host = document.createElement('div');
    host.className = '__maxvideo-hud-host';
    video.__maxvideo_hud_host = host;

    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host {
          display: block;
          position: fixed;
          z-index: 2147483647;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 0.25s ease, visibility 0.25s ease, transform 0.25s ease;
          transform: translateY(-4px);
        }
        :host(.visible) {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
          transform: translateY(0);
        }
        .hud-bar {
          display: flex;
          align-items: center;
          background: rgba(15, 23, 42, 0.92);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 12px;
          padding: 4px;
          gap: 3px;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6);
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transform: translateY(-4px);
          transition: opacity 0.25s ease, visibility 0.25s ease, transform 0.25s ease;
        }
        :host(.visible) .hud-bar,
        .hud-bar.visible {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
          transform: translateY(0);
        }
        .btn {
          all: unset;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          color: #f1f5f9;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
          position: relative;
        }
        .btn:hover {
          background: rgba(255, 255, 255, 0.18);
          color: #ffffff;
          transform: scale(1.08);
        }
        .btn:active {
          transform: scale(0.96);
        }
        .btn svg {
          width: 18px;
          height: 18px;
          fill: currentColor;
        }
        .btn-clean {
          color: #818cf8;
        }
        .btn-clean:hover {
          background: rgba(129, 140, 248, 0.25);
          color: #c7d2fe;
        }
        .btn-download {
          color: #34d399;
        }
        .btn-download:hover {
          background: rgba(52, 211, 153, 0.25);
          color: #6ee7b7;
        }
        /* Tooltip */
        .tooltip {
          position: absolute;
          top: 42px;
          background: #0f172a;
          color: #ffffff;
          font-size: 11px;
          font-weight: 500;
          padding: 4px 8px;
          border-radius: 6px;
          white-space: nowrap;
          border: 1px solid rgba(255, 255, 255, 0.12);
          pointer-events: none;
          opacity: 0;
          transform: translateY(-4px);
          transition: opacity 0.15s, transform 0.15s;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          z-index: 100;
        }
        .btn:hover .tooltip {
          opacity: 1;
          transform: translateY(0);
        }
        /* Menu dropdown */
        .tools-dropdown {
          display: none;
          position: absolute;
          top: 44px;
          right: 0;
          width: 220px;
          background: rgba(15, 23, 42, 0.96);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 8px;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7);
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
          color: #e2e8f0;
          z-index: 200;
        }
        :host(.is-preview) .tools-dropdown,
        .hud-bar.is-preview .tools-dropdown {
          right: auto;
          left: 0;
        }
        .tools-dropdown.open {
          display: flex;
        }
        .menu-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 4px 6px;
        }
        .menu-row span {
          font-weight: 500;
          color: #94a3b8;
        }
        .menu-btns {
          display: flex;
          gap: 4px;
        }
        .mini-btn {
          all: unset;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #f8fafc;
          padding: 2px 8px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 11px;
          transition: background 0.15s;
        }
        .mini-btn:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      </style>

      <div class="hud-bar">
        <!-- Maximize to window -->
        <button class="btn btn-max" id="btnMax">
          <svg viewBox="0 0 24 24"><path d="M3 3h8v2H5v6H3V3zm18 0h-8v2h6v6h2V3zM3 21h8v-2H5v-6H3v8zm18 0h-8v-2h6v-6h2v8z"/></svg>
          <div class="tooltip">Maximizar na Janela (Alt+M)</div>
        </button>

        <!-- Clean Window (Hide tabs/URL) -->
        <button class="btn btn-clean" id="btnClean">
          <svg viewBox="0 0 24 24"><path d="M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V8h14v10z"/></svg>
          <div class="tooltip">Janela Limpa Sem Abas (Alt+W)</div>
        </button>

        <!-- Immersive Fullscreen -->
        <button class="btn" id="btnFull">
          <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          <div class="tooltip">Tela Cheia Imersiva (Alt+F)</div>
        </button>

        <!-- Picture-in-Picture -->
        <button class="btn" id="btnPip">
          <svg viewBox="0 0 24 24"><path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"/></svg>
          <div class="tooltip">Picture-in-Picture (Alt+P)</div>
        </button>

        <!-- Download Video -->
        <button class="btn btn-download" id="btnDownload">
          <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
          <div class="tooltip">Baixar Vídeo (Alt+D)</div>
        </button>

        <!-- Tools dropdown -->
        <button class="btn" id="btnTools">
          <svg viewBox="0 0 24 24"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>
          <div class="tooltip">Ferramentas & Proporção</div>
        </button>

        <div class="tools-dropdown" id="toolsMenu">
          <div class="menu-row">
            <span>Download</span>
            <div class="menu-btns">
              <button class="mini-btn" id="optDownloadVideo">Baixar Vídeo</button>
              <button class="mini-btn" id="optSnapshot">Capturar Foto</button>
            </div>
          </div>
          <div class="menu-row">
            <span>Proporção</span>
            <div class="menu-btns">
              <button class="mini-btn" id="optFitCover">Cortar Barras</button>
              <button class="mini-btn" id="optFitNormal">Ajustar</button>
            </div>
          </div>
          <div class="menu-row">
            <span>Velocidade</span>
            <div class="menu-btns">
              <button class="mini-btn" id="optSpeedDown">-</button>
              <button class="mini-btn" id="optSpeedNormal">1x</button>
              <button class="mini-btn" id="optSpeed15">1.5x</button>
              <button class="mini-btn" id="optSpeed2">2x</button>
              <button class="mini-btn" id="optSpeedUp">+</button>
            </div>
          </div>
          <div class="menu-row">
            <span>Vídeo</span>
            <div class="menu-btns">
              <button class="mini-btn" id="optFlip">Espelhar</button>
              <button class="mini-btn" id="optRotate">Girar 90°</button>
            </div>
          </div>
          <div class="menu-row">
            <span>Áudio Boost</span>
            <div class="menu-btns">
              <button class="mini-btn" id="optBoost100">100%</button>
              <button class="mini-btn" id="optBoost200">200%</button>
              <button class="mini-btn" id="optBoost300">300%</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Event Listeners on HUD
    const btnMax = shadow.getElementById('btnMax');
    const btnClean = shadow.getElementById('btnClean');
    const btnFull = shadow.getElementById('btnFull');
    const btnPip = shadow.getElementById('btnPip');
    const btnDownload = shadow.getElementById('btnDownload');
    const btnTools = shadow.getElementById('btnTools');
    const toolsMenu = shadow.getElementById('toolsMenu');

    btnMax.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMaximize(video);
    });

    btnClean.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCleanWindow();
    });

    btnFull.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFullscreen();
    });

    btnPip.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePiP(video);
    });

    btnDownload.addEventListener('click', (e) => {
      e.stopPropagation();
      downloadVideo(video);
    });

    btnTools.addEventListener('click', (e) => {
      e.stopPropagation();
      toolsMenu.classList.toggle('open');
    });

    // Menu options
    const optDownloadVideo = shadow.getElementById('optDownloadVideo');
    if (optDownloadVideo) {
      optDownloadVideo.addEventListener('click', (e) => {
        e.stopPropagation();
        downloadVideo(video);
        toolsMenu.classList.remove('open');
      });
    }

    const optSnapshot = shadow.getElementById('optSnapshot');
    if (optSnapshot) {
      optSnapshot.addEventListener('click', (e) => {
        e.stopPropagation();
        captureVideoFrame(video);
        toolsMenu.classList.remove('open');
      });
    }

    shadow.getElementById('optFitCover').addEventListener('click', (e) => {
      e.stopPropagation();
      setFitMode('cover');
      toolsMenu.classList.remove('open');
    });

    shadow.getElementById('optFitNormal').addEventListener('click', (e) => {
      e.stopPropagation();
      setFitMode('contain');
      toolsMenu.classList.remove('open');
    });

    shadow.getElementById('optSpeedDown').addEventListener('click', (e) => {
      e.stopPropagation();
      adjustPlaybackSpeed(-0.25);
    });

    shadow.getElementById('optSpeedNormal').addEventListener('click', (e) => {
      e.stopPropagation();
      setPlaybackSpeed(1.0);
    });

    shadow.getElementById('optSpeed15').addEventListener('click', (e) => {
      e.stopPropagation();
      setPlaybackSpeed(1.5);
    });

    shadow.getElementById('optSpeed2').addEventListener('click', (e) => {
      e.stopPropagation();
      setPlaybackSpeed(2.0);
    });

    shadow.getElementById('optSpeedUp').addEventListener('click', (e) => {
      e.stopPropagation();
      adjustPlaybackSpeed(0.25);
    });

    shadow.getElementById('optFlip').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFlip();
    });

    shadow.getElementById('optRotate').addEventListener('click', (e) => {
      e.stopPropagation();
      rotateVideo();
    });

    shadow.getElementById('optBoost100').addEventListener('click', (e) => {
      e.stopPropagation();
      setAudioBoost(1.0);
    });

    shadow.getElementById('optBoost200').addEventListener('click', (e) => {
      e.stopPropagation();
      setAudioBoost(2.0);
    });

    shadow.getElementById('optBoost300').addEventListener('click', (e) => {
      e.stopPropagation();
      setAudioBoost(3.0);
    });

    // Hover fade-in / fade-out: ONLY visible when hovering over the video
    let isOverVideo = false;
    let isOverHud = false;
    let hideTimer = null;
    const bar = shadow.querySelector('.hud-bar');

    function isOverNativePreviewControls(e) {
      if (!e || !isYouTubePreviewVideo(video)) return false;
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      // Canto superior direito do preview no YouTube (área dos botões de mutar/desmutar, CC e fila)
      return (
        e.clientX >= rect.right - 90 &&
        e.clientX <= rect.right + 10 &&
        e.clientY >= rect.top - 5 &&
        e.clientY <= rect.top + 65
      );
    }

    function updatePosition() {
      if (!video || !video.isConnected) {
        if (host.isConnected) host.remove();
        return;
      }
      const rect = video.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const isYtPreview = isYouTubePreviewVideo(video);

      host.style.position = 'fixed';
      host.style.top = `${Math.max(8, Math.round(rect.top + (isYtPreview ? 8 : 12)))}px`;

      if (isYtPreview) {
        // Exclusivo para previews do YouTube: canto SUPERIOR ESQUERDO para não cobrir o botão de mutar/desmutar
        host.style.left = `${Math.max(8, Math.round(rect.left + 8))}px`;
        host.classList.add('is-preview');
        if (bar) bar.classList.add('is-preview');
      } else {
        // Twitter, Instagram, Facebook e qualquer outro site (ou player principal): canto SUPERIOR DIREITO padrão
        host.style.left = `${Math.min(window.innerWidth - 230, Math.round(rect.right - 210))}px`;
        host.classList.remove('is-preview');
        if (bar) bar.classList.remove('is-preview');
      }
      host.style.zIndex = '2147483647';
    }

    function showHud() {
      if (!state.showHud) return;
      updatePosition();
      host.classList.add('visible');
      if (bar) bar.classList.add('visible');

      clearTimeout(hideTimer);
      // Auto-hide after 2.5s if mouse stays still over the video
      hideTimer = setTimeout(() => {
        if (!toolsMenu.classList.contains('open') && !isOverHud) {
          hideHud();
        }
      }, 2500);
    }

    function hideHud() {
      if (toolsMenu.classList.contains('open')) return;
      host.classList.remove('visible');
      if (bar) bar.classList.remove('visible');
    }

    function onVideoEnter(e) {
      if (e && isOverNativePreviewControls(e)) return;
      isOverVideo = true;
      showHud();
    }

    function onVideoMove(e) {
      if (e && isOverNativePreviewControls(e)) {
        isOverVideo = false;
        hideHud();
        return;
      }
      isOverVideo = true;
      showHud();
    }

    function onVideoLeave(e) {
      if (e && e.relatedTarget && (e.relatedTarget === host || host.contains(e.relatedTarget))) {
        return;
      }
      isOverVideo = false;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!isOverHud && !toolsMenu.classList.contains('open')) {
          hideHud();
        }
      }, 200);
    }

    // Attach direct hover listeners to video and container
    video.addEventListener('mouseenter', onVideoEnter);
    video.addEventListener('mousemove', onVideoMove);
    video.addEventListener('mouseleave', onVideoLeave);

    container.addEventListener('mouseenter', onVideoEnter);
    container.addEventListener('mousemove', onVideoMove);
    container.addEventListener('mouseleave', onVideoLeave);

    // Also attach to post wrapper (crucial for Instagram, Twitter, Facebook)
    const postWrapper = video.closest('article, [role="dialog"], [data-testid="tweet"], .x10l6tqk');
    if (postWrapper && postWrapper !== container) {
      postWrapper.addEventListener('mouseenter', onVideoEnter);
      postWrapper.addEventListener('mousemove', onVideoMove);
      postWrapper.addEventListener('mouseleave', onVideoLeave);
    }

    // Coordinate-based check hook for global mousemove listener
    video.__maxvideo_check_hover = (e) => {
      // Se o cursor estiver na área dos botões nativos de mutar/desmutar do preview, esconde o HUD
      if (isOverNativePreviewControls(e)) {
        isOverVideo = false;
        hideHud();
        return;
      }

      if (isMouseOverVideo(e, video)) {
        isOverVideo = true;
        showHud();
      } else {
        if (isOverVideo) {
          isOverVideo = false;
          clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            if (!isOverHud && !toolsMenu.classList.contains('open')) {
              hideHud();
            }
          }, 200);
        }
      }
    };
    host.__maxvideo_update_pos = updatePosition;

    // Keep visible while hovering directly over HUD buttons
    host.addEventListener('mouseenter', () => {
      isOverHud = true;
      clearTimeout(hideTimer);
      showHud();
    });

    host.addEventListener('mousemove', () => {
      isOverHud = true;
      clearTimeout(hideTimer);
    });

    host.addEventListener('mouseleave', (e) => {
      isOverHud = false;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!isOverVideo && !toolsMenu.classList.contains('open')) {
          hideHud();
        }
      }, 250);
    });

    // Close tools menu if user clicks outside
    document.addEventListener('click', (e) => {
      if (!host.contains(e.target)) {
        toolsMenu.classList.remove('open');
        if (!isOverVideo && !isOverHud) {
          hideHud();
        }
      }
    });

    // Initially ensure it is completely hidden
    hideHud();

    // Append host to document.body so it is never clipped by parent overflow:hidden
    document.body.appendChild(host);
  }

  // Global mousemove tracker to penetrate through Instagram / Twitter overlay divs
  let hudMoveThrottle = null;
  document.addEventListener('mousemove', (e) => {
    if (hudMoveThrottle) return;
    hudMoveThrottle = requestAnimationFrame(() => {
      hudMoveThrottle = null;
      const videos = findAllVideos();
      videos.forEach((v) => {
        if (typeof v.__maxvideo_check_hover === 'function') {
          v.__maxvideo_check_hover(e);
        }
      });
    });
  }, { passive: true });

  window.addEventListener('scroll', () => {
    const visibleHosts = document.querySelectorAll('.__maxvideo-hud-host.visible');
    visibleHosts.forEach((h) => {
      if (typeof h.__maxvideo_update_pos === 'function') {
        h.__maxvideo_update_pos();
      }
    });
  }, { passive: true });

  window.addEventListener('resize', () => {
    const visibleHosts = document.querySelectorAll('.__maxvideo-hud-host.visible');
    visibleHosts.forEach((h) => {
      if (typeof h.__maxvideo_update_pos === 'function') {
        h.__maxvideo_update_pos();
      }
    });
  }, { passive: true });

  // -------------------------------------------------------------
  // Dynamic Video Scanner & Observer
  // -------------------------------------------------------------

  function scanAndAttach() {
    const videos = findAllVideos();
    videos.forEach(attachHudToVideo);
  }

  // Observer for dynamically added videos (infinite scroll, AJAX)
  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(scanAndAttach);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanAndAttach);
  } else {
    scanAndAttach();
  }

  // -------------------------------------------------------------
  // Keyboard Shortcuts in Page
  // -------------------------------------------------------------

  window.addEventListener('keydown', (e) => {
    // If typing in an input/textarea/contenteditable, ignore
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) {
      return;
    }

    // Escape to exit maximized mode
    if (e.key === 'Escape' && state.isMaximized) {
      restoreVideo();
      return;
    }

    // Alt + M: Toggle Maximize
    if (e.altKey && (e.key === 'm' || e.key === 'M')) {
      e.preventDefault();
      toggleMaximize();
      return;
    }

    // Alt + W: Toggle Clean Window
    if (e.altKey && (e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
      toggleCleanWindow();
      return;
    }

    // Alt + F: Toggle Fullscreen
    if (e.altKey && (e.key === 'f' || e.key === 'F')) {
      e.preventDefault();
      toggleFullscreen();
      return;
    }

    // Alt + P: Toggle Picture-in-Picture
    if (e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      togglePiP();
      return;
    }

    // Alt + D: Download Video
    if (e.altKey && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      downloadVideo();
      return;
    }

    // Alt + Z: Toggle Aspect Ratio (Zoom to fill)
    if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      cycleFitMode();
      return;
    }

    // [ or ]: Speed decrease/increase
    if (e.key === '[' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      adjustPlaybackSpeed(-0.25);
    } else if (e.key === ']' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      adjustPlaybackSpeed(0.25);
    }
  });

  // -------------------------------------------------------------
  // Multi-Frame / iFrame Message Bridge
  // -------------------------------------------------------------

  window.addEventListener('message', (event) => {
    if (!event.data || typeof event.data !== 'object') return;

    if (event.data.type === 'MAXVIDEO_EXPAND_IFRAME') {
      // Find which iframe sent this message
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.contentWindow === event.source) {
          iframe.classList.add('__maxvideo-iframe-expanded');
          document.documentElement.classList.add('__maxvideo-body-lock');
          document.body.classList.add('__maxvideo-body-lock');
          break;
        }
      }
    } else if (event.data.type === 'MAXVIDEO_RESTORE_IFRAME') {
      const iframes = document.querySelectorAll('iframe.__maxvideo-iframe-expanded');
      iframes.forEach((iframe) => {
        iframe.classList.remove('__maxvideo-iframe-expanded');
      });
      document.documentElement.classList.remove('__maxvideo-body-lock');
      document.body.classList.remove('__maxvideo-body-lock');
    }
  });

  // -------------------------------------------------------------
  // Message Listener (from Background Service Worker and Popup)
  // -------------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggle-maximize') {
      toggleMaximize();
      sendResponse({ success: true, isMaximized: state.isMaximized });
    } else if (request.action === 'maximize-video') {
      maximizeVideo();
      sendResponse({ success: true, isMaximized: state.isMaximized });
    } else if (request.action === 'restore-video') {
      restoreVideo();
      sendResponse({ success: true, isMaximized: false });
    } else if (request.action === 'toggle-pip') {
      togglePiP();
      sendResponse({ success: true });
    } else if (request.action === 'trigger-download') {
      downloadVideo();
      sendResponse({ success: true });
    } else if (request.action === 'capture-frame') {
      captureVideoFrame();
      sendResponse({ success: true });
    } else if (request.action === 'set-fit-mode') {
      setFitMode(request.mode);
      sendResponse({ success: true });
    } else if (request.action === 'set-speed') {
      setPlaybackSpeed(request.speed);
      sendResponse({ success: true });
    } else if (request.action === 'set-audio-boost') {
      setAudioBoost(request.boost);
      sendResponse({ success: true });
    } else if (request.action === 'set-brightness') {
      setBrightness(request.val);
      sendResponse({ success: true });
    } else if (request.action === 'set-contrast') {
      setContrast(request.val);
      sendResponse({ success: true });
    } else if (request.action === 'toggle-flip') {
      toggleFlip();
      sendResponse({ success: true });
    } else if (request.action === 'rotate-video') {
      rotateVideo();
      sendResponse({ success: true });
    } else if (request.action === 'toast') {
      showToast(request.message);
      sendResponse({ success: true });
    } else if (request.action === 'get-page-video-info') {
      const videos = findAllVideos();
      const info = videos.map((v, idx) => ({
        index: idx,
        paused: v.paused,
        currentTime: Math.round(v.currentTime),
        duration: Math.round(v.duration || 0),
        src: v.currentSrc || v.src || '',
        videoWidth: v.videoWidth || 0,
        videoHeight: v.videoHeight || 0
      }));
      sendResponse({
        count: videos.length,
        isMaximized: state.isMaximized,
        fitMode: state.fitMode,
        speed: state.speed,
        audioBoost: state.audioBoost,
        videos: info
      });
    } else if (request.action === 'update-settings') {
      if (typeof request.showFloatingHud === 'boolean') {
        state.showHud = request.showFloatingHud;
      }
      sendResponse({ success: true });
    }
    return true; // async friendly
  });
})();
