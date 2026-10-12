/* FoodDiary — camera barcode scanner.
   Uses the browser's built-in BarcodeDetector where it supports retail barcodes (Android Chrome),
   otherwise the ZXing-C++ WebAssembly engine from the `barcode-detector` package (iPhone/iPad, where
   Safari has no BarcodeDetector). Replaced html5-qrcode in 1.18.0, which decodes in plain JavaScript
   and was slow to pick up codes on iOS.
   Speed comes from: native/WASM decoding, a high-resolution rear camera with continuous autofocus,
   decoding a centre crop rather than the full frame, and only accepting codes whose check digit is valid. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Scanner = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIB_VERSION = '3.2.2';
  const LIB_URL = `https://cdn.jsdelivr.net/npm/barcode-detector@${LIB_VERSION}/dist/iife/ponyfill.min.js`;
  // Fallback: the address documented in the library's README (latest v3), in case the pinned copy is unavailable.
  const LIB_URL_FALLBACK = 'https://fastly.jsdelivr.net/npm/barcode-detector@3/dist/iife/ponyfill.min.js';
  const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

  /* ---------- check digits (pure; unit-tested in Node) ---------- */
  // GS1 mod-10 check for EAN-8, UPC-A (12), EAN-13. Other lengths are passed through as valid.
  function validRetailCode(code) {
    const s = String(code || '').replace(/\D/g, '');
    if (![8, 12, 13].includes(s.length)) return s.length >= 6; // UPC-E (6-8) / Code 128: trust the decoder
    const digits = s.split('').map(Number);
    const check = digits.pop();
    let sum = 0;
    // weight 3 for positions counted from the right (excluding the check digit), starting at 3
    for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
    return (10 - (sum % 10)) % 10 === check;
  }

  /* ---------- engine ---------- */
  let detectorPromise = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`) && window.BarcodeDetectionAPI) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = () => { s.remove(); rej(new Error('Could not load the scanner')); }; // remove so a later retry really retries
      document.head.appendChild(s);
    });
  }
  async function getDetector() {
    if (detectorPromise) return detectorPromise;
    detectorPromise = (async () => {
      // 1) Native (Android Chrome) if it can read retail barcodes
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          if (supported.includes('ean_13')) return { detector: new window.BarcodeDetector({ formats: FORMATS.filter((f) => supported.includes(f)) }), engine: 'native' };
        } catch (e) { /* fall through */ }
      }
      // 2) ZXing-C++ WebAssembly (iPhone / iPad / desktop Safari / Firefox)
      try { await loadScript(LIB_URL); } catch (e) { await loadScript(LIB_URL_FALLBACK); }
      const api = window.BarcodeDetectionAPI;
      if (!api || !api.BarcodeDetector) throw new Error('Scanner engine unavailable');
      // Serve the .wasm from the same CDN host as the script so the service worker caches it for offline use,
      // and start fetching it now rather than on the first frame.
      if (api.prepareZXingModule) {
        try {
          api.prepareZXingModule({
            overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') && api.ZXING_WASM_VERSION ? `https://cdn.jsdelivr.net/npm/zxing-wasm@${api.ZXING_WASM_VERSION}/dist/reader/${path}` : prefix + path) },
            fireImmediately: true
          });
        } catch (e) { /* use defaults */ }
      }
      return { detector: new api.BarcodeDetector({ formats: FORMATS }), engine: 'wasm' };
    })();
    detectorPromise.catch(() => { detectorPromise = null; }); // allow retry after a failed load
    return detectorPromise;
  }

  /* ---------- camera + loop ---------- */
  // Start scanning inside `container`. Calls onCode(digits) once, then stops itself.
  // Returns a controller { stop(), engine }.
  async function start(container, onCode, { onStatus } = {}) {
    const video = document.createElement('video');
    video.setAttribute('playsinline', ''); video.setAttribute('muted', ''); video.muted = true; video.autoplay = true;
    video.className = 'scan-video';
    container.innerHTML = ''; container.appendChild(video);
    let stream = null, stopped = false, raf = 0;
    const stop = () => {
      stopped = true; cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      stream = null; video.srcObject = null;
    };
    // Load the decoder and open the camera in parallel
    const detP = getDetector();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' }] }
    });
    if (stopped) { stream.getTracks().forEach((t) => t.stop()); return { stop, engine: null }; }
    video.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    try { // continuous autofocus where the browser allows it (ignored elsewhere)
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.focusMode && caps.focusMode.includes('continuous')) await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch (e) { /* not supported */ }
    await video.play().catch(() => {});
    if (onStatus) onStatus('loading');
    const { detector, engine } = await detP;
    if (stopped) return { stop, engine };
    if (onStatus) onStatus('ready', engine);

    // Decode a centre crop (where people hold the barcode), scaled to a sensible width.
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let busy = false, lastCode = '', lastHits = 0;
    const tick = async () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);
      if (busy || video.readyState < 2 || !video.videoWidth) return;
      busy = true;
      try {
        const vw = video.videoWidth, vh = video.videoHeight;
        const cw = Math.round(vw * 0.9), ch = Math.round(vh * 0.6);
        const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
        const scale = Math.min(1, 1280 / cw);
        const tw = Math.round(cw * scale), th = Math.round(ch * scale);
        if (canvas.width !== tw || canvas.height !== th) { canvas.width = tw; canvas.height = th; } // resizing every frame re-allocates the canvas
        ctx.drawImage(video, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height);
        const found = await detector.detect(canvas);
        const hit = (found || []).map((b) => String(b.rawValue || '').replace(/\D/g, '')).find((c) => c && validRetailCode(c));
        if (hit && !stopped) {
          // Native/WASM decoders plus a valid check digit are reliable; for Code 128 (no check digit here) wait for a second matching read.
          const needsConfirm = ![8, 12, 13].includes(hit.length);
          if (hit === lastCode) lastHits++; else { lastCode = hit; lastHits = 1; }
          if (!needsConfirm || lastHits >= 2) { stop(); onCode(hit); return; }
        }
      } catch (e) { /* a bad frame — keep going */ }
      busy = false;
    };
    raf = requestAnimationFrame(tick);
    return { stop, engine };
  }

  // Start loading the decoder early (e.g. when the Add screen opens) so the first scan is quick.
  function warmUp() { getDetector().catch(() => {}); }

  return { start, warmUp, validRetailCode, LIB_URL, LIB_URL_FALLBACK, FORMATS };
});
