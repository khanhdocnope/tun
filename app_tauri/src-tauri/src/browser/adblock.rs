pub const ADBLOCK_SCRIPT: &str = r#"
(function() {
  'use strict';
  if (window.__MOEJECT_ADBLOCK_INITIALIZED__) return;
  window.__MOEJECT_ADBLOCK_INITIALIZED__ = true;

  const AD_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'google-analytics.com', 'googleadservices.com',
    'exoclick.com', 'propellerads.com', 'popads.net', 'adsterra.com', 'monetag.com',
    'yadro.ru', 'adcash.com', 'juicyads.com', 'trafficjunky.com', 'tsyndicate.com',
    'adtng.com', 'clickadu.com', 'mgid.com', 'taboola.com', 'outbrain.com',
    'adnxs.com', 'criteo.com', 'pubmatic.com', 'rubiconproject.com', 'openx.net',
    'smartadserver.com', 'bidswitch.net', 'sharethrough.com', 'sovrn.com',
    'bet365', '1xbet', 'fun88', 'w88', 'fb88', 'kubet', 'shbet', 'jun88', 'new88',
    'casino', 'gamble', 'game-bai', 'nhacai', 'keonhacai'
  ];

  const AD_PATH_REGEX = /(?:[/?&_.-])(?:ads?|banner|pop(?:under|up)?|sponsor|pixel|telemetry|analytics|affiliate|track(?:er|ing)?|promo|vast|vpaid)(?:[/?&_.-]|$)/i;

  function isAdUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const lower = url.toLowerCase();
    for (let i = 0; i < AD_DOMAINS.length; i++) {
      if (lower.includes(AD_DOMAINS[i])) return true;
    }
    if (lower.includes('gold-usergeneratedcontent') || lower.includes('mangadex') || lower.includes('cuutruyen')) {
      return false;
    }
    return AD_PATH_REGEX.test(lower);
  }

  // 1. Popup & Popunder Blocker
  const originalOpen = window.open;
  window.open = function(url, target, features) {
    if (!url || isAdUrl(url) || target === '_blank') {
      console.warn('[MoeJect AdBlock] Chặn mở tab/cửa sổ quảng cáo popup:', url);
      return null;
    }
    return originalOpen.call(window, url, target, features);
  };

  // 2. Fetch Blocker
  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      if (isAdUrl(url)) {
        return Promise.resolve(new Response('', { status: 204, statusText: 'No Content' }));
      }
      return originalFetch.apply(this, arguments);
    };
  }

  // 3. XMLHttpRequest Blocker
  if (window.XMLHttpRequest) {
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      if (isAdUrl(url)) {
        this._isBlockedAd = true;
      }
      return origOpen.apply(this, arguments);
    };
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
      if (this._isBlockedAd) {
        return;
      }
      return origSend.apply(this, arguments);
    };
  }

  // 4. Anti-Adblock Defusers (AdBlock evasion bypass)
  window.canRunAds = true;
  window.isAdBlockActive = false;
  window.fuckAdBlock = {
    on: function(isAdblock, callback) { if (!isAdblock && typeof callback === 'function') callback(); return this; },
    check: function() { return false; },
    clearEvent: function() {}
  };
  window.BlockAdBlock = window.fuckAdBlock;

  // 5. Cosmetic CSS rules injection (Hides banners, floats, and overlay ads)
  const CSS_RULES = `
    .ad, .ads, .adsbox, .ad-box, .ad-banner, .banner-ad, .ad-container,
    .advertisement, .advertising, .ads-holder, .ad-wrapper,
    [id^="ad-"], [id^="ads-"], [class^="ad-"], [class*=" ad-"],
    [id*="google_ads"], [id*="aswift"], [class*="sponsored"],
    .taboola, .outbrain, .mgid, .rc-anchor,
    iframe[src*="ad"], iframe[src*="track"], iframe[src*="banner"],
    div[style*="z-index: 2147483647"][style*="position: fixed"],
    div[style*="z-index: 999999"][style*="position: fixed"]:not(#moeject-sniffer) {
      display: none !important;
      visibility: hidden !important;
      height: 0 !important;
      width: 0 !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;

  function injectStyles() {
    const style = document.createElement('style');
    style.id = 'moeject-adblock-styles';
    style.textContent = CSS_RULES;
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectStyles);
  } else {
    injectStyles();
  }

  // 6. DOM Mutation Observer to strip newly added ad iframes & clickjackers
  const observer = new MutationObserver(function(mutations) {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          if (node.tagName === 'IFRAME' || node.tagName === 'SCRIPT') {
            const src = node.getAttribute('src') || '';
            if (isAdUrl(src)) {
              node.remove();
            }
          }
        }
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
"#;
