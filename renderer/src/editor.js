/**
 * Siluet Editörü — lamba ekranından ayrı, tam ekran boyama alanı.
 *
 * Belge: 2048×2048 hedef görüntü (beyaz = duvarda ışık, siyah = gölge).
 * Katmanlar (alttan üste):
 *   - Arka plan: düzenlemeye başlanan siluet (gri, 1 bayt/piksel)
 *   - Resim katmanları: taşınabilir/ölçeklenebilir/döndürülebilir resimler,
 *     "çarp" kipinde birleşir (siyah gölge ekler, beyaz şeffaf kalır)
 *   - Boya: fırça, şekil, kova ve metin buraya çizilir (0 boş, 1 gölge, 2 ışık)
 * Geri al / ileri al: her işlemden önce durum anlık görüntüsü.
 */
(function (global) {
  'use strict';

  const N = 2048;
  const HISTORY = 20;   // 2048² belgede adım başına ~8 MB
  const PAINT_NONE = 0, PAINT_DARK = 1, PAINT_LIGHT = 2;

  const TOOLS = [
    { id: 'brush',   key: 'B', label: 'Gölge fırçası', icon: '✎' },
    { id: 'light',   key: 'L', label: 'Işık fırçası',  icon: '✧' },
    { id: 'erase',   key: 'E', label: 'Silgi (boyayı siler)', icon: '⌫' },
    { id: 'fill',    key: 'G', label: 'Kova (alan doldur)', icon: '◩' },
    { id: 'line',    key: 'I', label: 'Çizgi',         icon: '╱' },
    { id: 'rect',    key: 'R', label: 'Dikdörtgen',    icon: '▭' },
    { id: 'ellipse', key: 'O', label: 'Elips',         icon: '◯' },
    { id: 'text',    key: 'T', label: 'Metin',         icon: 'T' },
    { id: 'move',    key: 'V', label: 'Taşı (resim katmanı)', icon: '✥' },
    { id: 'hand',    key: 'H', label: 'El (kaydır) — Boşluk tuşu', icon: '✋' },
  ];

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }

  function init(host, hooks) {
    // ---------- durum ----------
    let base = new Uint8Array(N * N).fill(255);
    let paint = new Uint8Array(N * N);
    let layers = [];          // resim katmanları (alttan üste)
    let selected = 'paint';   // 'paint' | 'base' | katman id
    let nextId = 1;
    let tool = 'brush';
    const opt = {
      size: 40, color: 'dark', fillShape: true, symX: false, symY: false, smoothing: 0.35,
      text: 'Merhaba', textSize: 180, grid: false, footprint: true,
    };
    let zoom = 1, panX = 0, panY = 0;
    let undoStack = [], redoStack = [];

    // ---------- yerleşim ----------
    host.innerHTML = '';
    const rail = el('div', { class: 'ed-rail' });
    const stage = el('div', { class: 'ed-stage' });
    const side = el('aside', { class: 'ed-side' });
    host.append(rail, stage, side);

    const view = el('canvas', { class: 'ed-canvas' });
    stage.appendChild(view);
    const vctx = view.getContext('2d');
    const zoomBar = el('div', { class: 'ed-zoombar' });
    stage.appendChild(zoomBar);
    const hint = el('div', { class: 'ed-hint' });
    stage.appendChild(hint);

    const baseCv = Object.assign(document.createElement('canvas'), { width: N, height: N });
    const paintCv = Object.assign(document.createElement('canvas'), { width: N, height: N });
    const bctx = baseCv.getContext('2d', { willReadFrequently: true });
    const pctx = paintCv.getContext('2d', { willReadFrequently: true });

    // Araç çubuğu
    const toolBtns = {};
    TOOLS.forEach((t) => {
      const b = el('button', { class: 'ed-tool', title: `${t.label} (${t.key})`, onclick: () => setTool(t.id) }, t.icon);
      toolBtns[t.id] = b;
      rail.appendChild(b);
    });
    rail.appendChild(el('div', { class: 'ed-rail-sep' }));
    const undoBtn = el('button', { class: 'ed-tool', title: 'Geri al (Ctrl+Z)', onclick: () => undo() }, '↶');
    const redoBtn = el('button', { class: 'ed-tool', title: 'İleri al (Ctrl+Y)', onclick: () => redo() }, '↷');
    rail.append(undoBtn, redoBtn);

    // Yakınlaştırma çubuğu
    const zOut = el('button', { title: 'Uzaklaştır (−)', onclick: () => zoomBy(1 / 1.25) }, '−');
    const zLabel = el('span', { class: 'ed-zoomlabel' }, '100%');
    const zIn = el('button', { title: 'Yakınlaştır (+)', onclick: () => zoomBy(1.25) }, '+');
    const zFit = el('button', { title: 'Sığdır (0)', onclick: () => fit() }, 'Sığdır');
    const z100 = el('button', { title: '%100 (1)', onclick: () => { zoom = 1; panX = panY = 0; render(); } }, '1:1');
    zoomBar.append(zOut, zLabel, zIn, zFit, z100);

    // ---------- yan panel ----------
    function section(title, open) {
      const sec = el('section', { class: 'panel' + (open ? ' open' : '') });
      const head = el('button', { class: 'panel-head' }, `<span>${title}</span><i class="chev"></i>`);
      head.addEventListener('click', () => sec.classList.toggle('open'));
      const body = el('div', { class: 'panel-body' });
      sec.append(head, body);
      side.appendChild(sec);
      return body;
    }
    function numField(parent, label, unit, min, max, step, get, set) {
      const f = el('div', { class: 'field' });
      f.appendChild(el('label', {}, `<span>${label}</span>${unit ? `<small>${unit}</small>` : ''}`));
      const box = el('div', { class: 'numbox' });
      const input = el('input', { type: 'number', min, max, step });
      input.value = get();
      const clamp = (v) => Math.min(max, Math.max(min, v));
      const commit = (v) => { v = clamp(+v); if (!isFinite(v)) v = get(); input.value = v; set(v); };
      input.addEventListener('input', () => { if (isFinite(+input.value)) set(clamp(+input.value)); });
      input.addEventListener('change', () => commit(input.value));
      const dec = el('button', { type: 'button', tabindex: '-1', onclick: () => commit(+input.value - step) }, '−');
      const inc = el('button', { type: 'button', tabindex: '-1', onclick: () => commit(+input.value + step) }, '+');
      box.append(input, dec, inc);
      f.appendChild(box);
      parent.appendChild(f);
      return { input, refresh: () => { input.value = get(); } };
    }
    function checkField(parent, label, get, set) {
      const l = el('label', { class: 'check' });
      const c = el('input', { type: 'checkbox' });
      c.checked = get();
      c.addEventListener('change', () => set(c.checked));
      l.append(c, document.createTextNode(' ' + label));
      parent.appendChild(l);
      return { input: c, refresh: () => { c.checked = get(); } };
    }
    function buttonRow(parent, items) {
      const row = el('div', { class: 'row-buttons' });
      items.forEach(([label, fn, title]) => row.appendChild(el('button', { class: 'small', title: title || label, onclick: fn }, label)));
      parent.appendChild(row);
      return row;
    }

    // Araç ayarları
    const sTool = section('Araç ayarları', true);
    const toolTitle = el('div', { class: 'ed-tooltitle' });
    sTool.appendChild(toolTitle);
    const sizeField = numField(sTool, 'Fırça / çizgi boyutu', 'px  ·  [ ]', 1, 600, 1, () => opt.size, (v) => { opt.size = v; render(); });
    const colorRow = el('div', { class: 'field' });
    colorRow.appendChild(el('label', {}, '<span>Renk (kova, şekil, metin)</span><small>X</small>'));
    const colorSeg = el('div', { class: 'seg-row' });
    const cDark = el('button', { class: 'small', onclick: () => setColor('dark') }, '● Gölge');
    const cLight = el('button', { class: 'small', onclick: () => setColor('light') }, '○ Işık');
    colorSeg.append(cDark, cLight);
    colorRow.appendChild(colorSeg);
    sTool.appendChild(colorRow);
    checkField(sTool, 'Şekilleri dolu çiz', () => opt.fillShape, (v) => { opt.fillShape = v; });
    checkField(sTool, 'Yatay simetri (sol ↔ sağ)', () => opt.symX, (v) => { opt.symX = v; render(); });
    checkField(sTool, 'Dikey simetri (üst ↔ alt)', () => opt.symY, (v) => { opt.symY = v; render(); });
    numField(sTool, 'Fırça yumuşatma', '%', 0, 90, 5, () => Math.round(opt.smoothing * 100), (v) => { opt.smoothing = v / 100; });
    const textWrap = el('div', { class: 'field' });
    textWrap.appendChild(el('label', {}, '<span>Metin</span>'));
    const textInput = el('input', { type: 'text', value: opt.text });
    textInput.addEventListener('input', () => { opt.text = textInput.value; });
    textWrap.appendChild(textInput);
    sTool.appendChild(textWrap);
    numField(sTool, 'Metin boyutu', 'px', 12, 1200, 4, () => opt.textSize, (v) => { opt.textSize = v; });

    // Düzenleme işlemleri
    const sOps = section('Düzenle', true);
    buttonRow(sOps, [
      ['↶ Geri al', () => undo(), 'Ctrl+Z'], ['↷ İleri al', () => redo(), 'Ctrl+Y / Ctrl+Shift+Z'],
    ]);
    buttonRow(sOps, [
      ['Ters çevir', () => op('invert'), 'Gölge ↔ ışık'], ['↔ Yatay çevir', () => op('flipH')], ['↕ Dikey çevir', () => op('flipV')],
    ]);
    buttonRow(sOps, [
      ['⟳ 90°', () => op('rot90')], ['Kalınlaştır', () => op('dilate'), 'Gölgeyi 2 px büyüt (ince yerler baskıda kopmasın)'],
      ['İncelt', () => op('erode'), 'Gölgeyi 2 px küçült'],
    ]);
    buttonRow(sOps, [
      ['Kenar yumuşat', () => op('smooth')], ['Kırıntı temizle', () => op('despeckle'), 'Küçük lekeleri ve delikleri sil'],
      ['Temizle', () => op('clear'), 'Her şeyi sil (beyaz)'],
    ]);
    sOps.appendChild(el('div', { class: 'field-note' }, 'İşlemler tüm katmanları birleştirip arka plana uygular.'));

    // Katmanlar
    const sLayers = section('Katmanlar', true);
    const layerList = el('ul', { class: 'ed-layers' });
    sLayers.appendChild(layerList);
    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/svg+xml,.svg', style: 'display:none' });
    sLayers.appendChild(fileInput);
    buttonRow(sLayers, [
      ['+ Resim ekle…', () => fileInput.click(), 'Resim üzerine resim ekle'],
      ['▲', () => moveLayer(1), 'Yukarı taşı'], ['▼', () => moveLayer(-1), 'Aşağı taşı'],
      ['Çoğalt', () => duplicateLayer()], ['Sil', () => deleteLayer()],
    ]);
    buttonRow(sLayers, [['Tümünü birleştir', () => { snapshot(); flattenIntoBase(); refreshAll(); }, 'Resimleri ve boyayı arka plana işle']]);
    const layerProps = el('div', { class: 'ed-layerprops' });
    sLayers.appendChild(layerProps);

    // Görünüm
    const sView = section('Görünüm', false);
    checkField(sView, 'Izgara', () => opt.grid, (v) => { opt.grid = v; render(); });
    checkField(sView, 'Lamba izi ve ışık merkezi', () => opt.footprint, (v) => { opt.footprint = v; render(); });

    // Kısayollar
    const sKeys = section('Kısayollar', false);
    sKeys.appendChild(el('div', { class: 'field-note' },
      'B gölge · L ışık · E silgi · G kova · I çizgi · R dikdörtgen · O elips · T metin · V taşı · H el<br>'
      + '[ ] fırça boyutu · X renk değiştir · Boşluk+sürükle kaydır · tekerlek yakınlaştır<br>'
      + 'Ctrl+Z geri · Ctrl+Y ileri · + − yakınlaştır · 0 sığdır · 1 %100<br>'
      + 'Taşı aracında: sürükle taşı · Shift+sürükle döndür · Ctrl+tekerlek ölçekle'));

    const actions = el('div', { class: 'ed-actions' });
    actions.append(
      el('button', { class: 'primary', onclick: () => apply() }, 'Lambaya uygula'),
      el('button', { onclick: () => hooks.onClose && hooks.onClose() }, 'Vazgeç'),
    );
    side.appendChild(actions);

    // ---------- yardımcılar ----------

    function setTool(id) {
      tool = id;
      Object.entries(toolBtns).forEach(([k, b]) => b.classList.toggle('active', k === id));
      const t = TOOLS.find((x) => x.id === id);
      toolTitle.textContent = t ? t.label : '';
      textWrap.hidden = id !== 'text';
      hint.textContent = {
        brush: 'Sürükle: gölge boya', light: 'Sürükle: ışık boya (alttakini örter)', erase: 'Sürükle: boya katmanını sil',
        fill: 'Tıkla: alanı doldur', line: 'Sürükle: çizgi', rect: 'Sürükle: dikdörtgen (Shift = kare)',
        ellipse: 'Sürükle: elips (Shift = daire)', text: 'Tıkla: metni yerleştir', move: 'Resim katmanını sürükle · Shift döndür · Ctrl+tekerlek ölçek',
        hand: 'Sürükle: görünümü kaydır',
      }[id] || '';
      view.style.cursor = id === 'hand' ? 'grab' : id === 'move' ? 'move' : 'crosshair';
      render();
    }
    function setColor(c) {
      opt.color = c;
      cDark.classList.toggle('active', c === 'dark');
      cLight.classList.toggle('active', c === 'light');
    }

    function docToScreen(x, y) {
      return [(x - N / 2) * zoom + view.width / 2 + panX, (y - N / 2) * zoom + view.height / 2 + panY];
    }
    function screenToDoc(sx, sy) {
      return [(sx - view.width / 2 - panX) / zoom + N / 2, (sy - view.height / 2 - panY) / zoom + N / 2];
    }
    function eventDoc(e) {
      const r = view.getBoundingClientRect();
      const dpr = view.width / r.width;
      return screenToDoc((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    }

    function zoomBy(f, sx, sy) {
      const cx = sx != null ? sx : view.width / 2, cy = sy != null ? sy : view.height / 2;
      const [dx, dy] = screenToDoc(cx, cy);
      zoom = Math.max(0.1, Math.min(16, zoom * f));
      const [nx, ny] = docToScreen(dx, dy);
      panX += cx - nx; panY += cy - ny;
      render();
    }
    function fit() {
      const m = 40 * (window.devicePixelRatio || 1);
      zoom = Math.min((view.width - m) / N, (view.height - m) / N);
      panX = panY = 0;
      render();
    }

    // ---------- raster işlemleri ----------

    function updateBaseCanvas() {
      const img = bctx.createImageData(N, N);
      for (let i = 0; i < N * N; i++) {
        const v = base[i];
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      bctx.putImageData(img, 0, 0);
    }
    function updatePaintRect(x0, y0, x1, y1) {
      x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
      x1 = Math.min(N, Math.ceil(x1)); y1 = Math.min(N, Math.ceil(y1));
      const w = x1 - x0, h = y1 - y0;
      if (w <= 0 || h <= 0) return;
      const img = pctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = paint[(y0 + y) * N + x0 + x];
          const j = (y * w + x) * 4;
          if (c === PAINT_DARK) { img.data[j] = img.data[j + 1] = img.data[j + 2] = 0; img.data[j + 3] = 255; }
          else if (c === PAINT_LIGHT) { img.data[j] = img.data[j + 1] = img.data[j + 2] = 255; img.data[j + 3] = 255; }
        }
      }
      pctx.putImageData(img, x0, y0);
    }

    function symPoints(x, y) {
      const pts = [[x, y]];
      if (opt.symX) pts.push([N - x, y]);
      if (opt.symY) pts.push([x, N - y]);
      if (opt.symX && opt.symY) pts.push([N - x, N - y]);
      return pts;
    }

    function stamp(cx, cy, r, code) {
      const r2 = r * r;
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          if (dx * dx + dy * dy <= r2) paint[y * N + x] = code;
        }
      }
      updatePaintRect(cx - r - 1, cy - r - 1, cx + r + 2, cy + r + 2);
    }

    function strokeSegment(ax, ay, bx, by, code) {
      const r = Math.max(0.5, opt.size / 2);
      const dist = Math.hypot(bx - ax, by - ay);
      const step = Math.max(0.5, r * 0.3);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= n; i++) {
        const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
        symPoints(x, y).forEach(([px, py]) => stamp(px, py, r, code));
      }
    }

    /** Vektör çizimini (şekil/metin) boya katmanına işle. draw(ctx) tuvale çizer. */
    function rasterize(draw, code) {
      const cv = Object.assign(document.createElement('canvas'), { width: N, height: N });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const variants = [[1, 1]];
      if (opt.symX) variants.push([-1, 1]);
      if (opt.symY) variants.push([1, -1]);
      if (opt.symX && opt.symY) variants.push([-1, -1]);
      variants.forEach(([sx, sy]) => {
        ctx.save();
        ctx.translate(sx < 0 ? N : 0, sy < 0 ? N : 0);
        ctx.scale(sx, sy);
        draw(ctx);
        ctx.restore();
      });
      const a = ctx.getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) if (a[i * 4 + 3] > 127) paint[i] = code;
      updatePaintRect(0, 0, N, N);
    }

    function layerById(id) { return layers.find((l) => l.id === id); }

    function processLayer(L) {
      // Kaynağı griye çevir; isteğe bağlı eşik + ters çevirme. Beyaz = şeffaf (çarp kipi).
      const w = L.orig.width, h = L.orig.height;
      const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(L.orig, 0, 0);
      const d = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < d.data.length; i += 4) {
        let v = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
        if (L.threshold != null) v = v < L.threshold ? 0 : 255;
        if (L.invert) v = 255 - v;
        d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
        d.data[i + 3] = 255;
      }
      ctx.putImageData(d, 0, 0);
      L.src = cv;
    }

    function drawLayer(ctx, L) {
      if (!L.visible) return;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = L.opacity;
      ctx.translate(L.x, L.y);
      ctx.rotate((L.rot * Math.PI) / 180);
      ctx.scale(L.scale * (L.flip ? -1 : 1), L.scale);
      ctx.drawImage(L.src, -L.src.width / 2, -L.src.height / 2);
      ctx.restore();
    }

    function composite(ctx) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, N, N);
      ctx.drawImage(baseCv, 0, 0);
      layers.forEach((L) => drawLayer(ctx, L));
      ctx.drawImage(paintCv, 0, 0);
    }

    function flattenGray() {
      const cv = Object.assign(document.createElement('canvas'), { width: N, height: N });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      composite(ctx);
      const d = ctx.getImageData(0, 0, N, N).data;
      const g = new Uint8Array(N * N);
      for (let i = 0; i < N * N; i++) g[i] = d[i * 4];
      return g;
    }

    function flattenIntoBase() {
      base = flattenGray();
      paint = new Uint8Array(N * N);
      layers = [];
      selected = 'base';
      updateBaseCanvas();
      pctx.clearRect(0, 0, N, N);
    }

    // ---------- geçmiş ----------

    function state() {
      return {
        base: base.slice(),
        paint: paint.slice(),
        layers: layers.map((L) => Object.assign({}, L)),
        selected,
      };
    }
    function restore(s) {
      base = s.base; paint = s.paint;
      layers = s.layers.map((L) => Object.assign({}, L));
      selected = s.selected;
      updateBaseCanvas();
      updatePaintRect(0, 0, N, N);
      refreshAll();
    }
    function snapshot() {
      undoStack.push(state());
      if (undoStack.length > HISTORY) undoStack.shift();
      redoStack = [];
      updateHistoryButtons();
    }
    function undo() {
      if (!undoStack.length) return;
      redoStack.push(state());
      restore(undoStack.pop());
      updateHistoryButtons();
    }
    function redo() {
      if (!redoStack.length) return;
      undoStack.push(state());
      restore(redoStack.pop());
      updateHistoryButtons();
    }
    function updateHistoryButtons() {
      undoBtn.disabled = !undoStack.length;
      redoBtn.disabled = !redoStack.length;
    }

    // ---------- tüm görüntü işlemleri ----------

    function morph(bin, r, grow) {
      // bin: 1 = gölge. Ayrılabilir kare yapı elemanı (yatay + dikey geçiş).
      const tmp = new Uint8Array(N * N), out = new Uint8Array(N * N);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          let v = grow ? 0 : 1;
          for (let k = -r; k <= r; k++) {
            const xx = x + k;
            const b = xx < 0 || xx >= N ? 0 : bin[y * N + xx];
            if (grow ? b : !b) { v = grow ? 1 : 0; break; }
          }
          tmp[y * N + x] = v;
        }
      }
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          let v = grow ? 0 : 1;
          for (let k = -r; k <= r; k++) {
            const yy = y + k;
            const b = yy < 0 || yy >= N ? 0 : tmp[yy * N + x];
            if (grow ? b : !b) { v = grow ? 1 : 0; break; }
          }
          out[y * N + x] = v;
        }
      }
      return out;
    }

    function despeckle(bin, minArea) {
      // Küçük gölge lekelerini ve küçük ışık deliklerini temizle.
      const seen = new Uint8Array(N * N);
      const stack = new Int32Array(N * N);
      for (let s = 0; s < N * N; s++) {
        if (seen[s]) continue;
        const val = bin[s];
        let sp = 0, n = 0;
        const cells = [];
        stack[sp++] = s; seen[s] = 1;
        while (sp) {
          const i = stack[--sp];
          cells.push(i); n++;
          const x = i % N, y = (i / N) | 0;
          const nb = [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1];
          for (const j of nb) if (j >= 0 && !seen[j] && bin[j] === val) { seen[j] = 1; stack[sp++] = j; }
        }
        if (n < minArea) cells.forEach((i) => { bin[i] = 1 - val; });
      }
      return bin;
    }

    function op(name) {
      snapshot();
      const g = flattenGray();
      let out = new Uint8Array(N * N);
      const bin = () => { const b = new Uint8Array(N * N); for (let i = 0; i < N * N; i++) b[i] = g[i] < 128 ? 1 : 0; return b; };
      const fromBin = (b) => { for (let i = 0; i < N * N; i++) out[i] = b[i] ? 0 : 255; };
      if (name === 'invert') for (let i = 0; i < N * N; i++) out[i] = 255 - g[i];
      else if (name === 'flipH') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = g[y * N + (N - 1 - x)];
      else if (name === 'flipV') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = g[(N - 1 - y) * N + x];
      else if (name === 'rot90') for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = g[(N - 1 - x) * N + y];
      else if (name === 'dilate') fromBin(morph(bin(), 2, true));
      else if (name === 'erode') fromBin(morph(bin(), 2, false));
      else if (name === 'despeckle') fromBin(despeckle(bin(), 60));
      else if (name === 'clear') out.fill(255);
      else if (name === 'smooth') {
        const r = 3, b = bin(), tmp = new Float32Array(N * N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          let s = 0, c = 0;
          for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < N) { s += b[y * N + xx]; c++; } }
          tmp[y * N + x] = s / c;
        }
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          let s = 0, c = 0;
          for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < N) { s += tmp[yy * N + x]; c++; } }
          out[y * N + x] = s / c >= 0.5 ? 0 : 255;
        }
      }
      base = out;
      paint = new Uint8Array(N * N);
      layers = [];
      selected = 'base';
      updateBaseCanvas();
      pctx.clearRect(0, 0, N, N);
      refreshAll();
    }

    function floodFill(x, y, code) {
      const g = flattenGray();
      const sx = Math.floor(x), sy = Math.floor(y);
      if (sx < 0 || sy < 0 || sx >= N || sy >= N) return;
      const dark = g[sy * N + sx] < 128;
      const seen = new Uint8Array(N * N);
      const stack = new Int32Array(N * N);
      let sp = 0;
      stack[sp++] = sy * N + sx; seen[sy * N + sx] = 1;
      while (sp) {
        const i = stack[--sp];
        paint[i] = code;
        const px = i % N, py = (i / N) | 0;
        const nb = [px > 0 ? i - 1 : -1, px < N - 1 ? i + 1 : -1, py > 0 ? i - N : -1, py < N - 1 ? i + N : -1];
        for (const j of nb) if (j >= 0 && !seen[j] && (g[j] < 128) === dark) { seen[j] = 1; stack[sp++] = j; }
      }
      updatePaintRect(0, 0, N, N);
    }

    // ---------- katmanlar ----------

    function addImageLayer(img, name) {
      snapshot();
      const L = {
        id: nextId++, name: name || `Resim ${nextId - 1}`, orig: img, src: null,
        x: N / 2, y: N / 2, scale: Math.min(1, (N * 0.6) / Math.max(img.width, img.height)), rot: 0,
        opacity: 1, flip: false, threshold: null, invert: false, visible: true,
      };
      processLayer(L);
      layers.push(L);
      selected = L.id;
      setTool('move');
      refreshAll();
    }
    function moveLayer(dir) {
      const i = layers.findIndex((l) => l.id === selected);
      if (i < 0) return;
      const j = i + dir;
      if (j < 0 || j >= layers.length) return;
      snapshot();
      [layers[i], layers[j]] = [layers[j], layers[i]];
      refreshAll();
    }
    function duplicateLayer() {
      const L = layerById(selected);
      if (!L) return;
      snapshot();
      const C = Object.assign({}, L, { id: nextId++, name: L.name + ' kopya', x: L.x + 20, y: L.y + 20 });
      layers.push(C);
      selected = C.id;
      refreshAll();
    }
    function deleteLayer() {
      if (selected === 'paint') { snapshot(); paint = new Uint8Array(N * N); pctx.clearRect(0, 0, N, N); refreshAll(); return; }
      if (selected === 'base') { snapshot(); base = new Uint8Array(N * N).fill(255); updateBaseCanvas(); refreshAll(); return; }
      const i = layers.findIndex((l) => l.id === selected);
      if (i < 0) return;
      snapshot();
      layers.splice(i, 1);
      selected = 'paint';
      refreshAll();
    }

    function refreshLayerList() {
      layerList.innerHTML = '';
      const rows = [{ id: 'paint', name: 'Boya', fixed: true }, ...layers.slice().reverse(), { id: 'base', name: 'Arka plan (siluet)', fixed: true }];
      rows.forEach((L) => {
        const li = el('li', { class: selected === L.id ? 'active' : '' });
        if (!L.fixed) {
          const eye = el('button', { class: 'eye', title: 'Göster/gizle' }, L.visible ? '◉' : '○');
          eye.addEventListener('click', (e) => { e.stopPropagation(); snapshot(); L.visible = !L.visible; refreshAll(); });
          li.appendChild(eye);
        } else {
          li.appendChild(el('span', { class: 'eye' }, L.id === 'paint' ? '✎' : '▦'));
        }
        // Katman adı dosya adından gelir: HTML olarak değil, düz metin olarak yazılır (XSS).
        const nameEl = el('span', { class: 'name' });
        nameEl.textContent = L.name;
        li.appendChild(nameEl);
        li.addEventListener('click', () => { selected = L.id; if (!L.fixed && tool !== 'move') setTool('move'); refreshAll(); });
        layerList.appendChild(li);
      });
    }

    function refreshLayerProps() {
      layerProps.innerHTML = '';
      const L = layerById(selected);
      if (!L) {
        layerProps.appendChild(el('div', { class: 'field-note' },
          selected === 'paint' ? 'Boya katmanı: fırça, şekil, kova ve metin buraya çizilir. "Sil" boyayı temizler.'
            : 'Arka plan: düzenlemeye başlanan siluet. "Sil" arka planı beyaza çevirir.'));
        return;
      }
      // Sayısal ayarlarda geri alma noktası, bu seçimdeki ilk değişiklikte bir kez alınır.
      let snapped = false;
      const snapOnce = () => { if (!snapped) { snapshot(); snapped = true; } };
      const set = (k) => (v) => { snapOnce(); L[k] = v; render(); };
      const commitSnap = () => snapshot();
      numField(layerProps, 'Ölçek', '%', 1, 1000, 1, () => Math.round(L.scale * 100), (v) => { snapOnce(); L.scale = v / 100; render(); });
      numField(layerProps, 'Döndürme', '°', -180, 180, 1, () => Math.round(L.rot), set('rot'));
      numField(layerProps, 'Saydamlık', '%', 0, 100, 5, () => Math.round(L.opacity * 100), (v) => { snapOnce(); L.opacity = v / 100; render(); });
      checkField(layerProps, 'Yatay çevir', () => L.flip, (v) => { commitSnap(); L.flip = v; render(); });
      checkField(layerProps, 'Siyah-beyaz yap (eşik)', () => L.threshold != null, (v) => { commitSnap(); L.threshold = v ? 128 : null; processLayer(L); refreshLayerProps(); render(); });
      if (L.threshold != null) {
        numField(layerProps, 'Eşik', '0–255', 1, 254, 4, () => L.threshold, (v) => { snapOnce(); L.threshold = v; processLayer(L); render(); });
      }
      checkField(layerProps, 'Ters çevir', () => L.invert, (v) => { commitSnap(); L.invert = v; processLayer(L); render(); });
      const conv = [['Siluete çevir (hızlı)', () => toSilhouette(L, 'quick'), 'Arka planı ayırıp konuyu siyah yap']];
      if (global.Silhouette && Silhouette.aiAvailable()) conv.push(['Siluete çevir (AI)', () => toSilhouette(L, 'ai')]);
      buttonRow(layerProps, conv);
      buttonRow(layerProps, [['Ortala', () => { snapshot(); L.x = N / 2; L.y = N / 2; render(); }], ['Sığdır', () => { snapshot(); L.scale = (N * 0.9) / Math.max(L.orig.width, L.orig.height); refreshLayerProps(); render(); }]]);
    }

    async function toSilhouette(L, method) {
      try {
        hint.textContent = 'Siluet çıkarılıyor…';
        let mask;
        if (method === 'ai') mask = Silhouette.fromMatte(await Silhouette.aiMatte(L.orig, 'isnet-general-use'), {});
        else mask = Silhouette.quick(L.orig, {});
        const img = await Silhouette.maskToImage(mask);
        snapshot();
        // Maske çalışma çözünürlüğünde gelir; görünen boyut korunur.
        L.scale *= L.orig.width / img.width;
        L.orig = img;
        L.threshold = 128;
        L.invert = false;
        processLayer(L);
        refreshAll();
        setTool(tool);
      } catch (err) {
        hint.textContent = 'Siluet çıkarılamadı: ' + err.message;
      }
    }

    function refreshAll() {
      refreshLayerList();
      refreshLayerProps();
      updateHistoryButtons();
      render();
    }

    // ---------- çizim ----------

    let shapeDrag = null;   // { x0, y0, x1, y1 }
    let cursorDoc = null;

    function layerCorners(L) {
      const w = L.src.width * L.scale / 2, h = L.src.height * L.scale / 2;
      const a = (L.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [L.x + x * c - y * s, L.y + x * s + y * c]);
    }

    function shapePath(ctx, s, shift) {
      let { x0, y0, x1, y1 } = s;
      if (shift && tool !== 'line') {
        const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        x1 = x0 + Math.sign(x1 - x0 || 1) * d; y1 = y0 + Math.sign(y1 - y0 || 1) * d;
      }
      ctx.beginPath();
      if (tool === 'line') { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
      else if (tool === 'rect') ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      else if (tool === 'ellipse') ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
    }

    let rafPending = false;
    function render() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => { rafPending = false; draw(); });
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, Math.round(stage.clientWidth * dpr)), H = Math.max(1, Math.round(stage.clientHeight * dpr));
      if (view.width !== W || view.height !== H) { view.width = W; view.height = H; }
      vctx.setTransform(1, 0, 0, 1, 0, 0);
      vctx.fillStyle = '#1b1b1c';
      vctx.fillRect(0, 0, W, H);
      const [ox, oy] = docToScreen(0, 0);
      vctx.setTransform(zoom, 0, 0, zoom, ox, oy);
      vctx.imageSmoothingEnabled = zoom < 2;
      vctx.shadowColor = 'rgba(0,0,0,0.5)'; vctx.shadowBlur = 20 / zoom;
      vctx.fillStyle = '#fff';
      vctx.fillRect(0, 0, N, N);
      vctx.shadowBlur = 0;
      vctx.drawImage(baseCv, 0, 0);
      layers.forEach((L) => drawLayer(vctx, L));
      vctx.drawImage(paintCv, 0, 0);

      const lw = 1 / zoom;
      if (opt.grid) {
        vctx.strokeStyle = 'rgba(31,143,255,0.25)';
        vctx.lineWidth = lw;
        vctx.beginPath();
        for (let i = 64; i < N; i += 64) { vctx.moveTo(i, 0); vctx.lineTo(i, N); vctx.moveTo(0, i); vctx.lineTo(N, i); }
        vctx.stroke();
      }
      if (opt.symX || opt.symY) {
        vctx.strokeStyle = 'rgba(255,75,62,0.6)';
        vctx.setLineDash([8 * lw, 6 * lw]);
        vctx.lineWidth = lw;
        vctx.beginPath();
        if (opt.symX) { vctx.moveTo(N / 2, 0); vctx.lineTo(N / 2, N); }
        if (opt.symY) { vctx.moveTo(0, N / 2); vctx.lineTo(N, N / 2); }
        vctx.stroke();
        vctx.setLineDash([]);
      }
      if (opt.footprint && hooks.getOverlay) {
        const ov = hooks.getOverlay();
        if (ov) {
          vctx.strokeStyle = '#d85a30';
          vctx.lineWidth = 2 * lw;
          vctx.beginPath();
          ov.poly.forEach(([x, y], i) => (i ? vctx.lineTo(x, y) : vctx.moveTo(x, y)));
          vctx.closePath();
          vctx.stroke();
          const [lx, ly] = ov.light;
          vctx.strokeStyle = '#ef9f27';
          vctx.beginPath();
          vctx.moveTo(lx - 14 * lw, ly); vctx.lineTo(lx + 14 * lw, ly);
          vctx.moveTo(lx, ly - 14 * lw); vctx.lineTo(lx, ly + 14 * lw);
          vctx.stroke();
        }
      }
      const sel = layerById(selected);
      if (sel && sel.visible) {
        const c = layerCorners(sel);
        vctx.strokeStyle = '#1f8fff';
        vctx.lineWidth = 1.5 * lw;
        vctx.setLineDash([6 * lw, 4 * lw]);
        vctx.beginPath();
        c.forEach(([x, y], i) => (i ? vctx.lineTo(x, y) : vctx.moveTo(x, y)));
        vctx.closePath();
        vctx.stroke();
        vctx.setLineDash([]);
      }
      if (shapeDrag) {
        vctx.strokeStyle = opt.color === 'dark' ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.9)';
        vctx.fillStyle = opt.color === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.5)';
        vctx.lineWidth = opt.size;
        vctx.lineCap = 'round';
        vctx.lineJoin = 'round';
        shapePath(vctx, shapeDrag, shapeDrag.shift);
        if (opt.fillShape && tool !== 'line') vctx.fill();
        vctx.stroke();
      }
      if (cursorDoc && ['brush', 'light', 'erase'].includes(tool)) {
        vctx.strokeStyle = 'rgba(31,143,255,0.9)';
        vctx.lineWidth = lw;
        symPoints(cursorDoc[0], cursorDoc[1]).forEach(([x, y]) => {
          vctx.beginPath();
          vctx.arc(x, y, Math.max(0.5, opt.size / 2), 0, Math.PI * 2);
          vctx.stroke();
        });
      }
      vctx.setTransform(1, 0, 0, 1, 0, 0);
      zLabel.textContent = Math.round(zoom * 100) + '%';
    }

    // ---------- işaretçi ----------

    let mode = null;         // 'paint' | 'shape' | 'pan' | 'move' | 'rotate'
    let last = null, smooth = null, panStart = null, moveStart = null;
    let spaceDown = false;

    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('pointerdown', (e) => {
      try { view.setPointerCapture(e.pointerId); } catch (_) { /* sentetik olaylar */ }
      const p = eventDoc(e);
      if (e.button === 1 || e.button === 2 || tool === 'hand' || spaceDown) {
        mode = 'pan';
        panStart = [e.clientX, e.clientY, panX, panY];
        view.style.cursor = 'grabbing';
        return;
      }
      if (tool === 'brush' || tool === 'light' || tool === 'erase') {
        snapshot();
        mode = 'paint';
        last = p; smooth = p;
        const code = tool === 'brush' ? PAINT_DARK : tool === 'light' ? PAINT_LIGHT : PAINT_NONE;
        strokeSegment(p[0], p[1], p[0], p[1], code);
        render();
      } else if (tool === 'fill') {
        snapshot();
        floodFill(p[0], p[1], opt.color === 'dark' ? PAINT_DARK : PAINT_LIGHT);
        render();
      } else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') {
        mode = 'shape';
        shapeDrag = { x0: p[0], y0: p[1], x1: p[0], y1: p[1], shift: e.shiftKey };
      } else if (tool === 'text') {
        if (!opt.text.trim()) return;
        snapshot();
        rasterize((ctx) => {
          ctx.font = `700 ${opt.textSize}px -apple-system, "Segoe UI", system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#000';
          ctx.fillText(opt.text, p[0], p[1]);
        }, opt.color === 'dark' ? PAINT_DARK : PAINT_LIGHT);
        render();
      } else if (tool === 'move') {
        // Tıklanan noktadaki en üstteki resim katmanını seç.
        const hit = layers.slice().reverse().find((L) => L.visible && pointInPoly(p, layerCorners(L)));
        if (hit) selected = hit.id;
        const L = layerById(selected);
        if (!L) { refreshAll(); return; }
        snapshot();
        mode = e.shiftKey ? 'rotate' : 'move';
        moveStart = { p, x: L.x, y: L.y, rot: L.rot, a0: Math.atan2(p[1] - L.y, p[0] - L.x) };
        refreshAll();
      }
    });
    view.addEventListener('pointermove', (e) => {
      const p = eventDoc(e);
      cursorDoc = p;
      if (mode === 'pan') {
        const dpr = window.devicePixelRatio || 1;
        panX = panStart[2] + (e.clientX - panStart[0]) * dpr;
        panY = panStart[3] + (e.clientY - panStart[1]) * dpr;
      } else if (mode === 'paint') {
        const k = 1 - opt.smoothing;
        const nx = smooth[0] + (p[0] - smooth[0]) * k, ny = smooth[1] + (p[1] - smooth[1]) * k;
        const code = tool === 'brush' ? PAINT_DARK : tool === 'light' ? PAINT_LIGHT : PAINT_NONE;
        strokeSegment(last[0], last[1], nx, ny, code);
        smooth = [nx, ny];
        last = [nx, ny];
      } else if (mode === 'shape') {
        shapeDrag.x1 = p[0]; shapeDrag.y1 = p[1]; shapeDrag.shift = e.shiftKey;
      } else if (mode === 'move') {
        const L = layerById(selected);
        L.x = moveStart.x + p[0] - moveStart.p[0];
        L.y = moveStart.y + p[1] - moveStart.p[1];
      } else if (mode === 'rotate') {
        const L = layerById(selected);
        const a = Math.atan2(p[1] - L.y, p[0] - L.x);
        L.rot = moveStart.rot + ((a - moveStart.a0) * 180) / Math.PI;
      }
      render();
    });
    view.addEventListener('pointerup', () => {
      if (mode === 'shape' && shapeDrag) {
        const s = shapeDrag;
        if (Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > 1) {
          snapshot();
          rasterize((ctx) => {
            ctx.lineWidth = opt.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.fillStyle = ctx.strokeStyle = '#000';
            shapePath(ctx, s, s.shift);
            if (opt.fillShape && tool !== 'line') ctx.fill();
            ctx.stroke();
          }, opt.color === 'dark' ? PAINT_DARK : PAINT_LIGHT);
        }
        shapeDrag = null;
      }
      if (mode === 'move' || mode === 'rotate') refreshLayerProps();
      mode = null;
      view.style.cursor = tool === 'hand' ? 'grab' : tool === 'move' ? 'move' : 'crosshair';
      render();
    });
    view.addEventListener('pointerleave', () => { cursorDoc = null; render(); });
    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const L = layerById(selected);
      if (tool === 'move' && (e.ctrlKey || e.metaKey) && L) {
        L.scale = Math.max(0.01, L.scale * Math.exp(-e.deltaY * 0.0015));
        refreshLayerProps();
        render();
        return;
      }
      const r = view.getBoundingClientRect();
      const dpr = view.width / r.width;
      zoomBy(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
    }, { passive: false });

    function pointInPoly(p, poly) {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }

    // ---------- klavye ----------

    function onKey(e) {
      if (host.hidden) return;
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === ' ') { spaceDown = true; view.style.cursor = 'grab'; e.preventDefault(); return; }
      if (k === '[') { opt.size = Math.max(1, Math.round(opt.size / 1.2)); sizeField.refresh(); render(); return; }
      if (k === ']') { opt.size = Math.min(600, Math.round(opt.size * 1.2 + 1)); sizeField.refresh(); render(); return; }
      if (k === '+' || k === '=') { zoomBy(1.25); return; }
      if (k === '-' || k === '_') { zoomBy(1 / 1.25); return; }
      if (k === '0') { fit(); return; }
      if (k === '1') { zoom = 1; panX = panY = 0; render(); return; }
      if (k === 'x' || k === 'X') { setColor(opt.color === 'dark' ? 'light' : 'dark'); return; }
      if (k === 'Delete' || k === 'Backspace') { deleteLayer(); return; }
      const t = TOOLS.find((x) => x.key === k.toUpperCase());
      if (t) setTool(t.id);
    }
    function onKeyUp(e) {
      if (e.key === ' ') { spaceDown = false; view.style.cursor = tool === 'hand' ? 'grab' : tool === 'move' ? 'move' : 'crosshair'; }
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => addImageLayer(img, file.name.replace(/\.[^.]+$/, '').slice(0, 60));
        img.onerror = () => { hint.textContent = 'Bu görsel okunamadı.'; };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    new ResizeObserver(() => render()).observe(stage);

    // ---------- giriş / çıkış ----------

    function open(dataUrl) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          const cv = Object.assign(document.createElement('canvas'), { width: N, height: N });
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, N, N);
          ctx.drawImage(img, 0, 0, N, N);
          const d = ctx.getImageData(0, 0, N, N).data;
          base = new Uint8Array(N * N);
          for (let i = 0; i < N * N; i++) base[i] = d[i * 4];
          paint = new Uint8Array(N * N);
          layers = [];
          selected = 'paint';
          undoStack = []; redoStack = [];
          updateBaseCanvas();
          pctx.clearRect(0, 0, N, N);
          setTool('brush');
          setColor('dark');
          refreshAll();
          requestAnimationFrame(fit);
          resolve();
        };
        img.src = dataUrl;
      });
    }

    function apply() {
      const g = flattenGray();
      const cv = Object.assign(document.createElement('canvas'), { width: N, height: N });
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(N, N);
      for (let i = 0; i < N * N; i++) {
        const v = g[i];   // gri kenarlar korunur (piksel altı hassasiyet)
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (hooks.onApply) hooks.onApply(cv.toDataURL('image/png'));
    }

    setTool('brush');
    setColor('dark');
    updateHistoryButtons();

    return { open, render, fit };
  }

  global.SilhouetteEditor = { init };
})(window);
