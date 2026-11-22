/* Generator page: build A4 sheet + session manifest. */
(function () {
  'use strict';

  const DEFAULT_SELECTED = new Set([
    'code39', 'code93', 'code128', 'gs1-128', 'ean13', 'ean8', 'upca', 'upce',
    'itf14', 'i2of5', 'codabar', 'qr', 'dm', 'gs1dm', 'pdf417', 'aztec'
  ]);
  const SIZES = { s: { 1: 2, 2: 2 }, m: { 1: 3, 2: 4 }, l: { 1: 4, 2: 6 } }; // {1d,2d} scale
  const ONE_D = ['code39','code93','code128','gs1-128','ean13','ean8','upca','upce',
    'itf14','i2of5','codabar','msi','code11','pharma','telepen','databar'];

  const symListEl = document.getElementById('symList');
  const sheetHolder = document.getElementById('sheetHolder');
  const statusEl = document.getElementById('genStatus');
  const printBtn = document.getElementById('print');
  const rows = []; // {sel: checkbox, val: input, sym}

  function rowEl(sym) {
    const div = document.createElement('div');
    div.className = 'sym-row';
    const sel = document.createElement('input');
    sel.type = 'checkbox'; sel.checked = DEFAULT_SELECTED.has(sym.id);
    const name = document.createElement('span');
    name.innerHTML = '<span class="grp' + (sym.group === '2D' ? ' two' : '') + '">' + sym.group + '</span> ' +
      sym.name + (sym.note ? ' <span class="muted small">(' + sym.note + ')</span>' : '');
    const val = document.createElement('input');
    val.type = 'text'; val.className = 'val'; val.value = sym.value; val.spellcheck = false;
    sel.addEventListener('change', () => div.classList.toggle('off', !sel.checked));
    val.addEventListener('focus', () => { if (!sel.checked) { sel.checked = true; div.classList.remove('off'); } });
    div.append(sel, name, val);
    rows.push({ sel, val, sym });
    return div;
  }

  window.SYMBOLOGIES.forEach(s => symListEl.appendChild(rowEl(s)));

  function setAll(fn) {
    rows.forEach(r => { const on = fn(r.sym); r.sel.checked = on; r.sym && (r.val.closest('.sym-row').classList.toggle('off', !on)); });
  }
  document.getElementById('selAll').onclick = () => setAll(() => true);
  document.getElementById('selNone').onclick = () => setAll(() => false);
  document.getElementById('selDefaults').onclick = () => setAll(s => DEFAULT_SELECTED.has(s.id));

  // ---- value/manifest helpers ----
  function computeExpected(sym, value) {
    let expected = value;
    const d = sym.checkDigit ? window.gs1CheckDigit(value) : null;
    if (sym.id === 'ean13' || sym.id === 'ean8' || sym.id === 'upca' || sym.id === 'itf14') expected = value + d;
    const accepts = [expected];
    if (sym.id === 'upce') accepts.push(value.replace(/^0/, '')); // some scanners drop leading 0
    return { expected, accepts };
  }

  function bwipOpts(sym, scale) {
    const o = { bcid: sym.bwip, scale };
    if (ONE_D.includes(sym.id)) {
      o.height = 10; o.includetext = true; o.textsize = 8; o.textyoffset = -4;
      if (sym.id === 'gs1-128' || sym.id === 'databar') o.parsefnc = true;
      if (sym.id === 'code93') o.includecheck = true; // scanners (ZXing) verify the C/K check chars when decoding
    }
    if (sym.id === 'maxicode') { o.mode = 4; }
    if (sym.id === 'qr' || sym.id === 'dm' || sym.id === 'gs1dm') o.parse = false;
    return o;
  }

  function renderCanvas(canvas, sym, value, scale) {
    const o = bwipOpts(sym, scale);
    o.text = value;
    // bwip-js does not add quiet zones — scanners (esp. EAN/UPC/DataMatrix/I2of5) need them.
    // Render to a temp canvas, then composite onto a white canvas with a proper margin.
    const tmp = document.createElement('canvas');
    window.bwipjs.toCanvas(tmp, o);
    const is2D = !ONE_D.includes(sym.id);
    const pad = Math.max(6, Math.round((is2D ? 2 : 4) * scale)); // ≥4 modules for 1D, ≥2 for 2D
    canvas.width = tmp.width + pad * 2;
    canvas.height = tmp.height + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(tmp, pad, pad);
  }

  // ---- test strip: line-pair resolution test ----
  function buildStrip() {
    const div = document.createElement('div');
    div.className = 'strip';
    div.innerHTML = '<b style="font-size:8pt">Print-quality test strip</b>' +
      '<div class="muted small" style="font-size:7pt">Each pair should show crisp, distinct lines with no ink spread / bleed. Numbers = gap in printer dots (1 dot = 1/600", 1 dot = 1/300").</div>';
    for (const dots of [8, 6, 5, 4, 3, 2]) {
      const row = document.createElement('div');
      row.className = 'row';
      const lbl = document.createElement('div');
      lbl.className = 'lbl';
      lbl.textContent = dots + ' dot gap';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '120mm'); svg.setAttribute('height', '6mm');
      svg.setAttribute('viewBox', '0 0 600 6');
      svg.style.maxWidth = '100%';
      let pattern = '';
      for (let x = 0; x < 600; x += dots * 2) pattern += 'M' + x + ' 0h' + dots + 'v6h-' + dots + 'z';
      svg.innerHTML = '<path d="' + pattern + '" fill="#000"/>';
      row.append(lbl, svg);
      div.appendChild(row);
    }
    return div;
  }

  // ---- generate ----
  async function generate() {
    const chosen = rows.filter(r => r.sel.checked);
    if (!chosen.length) { statusEl.textContent = 'Select at least one barcode type.'; return; }

    statusEl.textContent = 'Creating test session…';
    const opts = {
      cols: +document.getElementById('cols').value,
      size: document.getElementById('size').value,
      extras: document.getElementById('extras').value,
      host: document.getElementById('hostOverride').value.trim()
    };
    const title = document.getElementById('title').value || 'A4 Barcode Test Sheet';

    const items = chosen.map((r, i) => {
      const sym = r.sym;
      const value = r.val.value.trim() || sym.value;
      const { expected, accepts } = computeExpected(sym, value);
      return {
        n: i + 1, id: sym.id, name: sym.name, group: sym.group,
        value, expected, accepts,
        zxing: sym.zxing, detector: sym.detector,
        note: sym.note || '', visualOnly: sym.zxing.length === 0 && sym.detector.length === 0
      };
    });

    let code = null;
    let sessErr = '';
    try {
      const r = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, opts, items })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'session failed');
      code = j.code;
    } catch (e) {
      sessErr = ' — ⚠ session create failed (' + e.message + '): sheet still prints, but the phone validator has no checklist for it. Fix the server connection and regenerate.';
    }

    renderSheet({ code, title, opts, items });
    statusEl.textContent = 'Sheet ready — ' + items.length + ' codes' +
      (code ? ' · session ' + code : '') + '. Now press Print.' + sessErr;
    printBtn.disabled = false;
    localStorage.setItem('pt_last', code || '');
    sheetHolder.scrollIntoView({ behavior: 'smooth' });
  }

  let httpsCfg = null; // { https, httpsPort } from /api/config
  fetch('/api/config').then(r => r.json()).then(c => { httpsCfg = c; }).catch(() => {});

  function validatorURL(code, opts) {
    const host = (opts && opts.host) || location.host || 'localhost:' + (location.port || '80');
    if (location.protocol !== 'https:' && httpsCfg && httpsCfg.https) {
      // Phone camera requires HTTPS — point the QR at the server's https:// listener.
      const hostname = location.hostname || host.split(':')[0];
      return 'https://' + hostname + ':' + httpsCfg.httpsPort + '/v/' + code;
    }
    const proto = location.protocol === 'https:' ? 'https' : 'http';
    return proto + '://' + host + '/v/' + code;
  }

  function renderSheet(man) {
    const { code, title, opts, items } = man;
    const size = SIZES[opts.size] || SIZES.m;
    sheetHolder.innerHTML = '';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';

    // header
    const head = document.createElement('div');
    head.className = 'sheet-head';
    const qrWrap = document.createElement('div');
    qrWrap.className = 'qr';
    if (code) {
      const qc = document.createElement('canvas');
      try {
        window.bwipjs.toCanvas(qc, { bcid: 'qrcode', text: validatorURL(code, opts), scale: 4 });
        qc.style.width = '26mm'; qc.style.height = '26mm';
        qrWrap.appendChild(qc);
        const ql = document.createElement('div');
        ql.className = 'small'; ql.style.textAlign = 'center';
        ql.textContent = 'Scan to verify on phone';
        qrWrap.appendChild(ql);
      } catch (_) { /* ignore */ }
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = '<b>' + escapeHtml(title) + '</b><br>' +
      'Printed: ' + new Date().toLocaleString() +
      (code ? ' · Session: <b>' + code + '</b>' : ' · <i>(offline: no session)</i>') + '<br>' +
      items.length + ' codes · validate one by one at ' + (code ? validatorURL(code, opts) : (location.origin + '/validate'));
    head.append(qrWrap, meta);
    sheet.appendChild(head);

    // grid
    const grid = document.createElement('div');
    grid.className = 'sheet-grid';
    grid.style.setProperty('--cols', opts.cols);

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.item = item.n;
      const num = document.createElement('div');
      num.className = 'num'; num.textContent = item.n + '/' + items.length;
      const chk = document.createElement('div'); chk.className = 'chk';
      const type = document.createElement('div');
      type.className = 'type'; type.textContent = item.name;
      const val = document.createElement('div');
      val.className = 'value'; val.textContent = item.value;
      const cv = document.createElement('canvas');
      const scale = ONE_D.includes(item.id) ? size[1] : size[2];
      card.append(num, chk, type, val, cv);
      try {
        renderCanvas(cv, window.SYMBOLOGIES.find(s => s.id === item.id), item.value, scale);
        if (item.visualOnly) {
          const vn = document.createElement('div'); vn.className = 'vnote';
          vn.textContent = 'visual check only (no phone scanner for this type)';
          card.appendChild(vn);
        }
      } catch (e) {
        cv.replaceWith(errEl('Render error: ' + e.message.split('\n')[0]));
      }
      grid.appendChild(card);
    });
    sheet.appendChild(grid);

    if (opts.extras === 'strip') sheet.appendChild(buildStrip());
    sheetHolder.appendChild(sheet);
  }

  function errEl(msg) {
    const d = document.createElement('div');
    d.className = 'err'; d.textContent = msg;
    return d;
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  document.getElementById('generate').onclick = generate;
  document.getElementById('print').onclick = () => window.print();

  // restore last session link for convenience
  const last = localStorage.getItem('pt_last');
  if (last) {
    const st = document.getElementById('genStatus');
    st.innerHTML = 'Last session: <a href="/v/' + last + '" target="_blank" rel="noopener">' + last + '</a> (open on phone)';
  }
})();
