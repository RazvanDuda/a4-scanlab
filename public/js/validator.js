/* Mobile validator: camera scanning (BarcodeDetector with ZXing fallback). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const video = $('video');
  const scanmsg = $('scanmsg');

  let session = null;       // {code,title,items}
  let results = {};         // n -> {status:'pass'|'warn'|'fail', raw, format, time, attempts}
  let mode = 'auto';
  let selectedN = null;
  let filterTbdOnly = false;
  let stream = null;
  let detector = null;
  let zxingReader = null;
  let rafId = null;
  let lastResult = { text: '', t: 0 };
  let running = false;

  const norm = (s) => (s == null ? '' : String(s)
    .replace(/[\s()\[\]{},;\u001d\u001e\u0004\u001c]/g, '')
    .replace(/^(http[s]?:\/\/[^\/]+\/v\/)/, '')
    .toUpperCase());

  // ---------- storage ----------
  function saveResults() {
    if (!session) return;
    try { localStorage.setItem('pt_results_' + session.code, JSON.stringify(results)); } catch (_) {}
  }
  function loadResults() {
    try { results = JSON.parse(localStorage.getItem('pt_results_' + session.code) || '{}'); }
    catch (_) { results = {}; }
  }

  // ---------- session ----------
  async function loadSession(code) {
    code = (code || $('codeInput').value).trim().toUpperCase();
    if (!code) { msg($('sessMsg'), 'Enter the session code printed on the sheet.'); return; }
    $('sessMsg').textContent = 'Loading…';
    try {
      const r = await fetch('/api/sessions/' + code);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'not found');
      session = j;
      loadResults();
      $('stepSession').style.display = 'none';
      $('stepTest').style.display = '';
      document.body.classList.add('scanning');
      $('sheetTitle').textContent = j.title;
      $('codeLabel').textContent = 'Session ' + j.code;
      buildList();
      updateCounts();
      startCamera();
      location.hash = j.code;
      window.__lastCode = j.code;
      saveSessionCode(j.code);
    } catch (e) {
      msg($('sessMsg'), '⚠ ' + e.message);
    }
  }

  function saveSessionCode(code) {
    try { localStorage.setItem('pt_last_validator', code); } catch (_) {}
  }

  function msg(el, text, cls) {
    el.textContent = text;
    el.className = 'muted small ' + (cls || '');
  }

  // ---------- checklist ----------
  function buildList() {
    const list = $('itemlist');
    list.innerHTML = '';
    session.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'item';
      row.dataset.n = item.n;
      row.innerHTML =
        '<div class="num">' + item.n + '</div>' +
        '<div class="info"><div class="nm">' + esc(item.name) +
        (item.visualOnly ? ' <span class="badge">visual only</span>' : '') + '</div>' +
        '<div class="vl">' + esc(item.expected) + '</div></div>' +
        '<div class="st tbd">—</div>';
      row.addEventListener('click', () => {
        if (mode !== 'manual') return;
        selectedN = item.n;
        [...list.children].forEach(c => c.classList.remove('selected'));
        row.classList.add('selected');
        $('manualbar').style.display = '';
        setScanMsg('Selected #' + item.n + ' ' + item.name + ' — scan it now, or mark manually', 'warn');
      });
      list.appendChild(row);
    });
    refreshList();
  }

  function refreshList() {
    if (!session) return;
    [...$('itemlist').children].forEach(row => {
      const n = +row.dataset.n;
      const item = session.items.find(i => i.n === n);
      const r = results[n];
      const st = row.querySelector('.st');
      st.className = 'st ' + (r ? r.status : 'tbd');
      st.textContent = r ? (r.status === 'pass' ? 'PASS' : r.status === 'warn' ? 'WARN' : 'FAIL') : '—';
      const hidden = filterTbdOnly && r && r.status === 'pass';
      row.style.display = hidden ? 'none' : '';
      if (selectedN === n && mode === 'manual') row.classList.add('selected');
    });
  }

  function updateCounts() {
    const t = session.items.length;
    let p = 0, w = 0, f = 0;
    Object.values(results).forEach(r => {
      if (r.status === 'pass') p++; else if (r.status === 'warn') w++; else if (r.status === 'fail') f++;
    });
    $('counts').textContent = p + '/' + t + ' passed' + (w ? ' · ' + w + ' warn' : '') + (f ? ' · ' + f + ' fail' : '');
    const cp = $('camProg');
    if (cp) cp.textContent = '✅ ' + p + ' · ⚠ ' + w + ' · ✖ ' + f + '  (' + Math.round(((p + w) / t) * 100) + '%)';
    $('progfill').style.width = Math.round(((p + w) / t) * 100) + '%';
    $('progfill').style.background = f ? 'var(--warn)' : 'var(--ok)';
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // ---------- matching ----------
  const digitsMod10 = (d) => { // EAN/UPC/GS1 check digit over payload (without check)
    let sum = 0;
    for (let i = d.length - 1, w = 3; i >= 0; i--, w = 4 - w) sum += (+d[i]) * w;
    return (10 - sum % 10) % 10;
  };
  function expandUPCE(e) { // 8-digit UPC-E (NS + 6 data + check) → 12-digit UPC-A payload
    if (!/^\d{8}$/.test(e)) return null;
    const ns = e[0], d1 = e[1], d2 = e[2], d3 = e[3], d4 = e[4], d5 = e[5], d6 = e[6];
    let upca;
    if (d6 <= '2') upca = ns + d1 + d2 + d6 + '00000' + d3 + d4;
    else if (d6 <= '4') upca = ns + d1 + d2 + d3 + d4 + '00000' + d6;
    else upca = ns + d1 + d2 + d3 + d4 + d5 + '0000' + d6;
    return upca.length === 11 ? upca : null; // 11-digit UPC-A payload (+ check digit added by caller)
  }
  function valuesMatch(expected, t) {
    const e = norm(expected);
    if (e === t) return true;
    // digit symbologies: tolerate check-digit expansion returned by zxing-cpp
    if (/^\d+$/.test(e) && /^\d+$/.test(t)) {
      if (t === e + digitsMod10(e)) return true;            // EAN-13/8, ITF-14: payload + check
      // UPC-A ↔ EAN-13 leading-zero equivalence — either side may already carry its check digit
      const e2 = (e.length === 13 && e[0] === '0') ? e.slice(1) : e;
      const t2 = (t.length === 13 && t[0] === '0') ? t.slice(1) : t;
      if (t2 === e2) return true;
      if (t2 === e2 + digitsMod10(e2)) return true;
      if (t === '0' + e + digitsMod10(e)) return true;      // UPC-A payload scanned as EAN-13
      const x = expandUPCE(e);                              // UPC-E scanned as UPC-A / EAN-13 expansion
      if (x && (t === x + digitsMod10(x) || t === '0' + x + digitsMod10(x))) return true;
    }
    return false;
  }
  function matchScanned(rawText, rawFormat) {
    const t = norm(rawText);
    const fmt = (rawFormat || '').toUpperCase().replace(/^PDF_?417$/, 'PDF_417');
    let matched = null;

    if (mode === 'manual' && selectedN != null) {
      matched = { item: session.items.find(i => i.n === selectedN) };
    } else {
      // auto: find item still needing verification (failed ones can be re-tested)
      const cands = session.items.filter(i => {
        const r = results[i.n];
        return (!r || r.status === 'fail') &&
          (valuesMatch(i.expected, t) || (i.accepts || []).some(a => valuesMatch(a, t)));
      });
      if (cands.length === 1) matched = { item: cands[0] };
      else if (cands.length > 1) {
        const byFmt = cands.find(i => i.detector.concat(i.zxing).includes(fmt));
        matched = { item: byFmt || cands[0], ambiguous: cands.length > 1 };
      } else {
        // already passed? no untested match at all?
        const passed = session.items.find(i => {
          const r = results[i.n];
          return r && (r.status === 'pass' || r.status === 'warn') && (valuesMatch(i.expected, t) || (i.accepts || []).some(a => valuesMatch(a, t)));
        });
        if (passed) { setScanMsg('✔ ' + passed.name + ' (#' + passed.n + ') already verified', 'ok'); return; }
        setScanMsg('✖ No match in this sheet: "' + short(rawText) + '" (' + fmt + ')', 'bad');
        beep(false);
        return;
      }
    }

    const item = matched.item;
    const valOk = valuesMatch(item.expected, t) || (item.accepts || []).some(a => valuesMatch(a, t));
    const fmtOk = item.detector.concat(item.zxing).includes(fmt) || fmt === '';
    const prev = results[item.n];
    const entry = {
      status: valOk && fmtOk ? 'pass' : valOk ? 'warn' : 'fail',
      raw: rawText, format: fmt, time: new Date().toISOString(),
      attempts: ((prev && prev.attempts) || 0) + 1
    };
    // keep a fail once recorded unless new attempt is better
    if (prev && prev.status === 'pass') {
      setScanMsg('✔ ' + item.name + ' (#' + item.n + ') already verified', 'ok');
      return;
    }
    results[item.n] = (!prev || rank(entry.status) < rank(prev.status)) ? entry : prev;
    saveResults();
    refreshList();
    updateCounts();
    refreshManualBar();

    const label = item.name + ' (#' + item.n + ')';
    if (entry.status === 'pass') {
      setScanMsg('✔ PASS — ' + label, 'ok');
      beep(true);
      flashRow(item.n);
      if (mode === 'manual') { selectedN = null; [...$('itemlist').children].forEach(c => c.classList.remove('selected')); refreshManualBar(); }
    } else if (entry.status === 'warn') {
      setScanMsg('⚠ ' + label + ' — value OK but symbology read as ' + fmt, 'warn');
      beep(true);
      flashRow(item.n);
    } else {
      setScanMsg('✖ FAIL — ' + label + ' scanned as "' + short(rawText) + '"', 'bad');
      beep(false);
    }
  }
  function rank(s) { return { pass: 0, warn: 1, fail: 2 }[s]; }

  function refreshManualBar() {
    $('manualbar').style.display = (mode === 'manual' && selectedN != null) ? '' : 'none';
  }

  function markManual(status) {
    if (selectedN == null) return;
    const item = session.items.find(i => i.n === selectedN);
    const prev = results[item.n];
    results[item.n] = {
      status, raw: '(manual entry)', format: 'MANUAL',
      time: new Date().toISOString(), attempts: ((prev && prev.attempts) || 0) + 1
    };
    saveResults();
    refreshList(); updateCounts(); refreshManualBar();
    setScanMsg((status === 'pass' ? '✔' : status === 'warn' ? '⚠' : '✖') + ' Marked ' +
      status.toUpperCase() + ' — ' + item.name + ' (#' + item.n + ')', status === 'pass' ? 'ok' : status === 'warn' ? 'warn' : 'bad');
    beep(status === 'fail');
    selectedN = null;
    [...$('itemlist').children].forEach(c => c.classList.remove('selected'));
    refreshManualBar();
  }
  function short(s) { s = String(s); return s.length > 28 ? s.slice(0, 26) + '…' : s; }
  function flashRow(n) {
    const row = [...$('itemlist').children].find(c => +c.dataset.n === n);
    if (!row) return;
    row.classList.add('flash-ok');
    setTimeout(() => row.classList.remove('flash-ok'), 750);
    // scroll inside the checklist container only — the page itself must never jump
    const list = $('itemlist');
    const top = row.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - row.offsetHeight) {
      list.scrollTop = top - list.clientHeight / 3;
    }
  }
  function setScanMsg(text, cls) {
    scanmsg.textContent = text;
    scanmsg.className = cls || '';
  }

  function beep(ok) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = ok ? 880 : 220;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      o.start(); o.stop(ctx.currentTime + 0.12);
      if (navigator.vibrate) navigator.vibrate(ok ? 80 : [80, 60, 80]);
      setTimeout(() => ctx.close(), 300);
    } catch (_) {}
  }

  // ---------- camera ----------
  async function startCamera() {
    if (running) return;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanMsg('⚠ Camera blocked: this page is not HTTPS (iOS/Chrome only expose the camera over HTTPS). Reopen the https://… URL printed by the server (accept the certificate warning), or tap a checklist item in One-by-one mode and use the manual result buttons.', 'bad');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      initTorch();
      await initScanner();
    } catch (e) {
      setScanMsg('⚠ Camera unavailable: ' + e.message + ' — use manual result buttons via checklist tap? (needs camera permission)', 'bad');
    }
  }

  async function initScanner() {
    // Preferred: native BarcodeDetector (Android Chrome, fast & robust)
    if ('BarcodeDetector' in window) {
      const wanted = ['code_39','code_93','code_128','ean_13','ean_8','itf','codabar','upc_a','upc_e','qr_code','data_matrix','pdf417','aztec'];
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const use = wanted.filter(f => supported.includes(f));
        detector = new window.BarcodeDetector({ formats: use });
        $('engineNote').textContent = 'Scanner: native BarcodeDetector (' + use.length + ' formats)' +
          (use.length < 13 ? ' — some formats not supported on this device' : '');
        loopDetector();
        return;
      } catch (_) {}
    }
    // Fallback 1: zxing-wasm (zxing-cpp core — reads every sheet symbology incl. Code 93 / UPC-E)
    if (window.ZXingWASM && window.WebAssembly) {
      try {
        window.ZXingWASM.setZXingModuleOverrides({ locateFile: (f) => '/vendor/' + f });
        const opts = {
          formats: ['Code39','Code93','Code128','EAN13','EAN8','UPCA','UPCE','ITF','Codabar','QRCode','MicroQRCode','DataMatrix','PDF417','MicroPDF417','Aztec','MaxiCode','DataBar','DataBarOmni','DataBarExp','Telepen','TelepenNumeric'],
          tryHarder: true, tryRotate: true, tryDownscale: true, tryInvert: true
        };
        wasmFrameLoop(opts);
        $('engineNote').textContent = 'Scanner: zxing-cpp (WASM)';
        return;
      } catch (e) {
        console.warn('zxing-wasm init failed, falling back to ZXing JS:', e);
      }
    }
    // Fallback 2: ZXing JS port (legacy)
    try {
      const ZX = window.ZXing;
      const formats = ['CODE_39','CODE_93','CODE_128','EAN_13','EAN_8','ITF','CODABAR','UPC_A','UPC_E','QR_CODE','DATA_MATRIX','PDF_417','AZTEC','MAXICODE']
        .map(f => ZX.BarcodeFormat[f]).filter(v => v !== undefined);
      const hints = new Map();
      hints.set(ZX.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(ZX.DecodeHintType.TRY_HARDER, true);
      zxingReader = new ZXing.BrowserMultiFormatReader(hints, 150);
      $('engineNote').textContent = 'Scanner: ZXing (fallback)';
      zxingReader.decodeFromVideoElementContinuously(video, (res) => {
        if (res) handleDecode(res.getText(), String(ZX.BarcodeFormat[res.getBarcodeFormat()]));
      });
    } catch (e) {
      setScanMsg('⚠ Scanner init failed: ' + e.message, 'bad');
    }
  }

  // zxing-cpp frame loop: draw video to an offscreen canvas, decode via WASM
  async function wasmFrameLoop(opts) {
    const full = document.createElement('canvas');
    const fctx = full.getContext('2d', { willReadFrequently: true });
    const aux = document.createElement('canvas');
    const actx = aux.getContext('2d', { willReadFrequently: true });
    let step = 0, backoff = 0;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    while (running && !detector) {
      if (!video.videoWidth) { await sleep(200); continue; }
      if (full.width !== video.videoWidth || full.height !== video.videoHeight) {
        full.width = video.videoWidth; full.height = video.videoHeight;
      }
      fctx.drawImage(video, 0, 0, full.width, full.height);

      // Adaptive sizing: cycle strategies so both small and very large barcodes get
      // enough pixels — 0: full frame, 1: 2× center-crop zoom (small codes), 2: 0.5× downscale (huge codes).
      const strat = step++ % 3;
      let srcCtx = fctx, w = full.width, h = full.height;
      if (strat === 1) {
        const cw = Math.round(full.width * 0.55), ch = Math.round(full.height * 0.55);
        aux.width = full.width; aux.height = full.height;
        actx.fillStyle = '#ffffff'; actx.fillRect(0, 0, aux.width, aux.height);
        actx.drawImage(full, (full.width - cw) / 2, (full.height - ch) / 2, cw, ch, 0, 0, aux.width, aux.height);
        srcCtx = actx; w = aux.width; h = aux.height;
      } else if (strat === 2) {
        aux.width = Math.round(full.width / 2); aux.height = Math.round(full.height / 2);
        actx.drawImage(full, 0, 0, aux.width, aux.height);
        srcCtx = actx; w = aux.width; h = aux.height;
      }
      try {
        const img = srcCtx.getImageData(0, 0, w, h);
        const found = await window.ZXingWASM.readBarcodes({ width: img.width, height: img.height, data: img.data }, opts);
        if (found && found.length) {
          backoff = 0;
          const d = found[0];
          handleDecode(d.text, normalizeFormat(d.format));
        }
        await sleep(strat === 0 ? 320 : 380);
      } catch (e) {
        if (++backoff > 3) { setScanMsg('⚠ WASM scanner error: ' + e.message, 'bad'); return; }
        await sleep(300);
      }
    }
  }

  async function loopDetector() {
    if (!running || !detector) return;
    try {
      const found = await detector.detect(video);
      if (found && found.length) {
        const d = found[0];
        const fmt = (d.format || '').toUpperCase();
        handleDecode(d.rawValue, fmt);
      }
    } catch (_) { /* transient */ }
    rafId = requestAnimationFrame(() => setTimeout(loopDetector, 160));
  }

  function handleDecode(text, format) {
    const now = Date.now();
    const key = norm(text) + '|' + format;
    if (key === lastResult.text && now - lastResult.t < 2500) return; // debounce same code
    lastResult = { text: key, t: now };
    matchScanned(text, normalizeFormat(format));
  }

  // unify detector names (code_128) with zxing names (CODE_128) and zxing-cpp names (Code128)
  function normalizeFormat(f) {
    let n = (f || '').toUpperCase().replace(/_/g, '_');
    const map = {
      CODE128: 'CODE_128', CODE39: 'CODE_39', CODE93: 'CODE_93',
      EAN13: 'EAN_13', EAN8: 'EAN_8', UPCA: 'UPC_A', UPCE: 'UPC_E',
      QRCODE: 'QR_CODE', MICROQRCODE: 'MICRO_QR', DATAMATRIX: 'DATA_MATRIX',
      PDF417: 'PDF_417', MICROPDF417: 'MICRO_PDF_417', AZTECCODE: 'AZTEC',
      DATABAR: 'DATA_BAR', DATABAROMNI: 'DATA_BAR', DATABAREXP: 'DATA_BAR_EXP',
      TELEPEN: 'TELEPEN', TELEPENNUMERIC: 'TELEPEN', TELEPENALPHA: 'TELEPEN'
    };
    return map[n] || n;
  }

  function initTorch() {
    const track = stream && stream.getVideoTracks()[0];
    if (track && track.getCapabilities && track.getCapabilities().torch) {
      const btn = $('torchBtn');
      btn.style.display = '';
      let on = false;
      btn.onclick = async () => {
        on = !on;
        try { await track.applyConstraints({ advanced: [{ torch: on }] }); btn.style.background = on ? '#ffd54a' : ''; }
        catch (_) {}
      };
    }
  }

  // ---------- QR scan for session code ----------
  async function scanSessionQR() {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setScanMsg('⚠ Camera blocked: this page is not HTTPS — reopen via the https://… URL printed by the server, or enter the 4-letter session code manually.', 'bad');
      return;
    }
    $('qrScanBox').style.display = 'block';
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = $('qrvideo');
      v.srcObject = s; await v.play();
      const stopAll = () => { s.getTracks().forEach(t => t.stop()); $('qrScanBox').style.display = 'none'; };
      const tryDetect = async () => {
        if (!$('qrScanBox').style.display || $('qrScanBox').style.display === 'none') return;
        try {
          if ('BarcodeDetector' in window) {
            const det = new window.BarcodeDetector({ formats: ['qr_code'] });
            const found = await det.detect(v);
            if (found.length && found[0].rawValue) {
              const url = found[0].rawValue;
              const m = url.match(/\/v\/([A-Z0-9]{3,8})/i);
              stopAll();
              if (m) { $('codeInput').value = m[1]; loadSession(m[1]); return; }
              $('codeInput').value = url.trim().toUpperCase();
              loadSession(url.trim()); return;
            }
          } else if (window.ZXing) {
            const ZX = window.ZXing;
            const reader = new ZXing.BrowserMultiFormatReader();
            // one-shot decode via canvas
            const c = document.createElement('canvas');
            c.width = v.videoWidth; c.height = v.videoHeight;
            if (c.width) {
              c.getContext('2d').drawImage(v, 0, 0);
              try {
                const res = await reader.decodeFromImageUrl(c.toDataURL('image/png'));
                const url = res.getText();
                const m = url.match(/\/v\/([A-Z0-9]{3,8})/i);
                stopAll();
                if (m) { $('codeInput').value = m[1]; loadSession(m[1]); }
                else { $('codeInput').value = url.trim().toUpperCase(); loadSession(url.trim()); }
                return;
              } catch (_) {}
            }
          }
        } catch (_) {}
        setTimeout(tryDetect, 250);
      };
      tryDetect();
    } catch (e) {
      msg($('sessMsg'), '⚠ Camera unavailable: ' + e.message);
      $('qrScanBox').style.display = 'none';
    }
  }

  // ---------- report ----------
  function buildReport() {
    const lines = [];
    lines.push('=== BARCODE PRINT VALIDATION REPORT ===');
    lines.push('Sheet   : ' + session.title);
    lines.push('Session : ' + session.code);
    lines.push('Date    : ' + new Date().toLocaleString());
    lines.push('Scanner : ' + (($('engineNote').textContent || '').replace('Scanner: ', '')));
    let p = 0, w = 0, f = 0;
    session.items.forEach(item => {
      const r = results[item.n];
      const st = r ? r.status.toUpperCase() : 'UNTESTED';
      if (r) { if (r.status === 'pass') p++; else if (r.status === 'warn') w++; else f++; }
      lines.push('----');
      lines.push('#' + item.n + ' ' + item.name + ' [' + st + ']');
      lines.push('   expected: ' + item.expected);
      if (r) lines.push('   scanned : "' + r.raw + '" as ' + (r.format || '?') + ' (' + r.attempts + ' attempt' + (r.attempts > 1 ? 's' : '') + ')');
    });
    lines.push('====');
    lines.push('RESULT: ' + p + ' passed, ' + w + ' warnings, ' + f + ' failed, ' +
      (session.items.length - p - w - f) + ' untested / ' + session.items.length);
    return lines.join('\n');
  }

  // ---------- wiring ----------
  $('loadBtn').onclick = () => loadSession();
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSession(); });
  $('scanQRBtn').onclick = scanSessionQR;
  $('resetsess').onclick = () => {
    stopCamera();
    session = null; results = {}; selectedN = null;
    try { localStorage.removeItem('pt_results_' + (window.__lastCode || '')); } catch (_) {}
    $('manualbar').style.display = 'none';
    $('stepTest').style.display = 'none';
    document.body.classList.remove('scanning');
    $('stepSession').style.display = '';
    $('sessMsg').textContent = '';
    history.replaceState(null, '', location.pathname);
  };
  $('modeAuto').onclick = () => setMode('auto');
  $('modeManual').onclick = () => setMode('manual');
  function setMode(m) {
    mode = m;
    selectedN = null;
    $('modeAuto').classList.toggle('active', m === 'auto');
    $('modeManual').classList.toggle('active', m === 'manual');
    refreshManualBar();
    setScanMsg(m === 'auto' ? 'Auto-match: scan any code on the sheet' : 'Tap an item in the checklist, then scan it (or mark manually)');
  }
  $('markPass').onclick = () => markManual('pass');
  $('markWarn').onclick = () => markManual('warn');
  $('markFail').onclick = () => markManual('fail');
  $('listBtn').onclick = () => $('checkPanel').classList.toggle('open');
  $('closeList').onclick = () => $('checkPanel').classList.remove('open');
  $('resetBtn2').onclick = () => $('resetsess').click();
  $('filterAll').onclick = () => { filterTbdOnly = false; $('filterBadge').textContent = ''; refreshList(); };
  $('filterTbd').onclick = () => { filterTbdOnly = true; $('filterBadge').textContent = 'untested'; refreshList(); };
  $('reportBtn').onclick = () => {
    if (!session) return;
    $('resultpre').value = buildReport();
    $('report').style.display = '';
    window.scrollTo({ top: 0 });
  };
  $('closeReport').onclick = () => { $('report').style.display = 'none'; };
  $('copyReport').onclick = async () => {
    try { await navigator.clipboard.writeText($('resultpre').value); $('copyReport').textContent = 'Copied ✔'; setTimeout(() => $('copyReport').textContent = 'Copy report', 1500); }
    catch (_) { $('resultpre').select(); document.execCommand('copy'); }
  };

  function stopCamera() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (zxingReader) { try { zxingReader.reset(); } catch (_) {} zxingReader = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    video.srcObject = null;
  }

  // auto-load from hash
  const h = location.hash.replace('#', '').trim().toUpperCase();
  if (/^[A-Z0-9]{3,8}$/.test(h)) {
    $('codeInput').value = h;
    loadSession(h);
  } else {
    const last = localStorage.getItem('pt_last_validator');
    if (last) $('codeInput').value = last;
  }
})();
