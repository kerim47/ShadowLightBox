/**
 * Görsel Dönüştürücü — fotoğraf / logo / çizim → baskıya hazır gölge şablonu + SVG.
 *
 * İsteğe bağlı ek araç: ana fotoğraf → lamba akışının dışında, yalnızca
 * Araçlar → Görsel Dönüştürücü (Ctrl+Shift+G) ile açılır. Görsel doğrudan
 * hedef çerçevesine (duvardaki gölge alanı, [-R, R]²) yerleştirilir; böylece
 * baskı analizi lamba gövdesinin gerçek ölçüleriyle yapılır:
 *   A. görsel ayarları + dönüştürme yöntemi  → çalışma çözünürlüğünde maske
 *   B. yerleşim + temizlik                    → 2048² hedef maskesi
 *   C. baskı uygunluğu (Stencil.analyzePrint) → yüzen parça köprüsü, ince çizgi
 *   D. vektör izleme                          → SVG yolu (lambaya da bu yol gider)
 * "Basılacak gölge" görünümü, lambanın gerçek duvar alanından (köprüler,
 * çatılar, delik doldurma sonrası) hesaplanır.
 */
(function (global) {
  'use strict';

  const S = 1024;            // çalışma çözünürlüğü (hızlı); çıktı OUT'a vektörle çizilir
  const OUT = 2048;          // hedef görüntü = designer N
  const WORK = 1400;         // görselin işlendiği en uzun kenar
  const STORE = 'sb-converter-v1';

  const MODES = [
    ['threshold', 'Tek renk — parlaklık eşiği'],
    ['colors', 'Renk katmanları — seçilen renkler gölge'],
    ['edges', 'Çizgi sanatı — kenarlar gölge olur'],
    ['subject', 'Siluet — arka planı sil'],
    ['portrait', 'Detaylı portre — yüz hatları gölgede'],
  ];

  const DEFAULTS = {
    mode: 'threshold', invert: false,
    brightness: 0, contrast: 0, gamma: 1, saturation: 0, blur: 0,
    levelAuto: true, level: 128, adaptive: 0,
    colors: 4, colorSel: null,
    edgeLevel: 35, edgeWidth: 3,
    ai: true, sens: 0, local: 50, outline: 3,
    size: 90, rot: 0, offX: 0, offY: 0, flipX: false, flipY: false, outsideLit: true,
    grow: 0, smooth: 1, speckle: 20, holes: 10, fillAll: false,
    printFix: true, nozzle: 0.4, minLine: 0.8, minGap: 0.6, bridge: 1.2,
    floating: 'bridge', thin: 'thicken', gaps: 'close',
    svgDetail: 'balanced', showPaths: false,
  };

  // Hangi ayar hangi aşamadan itibaren yeniden hesaplatır.
  const STAGE = { A: 0, B: 1, C: 2, D: 3, R: 4 };
  const STAGE_OF = {};
  'mode invert brightness contrast gamma saturation blur levelAuto level adaptive colors colorSel edgeLevel edgeWidth ai sens local outline'
    .split(' ').forEach((k) => { STAGE_OF[k] = STAGE.A; });
  'size rot offX offY flipX flipY outsideLit grow smooth speckle holes fillAll'.split(' ').forEach((k) => { STAGE_OF[k] = STAGE.B; });
  'printFix nozzle minLine minGap bridge floating thin gaps'.split(' ').forEach((k) => { STAGE_OF[k] = STAGE.C; });
  STAGE_OF.svgDetail = STAGE.D;
  STAGE_OF.showPaths = STAGE.R;

  // SVG ayrıntısı → sadeleştirme toleransı (px) ve eğri yumuşaklığı.
  const SVG_DETAIL = {
    high: { simplify: 0.35, curve: 0.6 },
    balanced: { simplify: 0.8, curve: 0.8 },
    light: { simplify: 1.6, curve: 0.9 },
  };

  const VIEWS = [
    ['original', 'Orijinal'],
    ['stencil', 'Şablon'],
    ['analysis', 'Baskı analizi'],
    ['shadow', 'Basılacak gölge'],
  ];

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    });
    if (html != null) e.innerHTML = html;
    return e;
  }
  const sleep0 = () => new Promise((r) => setTimeout(r, 0));
  const fmt = (v, d) => (+v).toLocaleString('tr-TR', { maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: 0 });

  function init(host, hooks) {
    let st = Object.assign({}, DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (saved) Object.keys(DEFAULTS).forEach((k) => { if (saved[k] !== undefined) st[k] = saved[k]; });
    } catch (e) { /* depolama yok: varsayılanlar */ }
    function save() { try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* yok say */ } }

    // ---------- durum ----------
    let srcImg = null, srcName = 'sablon';
    let adjCv = null, adjKey = null;
    let km = null, kmKey = null;
    let matte = null, matteSrc = null;
    let aCv = null;                       // A çıktısı: beyaz = ışık, siyah = gölge
    let autoLevel = null;
    let maskB = null;                     // B çıktısı (S²)
    let print = null;                     // C çıktısı { mask, overlay, stats }
    let vec = null;                       // D çıktısı { d, nodes, paths, svg }
    let map = null, mapKey = null;
    let dirty = STAGE.A;
    let running = false, rerun = false, timer = null;
    let view = 'stencil';
    let shadow = null, shadowDirty = true, shadowBusy = false;
    const cvs = { original: null, stencil: null, analysis: null, shadow: null };
    let viewDirty = { original: true, stencil: true, analysis: true };
    let zoom = 1, panX = 0, panY = 0;
    let drag = null;
    let spaceDown = false;

    // ---------- yerleşim ----------
    host.innerHTML = '';
    const side = el('aside', { class: 'cv-side' });
    const main = el('div', { class: 'cv-main' });
    host.append(side, main);

    const bar = el('div', { class: 'cv-toolbar' });
    const stage = el('div', { class: 'cv-stage' });
    main.append(bar, stage);
    const view2d = el('canvas', { class: 'cv-canvas' });
    stage.appendChild(view2d);
    const vctx = view2d.getContext('2d');
    const empty = el('div', { class: 'cv-empty' },
      '<div class="cv-empty-box"><strong>Görsel bırakın, yapıştırın (Ctrl+V) veya açın</strong>'
      + '<span>Fotoğraf, logo, çizim veya SVG. Sonuç, lambanızın ölçülerine göre basılabilir hale getirilir.</span></div>');
    stage.appendChild(empty);
    const thumb = el('canvas', { class: 'cv-thumb', width: 120, height: 120, title: 'Orijinal görsel' });
    thumb.hidden = true;
    stage.appendChild(thumb);
    const viewTabs = el('div', { class: 'view-switch cv-views' });
    VIEWS.forEach(([id, label]) => viewTabs.appendChild(el('button', { class: 'seg' + (id === view ? ' active' : ''), 'data-v': id, onclick: () => setView(id) }, label)));
    stage.appendChild(viewTabs);
    const legend = el('div', { class: 'cv-legend' });
    stage.appendChild(legend);
    const verdict = el('div', { class: 'cv-verdict' });
    verdict.hidden = true;
    stage.appendChild(verdict);
    const badge = el('div', { class: 'cv-badge' });
    badge.hidden = true;
    stage.appendChild(badge);
    const zoomBar = el('div', { class: 'ed-zoombar cv-zoombar' });
    const zLabel = el('span', { class: 'ed-zoomlabel' }, '100%');
    zoomBar.append(
      el('button', { title: 'Uzaklaştır', onclick: () => zoomAt(1 / 1.25) }, '−'), zLabel,
      el('button', { title: 'Yakınlaştır', onclick: () => zoomAt(1.25) }, '+'),
      el('button', { title: 'Sığdır', onclick: () => { zoom = 1; panX = panY = 0; draw(); } }, 'Sığdır'));
    stage.appendChild(zoomBar);
    const hint = el('div', { class: 'ed-hint cv-hint' }, 'sürükle / oklar: taşı · [ ]: boyut · Q W: döndür · F1: tüm kısayollar');
    stage.appendChild(hint);

    const fileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml,.svg', style: 'display:none' });
    host.appendChild(fileIn);
    const tb = (label, title, fn, cls) => { const b = el('button', { class: 'ghost ' + (cls || ''), title, onclick: fn }, label); bar.appendChild(b); return b; };
    tb('📂 Görsel aç', 'Bilgisayardan görsel seç', () => fileIn.click());
    tb('📋 Yapıştır', 'Panodaki görseli yapıştır (Ctrl+V)', pasteFromClipboard);
    bar.appendChild(el('span', { class: 'cv-sep' }));
    const bSvg = tb('💾 SVG kaydet', 'Vektör şablonu SVG olarak kaydet (Ctrl+Shift+E). PNG ve kopyalama: Dosya menüsü', saveSVG);
    const progress = el('div', { class: 'cv-progress' }, '<i></i>');
    bar.appendChild(progress);
    const status = el('span', { class: 'cv-status' });
    bar.appendChild(status);
    bar.appendChild(el('span', { class: 'cv-spacer' }));
    const bApply = el('button', { class: 'primary', title: 'Şablonu lambanın silueti yap (Ctrl+Enter)', onclick: apply }, 'Lambaya uygula →');
    bar.appendChild(bApply);
    [bSvg, bApply].forEach((b) => { b.disabled = true; });

    // ---------- yan panel: denetimler ----------
    const controls = [];
    function section(title, open) {
      const sec = el('section', { class: 'panel' + (open ? ' open' : '') });
      const head = el('button', { class: 'panel-head' }, `<span>${title}</span><i class="chev"></i>`);
      head.addEventListener('click', () => sec.classList.toggle('open'));
      const body = el('div', { class: 'panel-body' });
      sec.append(head, body);
      side.appendChild(sec);
      return body;
    }
    // ---------- geri al / yinele (ayar anlık görüntüleri) ----------
    const undoStack = [], redoStack = [];
    let lastPush = { id: null, t: 0 };
    function pushHistory(id) {
      const now = Date.now();
      // Aynı ayardaki ardışık değişiklikler (kaydırıcı sürükleme) tek adım sayılır.
      if (id && lastPush.id === id && now - lastPush.t < 800) { lastPush.t = now; return; }
      undoStack.push(JSON.stringify(st));
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      lastPush = { id, t: now };
    }
    function restore(json) {
      const prev = st;
      st = Object.assign({}, DEFAULTS, JSON.parse(json));
      save();
      let from = STAGE.R;
      Object.keys(DEFAULTS).forEach((k) => { if (JSON.stringify(prev[k]) !== JSON.stringify(st[k])) from = Math.min(from, STAGE_OF[k]); });
      refreshControls();
      if (km) renderPalette();
      schedule(from);
      lastPush = { id: null, t: 0 };
    }
    function undo() { if (!undoStack.length) return false; redoStack.push(JSON.stringify(st)); restore(undoStack.pop()); return true; }
    function redo() { if (!redoStack.length) return false; undoStack.push(JSON.stringify(st)); restore(redoStack.pop()); return true; }

    function set(id, v) {
      if (st[id] === v) return;
      pushHistory(id);
      st[id] = v;
      save();
      refreshControls();
      schedule(STAGE_OF[id]);
    }
    // Sayısal ayar — lamba panelindeki alanlarla aynı görünüm: etiket + birim,
    // sayı kutusu ve −/+ düğmeleri. Etikete çift tıklama varsayılana döndürür.
    function range(parent, d) {
      const wrap = el('div', { class: 'field' });
      const lab = el('label', { title: 'Çift tıklayın: varsayılan değere dön' }, `<span>${d.label}</span>${d.unit ? `<small>${d.unit}</small>` : ''}`);
      const box = el('div', { class: 'numbox' });
      const inp = el('input', { type: 'number', min: d.min, max: d.max, step: d.step, 'data-default': DEFAULTS[d.id], 'data-setting': d.id });
      const dec = el('button', { type: 'button', tabindex: '-1', title: 'Azalt' }, '−');
      const inc = el('button', { type: 'button', tabindex: '-1', title: 'Artır' }, '+');
      box.append(inp, dec, inc);
      wrap.append(lab, box);
      if (d.note) wrap.appendChild(el('div', { class: 'field-note' }, d.note));
      parent.appendChild(wrap);
      const digits = (String(d.step).split('.')[1] || '').length;
      const clamp = (v) => Math.min(d.max, Math.max(d.min, +(+v).toFixed(digits)));
      const commit = (v) => {
        if (!Number.isFinite(+v)) { inp.value = st[d.id]; return; }
        const c = clamp(v);
        inp.value = c;
        set(d.id, c);
      };
      inp.addEventListener('change', () => commit(inp.value));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(inp.value); inp.blur(); } });
      dec.addEventListener('click', () => commit(+st[d.id] - d.step));
      inc.addEventListener('click', () => commit(+st[d.id] + d.step));
      lab.addEventListener('dblclick', () => commit(DEFAULTS[d.id]));
      controls.push({ wrap, d, refresh: () => { if (document.activeElement !== inp) inp.value = st[d.id]; } });
    }
    function check(parent, d) {
      const l = el('label', { class: 'check' });
      const c = el('input', { type: 'checkbox', 'data-default': String(!!DEFAULTS[d.id]), 'data-setting': d.id });
      c.addEventListener('change', () => set(d.id, c.checked));
      l.append(c, document.createTextNode(' ' + d.label));
      parent.appendChild(l);
      controls.push({ wrap: l, d, refresh: () => { c.checked = !!st[d.id]; } });
    }
    function select(parent, d) {
      const f = el('div', { class: 'field' });
      f.appendChild(el('label', {}, `<span>${d.label}</span>`));
      const s = el('select', { 'data-default': DEFAULTS[d.id], 'data-setting': d.id });
      d.options.forEach(([v, t]) => s.appendChild(el('option', { value: v }, t)));
      s.addEventListener('change', () => set(d.id, s.value));
      f.appendChild(s);
      if (d.note) f.appendChild(el('div', { class: 'field-note' }, d.note));
      parent.appendChild(f);
      controls.push({ wrap: f, d, refresh: () => { s.value = st[d.id]; } });
    }
    function custom(parent, node, showIf) {
      parent.appendChild(node);
      controls.push({ wrap: node, d: { showIf }, refresh: () => {} });
      return node;
    }
    function refreshControls() {
      controls.forEach((c) => {
        if (c.d.showIf) c.wrap.hidden = !c.d.showIf(st);
        c.refresh();
      });
      side.dispatchEvent(new Event('settings-sync'));   // Inspector sıfırlama ikonlarını tazeler
    }
    /** Inspector'dan toplu sıfırlama: tek geri alma adımı, tek yeniden hesap. */
    function resetSettings(ids) {
      const keys = ids.filter((k) => k in DEFAULTS && JSON.stringify(st[k]) !== JSON.stringify(DEFAULTS[k]));
      if (!keys.length) return;
      pushHistory(null);
      let from = STAGE.R;
      keys.forEach((k) => { st[k] = k === 'bridge' ? lampBridge() : DEFAULTS[k]; from = Math.min(from, STAGE_OF[k]); });
      save();
      refreshControls();
      schedule(from);
    }
    const isMode = (...m) => (s) => m.includes(s.mode);
    const aiOk = () => !!(global.Silhouette && Silhouette.aiAvailable());

    // 1) Dönüştürme
    const sConv = section('Dönüştürme', true);
    select(sConv, { id: 'mode', label: 'Yöntem', options: MODES });
    check(sConv, { id: 'levelAuto', label: 'Eşiği otomatik bul', showIf: isMode('threshold') });
    range(sConv, { id: 'level', label: 'Eşik', min: 0, max: 255, step: 1,
      showIf: (s) => s.mode === 'threshold' && !s.levelAuto });
    range(sConv, { id: 'adaptive', label: 'Dengesiz ışık düzeltmesi', unit: '%', min: 0, max: 100, step: 5, showIf: isMode('threshold'),
      note: 'Gölgeli / parlak yerleri olan fotoğraflarda detayı korur.' });
    range(sConv, { id: 'colors', label: 'Renk sayısı', min: 2, max: 8, step: 1, showIf: isMode('colors') });
    const palette = custom(sConv, el('div', { class: 'cv-palette', title: 'Renge tıklayın: çerçeveli renkler gölge (lambada malzeme), diğerleri ışık olur.' }), isMode('colors'));
    range(sConv, { id: 'edgeLevel', label: 'Kenar hassasiyeti', min: 5, max: 120, step: 1, showIf: isMode('edges'),
      note: 'Küçük değer = daha çok çizgi.' });
    range(sConv, { id: 'edgeWidth', label: 'Çizgi kalınlığı', unit: 'px', min: 0, max: 12, step: 1, showIf: isMode('edges') });
    check(sConv, { id: 'ai', label: 'Yapay zeka ile arka plan sil', showIf: (s) => (s.mode === 'subject' || s.mode === 'portrait') && aiOk() });
    range(sConv, { id: 'sens', label: 'Hassasiyet', min: -100, max: 100, step: 5, showIf: isMode('subject', 'portrait') });
    range(sConv, { id: 'local', label: 'Yerel kontrast (göz, kaş)', unit: '%', min: 0, max: 100, step: 5, showIf: isMode('portrait') });
    range(sConv, { id: 'outline', label: 'Dış hat kalınlığı', unit: 'px', min: 0, max: 12, step: 1, showIf: isMode('portrait') });
    check(sConv, { id: 'invert', label: 'Ters çevir (açık renkler gölge)' });

    // 2) Boyut ve yerleşim
    const sPlace = section('Boyut ve yerleşim', true);
    range(sPlace, { id: 'size', label: 'Boyut', unit: '%', min: 10, max: 300, step: 1 });
    range(sPlace, { id: 'rot', label: 'Döndür', unit: '°', min: -180, max: 180, step: 1 });
    range(sPlace, { id: 'offX', label: 'Yatay kaydır', unit: '%', min: -60, max: 60, step: 0.5 });
    range(sPlace, { id: 'offY', label: 'Dikey kaydır', unit: '%', min: -60, max: 60, step: 0.5 });
    check(sPlace, { id: 'flipX', label: 'Yatay aynala' });
    check(sPlace, { id: 'flipY', label: 'Dikey aynala' });
    check(sPlace, { id: 'outsideLit', label: 'Görselin dışı ışık olsun' });
    custom(sPlace, el('div', { class: 'field-note' }, 'Görseli tuvalde sürükleyerek taşıyın. Kırmızı kesikli çizgi lamba gövdesi.'));

    // 3) 3B baskı: özet her zaman,
    const sPrint = section('3B baskı', true);
    const lampInfo = custom(sPrint, el('div', { class: 'cv-lamp' }));
    const reportBox = custom(sPrint, el('div', { class: 'cv-report' }));
    check(sPrint, { id: 'printFix', label: 'Baskı sorunlarını otomatik düzelt' });
    select(sPrint, { id: 'floating', label: 'Havada kalan parçalar', options: [
      ['bridge', 'Köprüyle tabana bağla (önerilen)'], ['remove', 'Sil'], ['keep', 'Dokunma (lamba kendisi köprüler)']],
    showIf: (s) => s.printFix });
    range(sPrint, { id: 'bridge', label: 'Köprü kalınlığı', unit: 'mm', min: 0.8, max: 4, step: 0.1, showIf: (s) => s.printFix && s.floating === 'bridge' });
    select(sPrint, { id: 'thin', label: 'İnce çizgiler', options: [
      ['thicken', 'Kalınlaştır (önerilen)'], ['remove', 'Sil'], ['keep', 'Dokunma']], showIf: (s) => s.printFix });
    select(sPrint, { id: 'gaps', label: 'Dar ışık aralıkları', options: [
      ['close', 'Kapat'], ['widen', 'Genişlet'], ['keep', 'Dokunma']], showIf: (s) => s.printFix });
    range(sPrint, { id: 'nozzle', label: 'Nozul çapı', unit: 'mm', min: 0.2, max: 1, step: 0.05 });
    range(sPrint, { id: 'minLine', label: 'En ince gölge çizgisi', unit: 'mm', min: 0.3, max: 3, step: 0.05 });
    range(sPrint, { id: 'minGap', label: 'En dar ışık aralığı', unit: 'mm', min: 0.2, max: 2, step: 0.05 });

    // 4) Görsel ayarları
    const sAdj = section('Görsel ayarları', false);
    range(sAdj, { id: 'brightness', label: 'Parlaklık', min: -100, max: 100, step: 1 });
    range(sAdj, { id: 'contrast', label: 'Kontrast', min: -100, max: 100, step: 1 });
    range(sAdj, { id: 'blur', label: 'Gürültü azalt', unit: 'px', min: 0, max: 10, step: 1 });
    range(sAdj, { id: 'gamma', label: 'Gama', min: 0.2, max: 3, step: 0.05 });
    range(sAdj, { id: 'saturation', label: 'Doygunluk', min: -100, max: 100, step: 1 });

    // 5) Temizlik
    const sClean = section('Temizlik', false);
    range(sClean, { id: 'speckle', label: 'Benekleri sil', unit: 'px²', min: 0, max: 500, step: 5 });
    range(sClean, { id: 'holes', label: 'Küçük delikleri kapat', unit: 'px²', min: 0, max: 500, step: 5 });
    range(sClean, { id: 'smooth', label: 'Kenar yumuşatma', unit: 'px', min: 0, max: 8, step: 1 });
    range(sClean, { id: 'grow', label: 'Kalınlaştır / incelt', unit: 'px', min: -8, max: 8, step: 1 });
    check(sClean, { id: 'fillAll', label: 'Dolu siluet (iç boşlukları doldur)' });

    // 6) SVG: tek seçim
    const sVec = section('SVG', false);
    select(sVec, { id: 'svgDetail', label: 'Ayrıntı', options: [
      ['high', 'Yüksek — en sadık, büyük dosya'], ['balanced', 'Dengeli (önerilen)'], ['light', 'Hafif — az düğüm, küçük dosya']],
    note: 'SVG gerçek duvar ölçüsünde (cm) kaydedilir; lambaya da bu yol gönderilir.' });
    check(sVec, { id: 'showPaths', label: 'Yol çizgilerini göster' });


    // Nozul değişince en ince çizgi 2 × nozul olur.
    controls.find((c) => c.d.id === 'nozzle').wrap.querySelector('input').addEventListener('change', () => {
      set('minLine', Math.round(st.nozzle * 2 * 100) / 100);
    });

    function lampBridge() {
      const g = hooks.designer.getPrintGeometry();
      return Math.round(Math.max(0.8, g.ribWidthMm) * 10) / 10;
    }

    // ---------- renk paleti ----------
    function renderPalette() {
      palette.innerHTML = '';
      if (!km) return;
      const total = km.palette.reduce((a, p) => a + p.count, 0) || 1;
      km.palette.forEach((p, i) => {
        const on = st.colorSel && st.colorSel[i];
        const b = el('button', { class: 'cv-chip' + (on ? ' on' : ''), title: `${on ? 'Gölge' : 'Işık'} — %${fmt((100 * p.count) / total, 0)}` });
        b.style.background = `rgb(${p.rgb.join(',')})`;
        b.addEventListener('click', () => {
          const sel = st.colorSel.slice();
          sel[i] = !sel[i];
          set('colorSel', sel);
          renderPalette();
        });
        palette.appendChild(b);
      });
    }

    // ---------- işlem hattı ----------
    function schedule(stageIdx) {
      if (stageIdx === STAGE.R) { draw(); return; }
      dirty = Math.min(dirty, stageIdx);
      if (!srcImg) return;
      clearTimeout(timer);
      timer = setTimeout(run, 40);
    }

    function setBusy(on, msg) {
      progress.classList.toggle('on', on);
      if (msg != null) status.textContent = msg;
    }

    async function run() {
      if (running) { rerun = true; return; }
      running = true;
      try {
        do {
          rerun = false;
          const from = dirty;
          dirty = STAGE.R;
          if (from <= STAGE.A) { setBusy(true, 'Görsel dönüştürülüyor…'); await sleep0(); await stageA(); }
          if (rerun) continue;
          if (from <= STAGE.B) { setBusy(true, 'Yerleştiriliyor…'); await sleep0(); stageB(); }
          if (rerun) continue;
          if (from <= STAGE.C) { setBusy(true, 'Baskı uygunluğu analiz ediliyor…'); await sleep0(); stageC(); }
          if (rerun) continue;
          if (from <= STAGE.D) { setBusy(true, 'Vektöre çevriliyor…'); await sleep0(); stageD(); }
          viewDirty = { original: true, stencil: true, analysis: true };
          shadowDirty = true;
          setBusy(false, '');
          updateReport();
          draw();
          if (view === 'shadow') computeShadow();
        } while (rerun);
      } catch (err) {
        console.error(err);
        setBusy(false, 'Hata: ' + err.message);
      } finally {
        running = false;
      }
    }

    function adjustedSource() {
      const key = JSON.stringify([st.brightness, st.contrast, st.gamma, st.saturation, st.blur]);
      if (adjCv && adjKey === key) return adjCv;
      const s = Math.min(1, WORK / Math.max(srcImg.width, srcImg.height));
      const w = Math.max(1, Math.round(srcImg.width * s)), h = Math.max(1, Math.round(srcImg.height * s));
      const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(srcImg, 0, 0, w, h);
      const id = ctx.getImageData(0, 0, w, h);
      const out = Stencil.adjust(id.data, w, h, st);
      id.data.set(out);
      ctx.putImageData(id, 0, 0);
      adjCv = cv; adjKey = key;
      km = null;
      return cv;
    }

    async function stageA() {
      const cv = adjustedSource();
      const w = cv.width, h = cv.height;
      const rgba = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      let mask;
      autoLevel = null;
      if (st.mode === 'threshold') {
        const lum = Stencil.luminance(rgba, w * h);
        const r = Stencil.threshold(lum, w, h, { level: st.levelAuto ? null : st.level, adaptive: st.adaptive / 100 });
        mask = r.mask;
        autoLevel = r.level;
        if (st.levelAuto) st.level = Math.round(r.level);
      } else if (st.mode === 'colors') {
        const key = adjKey + '|' + st.colors;
        if (!km || kmKey !== key) {
          km = Stencil.kmeans(rgba, w, h, st.colors);
          kmKey = key;
          if (!Array.isArray(st.colorSel) || st.colorSel.length !== km.palette.length) {
            st.colorSel = km.palette.map((p, i) => i < Math.ceil(km.palette.length / 2));
            save();
          }
        }
        mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = st.colorSel[km.labels[i]] ? 1 : 0;
        renderPalette();
      } else if (st.mode === 'edges') {
        const lum = Stencil.blurF(Stencil.luminance(rgba, w * h), w, h, 1);
        mask = Stencil.edges(lum, w, h, st.edgeLevel);
        if (st.edgeWidth > 1) mask = Stencil.offset(mask, w, h, (st.edgeWidth - 1) / 2);
      } else {
        let subject;
        if (st.ai && aiOk()) {
          if (!matte || matteSrc !== cv) {
            matte = await Silhouette.aiMatte(cv, 'isnet-general-use', (msg) => {
              if (msg.phase === 'download') status.textContent = `Yapay zeka modeli indiriliyor (yalnızca ilk sefer)… %${Math.round((100 * msg.received) / (msg.total || 1))}`;
              else if (msg.phase === 'run') status.textContent = 'Arka plan siliniyor…';
            });
            matteSrc = cv;
          }
          subject = Silhouette.fromMatte(matte, { sensitivity: st.mode === 'subject' ? st.sens / 100 : 0, smooth: 0 });
        } else {
          subject = Silhouette.quick(cv, { sensitivity: st.mode === 'subject' ? st.sens / 100 : 0, smooth: 0 });
        }
        if (st.mode === 'portrait') {
          subject = Silhouette.portrait(cv, subject, { sensitivity: st.sens / 100, local: st.local / 100, outline: st.outline, smooth: 0 });
        }
        mask = subject.data;
        if (subject.w !== w || subject.h !== h) {
          // Silhouette kendi çalışma çözünürlüğünde dönebilir: en yakın komşuyla eşle.
          const m = new Uint8Array(w * h);
          for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            m[y * w + x] = subject.data[Math.min(subject.h - 1, Math.floor((y * subject.h) / h)) * subject.w + Math.min(subject.w - 1, Math.floor((x * subject.w) / w))];
          }
          mask = m;
        }
      }
      if (st.invert) for (let i = 0; i < mask.length; i++) mask[i] = 1 - mask[i];
      const out = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const octx = out.getContext('2d');
      const id = octx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = mask[i] ? 0 : 255;
        id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
        id.data[i * 4 + 3] = 255;
      }
      octx.putImageData(id, 0, 0);
      aCv = out;
      refreshControls();
    }

    function placeTransform(ctx, src) {
      const k = ((st.size / 100) * S) / Math.max(src.width, src.height);
      ctx.translate(S / 2 + (st.offX / 100) * S, S / 2 - (st.offY / 100) * S);
      ctx.rotate((-st.rot * Math.PI) / 180);
      ctx.scale(k * (st.flipX ? -1 : 1), k * (st.flipY ? -1 : 1));
      ctx.translate(-src.width / 2, -src.height / 2);
    }

    function stageB() {
      const cv = Object.assign(document.createElement('canvas'), { width: S, height: S });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = st.outsideLit ? '#fff' : '#000';
      ctx.fillRect(0, 0, S, S);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.save();
      placeTransform(ctx, aCv);
      ctx.drawImage(aCv, 0, 0);
      ctx.restore();
      const d = ctx.getImageData(0, 0, S, S).data;
      let m = new Uint8Array(S * S);
      for (let i = 0; i < S * S; i++) m[i] = d[i * 4] < 128 ? 1 : 0;
      if (st.grow) m = Stencil.offset(m, S, S, st.grow);
      if (st.smooth > 0) {
        const f = new Float32Array(S * S);
        for (let i = 0; i < S * S; i++) f[i] = m[i];
        const b = Stencil.blurF(Stencil.blurF(f, S, S, st.smooth), S, S, st.smooth);
        for (let i = 0; i < S * S; i++) m[i] = b[i] >= 0.5 ? 1 : 0;
      }
      if (st.fillAll) m = Stencil.fillHoles(m, S, S);
      if (st.speckle > 0 || st.holes > 0) m = Stencil.despeckle(m, S, S, st.speckle, st.holes);
      maskB = m;
    }

    function ensureMap() {
      const geo = hooks.designer.getPrintGeometry();
      if (map && mapKey === geo.key) return map;
      map = Stencil.buildPrintMap(geo, S, Projection);
      mapKey = geo.key;
      return map;
    }

    function stageC() {
      const m = ensureMap();
      const fix = st.printFix;
      print = Stencil.analyzePrint(maskB, m, {
        outsideLit: st.outsideLit,
        minLineMm: st.minLine, minGapMm: st.minGap, bridgeMm: st.bridge,
        floating: fix ? st.floating : 'keep', thin: fix ? st.thin : 'keep', gaps: fix ? st.gaps : 'keep',
      });
    }

    function stageD() {
      const q = SVG_DETAIL[st.svgDetail] || SVG_DETAIL.balanced;
      const loops = Stencil.trace(print.mask, S, S).map((l) => Stencil.simplify(l, q.simplify));
      const pd = Stencil.pathData(loops, { smooth: q.curve, cornerDeg: 55 });
      vec = pd;
      vec.path2d = new Path2D(pd.d);
      [bSvg, bApply].forEach((b) => { b.disabled = false; });
    }

    function svgString() {
      const g = hooks.designer.getPrintGeometry();
      return Stencil.toSVG(vec.d, S, {
        background: false, sizeCm: Math.round(2 * g.R * 100) / 100,
        title: 'Gölge şablonu — ' + srcName,
      });
    }

    /** Lambaya giden hedef: SVG yolu 2048²'ye kenar yumuşatmalı çizilir (piksel altı hassasiyet). */
    function renderTarget() {
      const cv = Object.assign(document.createElement('canvas'), { width: OUT, height: OUT });
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, OUT, OUT);
      ctx.scale(OUT / S, OUT / S);
      ctx.fillStyle = '#000';
      ctx.fill(vec.path2d, 'evenodd');
      return cv;
    }

    // ---------- basılacak gölge (lambanın gerçek duvar alanı) ----------
    async function computeShadow() {
      if (!vec || shadowBusy || !shadowDirty) return;
      shadowBusy = true;
      setBusy(true, 'Lambanın gerçek duvarı hesaplanıyor…');
      await sleep0();
      try {
        const tcv = renderTarget();
        const data = tcv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, OUT, OUT).data;
        const { field } = hooks.designer.fieldForTarget(data, st.outsideLit);
        const g = hooks.designer.getPrintGeometry();
        const A = 1024, k = S / A;
        const cv = Object.assign(document.createElement('canvas'), { width: A, height: A });
        const ctx = cv.getContext('2d');
        const img = ctx.createImageData(A, A);
        const fm = print.mask;
        let inter = 0, uni = 0;
        for (let py = 0; py < A; py++) {
          const y = (0.5 - (py + 0.5) / A) * 2 * g.R;
          for (let px = 0; px < A; px++) {
            const x = ((px + 0.5) / A - 0.5) * 2 * g.R;
            const wpt = g.toWall(x, y);
            const inv = Projection.inverseShell(wpt[0], wpt[1], g.shape, g.cz, g.margin);
            const i = (py * A + px) * 4;
            let c;
            if (!inv) c = [60, 44, 92];                                  // lamba izi
            else {
              const lit = !inv.blocked && WallField.sampleField(field, inv.s, inv.z) > 0.5;
              const want = !fm[Math.floor(py * k) * S + Math.floor(px * k)];
              if (!want || !lit) uni++;
              if (!want && !lit) inter++;
              if (lit && want) c = [250, 214, 150];
              else if (!lit && !want) c = [22, 22, 24];
              else if (lit) c = [255, 75, 62];                          // şablonda gölge, lambada ışık
              else c = [31, 143, 255];                                  // lamba fazladan gölge yapıyor
            }
            img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
          }
        }
        ctx.putImageData(img, 0, 0);
        shadow = { cv, iou: uni ? inter / uni : 1, stats: field.stats };
        cvs.shadow = cv;
        shadowDirty = false;
        updateReport();
        draw();
      } catch (err) {
        console.error(err);
        status.textContent = 'Gölge hesaplanamadı: ' + err.message;
      } finally {
        shadowBusy = false;
        setBusy(false, '');
        if (shadowDirty && view === 'shadow' && !running) computeShadow();
      }
    }

    // ---------- rapor ----------
    // Bundan küçük kalıntılar (birkaç hücrelik örnekleme kırıntısı) sorun sayılmaz.
    const MIN_AREA = 0.5;   // mm²

    function updateReport() {
      const g = hooks.designer.getPrintGeometry();
      lampInfo.innerHTML = `<div title="Analiz bu lamba ölçülerine göre yapılır; gövde, gölge boyutu veya montaj değişirse sonuç da değişir.">${hooks.lampSummary ? hooks.lampSummary() : ''}</div>`;
      const goLamp = el('button', { class: 'small', onclick: () => hooks.onClose && hooks.onClose() }, 'Lamba ayarlarını değiştir');
      lampInfo.appendChild(goLamp);
      if (!print) { reportBox.innerHTML = ''; verdict.hidden = true; return; }
      const s = print.stats;
      const fix = st.printFix;
      const rows = [];
      const row = (cls, text) => rows.push(`<li class="${cls}"><i></i><span>${text}</span></li>`);
      if (s.floating) {
        const what = !fix || st.floating === 'keep' ? 'lamba köprüleyecek' : (st.floating === 'bridge' ? `${s.bridges} köprü eklendi` : 'silindi');
        row(s.residualFloating ? 'bad' : 'fixed', `Havada kalan parça: <b>${s.floating}</b> → ${what}`);
      } else row('ok', 'Havada kalan parça yok');
      if (s.thinLineMm2 > MIN_AREA) {
        const what = !fix || st.thin === 'keep' ? 'baskıda kaybolabilir' : (st.thin === 'thicken' ? 'kalınlaştırıldı' : 'silindi');
        row(s.residualThin > MIN_AREA ? 'bad' : 'fixed', `${fmt(st.minLine, 2)} mm'den ince gölge: <b>${fmt(s.thinLineMm2, 1)} mm²</b> → ${what}`);
      } else row('ok', `Bütün gölge çizgileri ≥ ${fmt(st.minLine, 2)} mm`);
      if (s.thinGapMm2 > MIN_AREA) {
        const what = !fix || st.gaps === 'keep' ? 'baskıda kapanabilir' : (st.gaps === 'close' ? 'kapatıldı' : 'genişletildi');
        row(s.residualGap > MIN_AREA ? 'warn' : 'fixed', `${fmt(st.minGap, 2)} mm'den dar ışık aralığı: <b>${fmt(s.thinGapMm2, 1)} mm²</b> → ${what}`);
      } else row('ok', `Bütün ışık aralıkları ≥ ${fmt(st.minGap, 2)} mm`);
      if (shadow && !shadowDirty) {
        const pct = Math.round(shadow.iou * 100);
        row(pct >= 90 ? 'ok' : (pct >= 75 ? 'warn' : 'bad'), `Basılacak gölge şablona uyumu: <b>%${pct}</b>`);
        if (shadow.stats.roofArea > 0.05) row('warn', `Desteksiz baskı çatıları: ${fmt(shadow.stats.roofArea * 100, 0)} mm² (gölgede küçük dolgular)`);
      }
      reportBox.innerHTML = `<ul>${rows.join('')}</ul>`;
      const bad = s.residualFloating > 0 || s.residualThin > MIN_AREA;
      verdict.hidden = false;
      verdict.className = 'cv-verdict ' + (bad ? 'bad' : (s.residualGap > MIN_AREA ? 'warn' : 'ok'));
      verdict.innerHTML = bad
        ? '⚠ Baskı sorunları var — "Baskı analizi" görünümüne bakın'
        : (s.floating || s.thinLineMm2 > MIN_AREA ? '✓ Baskıya hazır (düzeltmeler uygulandı)' : '✓ Baskıya hazır');
      badge.hidden = !vec;
      if (vec) {
        const kb = new Blob([svgString()]).size / 1024;
        badge.textContent = `SVG ${fmt(kb, 0)} KB · gölge ${fmt(2 * g.R, 0)} × ${fmt(2 * g.R, 0)} cm`;
        badge.title = `${vec.nodes.toLocaleString('tr-TR')} düğüm · ${vec.paths} yol`;
      }
    }

    // ---------- çizim ----------
    function maskCanvas(m, colorize) {
      const cv = Object.assign(document.createElement('canvas'), { width: S, height: S });
      const ctx = cv.getContext('2d');
      const img = ctx.createImageData(S, S);
      const d = img.data;
      const ov = colorize ? print.overlay : null;
      const COL = [null, [31, 143, 255], [255, 75, 62], [255, 159, 10], [92, 62, 140], null];
      for (let i = 0; i < S * S; i++) {
        let r, g, b;
        if (m[i]) { r = 24; g = 24; b = 26; } else { r = 246; g = 241; b = 232; }
        if (ov) {
          const o = ov[i];
          if (o === 5) { r = r * 0.75 + 20; g = g * 0.75 + 40; b = b * 0.75 + 45; }   // ışığın önü
          else if (o === 4) { r = r * 0.45 + 50; g = g * 0.45 + 34; b = b * 0.45 + 77; }
          else if (o) { const c = COL[o]; r = c[0]; g = c[1]; b = c[2]; }
        }
        d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b; d[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return cv;
    }

    function contentFor(v) {
      if (!print) return null;
      if (v === 'original') {
        if (viewDirty.original || !cvs.original) {
          const cv = Object.assign(document.createElement('canvas'), { width: S, height: S });
          const ctx = cv.getContext('2d');
          ctx.fillStyle = st.outsideLit ? '#fff' : '#000';
          ctx.fillRect(0, 0, S, S);
          ctx.save();
          placeTransform(ctx, adjCv);
          ctx.drawImage(adjCv, 0, 0);
          ctx.restore();
          cvs.original = cv;
          viewDirty.original = false;
        }
        return cvs.original;
      }
      if (v === 'stencil') {
        if (viewDirty.stencil || !cvs.stencil) { cvs.stencil = maskCanvas(print.mask, false); viewDirty.stencil = false; }
        return cvs.stencil;
      }
      if (v === 'analysis') {
        if (viewDirty.analysis || !cvs.analysis) { cvs.analysis = maskCanvas(print.mask, true); viewDirty.analysis = false; }
        return cvs.analysis;
      }
      if (v === 'shadow') return shadowDirty ? null : cvs.shadow;
      return null;
    }

    const LEGENDS = {
      original: '',
      stencil: '<span><i style="background:#18181a"></i>gölge (malzeme)</span><span><i style="background:#f6f1e8"></i>ışık (kesilir)</span>',
      analysis: '<span><i style="background:#1f8fff"></i>eklendi (köprü / kalınlaştırma)</span><span><i style="background:#ff4b3e"></i>silindi</span>'
        + '<span><i style="background:#ff9f0a"></i>kalan sorun</span><span><i style="background:#5c3e8c"></i>lamba izi / taban</span><span><i style="background:#3c5a5e"></i>ışığın önü (kesim yok)</span>',
      shadow: '<span><i style="background:#fad696"></i>ışık</span><span><i style="background:#ff4b3e"></i>şablonda gölge, lambada ışık</span>'
        + '<span><i style="background:#1f8fff"></i>lambanın eklediği gölge</span>',
    };

    let checker = null;
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const W = stage.clientWidth, H = stage.clientHeight;
      if (!W || !H) return;
      if (view2d.width !== Math.round(W * dpr) || view2d.height !== Math.round(H * dpr)) {
        view2d.width = Math.round(W * dpr); view2d.height = Math.round(H * dpr);
      }
      vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!checker) {
        const c = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
        const cc = c.getContext('2d');
        cc.fillStyle = '#1c1c1e'; cc.fillRect(0, 0, 16, 16);
        cc.fillStyle = '#262628'; cc.fillRect(0, 0, 8, 8); cc.fillRect(8, 8, 8, 8);
        checker = vctx.createPattern(c, 'repeat');
      }
      vctx.fillStyle = checker;
      vctx.fillRect(0, 0, W, H);
      empty.hidden = !!srcImg;
      thumb.hidden = !srcImg;
      zoomBar.hidden = hint.hidden = !srcImg;
      viewTabs.hidden = !srcImg;
      legend.innerHTML = srcImg ? LEGENDS[view] : '';
      legend.hidden = !srcImg || !LEGENDS[view];
      zLabel.textContent = Math.round(zoom * 100) + '%';
      if (!srcImg) return;
      let sc = (Math.min(W, H) * 0.9 / S) * zoom;
      const ox = W / 2 + panX - (S * sc) / 2, oy = H / 2 + panY - (S * sc) / 2;
      const content = contentFor(view);
      vctx.imageSmoothingEnabled = sc < 1.5;
      if (content) vctx.drawImage(content, ox, oy, S * sc, S * sc);
      else {
        vctx.fillStyle = '#202022';
        vctx.fillRect(ox, oy, S * sc, S * sc);
        vctx.fillStyle = '#a6a6aa';
        vctx.font = '13px sans-serif';
        vctx.textAlign = 'center';
        vctx.fillText(view === 'shadow' ? 'Lambanın gerçek duvarı hesaplanıyor…' : 'Hazırlanıyor…', W / 2 + panX, H / 2 + panY);
      }
      // Sürüklerken: yeni yerleşimin hızlı önizlemesi
      if (drag && drag.kind === 'move' && aCv) {
        vctx.save();
        vctx.globalAlpha = 0.55;
        vctx.translate(ox, oy);
        vctx.scale(sc, sc);
        placeTransform(vctx, aCv);
        vctx.drawImage(aCv, 0, 0);
        vctx.restore();
      }
      vctx.strokeStyle = 'rgba(255,255,255,0.25)';
      vctx.lineWidth = 1;
      vctx.strokeRect(ox + 0.5, oy + 0.5, S * sc, S * sc);
      if (st.showPaths && vec && view !== 'shadow') {
        vctx.save();
        vctx.translate(ox, oy);
        vctx.scale(sc, sc);
        vctx.strokeStyle = '#2fd4ff';
        vctx.lineWidth = 1.2 / sc;
        vctx.stroke(vec.path2d);
        vctx.restore();
      }
      {
        // Gövde izi hedef (OUT) pikselinde gelir.
        const fp = hooks.designer.footprintInTarget();
        vctx.save();
        vctx.translate(ox, oy);
        vctx.scale(sc * S / OUT, sc * S / OUT);
        sc = sc * S / OUT;
        vctx.setLineDash([6 / sc, 4 / sc]);
        vctx.strokeStyle = '#ff4b3e';
        vctx.lineWidth = 1.5 / sc;
        vctx.beginPath();
        fp.poly.forEach(([x, y], i) => (i ? vctx.lineTo(x, y) : vctx.moveTo(x, y)));
        vctx.closePath();
        vctx.stroke();
        vctx.setLineDash([]);
        vctx.strokeStyle = '#ff9f0a';
        const L = 10 / sc;
        vctx.beginPath();
        vctx.moveTo(fp.light[0] - L, fp.light[1]); vctx.lineTo(fp.light[0] + L, fp.light[1]);
        vctx.moveTo(fp.light[0], fp.light[1] - L); vctx.lineTo(fp.light[0], fp.light[1] + L);
        vctx.stroke();
        vctx.restore();
      }
    }

    function drawThumb() {
      const ctx = thumb.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 120, 120);
      if (!srcImg) return;
      const s = Math.min(120 / srcImg.width, 120 / srcImg.height);
      ctx.drawImage(srcImg, (120 - srcImg.width * s) / 2, (120 - srcImg.height * s) / 2, srcImg.width * s, srcImg.height * s);
    }

    function setView(v) {
      view = v;
      viewTabs.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.v === v));
      draw();
      if (v === 'shadow') computeShadow();
    }

    // ---------- fare / klavye ----------
    function zoomAt(f, cx, cy) {
      const W = stage.clientWidth, H = stage.clientHeight;
      const nz = Math.min(16, Math.max(0.25, zoom * f));
      const px = cx == null ? W / 2 : cx, py = cy == null ? H / 2 : cy;
      const k = nz / zoom;
      panX = (panX + W / 2 - px) * k - W / 2 + px;
      panY = (panY + H / 2 - py) * k - H / 2 + py;
      zoom = nz;
      draw();
    }
    view2d.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!srcImg) return;
      if (e.ctrlKey || e.metaKey) {
        set('size', Math.min(300, Math.max(10, Math.round(st.size * (e.deltaY < 0 ? 1.05 : 1 / 1.05)))));
        return;
      }
      const r = view2d.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    view2d.addEventListener('pointerdown', (e) => {
      if (!srcImg) return;
      view2d.setPointerCapture(e.pointerId);
      const pan = e.button === 1 || e.button === 2 || spaceDown;
      drag = { kind: pan ? 'pan' : 'move', x: e.clientX, y: e.clientY, offX: st.offX, offY: st.offY, panX, panY };
      if (!pan) drag.snapshot = JSON.stringify(st);
    });
    view2d.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.kind === 'pan') { panX = drag.panX + dx; panY = drag.panY + dy; draw(); return; }
      const sc = (Math.min(stage.clientWidth, stage.clientHeight) * 0.9 / S) * zoom;
      st.offX = Math.round((drag.offX + (dx / sc / S) * 100) * 10) / 10;
      st.offY = Math.round((drag.offY - (dy / sc / S) * 100) * 10) / 10;
      refreshControls();
      draw();
    });
    const endDrag = () => {
      if (!drag) return;
      const moved = drag.kind === 'move' && (st.offX !== drag.offX || st.offY !== drag.offY);
      const snapshot = drag.snapshot;
      drag = null;
      if (moved) {
        undoStack.push(snapshot);
        redoStack.length = 0;
        save();
        schedule(STAGE.B);
      } else draw();
    };
    view2d.addEventListener('pointerup', endDrag);
    view2d.addEventListener('pointercancel', endDrag);
    view2d.addEventListener('contextmenu', (e) => e.preventDefault());
    view2d.addEventListener('dblclick', () => { zoom = 1; panX = panY = 0; draw(); });

    function visible() { return !host.hidden; }
    window.addEventListener('keydown', (e) => {
      if (!visible()) return;
      if (e.code === 'Space' && e.target === document.body) { spaceDown = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') spaceDown = false; });
    // Klavye: [ ] boyut · Q W döndür · oklar taşı · H aynala · 1–4 görünüm · P yollar · + − 0 yakınlaştırma.
    window.addEventListener('keydown', (e) => {
      if (!visible() || !srcImg || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '')) return;
      if (document.querySelector('.modal:not([hidden])')) return;
      const k = e.key, fine = e.shiftKey;
      const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
      const step = fine ? 5 : 1;
      let handled = true;
      if (k === '[' || k === '{') set('size', clamp(Math.round(st.size - (fine ? 1 : 5)), 10, 300));
      else if (k === ']' || k === '}') set('size', clamp(Math.round(st.size + (fine ? 1 : 5)), 10, 300));
      else if (k === 'q' || k === 'Q') set('rot', ((st.rot - (fine ? 1 : 5) + 540) % 360) - 180);
      else if (k === 'w' || k === 'W') set('rot', ((st.rot + (fine ? 1 : 5) + 540) % 360) - 180);
      else if (k === 'ArrowLeft') set('offX', clamp(st.offX - step, -60, 60));
      else if (k === 'ArrowRight') set('offX', clamp(st.offX + step, -60, 60));
      else if (k === 'ArrowUp') set('offY', clamp(st.offY + step, -60, 60));
      else if (k === 'ArrowDown') set('offY', clamp(st.offY - step, -60, 60));
      else if (k === 'h' || k === 'H') set('flipX', !st.flipX);
      else if (k === 'p' || k === 'P') set('showPaths', !st.showPaths);
      else if (k >= '1' && k <= '4') setView(VIEWS[+k - 1][0]);
      else if (k === '+' || k === '=') zoomAt(1.25);
      else if (k === '-' || k === '_') zoomAt(1 / 1.25);
      else if (k === '0') { zoom = 1; panX = panY = 0; draw(); }
      else handled = false;
      if (handled) e.preventDefault();
    });
    stage.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); stage.classList.add('drop'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('drop'));
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();          // uygulama geneli bırakma işleyicisi çalışmasın
      stage.classList.remove('drop');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    new ResizeObserver(() => draw()).observe(stage);

    // ---------- giriş / çıkış ----------
    function loadImageURL(url, name, placement) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          // SVG'nin doğal boyutu olmayabilir: yüksek çözünürlükte rasterleştir.
          let src = img;
          if (!img.width || !img.height || /\.svg$/i.test(name || '') || /^data:image\/svg/.test(url)) {
            const w0 = img.width || 1024, h0 = img.height || 1024;
            const k = WORK / Math.max(w0, h0);
            src = Object.assign(document.createElement('canvas'), { width: Math.round(w0 * k), height: Math.round(h0 * k) });
            const c = src.getContext('2d');
            c.fillStyle = '#fff';
            c.fillRect(0, 0, src.width, src.height);
            c.drawImage(img, 0, 0, src.width, src.height);
          }
          srcImg = src;
          srcName = (name || 'sablon').replace(/\.[^.]+$/, '') || 'sablon';
          adjCv = null; km = null; matte = null; matteSrc = null;
          cvs.shadow = null;
          if (placement) Object.assign(st, placement);
          save();
          drawThumb();
          refreshControls();
          zoom = 1; panX = panY = 0;
          dirty = STAGE.A;
          draw();
          run();
          resolve();
        };
        img.onerror = () => { status.textContent = 'Bu görsel okunamadı.'; reject(new Error('görsel okunamadı')); };
        img.src = url;
      });
    }
    function loadFile(file) {
      if (!file) return;
      const r = new FileReader();
      r.onload = (ev) => {
        pushHistory(null);
        loadImageURL(ev.target.result, file.name, { size: DEFAULTS.size, rot: 0, offX: 0, offY: 0, flipX: false, flipY: false }).catch(() => {});
      };
      r.readAsDataURL(file);
    }
    fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; loadFile(f); });

    async function pasteFromClipboard() {
      try {
        const items = await navigator.clipboard.read();
        for (const it of items) {
          const type = it.types.find((t) => t.startsWith('image/'));
          if (type) { loadFile(new File([await it.getType(type)], 'pano.' + type.split('/')[1], { type })); return; }
        }
        status.textContent = 'Panoda görsel yok.';
      } catch (e) {
        status.textContent = 'Pano okunamadı — Ctrl+V ile yapıştırın.';
      }
    }

    function loadFromLamp() {
      const url = hooks.designer.getTargetImageDataURL();
      // Hedef görüntü zaten çerçevenin tamamı: birebir yerleşim.
      loadImageURL(url, 'lamba-silueti', {
        size: 100, rot: 0, offX: 0, offY: 0, flipX: false, flipY: false, outsideLit: hooks.designer.isOutsideLit(),
        mode: 'threshold', levelAuto: false, level: 128, adaptive: 0, invert: false,
        brightness: 0, contrast: 0, gamma: 1, saturation: 0, blur: 0, grow: 0, smooth: 0,
      }).catch(() => {});
    }

    function download(blob, name) { hooks.download(blob, name); }
    function saveSVG() { if (vec) download(new Blob([svgString()], { type: 'image/svg+xml' }), srcName + '-golge.svg'); }
    async function copySVG() {
      if (!vec) return;
      try { await navigator.clipboard.writeText(svgString()); status.textContent = 'SVG panoya kopyalandı.'; }
      catch (e) { status.textContent = 'Kopyalanamadı: ' + e.message; }
    }
    function savePNG() { if (vec) renderTarget().toBlob((b) => download(b, srcName + '-golge.png'), 'image/png'); }

    function apply() {
      if (!vec || !hooks.onApply) return;
      hooks.onApply(renderTarget().toDataURL('image/png'), st.outsideLit);
    }

    if (global.HelpTips) HelpTips.compact(side);
    if (!Number.isFinite(st.bridge)) st.bridge = lampBridge();
    refreshControls();
    updateReport();

    return {
      open() {
        // Lamba ayarları değişmiş olabilir: baskı analizini tazele.
        shadowDirty = true;
        updateReport();
        if (srcImg && mapKey !== hooks.designer.getPrintGeometry().key) schedule(STAGE.C);
        requestAnimationFrame(draw);
      },
      loadImageURL,
      loadFile,
      openFileDialog: () => fileIn.click(),
      pasteFromClipboard,
      loadFromLamp,
      saveSVG, savePNG, copySVG, apply,
      resetSettings,
      hasResult: () => !!vec,
      hasImage: () => !!srcImg,
      undo, redo,
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      setView,
      getView: () => view,
      zoomIn: () => zoomAt(1.25), zoomOut: () => zoomAt(1 / 1.25), zoomFit: () => { zoom = 1; panX = panY = 0; draw(); },
      togglePaths: () => set('showPaths', !st.showPaths),
      pathsShown: () => !!st.showPaths,
    };
  }

  global.ImageConverter = { init };
})(window);
