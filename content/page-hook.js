// MaxVideo Pro - Page-level Media Sniffer (Main World)
// Intercepts real media stream URLs from YouTube, Twitter, Instagram, Facebook, and HTML5 players

(function () {
  'use strict';

  const reportedUrls = new Set();
  window.__maxvideo_sniffedMedia = window.__maxvideo_sniffedMedia || [];

  function reportMedia(url, platform, extra = {}) {
    if (!url || typeof url !== 'string') return;
    url = url.trim();
    const key = `${platform}:${url}`;
    if (reportedUrls.has(key)) return;
    reportedUrls.add(key);

    const item = {
      url,
      platform,
      timestamp: Date.now(),
      ...extra
    };
    if (window.__maxvideo_sniffedMedia) {
      window.__maxvideo_sniffedMedia.push(item);
    }

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
    // Blacklist static branding/promo clips, tracking pixels, and assets
    if (lower.startsWith('blob:') || lower.startsWith('data:')) return true;
    if (lower.includes('static.cdninstagram.com')) return true;
    if (lower.includes('/rsrc.php/')) return true;
    if (lower.includes('instagram_branding')) return true;
    if (lower.includes('static.xx.fbcdn.net')) return true;
    if (lower.includes('/embed/') || lower.includes('.htm') || lower.includes('.html')) return true;
    if (lower.match(/\.(jpg|jpeg|png|webp|gif|ico|svg)(\?.*)?$/i)) return true;
    return false;
  }

  function checkUrl(url) {
    if (!url || typeof url !== 'string' || isBlacklistedMedia(url)) return;
    const host = window.location.hostname;

    // 1. YouTube: googlevideo.com/videoplayback
    if (url.includes('googlevideo.com/videoplayback')) {
      const clean = stripByteRangeParams(cleanUrl(url));
      let itag = null;
      try {
        const u = new URL(clean);
        itag = parseInt(u.searchParams.get('itag'), 10);
      } catch {}
      reportMedia(clean, 'youtube', { itag });
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
    // 5. Generic direct MP4 / WebM / MKV
    else if (url.match(/\.(mp4|webm|mkv|mov)(\?.*)?$/i) && !url.includes('/embed/')) {
      const fullUrl = stripByteRangeParams(cleanUrl(url));
      reportMedia(fullUrl, 'generic');
    }
  }

  function inspectResponseBody(text, requestUrl) {
    if (!text || typeof text !== 'string') return;

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

  function shouldInspect(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    return (
      lower.includes('graphql') ||
      lower.includes('/api/') ||
      lower.includes('twitter.com') ||
      lower.includes('x.com') ||
      lower.includes('instagram.com') ||
      lower.includes('facebook.com') ||
      lower.includes('twimg.com') ||
      lower.includes('fbcdn.net') ||
      lower.includes('cdninstagram.com')
    );
  }

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

  // Hook Fetch
  try {
    const origFetch = window.fetch;
    window.__maxvideo_origFetch = origFetch;
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      checkUrl(url);

      const response = await origFetch.apply(this, arguments);

      try {
        if (shouldInspect(url) && response && typeof response.clone === 'function') {
          const clone = response.clone();
          clone.text().then((text) => inspectResponseBody(text, url)).catch(() => {});
        }
      } catch {}

      return response;
    };
  } catch {}

  // Listen for active queries from content script (world: ISOLATED)
  window.addEventListener('MAXVIDEO_QUERY_PAGE_MEDIA', () => {
    try {
      // Do NOT check og:video on Instagram because it holds a static generic 3-second branding clip
      if (!window.location.hostname.includes('instagram.com')) {
        const ogVideo = document.querySelector('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]');
        if (ogVideo && ogVideo.content && !isBlacklistedMedia(ogVideo.content)) {
          checkUrl(ogVideo.content);
        }
      }

      const scripts = document.querySelectorAll('script:not([src])');
      scripts.forEach((s) => {
        const txt = s.textContent || '';
        if (txt.includes('.mp4')) {
          inspectResponseBody(txt, window.location.href);
        }
      });
    } catch {}
  });

  // Provide in-page YouTube playerResponse & sniffed playback streams if available
  window.addEventListener('MAXVIDEO_REQUEST_YT_INPAGE', () => {
    try {
      let pr = null;
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
