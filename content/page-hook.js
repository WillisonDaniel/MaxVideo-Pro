// MaxVideo Pro - Page-level Media Sniffer (Main World)
// Intercepts real media stream URLs from YouTube, Twitter, Instagram, Facebook, and HTML5 players

(function () {
  'use strict';

  const currentHostname = (window.location && window.location.hostname ? window.location.hostname : '').toLowerCase();
  const ignoredHosts = [
    'outlook.live.com',
    'outlook.office.com',
    'outlook.office365.com',
    'mail.google.com',
    'teams.microsoft.com',
    'teams.live.com',
    'web.whatsapp.com',
    'discord.com',
    'slack.com'
  ];
  if (ignoredHosts.some((h) => currentHostname.includes(h))) {
    return; // Do not patch or monitor email, chat, or enterprise productivity apps
  }

  const reportedUrls = new Set();
  window.__maxvideo_sniffedMedia = window.__maxvideo_sniffedMedia || [];
  window.__maxvideo_drmDetected = false;

  // Intercept EME / DRM key requests (Widevine, PlayReady, ClearKey)
  try {
    if (navigator && navigator.requestMediaKeySystemAccess) {
      const origRMKSA = navigator.requestMediaKeySystemAccess.bind(navigator);
      navigator.requestMediaKeySystemAccess = function (keySystem, supportedConfigurations) {
        window.__maxvideo_drmDetected = true;
        try {
          window.dispatchEvent(
            new CustomEvent('MAXVIDEO_DRM_DETECTED', {
              detail: { keySystem, host: window.location.hostname, timestamp: Date.now() }
            })
          );
        } catch {}
        return origRMKSA(keySystem, supportedConfigurations);
      };
    }
  } catch {}

  function reportMedia(url, platform, extra = {}) {
    if (!url || typeof url !== 'string') return;
    url = url.trim();
    const key = `${platform}:${url}`;
    let item = window.__maxvideo_sniffedMedia?.find((m) => m.url === url);
    if (!item) {
      item = {
        url,
        platform,
        timestamp: Date.now(),
        ...extra
      };
      if (window.__maxvideo_sniffedMedia) {
        window.__maxvideo_sniffedMedia.push(item);
      }
    }
    reportedUrls.add(key);

    try {
      window.dispatchEvent(
        new CustomEvent('MAXVIDEO_SNIFFED_MEDIA', {
          detail: item
        })
      );
    } catch {}
  }

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

  function extractTwitterMediaId(url) {
    if (!url || typeof url !== 'string') return null;
    const m = url.match(/\/(?:ext_tw_video|amplify_video|ext_tw_video_thumb|amplify_video_thumb)\/(\d+)\//);
    return m ? m[1] : null;
  }

  function isBlacklistedMedia(url) {
    if (!url || typeof url !== 'string') return true;
    const lower = url.toLowerCase();
    if (lower.startsWith('data:')) return true;

    // Never blacklist valid streaming / video formats (.m3u8, .mp4, .ts, etc.) even if they have /embed/ in the path
    if (lower.includes('.m3u8') || lower.match(/\.(mp4|webm|mkv|mov|ts|m4s)(\?.*)?$/i)) {
      return false;
    }

    // Blacklist web page documents
    if (lower.match(/\.(htm|html|php|asp|aspx)(\?.*)?$/i)) return true;

    // Blacklist static branding/promo clips, tracking pixels, and assets
    if (lower.includes('static.cdninstagram.com')) return true;
    if (lower.includes('/rsrc.php/')) return true;
    if (lower.includes('instagram_branding')) return true;
    if (lower.includes('static.xx.fbcdn.net')) return true;
    if (lower.match(/\.(jpg|jpeg|png|webp|gif|ico|svg|css|woff|woff2|ttf)(\?.*)?$/i)) return true;
    return false;
  }

  function checkUrl(url) {
    if (!url || typeof url !== 'string' || isBlacklistedMedia(url)) return;
    const host = window.location.hostname;

    // 1. YouTube: googlevideo.com/videoplayback
    if (url.includes('googlevideo.com/videoplayback')) {
      const clean = stripByteRangeParams(cleanUrl(url));
      let itag = null;
      let xtags = '';
      try {
        const u = new URL(clean);
        itag = parseInt(u.searchParams.get('itag'), 10);
        xtags = u.searchParams.get('xtags') || u.searchParams.get('btrack') || '';
      } catch {}
      reportMedia(clean, 'youtube', { itag, xtags });
    }
    // 2. Twitter / X: video.twimg.com
    else if (url.includes('video.twimg.com')) {
      const mediaId = extractTwitterMediaId(url);
      if (url.includes('.mp4')) {
        reportMedia(url, 'twitter', { mediaId });
      } else if (url.includes('.m3u8')) {
        reportMedia(url, 'twitter_hls', { mediaId });
      }
    }
    // 3. Instagram: scontent*.cdninstagram.com or fbcdn.net video paths
    else if (host.includes('instagram.com') && (url.includes('cdninstagram.com') || url.includes('fbcdn.net'))) {
      if (url.includes('.mp4') || url.includes('/v/') || url.includes('bytestart=') || url.includes('video')) {
        const fullUrl = stripByteRangeParams(cleanUrl(url));
        let shortcode = null;
        const scMatch = window.location.pathname.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
        if (scMatch) shortcode = scMatch[1];
        reportMedia(fullUrl, 'instagram', { shortcode });
      }
    }
    // 4. Facebook: fbcdn.net
    else if (host.includes('facebook.com') && url.includes('fbcdn.net')) {
      if (url.includes('.mp4') || url.includes('/v/') || url.includes('video') || url.includes('bytestart=')) {
        const fullUrl = stripByteRangeParams(cleanUrl(url));
        reportMedia(fullUrl, 'facebook');
      }
    }
    // 5. TikTok: tiktokcdn.com, byteoversea.com, ibytedtos.com, muscdn.com
    else if (url.includes('tiktokcdn.com') || url.includes('byteoversea.com') || url.includes('ibytedtos.com') || url.includes('muscdn.com') || (host.includes('tiktok.com') && (url.includes('/video/') || url.includes('.mp4')))) {
      if (url.includes('.mp4') || url.includes('/tos-') || url.includes('video/tos') || url.includes('x-expires') || url.includes('mime_type=video_mp4')) {
        const fullUrl = stripByteRangeParams(cleanUrl(url));
        let videoId = null;
        const vm = window.location.pathname.match(/\/video\/(\d+)/);
        if (vm) videoId = vm[1];
        reportMedia(fullUrl, 'tiktok', { videoId });
      }
    }
    // 6. Reddit: v.redd.it
    else if (url.includes('v.redd.it')) {
      const fullUrl = stripByteRangeParams(cleanUrl(url));
      const m = fullUrl.match(/v\.redd\.it\/([a-zA-Z0-9_-]+)/);
      const mediaId = m ? m[1] : null;
      let quality = null;
      const qm = fullUrl.match(/DASH_(\d+)/i);
      if (qm) quality = `${qm[1]}p`;
      const isAudio = fullUrl.toLowerCase().includes('audio');
      reportMedia(fullUrl, 'reddit', { mediaId, quality, isAudio });
    }
    // 7. Twitch: clips-media-assets2.twitch.tv, production.assets.clips.twitchcdn.net, usher.ttvnw.net
    else if (url.includes('clips-media-assets2.twitch.tv') || url.includes('assets.clips.twitchcdn.net') || (host.includes('twitch.tv') && url.includes('.mp4'))) {
      const fullUrl = cleanUrl(url);
      reportMedia(fullUrl, 'twitch', { isClip: true });
    }
    else if (url.includes('usher.ttvnw.net') || (host.includes('twitch.tv') && url.includes('.m3u8'))) {
      const fullUrl = cleanUrl(url);
      reportMedia(fullUrl, 'twitch', { isHls: true });
    }
    // 8. Universal HLS (.m3u8) Playlists across all websites
    else if (url.includes('.m3u8')) {
      const fullUrl = cleanUrl(url);
      reportMedia(fullUrl, 'hls', { isHls: true });
    }
    // 9. Generic direct MP4 / WebM / MKV / MOV / TS
    else if (url.match(/\.(mp4|webm|mkv|mov|ts)(\?.*)?$/i)) {
      const fullUrl = stripByteRangeParams(cleanUrl(url));
      reportMedia(fullUrl, 'generic');
    }
  }

  function inspectResponseBody(text, requestUrl) {
    if (!text || typeof text !== 'string') return;

    // --- Universal HLS / Streaming Manifest & M3U8 URLs inspection ---
    if (text.includes('#EXTM3U')) {
      reportMedia(requestUrl, 'hls', { isHls: true });
    }
    const m3u8Matches = text.match(/https?:\\?\/\\?\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8Matches) {
      m3u8Matches.forEach((m) => {
        const clean = cleanUrl(m);
        reportMedia(clean, 'hls', { isHls: true });
      });
    }

    // --- Twitter / X GraphQL & API response inspection ---
    if (requestUrl.includes('twitter.com') || requestUrl.includes('x.com') || text.includes('video.twimg.com')) {
      const twMatches = text.match(/https:\\?\/\\?\/video\.twimg\.com\\?\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
      if (twMatches) {
        twMatches.forEach((m) => {
          const clean = cleanUrl(m);
          const mediaId = extractTwitterMediaId(clean);
          reportMedia(clean, 'twitter', { mediaId });
        });
      }

      try {
        if (text.startsWith('{') && text.includes('video_info')) {
          const json = JSON.parse(text);
          findTwitterVariantsInJson(json);
        }
      } catch {}
    }

    // --- Instagram GraphQL & API response inspection ---
    if (requestUrl.includes('instagram.com') || text.includes('cdninstagram.com') || text.includes('video_versions')) {
      try {
        if (text.startsWith('{') && (text.includes('video_versions') || text.includes('shortcode_media') || text.includes('video_url'))) {
          const json = JSON.parse(text);
          findInstagramVariantsInJson(json);
        }
      } catch {}

      const igMatches = text.match(/https:\\?\/\\?\/[^\s"'<>]*(?:cdninstagram\.com|fbcdn\.net)\\?\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
      if (igMatches) {
        igMatches.forEach((m) => {
          const clean = stripByteRangeParams(cleanUrl(m));
          if (!isBlacklistedMedia(clean)) {
            let shortcode = null;
            const scMatch = window.location.pathname.match(/\/(?:p|reel|reels)\/([a-zA-Z0-9_-]+)/);
            if (scMatch) shortcode = scMatch[1];
            reportMedia(clean, 'instagram', { shortcode });
          }
        });
      }
    }

    // --- Facebook GraphQL & API response inspection ---
    if (requestUrl.includes('facebook.com') || text.includes('fbcdn.net')) {
      const fbHdMatches = text.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/g) || [];
      const fbSdMatches = text.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/g) || [];
      const fbPlayableMatches = text.match(/"playable_url(?:_quality_hd)?"\s*:\s*"([^"]+)"/g) || [];

      [...fbHdMatches, ...fbSdMatches, ...fbPlayableMatches].forEach((entry) => {
        const valMatch = entry.match(/:\s*"([^"]+)"/);
        if (valMatch && valMatch[1]) {
          const clean = stripByteRangeParams(cleanUrl(valMatch[1]));
          if (clean.includes('fbcdn.net') && !isBlacklistedMedia(clean)) {
            reportMedia(clean, 'facebook');
          }
        }
      });
    }

    // --- TikTok JSON & API response inspection ---
    if (requestUrl.includes('tiktok.com') || requestUrl.includes('byteoversea.com') || requestUrl.includes('tiktokcdn.com') || text.includes('playAddr') || text.includes('play_addr')) {
      const ttMatches = text.match(/https:\\?\/\\?\/[^\s"'<>]*(?:tiktokcdn\.com|byteoversea\.com|ibytedtos\.com)[^\s"'<>]*/g);
      if (ttMatches) {
        ttMatches.forEach((m) => {
          const clean = cleanUrl(m);
          if (clean.includes('.mp4') || clean.includes('/tos-') || clean.includes('video/tos') || clean.includes('mime_type=video_mp4')) {
            reportMedia(clean, 'tiktok');
          }
        });
      }
      try {
        if (text.startsWith('{') && (text.includes('playAddr') || text.includes('play_addr') || text.includes('downloadAddr'))) {
          const json = JSON.parse(text);
          findTikTokUrlsInJson(json);
        }
      } catch {}
    }

    // --- Reddit JSON & API response inspection ---
    if (requestUrl.includes('reddit.com') || text.includes('v.redd.it')) {
      const redMatches = text.match(/https:\\?\/\\?\/v\.redd\.it\\?\/[a-zA-Z0-9_-]+\\?\/(?:DASH_[a-zA-Z0-9_.]+|HLSPlaylist\.m3u8)/g);
      if (redMatches) {
        redMatches.forEach((m) => {
          const clean = cleanUrl(m);
          checkUrl(clean);
        });
      }
      try {
        if (text.startsWith('{') && (text.includes('fallback_url') || text.includes('hls_url'))) {
          const json = JSON.parse(text);
          findRedditUrlsInJson(json);
        }
      } catch {}
    }

    // --- Twitch GQL & Response inspection ---
    if (requestUrl.includes('twitch.tv') || text.includes('clips-media-assets2.twitch.tv')) {
      const twClips = text.match(/https:\\?\/\\?\/clips-media-assets2\.twitch\.tv\\?\/[^\s"'<>]+\.mp4[^\s"'<>]*/g);
      if (twClips) {
        twClips.forEach((m) => {
          reportMedia(cleanUrl(m), 'twitch', { isClip: true });
        });
      }
    }
  }

  function findTwitterVariantsInJson(obj, currentTweetId = null) {
    if (!obj || typeof obj !== 'object') return;
    const tweetId = obj.rest_id || obj.id_str || currentTweetId;

    if (obj.variants && Array.isArray(obj.variants)) {
      const mp4s = obj.variants
        .filter((v) => v && (v.url || v.src) && (v.content_type === 'video/mp4' || (v.url || v.src).includes('.mp4')))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

      mp4s.forEach((v) => {
        const u = cleanUrl(v.url || v.src);
        if (u) {
          const mediaId = extractTwitterMediaId(u);
          reportMedia(u, 'twitter', { bitrate: v.bitrate, tweetId, mediaId });
        }
      });
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        findTwitterVariantsInJson(obj[key], tweetId);
      }
    }
  }

  function findInstagramVariantsInJson(obj, currentShortcode = null) {
    if (!obj || typeof obj !== 'object') return;
    const sc = obj.code || obj.shortcode || currentShortcode;

    // Check direct video_url (e.g. shortcode_media.video_url)
    if (obj.video_url && typeof obj.video_url === 'string') {
      const u = stripByteRangeParams(cleanUrl(obj.video_url));
      if (!isBlacklistedMedia(u)) {
        reportMedia(u, 'instagram', { shortcode: sc });
      }
    }

    if (obj.video_versions && Array.isArray(obj.video_versions)) {
      const sorted = [...obj.video_versions].sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
      for (const v of sorted) {
        if (v && (v.url || v.src)) {
          const u = stripByteRangeParams(cleanUrl(v.url || v.src));
          if (!isBlacklistedMedia(u)) {
            reportMedia(u, 'instagram', { shortcode: sc, width: v.width, height: v.height });
            break; // Report the highest resolution
          }
        }
      }
    }

    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        findInstagramVariantsInJson(obj[key], sc);
      }
    }
  }

  function findTikTokUrlsInJson(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.playAddr && typeof obj.playAddr === 'string') {
      const u = cleanUrl(obj.playAddr);
      if (!isBlacklistedMedia(u)) reportMedia(u, 'tiktok');
    }
    if (obj.downloadAddr && typeof obj.downloadAddr === 'string') {
      const u = cleanUrl(obj.downloadAddr);
      if (!isBlacklistedMedia(u)) reportMedia(u, 'tiktok');
    }
    if (obj.play_addr && typeof obj.play_addr === 'object') {
      const urls = obj.play_addr.url_list || [];
      urls.forEach((raw) => {
        if (typeof raw === 'string') {
          const u = cleanUrl(raw);
          if (!isBlacklistedMedia(u)) reportMedia(u, 'tiktok');
        }
      });
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        findTikTokUrlsInJson(obj[key]);
      }
    }
  }

  function findRedditUrlsInJson(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.fallback_url && typeof obj.fallback_url === 'string') {
      checkUrl(cleanUrl(obj.fallback_url));
    }
    if (obj.hls_url && typeof obj.hls_url === 'string') {
      checkUrl(cleanUrl(obj.hls_url));
    }
    if (obj.scrubber_media_url && typeof obj.scrubber_media_url === 'string') {
      checkUrl(cleanUrl(obj.scrubber_media_url));
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        findRedditUrlsInJson(obj[key]);
      }
    }
  }

  function shouldInspect(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('graphql') ||
      lower.includes('/api/') ||
      lower.includes('playlist') ||
      lower.includes('manifest') ||
      lower.includes('master') ||
      lower.includes('stream') ||
      lower.includes('embed') ||
      lower.includes('player') ||
      lower.includes('source') ||
      lower.includes('video') ||
      lower.includes('twitter.com') ||
      lower.includes('x.com') ||
      lower.includes('instagram.com') ||
      lower.includes('facebook.com') ||
      lower.includes('twimg.com') ||
      lower.includes('fbcdn.net') ||
      lower.includes('cdninstagram.com') ||
      lower.includes('tiktok.com') ||
      lower.includes('byteoversea.com') ||
      lower.includes('tiktokcdn.com') ||
      lower.includes('reddit.com') ||
      lower.includes('v.redd.it') ||
      lower.includes('twitch.tv') ||
      lower.includes('ttvnw.net') ||
      lower.includes('.m3u8')
    );
  }

  // Hook HTMLMediaElement & HTMLSourceElement src setters so dynamic videos are captured at runtime
  try {
    const origMediaSrcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (origMediaSrcDesc && origMediaSrcDesc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set: function (val) {
          if (typeof val === 'string') checkUrl(val);
          return origMediaSrcDesc.set.call(this, val);
        },
        get: origMediaSrcDesc.get,
        configurable: true,
        enumerable: true
      });
    }

    const origSourceSrcDesc = Object.getOwnPropertyDescriptor(HTMLSourceElement.prototype, 'src');
    if (origSourceSrcDesc && origSourceSrcDesc.set) {
      Object.defineProperty(HTMLSourceElement.prototype, 'src', {
        set: function (val) {
          if (typeof val === 'string') checkUrl(val);
          return origSourceSrcDesc.set.call(this, val);
        },
        get: origSourceSrcDesc.get,
        configurable: true,
        enumerable: true
      });
    }
  } catch {}

  // Hook XMLHttpRequest
  try {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__maxvideo_url = typeof url === 'string' ? url : '';
      checkUrl(this.__maxvideo_url);
      return origOpen.apply(this, arguments);
    };

    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', function () {
        try {
          const u = this.__maxvideo_url || '';
          if (shouldInspect(u) && this.responseText) {
            inspectResponseBody(this.responseText, u);
          }
        } catch {}
      });
      return origSend.apply(this, arguments);
    };
  } catch {}

  // Hook Fetch safely (synchronous wrapper returning exact promise without unhandled rejections)
  try {
    const origFetch = window.fetch;
    window.__maxvideo_origFetch = origFetch;
    window.fetch = function (input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
        checkUrl(url);
      } catch {}

      const promise = origFetch.apply(this, arguments);

      if (promise && typeof promise.then === 'function') {
        promise
          .then((response) => {
            try {
              const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
              if (shouldInspect(url) && response && typeof response.clone === 'function') {
                const clone = response.clone();
                clone.text().then((text) => inspectResponseBody(text, url)).catch(() => {});
              }
            } catch {}
          })
          .catch(() => {}); // Passive tap, never re-throws or alters promise rejection
      }

      return promise;
    };
  } catch {}

  // Helper to inspect JWPlayer, Video.js, and web player instances on page
  function inspectPagePlayerInstances() {
    try {
      if (typeof window.jwplayer === 'function') {
        const player = window.jwplayer();
        if (player && typeof player.getPlaylist === 'function') {
          const pl = player.getPlaylist();
          if (Array.isArray(pl)) {
            pl.forEach((item) => {
              if (item.file) checkUrl(item.file);
              if (Array.isArray(item.sources)) {
                item.sources.forEach((s) => {
                  if (s.file) checkUrl(s.file);
                });
              }
            });
          }
        }
      }
    } catch {}

    try {
      if (typeof window.videojs === 'function' && typeof window.videojs.getAllPlayers === 'function') {
        const players = window.videojs.getAllPlayers();
        players.forEach((p) => {
          if (p && typeof p.currentSrc === 'function') {
            const src = p.currentSrc();
            if (src) checkUrl(src);
          }
        });
      }
    } catch {}
  }

  // Hook Hls.js dynamic loader
  function hookHlsJs() {
    try {
      if (window.Hls && window.Hls.prototype && window.Hls.prototype.loadSource && !window.Hls.prototype.__maxvideo_hooked) {
        window.Hls.prototype.__maxvideo_hooked = true;
        const origLoadSource = window.Hls.prototype.loadSource;
        window.Hls.prototype.loadSource = function (url) {
          if (typeof url === 'string') checkUrl(url);
          return origLoadSource.apply(this, arguments);
        };
      }
    } catch {}
  }
  hookHlsJs();
  setInterval(hookHlsJs, 2000);

  // Listen for active queries from content script (world: ISOLATED)
  window.addEventListener('MAXVIDEO_QUERY_PAGE_MEDIA', () => {
    try {
      // 1. Immediately emit all accumulated sniffed media in batch to isolated content script
      if (window.__maxvideo_sniffedMedia && window.__maxvideo_sniffedMedia.length > 0) {
        window.dispatchEvent(
          new CustomEvent('MAXVIDEO_SNIFFED_MEDIA_BATCH', {
            detail: { media: window.__maxvideo_sniffedMedia }
          })
        );
      }

      inspectPagePlayerInstances();

      // Do NOT check og:video on Instagram because it holds a static generic 3-second branding clip
      if (!window.location.hostname.includes('instagram.com')) {
        const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]');
        if (ogVideo && ogVideo.content && !isBlacklistedMedia(ogVideo.content)) {
          checkUrl(ogVideo.content);
        }
      }

      const scripts = document.querySelectorAll('script');
      scripts.forEach((s) => {
        const txt = s.textContent || '';
        if (!txt) return;

        // Search for .m3u8 URLs directly in scripts
        const m3u8Matches = txt.match(/https?:\\?\/\\?\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
        if (m3u8Matches) {
          m3u8Matches.forEach((m) => checkUrl(cleanUrl(m)));
        }

        // Search for direct video URLs (.mp4, .webm, .mkv, .mov, .ts)
        const videoMatches = txt.match(/https?:\\?\/\\?\/[^\s"'<>]+\.(?:mp4|webm|mkv|mov|ts)[^\s"'<>]*/g);
        if (videoMatches) {
          videoMatches.forEach((m) => checkUrl(cleanUrl(m)));
        }

        // Search for jwplayer / player configurations: file: "...", sources: [...]
        const fileMatches = txt.match(/["']file["']\s*:\s*["']([^"']+)["']/g);
        if (fileMatches) {
          fileMatches.forEach((fm) => {
            const val = fm.match(/:\s*["']([^"']+)["']/);
            if (val && val[1]) checkUrl(cleanUrl(val[1]));
          });
        }

        if (txt.includes('.mp4') || txt.includes('.m3u8')) {
          inspectResponseBody(txt, window.location.href);
        }
      });
    } catch {}
  });

  // Provide in-page YouTube playerResponse & sniffed playback streams if available
  window.addEventListener('MAXVIDEO_REQUEST_YT_INPAGE', () => {
    try {
      let pr = null;
      let audioTracks = null;
      let currentAudioTrack = null;
      const moviePlayer = document.getElementById('movie_player');
      if (moviePlayer && typeof moviePlayer.getPlayerResponse === 'function') {
        pr = moviePlayer.getPlayerResponse();
      }
      if (!pr && window.ytInitialPlayerResponse) {
        pr = window.ytInitialPlayerResponse;
      }
      if (!pr && window.ytplayer && window.ytplayer.config && window.ytplayer.config.args) {
        const raw = window.ytplayer.config.args.raw_player_response;
        if (typeof raw === 'string') {
          try { pr = JSON.parse(raw); } catch {}
        } else if (raw) {
          pr = raw;
        }
      }

      if (moviePlayer && typeof moviePlayer.getAvailableAudioTracks === 'function') {
        try { audioTracks = moviePlayer.getAvailableAudioTracks(); } catch {}
      }
      if (moviePlayer && typeof moviePlayer.getAudioTrack === 'function') {
        try { currentAudioTrack = moviePlayer.getAudioTrack(); } catch {}
      }

      // If no video stream has been sniffed yet, gently trigger playback to buffer streams
      const hasVideoSniffed = (window.__maxvideo_sniffedMedia || []).some((m) => m.url && m.url.includes('googlevideo.com') && (m.url.includes('aitags') || m.url.includes('mime=video')));
      if (!hasVideoSniffed && moviePlayer && typeof moviePlayer.playVideo === 'function') {
        const state = typeof moviePlayer.getPlayerState === 'function' ? moviePlayer.getPlayerState() : -1;
        if (state !== 1) { // not already playing
          moviePlayer.playVideo();
          setTimeout(() => {
            if (typeof moviePlayer.pauseVideo === 'function') {
              moviePlayer.pauseVideo();
            }
          }, 350);
        }
      }

      window.dispatchEvent(new CustomEvent('MAXVIDEO_RESPONSE_YT_INPAGE', {
        detail: {
          playerResponse: pr,
          audioTracks: audioTracks,
          currentAudioTrack: currentAudioTrack,
          sniffedMedia: window.__maxvideo_sniffedMedia || []
        }
      }));
    } catch {}
  });

  function getInPageVisitorData() {
    try {
      if (window.ytcfg) {
        if (typeof window.ytcfg.get === 'function') {
          const v = window.ytcfg.get('VISITOR_DATA');
          if (v) return v;
        }
        if (window.ytcfg.data_ && window.ytcfg.data_.VISITOR_DATA) {
          return window.ytcfg.data_.VISITOR_DATA;
        }
      }
      if (window.yt && window.yt.config_ && window.yt.config_.VISITOR_DATA) {
        return window.yt.config_.VISITOR_DATA;
      }
    } catch {}
    try {
      const scripts = document.getElementsByTagName('script');
      for (let i = 0; i < scripts.length; i++) {
        const txt = scripts[i].textContent || '';
        const m = txt.match(/"VISITOR_DATA":"([^"]+)"/) || txt.match(/"visitorData":"([^"]+)"/);
        if (m) return m[1];
      }
    } catch {}
    return null;
  }

})();
