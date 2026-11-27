// The JS embed: <script src="https://HOST/embed.js" data-project="PROJECT_ID" async></script>
// Optional: data-position="left", data-open="true". Exposes window.RAGPulse = { open, close, toggle }.
// Vanilla, dependency free; the chat iframe is only created on first open so host pages stay fast.

const SCRIPT = /* js */ `(function () {
  var s = document.currentScript;
  if (!s || (window.RAGPulse && window.RAGPulse._v)) return;
  var pid = s.getAttribute('data-project');
  var base;
  try { base = new URL(s.src).origin; } catch (e) { return; }
  if (!pid) return;
  var queue = [];
  var api = { _v: 1 };
  ['open', 'close', 'toggle'].forEach(function (k) { api[k] = function () { queue.push(k); }; });
  window.RAGPulse = api;

  function okHost(list) {
    if (location.origin === base) return true;
    return (list || []).some(function (p) {
      p = String(p).toLowerCase();
      var h = (/:\\d+$/.test(p) ? location.host : location.hostname).toLowerCase();
      if (p.indexOf('*.') === 0) { p = p.slice(2); return h === p || h.slice(-p.length - 1) === '.' + p; }
      return h === p;
    });
  }

  function ink(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    var n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.45 ? '#0b0d12' : '#fff';
  }

  function safe(c, d) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : d; }

  function init(cfg) {
    var t = cfg.theme || {};
    var a = safe(t.accent, '#7c5cff'), b = safe(t.accent2, a), hl = safe(t.highlight, a);
    var side = (s.getAttribute('data-position') || t.position) === 'left' ? 'left' : 'right';
    // Launcher and panel corner radii per chat style
    var sq = t.style === 'square', lr = sq ? '0' : '50%', pr = sq ? '0' : t.style === 'round' ? '28px' : t.style === 'glass' ? '24px' : '20px';
    var host = document.createElement('div');
    host.setAttribute('data-ragpulse', '');
    host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;' + side + ':0;width:0;height:0';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    var e = 'cubic-bezier(.2,.8,.2,1)';
    root.innerHTML = '<style>' +
      '.w{all:initial;font-family:system-ui,sans-serif}' +
      '.l{position:fixed;bottom:20px;' + side + ':20px;width:58px;height:58px;border-radius:' + lr + ';border:0;padding:0;margin:0;cursor:pointer;display:grid;place-items:center;' +
      'background:linear-gradient(135deg,' + a + ',' + b + ');color:' + ink(a) + ';box-shadow:0 12px 32px -8px rgba(0,0,0,.4),0 2px 6px rgba(0,0,0,.14);transition:transform .25s ' + e + '}' +
      '.l:hover{transform:scale(1.06)}.l:active{transform:scale(.95)}.l:focus-visible{outline:3px solid ' + hl + ';outline-offset:3px}' +
      '.l svg{position:absolute;width:26px;height:26px;transition:transform .35s ' + e + ',opacity .2s}' +
      '.x,.o .c{opacity:0;transform:rotate(-90deg) scale(.4)}.o .c{transform:rotate(90deg) scale(.4)}.o .x{opacity:1;transform:none}' +
      '.p{position:fixed;bottom:90px;' + side + ':20px;width:400px;height:640px;max-height:calc(100vh - 110px);border-radius:' + pr + ';overflow:hidden;' +
      'background:' + (t.mode === 'light' ? '#fff' : '#0d0f14') + ';box-shadow:0 28px 80px -16px rgba(0,0,0,.5),0 0 0 1px rgba(127,127,127,.15);' +
      'opacity:0;visibility:hidden;transform:translateY(14px) scale(.97);transform-origin:bottom ' + side + ';' +
      'transition:opacity .2s,transform .3s ' + e + ',visibility 0s .3s}' +
      '.o .p{opacity:1;visibility:visible;transform:none;transition-delay:0s}' +
      '.p iframe{width:100%;height:100%;border:0;display:block}' +
      '@media (max-width:519px),(pointer:coarse) and (orientation:landscape) and (max-height:519px){.p{inset:var(--viewport-top,0px) 0 auto;width:100%;height:var(--viewport-height,100%);max-height:none;border-radius:0}.o .l{transform:scale(0);pointer-events:none}}' +
      '@media (prefers-reduced-motion:reduce){.l,.l svg,.p{transition:none}}' +
      '</style><div class="w"><div class="p" role="dialog" aria-label="Chat"></div>' +
      '<button class="l" type="button" aria-label="Open chat" aria-expanded="false">' +
      '<svg class="c" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.6A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>' +
      '<svg class="x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
      '</button></div>';
    document.body.appendChild(host);
    var w = root.querySelector('.w'), btn = root.querySelector('.l'), panel = root.querySelector('.p'), frame = null, isOpen = false;
    var viewport = window.visualViewport, viewportFrame;

    // Only follow the visual viewport at scale 1 (keyboard open, no pinch-zoom).
    // While pinch-zoomed, fixed elements stay laid out against the layout viewport and the
    // browser pans over them; sizing to the zoomed visual viewport's height without its
    // width/offsetLeft would leave a panel that is too short and misplaced.
    function fitViewport() {
      if (viewport.scale === 1) {
        panel.style.setProperty('--viewport-top', viewport.offsetTop + 'px');
        panel.style.setProperty('--viewport-height', viewport.height + 'px');
      } else {
        panel.style.removeProperty('--viewport-top');
        panel.style.removeProperty('--viewport-height');
      }
    }

    // WebKit can update visualViewport after dispatching the event.
    function scheduleViewportFit() {
      if (viewportFrame !== undefined) return;
      viewportFrame = window.requestAnimationFrame(function () {
        viewportFrame = window.requestAnimationFrame(function () {
          viewportFrame = undefined;
          fitViewport();
        });
      });
    }

    function open() {
      if (isOpen) return;
      if (!frame) {
        frame = document.createElement('iframe');
        frame.title = (t.botName || cfg.title || 'Chat');
        frame.allow = 'clipboard-write';
        frame.src = base + '/chat/' + encodeURIComponent(pid) + '?embed=1&parent=' + encodeURIComponent(location.origin);
        panel.appendChild(frame);
      }
      isOpen = true;
      if (viewport) {
        fitViewport();
        viewport.addEventListener('resize', scheduleViewportFit);
        viewport.addEventListener('scroll', scheduleViewportFit);
        window.addEventListener('scroll', scheduleViewportFit, { passive: true });
      }
      visibility(true);
      w.classList.add('o');
      btn.setAttribute('aria-expanded', 'true');
      btn.setAttribute('aria-label', 'Close chat');
      setTimeout(function () { try { frame.focus(); } catch (x) {} }, 250);
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      if (viewport) {
        viewport.removeEventListener('resize', scheduleViewportFit);
        viewport.removeEventListener('scroll', scheduleViewportFit);
        window.removeEventListener('scroll', scheduleViewportFit);
      }
      if (viewportFrame !== undefined) {
        window.cancelAnimationFrame(viewportFrame);
        viewportFrame = undefined;
      }
      visibility(false);
      w.classList.remove('o');
      btn.setAttribute('aria-expanded', 'false');
      btn.setAttribute('aria-label', 'Open chat');
      btn.focus();
    }
    function toggle() { isOpen ? close() : open(); }
    // Lets the chat know whether the visitor can see it (answers are emailed to visitors who don't)
    function visibility(visible) { try { frame.contentWindow.postMessage({ type: 'ragpulse:visibility', open: visible }, base); } catch (x) {} }

    btn.addEventListener('click', toggle);
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') close(); });
    window.addEventListener('message', function (ev) {
      if (ev.origin !== base || !frame || ev.source !== frame.contentWindow) return;
      if (ev.data && ev.data.type === 'ragpulse:close') close();
    });

    api.open = open; api.close = close; api.toggle = toggle;
    if (s.getAttribute('data-open') === 'true') open();
    queue.forEach(function (k) { api[k](); });
  }

  fetch(base + '/api/chat/' + encodeURIComponent(pid) + '/config')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (!cfg || !okHost(cfg.allowedHosts)) return;
      if (document.body) init(cfg);
      else document.addEventListener('DOMContentLoaded', function () { init(cfg); });
    })
    .catch(function () {});
})();
`

const MINIFIED = SCRIPT.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//"))
    .join("\n")

export default defineEventHandler((event) => {
    setResponseHeaders(event, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Access-Control-Allow-Origin": "*"
    })
    return MINIFIED
})
