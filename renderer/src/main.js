/**
 * Giriş noktası: ayar paneli (şemadan üretilir), fotoğraf → lamba akışı,
 * 3B görünüm modları, model dışa aktarma (STL/3MF/OBJ/FBX/PLY/GLB) ve kaydet/aç.
 */

(function () {
  'use strict';

  let designer = null;
  let inspector = null;      // sağdaki Özellikler | Dosyalar sütunu (aşağıda kurulur)
  const $ = (id) => document.getElementById(id);

  // ---------- ayar şeması ----------
  // type: num | select | check | color. Kimlikler tasarımcı ve kayıt dosyasıyla ortak.

  const SCHEMA = {
    shadow: [
      { id: 'd-R', label: 'Gölge boyutu', unit: 'cm', min: 20, max: 150, step: 2, value: 60, note: 'Siluet görüntüsünün duvardaki yarı genişliği.' },
      { id: 'g-quality', type: 'select', label: 'Detay seviyesi', value: 'high', options: [
        ['medium', 'Normal (hızlı)'], ['high', 'Yüksek (önerilen)'], ['ultra', 'Çok yüksek (çok ince detay, büyük dosya)'], ['low', 'Düşük (taslak)']],
        note: 'İnce detaylı silüetlerde "Çok yüksek" seçin; önizleme yavaşlar, STL büyür.' },
      { id: 'd-rot', label: 'Gölge döndürme açısı', unit: '°', min: -180, max: 180, step: 1, value: 0 },
      { id: 'd-offx', label: 'Gölge kaydır X', unit: 'cm', min: -60, max: 60, step: 0.5, value: 0 },
      { id: 'd-offy', label: 'Gölge kaydır Y', unit: 'cm', min: -60, max: 60, step: 0.5, value: 0 },
    ],
    body: [
      { id: 's-shape', type: 'select', label: 'Gövde şekli', value: 'square', options: [
        ['square', 'Kare'], ['rect', 'Dikdörtgen'], ['roundedRect', 'Yuvarlak köşeli'], ['circle', 'Silindir'],
        ['polygon', 'Çokgen (altıgen, sekizgen…)'], ['star', 'Yıldız'], ['flower', 'Çiçek'], ['heart', 'Kalp']] },
      { id: 's-W', param: 'W', label: 'Genişlik', unit: 'cm', min: 6, max: 40, step: 0.5, value: 15 },
      { id: 's-H', param: 'H', label: 'Yükseklik', unit: 'cm', min: 6, max: 40, step: 0.5, value: 15 },
      { id: 's-N', param: 'N', label: 'Kenar sayısı', unit: '', min: 3, max: 12, step: 1, value: 6 },
      { id: 's-A', param: 'A', label: 'Oran', unit: '%', min: 20, max: 90, step: 1, value: 50 },
      { id: 's-d', label: 'Derinlik', unit: 'cm', min: 3, max: 25, step: 0.5, value: 6 },
      { id: 's-lightz', label: 'Işık konumu', unit: '% derinlik', min: 40, max: 90, step: 1, value: 90 },
      { id: 's-taper', label: 'Daralma (ön / arka)', unit: '%', min: -30, max: 50, step: 1, value: 0 },
    ],
    support: [
      { id: 'd-ribs', label: 'Destek kolonu', unit: 'adet', min: 0, max: 12, step: 1, value: 3, showIf: () => mount() === 'cap',
        note: 'Ön çemberi tabana bağlar; siluetin gölge yaptığı yerlere konur. Şeffaf tüp montajında gerekmez.' },
      { id: 'd-ribw', label: 'Kolon / köprü kalınlığı', unit: 'mm', min: 0.8, max: 6, step: 0.1, value: 1.2,
        note: 'Kopuk parçaları (harf, dal ucu) bağlayan köprüler. İnce = gölgede az görünür; 0,8 mm altı basılamaz.' },
      { id: 'd-margin', label: 'Işığa en yakın kesim payı', unit: 'mm', min: 1, max: 10, step: 1, value: 3 },
      { id: 'd-minhole', label: 'En küçük ışık deliği', unit: 'mm²', min: 0, max: 30, step: 1, value: 2 },
    ],
    print: [
      { id: 'g-bedx', label: 'Tabla genişliği (X)', unit: 'mm', min: 100, max: 1000, step: 1, value: 256,
        note: 'Yazıcınızın baskı alanı. Gövde ve kapak bu ölçülere göre tablaya yerleştirilir; sığmazsa uyarı verilir.' },
      { id: 'g-bedy', label: 'Tabla derinliği (Y)', unit: 'mm', min: 100, max: 1000, step: 1, value: 256 },
      { id: 'g-bedz', label: 'Baskı yüksekliği (Z)', unit: 'mm', min: 100, max: 1000, step: 1, value: 256 },
      { id: 'g-mount', type: 'select', label: 'Işık montajı', value: 'tube', options: [
        ['tube', 'Şeffaf tüp (önerilen — gölgede kolon çizgisi yok)'], ['cap', 'Ön kapak + LED yuvası (tüp gerekmez)']],
        note: 'Şeffaf tüp: tabandaki halkaya akrilik tüp takılır, LED tüpün tepesinde aşağı bakar. Duvar yalnızca siluetin olduğu yerde yükselir; siluet lambanın etrafını sarmalı.' },
      { id: 'g-tube', label: 'Tüp dış çapı', unit: 'mm', min: 20, max: 80, step: 1, value: 40, showIf: () => mount() === 'tube' },
      { id: 'g-holder', label: 'Tüp tutucu yüksekliği', unit: 'mm', min: 4, max: 30, step: 1, value: 10, showIf: () => mount() === 'tube' },
      { id: 'g-mode', type: 'select', label: 'Baskı şekli', value: 'onepiece', options: [
        ['onepiece', 'Tek parça (gövde + taban dik basılır)'], ['flat', 'Düz paneller (basıp yapıştırılır)']] },
      { id: 'g-supportfree', type: 'check', label: 'Desteksiz baskı (sarkan yerlerin altına 45° çatı)', value: false, showIf: () => $('g-mode').value === 'onepiece',
        note: 'Kapalıyken (varsayılan) gölge siluete birebir uyar; gövdeyi dilimleyicide destek açarak basın, destekler sonra sökülür. Açıkken dik basılan gövdede havaya basılacak yatay çıkıntı kalmaz, ama sarkan yerlerin altına eklenen çatılar duvarda büyür ve gölgenin uzak kenarında testere dişi gibi görünebilir.' },
      { id: 'g-chamfer', type: 'check', label: 'Panel kenarları 45° pahlı (köşeler temiz birleşir)', value: true, showIf: () => $('g-mode').value === 'flat' },
      { id: 'g-layer', type: 'check', label: '0,2 mm destek katmanı (kopuk parçaları köprüsüz tutar)', value: false, showIf: () => $('g-mode').value === 'flat' },
      { id: 'g-thickness', label: 'Duvar kalınlığı', unit: 'mm', min: 0.8, max: 5, step: 0.1, value: 1.6 },
      { id: 'g-plate', label: 'Taban kalınlığı', unit: 'mm', min: 1.5, max: 8, step: 0.5, value: 3 },
      { id: 'g-cap', label: 'Kapak kalınlığı', unit: 'mm', min: 1.2, max: 6, step: 0.2, value: 2.4, note: 'Tüp modunda tüpün tepesindeki LED kapağı.' },
      { id: 'g-seat', label: 'LED yuva çapı', unit: 'mm', min: 5, max: 60, step: 0.5, value: 20 },
      { id: 'g-keyhole', type: 'check', label: 'Duvar askı deliği (anahtar deliği)', value: true },
    ],
    room: [
      { id: 'l-color', type: 'color', label: 'LED rengi', value: '#ffc46e', swatches: [
        ['#ffb35c', 'Sıcak'], ['#ffc46e', 'Sıcak beyaz'], ['#fff1dc', 'Gün ışığı'], ['#cfe3ff', 'Soğuk'],
        ['#ff4b3e', 'Kırmızı'], ['#4c8dff', 'Mavi'], ['#4cd964', 'Yeşil'], ['#c77dff', 'Mor']] },
      { id: 'l-bright', label: 'Işık şiddeti', unit: '%', min: 10, max: 300, step: 5, value: 100 },
      { id: 'l-wall', type: 'color', label: 'Duvar rengi', value: '#efe9df', swatches: [
        ['#efe9df', 'Beyaz'], ['#a8a39b', 'Gri'], ['#e3cfae', 'Bej'], ['#b9cbe0', 'Açık mavi'], ['#3a3a3c', 'Antrasit']] },
      { id: 'l-wallsize', label: 'Aydınlanan duvar genişliği', unit: 'cm', min: 60, max: 600, step: 10, value: 240,
        note: 'Karanlık odada gösterilen duvar alanı. Gölge boyutunun dışında kalan kısımda lambanın duvara düşürdüğü ışık da görünür. Gölge boyutundan küçükse gölge boyutu kullanılır. Yalnızca önizlemeyi etkiler, baskıyı değiştirmez.' },
    ],
    compare: [
      { id: 'c-align', type: 'select', label: 'Konum', value: 'auto', showIf: () => compareLoaded, options: [
        ['auto', 'Lambaya hizala (ortala, duvara oturt)'], ['original', "Orijinal koordinatlar (bu uygulamanın STL'i)"]] },
      { id: 'c-units', type: 'select', label: 'Model birimi', value: 'mm', showIf: () => compareLoaded, options: [
        ['mm', 'Milimetre'], ['cm', 'Santimetre'], ['m', 'Metre'], ['in', 'İnç']] },
      { id: 'c-up', type: 'select', label: 'Yukarı ekseni', value: 'z', showIf: () => compareLoaded, options: [
        ['z', 'Z yukarı (STL, 3MF, bu uygulama)'], ['y', 'Y yukarı (OBJ, FBX)']] },
      { id: 'c-rot', label: 'Eksen etrafında döndür', unit: '°', min: -180, max: 180, step: 1, value: 0, showIf: () => compareLoaded },
      { id: 'c-offx', label: 'Kaydır X', unit: 'mm', min: -500, max: 500, step: 0.5, value: 0, showIf: () => compareLoaded },
      { id: 'c-offy', label: 'Kaydır Y', unit: 'mm', min: -500, max: 500, step: 0.5, value: 0, showIf: () => compareLoaded },
      { id: 'c-offz', label: 'Kaydır Z (duvardan)', unit: 'mm', min: -500, max: 500, step: 0.5, value: 0, showIf: () => compareLoaded },
      { id: 'c-color', type: 'color', label: 'Model rengi', value: '#ff8a3d', showIf: () => compareLoaded, swatches: [
        ['#ff8a3d', 'Turuncu'], ['#34c759', 'Yeşil'], ['#1f8fff', 'Mavi'], ['#ff4b3e', 'Kırmızı'], ['#f2f2f0', 'Beyaz']] },
      { id: 'c-opacity', label: 'Model saydamlığı', unit: '%', min: 10, max: 100, step: 5, value: 60, showIf: () => compareLoaded },
      { id: 'c-visible', type: 'check', label: 'Modeli göster', value: true, showIf: () => compareLoaded },
      { id: 'c-hidegen', type: 'check', label: 'Üretilen lambayı gizle', value: false, showIf: () => compareLoaded },
    ],
  };
  let compareLoaded = false;
  const ALL_FIELDS = Object.values(SCHEMA).flat();
  function mount() { const el = $('g-mount'); return el ? el.value : 'tube'; }

  function updateVisibility() {
    ALL_FIELDS.forEach((def) => {
      if (!def.showIf) return;
      const el = $(def.id);
      if (el) el.closest('.field').hidden = !def.showIf();
    });
  }

  function fire(el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }

  function makeField(def) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    if (def.param) wrap.dataset.param = def.param;
    const type = def.type || 'num';

    if (type === 'check') {
      wrap.innerHTML = `<label class="check"><input type="checkbox" id="${def.id}" data-default="${def.value ? 'true' : 'false'}" ${def.value ? 'checked' : ''}/> ${def.label}</label>`;
      return wrap;
    }
    const label = document.createElement('label');
    label.htmlFor = def.id;
    label.innerHTML = `<span id="${def.id}-label">${def.label}</span>${def.unit ? `<small>${def.unit}</small>` : ''}`;
    wrap.appendChild(label);

    if (type === 'select') {
      const sel = document.createElement('select');
      sel.id = def.id;
      def.options.forEach(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = def.value;
      sel.dataset.default = def.value;
      wrap.appendChild(sel);
    } else if (type === 'color') {
      const box = document.createElement('div');
      box.className = 'colorbox';
      box.innerHTML = `<input type="color" id="${def.id}" value="${def.value}" data-default="${def.value}"><div class="swatches"></div>`;
      const input = box.querySelector('input');
      def.swatches.forEach(([hex, name]) => {
        const b = document.createElement('button');
        b.className = 'swatch';
        b.title = name;
        b.style.background = hex;
        b.addEventListener('click', () => { input.value = hex; fire(input); });
        box.querySelector('.swatches').appendChild(b);
      });
      wrap.appendChild(box);
    } else {
      const box = document.createElement('div');
      box.className = 'numbox';
      box.innerHTML = `<input type="number" id="${def.id}" min="${def.min}" max="${def.max}" step="${def.step}" value="${def.value}" data-default="${def.value}">`
        + `<button type="button" class="dec" tabindex="-1">−</button><button type="button" class="inc" tabindex="-1">+</button>`;
      const input = box.querySelector('input');
      const clamp = (v) => Math.min(def.max, Math.max(def.min, v));
      const nudge = (dir) => {
        const dec = (String(def.step).split('.')[1] || '').length;
        input.value = clamp(+((+input.value || 0) + dir * def.step).toFixed(dec));
        fire(input);
      };
      box.querySelector('.dec').addEventListener('click', () => nudge(-1));
      box.querySelector('.inc').addEventListener('click', () => nudge(1));
      input.addEventListener('change', () => {
        const v = +input.value;
        if (!isFinite(v) || v !== clamp(v)) { input.value = clamp(isFinite(v) ? v : def.value); fire(input); }
      });
      wrap.appendChild(box);
    }
    if (def.note) {
      const n = document.createElement('div');
      n.className = 'field-note';
      n.textContent = def.note;
      wrap.appendChild(n);
    }
    return wrap;
  }

  Object.entries(SCHEMA).forEach(([section, defs]) => {
    const host = $(`fields-${section}`);
    defs.forEach((def) => host.appendChild(makeField(def)));
  });

  // Paneller açılıp kapanır.
  document.querySelectorAll('.panel-head').forEach((h) => {
    h.addEventListener('click', () => {
      h.parentElement.classList.toggle('open');
      window.dispatchEvent(new Event('resize'));
    });
  });

  // Yalnızca masaüstü uygulamasında çalışan özellikler tarayıcıda hiç gösterilmez.
  const isDesktop = !!(window.appAPI && window.appAPI.isDesktop);
  if (!Silhouette.aiAvailable()) {
    $('photo-method').querySelector('option[value="ai"]').remove();
  }

  const geo = Geometry.init($('three-wrap'));

  // ---------- kayıt durumu ----------

  const STATE_IDS = [...ALL_FIELDS.filter((f) => !f.id.startsWith('c-')).map((f) => f.id), 'wf-autoshape'];

  function readState() {
    const v = {};
    STATE_IDS.forEach((id) => {
      const el = $(id);
      if (!el) return;
      v[id] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? +el.value : el.value);
    });
    return v;
  }

  function writeState(state) {
    Object.entries(state || {}).forEach(([id, value]) => {
      const el = $(id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!value;
      else el.value = value;
    });
  }

  // ---------- şekle özel alanlar ----------

  const PARAM_LABELS = {
    W: { circle: 'Çap', polygon: 'Karşılıklı kenar arası', star: 'Dış çap', flower: 'Dış çap', _: 'Genişlik' },
    N: { polygon: 'Kenar sayısı', star: 'Uç sayısı', flower: 'Yaprak sayısı', _: 'Adet' },
    A: { star: 'İç yarıçap', flower: 'Dalga derinliği', _: 'Oran' },
  };
  const flatOption = $('g-mode').querySelector('option[value="flat"]');

  function updateShapeControls() {
    const kind = $('s-shape').value;
    const entry = Shapes.CATALOG[kind] || Shapes.CATALOG.square;
    document.querySelectorAll('[data-param]').forEach((el) => {
      el.hidden = !entry.params.includes(el.dataset.param);
    });
    Object.entries(PARAM_LABELS).forEach(([param, labels]) => {
      const el = $(`s-${param}-label`);
      if (el) el.textContent = labels[kind] || labels._;
    });
    // Düz panel yalnızca köşeli şekillerde mümkün: diğerlerinde seçenek görünmez.
    if (entry.faceted) {
      if (!flatOption.parentNode) $('g-mode').appendChild(flatOption);
    } else {
      if ($('g-mode').value === 'flat') $('g-mode').value = 'onepiece';
      flatOption.remove();
    }
    updateVisibility();
  }

  // ---------- baskı seçenekleri + sahne ----------

  function numVal(id, fb) { const v = +$(id).value; return isFinite(v) && v > 0 ? v : fb; }

  function printOpts(assembled) {
    return {
      mode: $('g-mode').value,
      thickness: Math.max(0.8, numVal('g-thickness', 1.6)),
      plateThickness: numVal('g-plate', 3),
      capThickness: numVal('g-cap', 2.4),
      ledSeat: Math.max(5, numVal('g-seat', 20)),
      keyhole: $('g-keyhole').checked,
      mount: mount(),
      tubeOD: numVal('g-tube', 40),
      holderHeight: numVal('g-holder', 10),
      chamfer: $('g-chamfer').checked,
      supportLayer: $('g-layer').checked,
      bed: { x: Math.max(100, numVal('g-bedx', 256)), y: Math.max(100, numVal('g-bedy', 256)), z: Math.max(100, numVal('g-bedz', 256)) },
      assembled,
    };
  }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(rebuildPreview, 150);
  }

  function rebuildPreview() {
    const field = designer ? designer.getField() : null;
    if (!field) return;
    const p = designer.getParams();

    // Montaj görünümü (oda)
    const optsAssembled = printOpts(true);
    // Baskı düzeni (tabla) — assembled: false
    const optsPrint = printOpts(false);

    let lampAssembled = null, lampPrint = null;
    try {
      lampAssembled = ShellMesher.buildLamp(field, optsAssembled);
    } catch (err) {
      console.error('preview mesh (montaj)', err);
    }
    try {
      lampPrint = ShellMesher.buildLamp(field, optsPrint);
    } catch (err) {
      console.error('preview mesh (baskı)', err);
    }

    // Baskı doğrulama
    let validation = null;
    if (lampPrint) {
      try {
        validation = ShellMesher.validatePrint(lampPrint.meshes);
      } catch (err) {
        console.error('validatePrint', err);
      }
    }
    updatePrintStatus(validation, lampPrint ? lampPrint.info : null);

    const body = lampAssembled ? lampAssembled.info.bodyMM : null;
    const opts = optsAssembled;
    geo.buildScene({
      meshes: lampAssembled ? lampAssembled.meshes : [],
      printMeshes: lampPrint ? lampPrint.meshes : [],
      floatingNames: validation ? validation.floating.map((f) => f.name) : [],
      d: p.d, cz: p.cz, R: p.R,
      simCanvas: simCanvas, maskCanvas: maskCanvas, wallR: Math.max(p.R, p.look.wallSize / 2),
      shadowBBox: designer.getShadowBBox(),
      bed: opts.bed,
      bodyMM: body,
      fitsBed: !body || (body.d <= opts.bed.z
        && ((body.w <= opts.bed.x && body.h <= opts.bed.y) || (body.w <= opts.bed.y && body.h <= opts.bed.x))),
      look: p.look,
    });
    if (compareLoaded) updateCompareStats();
  }

  window.onWallFieldUpdated = () => { schedulePreview(); updateAccuracy(); };

  // ---------- gölge uyumu + detay iyileştirme ----------

  const accEl = $('accuracy'), optBtn = $('wf-optimize');
  function updateAccuracy() {
    const acc = designer && designer.getAccuracy();
    if (!acc) { accEl.hidden = true; optBtn.hidden = true; return; }
    const pct = Math.round(acc.iou * 100);
    const cls = pct >= 95 ? 'good' : pct >= 88 ? 'ok' : 'bad';
    const word = pct >= 95 ? 'Çok iyi' : pct >= 88 ? 'İyi' : 'Detay kayboluyor';
    accEl.hidden = false;
    accEl.className = 'accuracy ' + cls;
    accEl.innerHTML = `<div class="acc-row"><span>Gölge uyumu</span><strong>%${pct} · ${word}</strong></div>`
      + `<div class="acc-bar"><i style="width:${Math.max(3, pct)}%"></i></div>`
      + `<div class="acc-detail">Kaybolan detay %${(acc.lost * 100).toFixed(1)} · fazladan gölge %${(acc.extra * 100).toFixed(1)}</div>`
      + detailLimitHtml();
    optBtn.hidden = pct >= 97;
    // Çok sayıda kopuk parça: köprüler gölgede çizgi bırakır → köprüsüz seçeneği öner.
    const field = designer.getField();
    const nb = field && field.stats ? field.stats.bridges || 0 : 0;
    if (nb >= 6 && field.shape.faceted && $('g-mode').value !== 'flat') {
      accEl.innerHTML += `<div class="acc-tip">${nb} kopuk parça köprüyle bağlandı; köprüler gölgede ince çizgi bırakır. `
        + `<button class="small" id="acc-flat">Köprüsüz yap: düz panel + 0,2 mm katman</button></div>`;
      $('acc-flat').addEventListener('click', () => {
        $('g-mode').value = 'flat'; $('g-layer').checked = true;
        updateVisibility();
        recomputeAll();
        showStatus('<strong>Köprüsüz baskı:</strong> paneller tablada yatık basılır; kopuk parçalar 0,2 mm\'lik ince katmanla tutulur (ışığı büyük ölçüde geçirir). Basıp birleştirin.');
      });
    } else if (nb >= 6 && !field.shape.faceted) {
      accEl.innerHTML += `<div class="acc-tip">${nb} kopuk parça köprüyle bağlandı. Köprüsüz baskı için köşeli bir gövde (kare, dikdörtgen, çokgen) seçip düz paneli kullanın.</div>`;
    }
  }

  /**
   * Baskı doğrulama durumu — validatePrint sonucunu UI'a yansıtır.
   * validation: { ok, parts, grounded, floating: [{name, minZ, size}] } veya null.
   * info: buildLamp'tan gelen info nesnesi (mount bilgisi için).
   */
  const printStatusEl = $('print-status');
  /**
   * Bileşen sayısı üst üste oturan katıları (kapak, tapa, direk, LED yuvası…)
   * ayrı sayar; kullanıcıya basılacak nesneleri ad ad gösteririz.
   */
  function printGroupsText(validation) {
    const names = validation.names || [];
    // Silüet yokken de tabanın kenarında birkaç mm'lik duvar bandı basılır; ölçüt hedefin kendisi.
    const hasWall = !!designer.getAccuracy();
    const groups = [];
    if (hasWall && names.some((n) => /^(shell|wall|panel)/.test(n))) groups.push(names.some((n) => /^panel/.test(n)) ? 'duvar panelleri' : 'gövde duvarı');
    if (names.includes('base-plate')) groups.push('taban plakası');
    const parts = [names.includes('tube-holder') && 'tüp tutucu', names.some((n) => /^(tube-cap|cap|led-)/.test(n)) && 'LED kapağı'].filter(Boolean);
    if (parts.length) groups.push(parts.join(' + ') + (geo.isLidVisible() ? '' : ' (tablada gizli: "Montaj parçaları")'));
    const list = groups.join(', ');
    return list;
  }

  // Baskı durumu tablada birkaç saniye görünür, sonra kaybolur; kalıcı özeti
  // durum çubuğunda ("Baskı"), tam metni Mesajlar listesinde kalır.
  let printStatusTimer = null;
  let lastPrintHtml = '';
  function updatePrintStatus(validation, info) {
    if (!printStatusEl) return;
    const sb = $('sb-print');
    // Siluet yokken (ilk açılış) baskı durumu gösterilmez: ortada basılacak bir lamba yok.
    if (!validation || !designer.getAccuracy()) { printStatusEl.hidden = true; sb.hidden = true; lastPrintHtml = ''; return; }
    let html, cls, summary;
    if (validation.ok) {
      cls = 'good';
      summary = '✓ Baskı: hazır';
      html = `<span class="ps-icon">✓</span> ${printGroupsText(validation)} · hepsi tablaya oturuyor`
        + (info && info.mount === 'tube' && info.tubeLengthMM
          ? ` · şeffaf tüp <strong>${info.tubeLengthMM.toFixed(0)} mm</strong> (satın alınır, basılmaz)`
          : '');
    } else {
      cls = 'bad';
      summary = `⚠ Baskı: ${validation.floating.length} parça havada`;
      const names = validation.floating.map((f) => `<strong>${escapeHtml(f.name)}</strong>`).join(', ');
      html = `<span class="ps-icon">⚠</span> ${validation.floating.length} parça havada kalıyor (tablada kırmızı): ${names}`;
    }
    sb.hidden = false;
    sb.className = 'sb-link sb-print ' + cls;
    sb.textContent = summary;
    sb.title = printStatusEl.textContent || '';
    if (html === lastPrintHtml) return;          // değişmediyse tekrar gösterme
    lastPrintHtml = html;
    printStatusEl.className = 'print-status bed-only ' + cls;
    printStatusEl.innerHTML = html;
    sb.title = printStatusEl.textContent;
    logMessage(html, cls);
    printStatusEl.hidden = false;
    printStatusEl.classList.remove('fade');
    clearTimeout(printStatusTimer);
    printStatusTimer = setTimeout(() => {
      printStatusEl.classList.add('fade');
      printStatusTimer = setTimeout(() => { printStatusEl.hidden = true; }, 400);
    }, cls === 'bad' ? 7000 : 3000);
  }

  // ---------- mesaj geçmişi (durum çubuğu → Mesajlar) ----------
  const messageLog = [];
  function logMessage(html, kind) {
    messageLog.unshift({ time: new Date(), html, kind: kind || 'info' });
    if (messageLog.length > 60) messageLog.pop();
    const b = $('sb-msgs');
    if (b) b.textContent = `💬 Mesajlar (${messageLog.length})`;
    renderMessages();
  }
  function renderMessages() {
    const panel = $('msg-panel');
    if (!panel || panel.hidden) return;
    const list = panel.querySelector('ul');
    list.innerHTML = messageLog.length
      ? messageLog.map((m) => `<li class="${m.kind}"><time>${m.time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><div>${m.html}</div></li>`).join('')
      : '<li class="empty">Henüz mesaj yok.</li>';
  }
  function toggleMessages(force) {
    const panel = $('msg-panel');
    panel.hidden = force != null ? !force : !panel.hidden;
    renderMessages();
  }



  /**
   * Basılabilir en ince detay: duvardaki detay lamba duvarında t = ρ/r kat
   * küçülür; yazıcının basabildiği en ince çizgi ~2 nozul (≈0,8 mm).
   */
  function detailLimitHtml() {
    const field = designer.getField();
    const p = designer.getParams();
    if (!field || !p) return '';
    const b = field.shape.bounds();
    const r = Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2;      // cm, en dar yarıçap
    const minLine = 0.8;                                           // mm, ~2 × 0,4 mm nozul
    const near = minLine * Math.max(1, (r * 1.5) / r);
    const edge = minLine * (p.R / r);
    return `<div class="acc-detail">Basılabilir en ince detay: lamba yakınında ~${near.toFixed(1)} mm, gölge kenarında ~${edge.toFixed(0)} mm. `
      + `Daha ince çizgiler kaybolur ya da kalınlaşır — gövdeyi büyütün veya gölge boyutunu küçültün.</div>`;
  }

  const sleep0 = () => new Promise((r) => setTimeout(r, 0));
  async function optimizeDetail() {
    const kind = $('s-shape').value;
    const twoD = Shapes.CATALOG[kind].params.includes('H');
    const W0 = +$('s-W').value, H0 = twoD ? +$('s-H').value : W0, d0 = +$('s-d').value;
    const bed = Math.min(numVal('g-bedx', 256), numVal('g-bedy', 256)), bedZ = numVal('g-bedz', 256), t = numVal('g-thickness', 1.6);
    const before = designer.getAccuracy();
    optBtn.disabled = true;
    const tries = [];
    const factors = [1, 1.15, 1.3, 1.5, 1.75, 2, 2.4];
    let best = null;
    for (const fct of factors) {
      const W = Math.min(40, Math.round(W0 * fct * 2) / 2), H = Math.min(40, Math.round(H0 * fct * 2) / 2);
      const d = Math.min(25, Math.round(d0 * Math.sqrt(fct) * 2) / 2);
      // Gövde tablaya sığmalı (çapraz ölçü yerine en/boy; şekiller sınır kutusuna sığar).
      if (Math.max(W, H) * 10 + t > bed - 6 || d * 10 > bedZ - 6) break;
      if (tries.some((x) => x.W === W && x.H === H && x.d === d)) continue;
      showStatus(`<strong>Detay iyileştiriliyor…</strong> gövde ${W} × ${twoD ? H : W} × ${d} cm deneniyor`);
      await sleep0();
      const acc = designer.evaluate({ shapeSpec: { W, H }, d });
      if (!acc) break;
      const tr = { W, H, d, acc, quality: $('g-quality').value };
      tries.push(tr);
      if (!best || acc.iou > best.acc.iou + 0.004) best = tr;
      if (acc.iou >= 0.95) break;
    }
    // Hâlâ yetersizse çok yüksek detay seviyesini de dene.
    if (best && best.acc.iou < 0.95 && $('g-quality').value !== 'ultra') {
      showStatus('<strong>Detay iyileştiriliyor…</strong> çok yüksek detay seviyesi deneniyor');
      await sleep0();
      const acc = designer.evaluate({ shapeSpec: { W: best.W, H: best.H }, d: best.d, maxCells: 650000 });
      if (acc && acc.iou > best.acc.iou + 0.005) best = Object.assign({}, best, { acc, quality: 'ultra' });
    }
    // Baskı şekli de detayı etkiler: dik desteksiz baskıda ince çıkıntıların
    // altına çatı eklenir. Aynı boyutta alternatif baskı şekillerini de dene.
    let printChoice = null;
    if (best) {
      const base = { shapeSpec: { W: best.W, H: best.H }, d: best.d, maxCells: best.quality === 'ultra' ? 650000 : undefined };
      const cands = [];
      if ($('g-mode').value === 'onepiece' && $('g-supportfree').checked) {
        cands.push({ key: 'supports', label: 'tek parça, dilimleyici desteğiyle', o: { supportFree: false } });
      }
      if (Shapes.CATALOG[kind].faceted && !($('g-mode').value === 'flat' && $('g-layer').checked)) {
        cands.push({ key: 'flat', label: 'düz paneller + 0,2 mm katman (desteksiz ve köprüsüz)', o: { mode: 'flat', supportLayer: true, supportFree: false } });
      }
      for (const cd of cands) {
        showStatus(`<strong>Detay iyileştiriliyor…</strong> baskı şekli deneniyor: ${cd.label}`);
        await sleep0();
        const acc = designer.evaluate(Object.assign({}, base, cd.o));
        if (acc && acc.iou > best.acc.iou + 0.02 && (!printChoice || acc.iou > printChoice.acc.iou)) printChoice = Object.assign({}, cd, { acc });
      }
    }
    optBtn.disabled = false;
    if (!best) { showStatus('Önce bir silüet yükleyin.'); return; }
    $('s-W').value = best.W;
    if (twoD) $('s-H').value = best.H;
    $('s-d').value = best.d;
    $('g-quality').value = best.quality;
    if (printChoice) {
      if (printChoice.key === 'supports') $('g-supportfree').checked = false;
      if (printChoice.key === 'flat') { $('g-mode').value = 'flat'; $('g-layer').checked = true; }
      updateVisibility();
      best = Object.assign({}, best, { acc: printChoice.acc });
    }
    recomputeAll();
    // "Önce" aynı yöntemle ölçülmüş ilk deneme (mevcut gövde) — tutarlı karşılaştırma.
    const first = tries.length ? tries[0].acc : before;
    const b = first ? Math.round(first.iou * 100) : null;
    const a = Math.round(best.acc.iou * 100);
    showStatus(`<strong>Detay iyileştirildi:</strong> gövde ${best.W} × ${twoD ? best.H : best.W} × ${best.d} cm`
      + (best.quality === 'ultra' ? ', detay seviyesi "Çok yüksek"' : '')
      + (printChoice ? `, baskı şekli: <strong>${printChoice.label}</strong> (dik desteksiz baskı ince çıkıntıların altına dolgu ekleyip detayı bozuyordu)` : '')
      + `. Gölge uyumu ${b != null ? '%' + b + ' → ' : ''}%${a}.`
      + (a < 95 ? '<br><span class="warn">⚠ Daha fazlası için siluetteki çok ince çizgileri editörde "Kalınlaştır" ile belirginleştirin veya gölge boyutunu küçültün.</span>' : ''));
  }
  optBtn.addEventListener('click', optimizeDetail);

  // ---------- basit / gelişmiş arayüz ----------

  const appEl = document.querySelector('.app');

  function recomputeAll() { if (designer) designer.recompute(); }

  ['s-W', 's-H', 's-N', 's-A', 's-d', 's-lightz', 's-taper'].forEach((id) => $(id).addEventListener('input', recomputeAll));
  $('s-shape').addEventListener('change', () => { updateShapeControls(); recomputeAll(); });
  $('g-mode').addEventListener('change', () => { updateVisibility(); recomputeAll(); }); // düz panelde köşe direkleri alana eklenir
  $('g-mount').addEventListener('change', updateVisibility);
  ['g-thickness', 'g-cap', 'g-seat', 'g-bedx', 'g-bedy', 'g-bedz', 'g-tube', 'g-holder'].forEach((id) => $(id).addEventListener('input', schedulePreview));
  $('g-chamfer').addEventListener('change', schedulePreview);
  $('g-keyhole').addEventListener('change', schedulePreview);

  // ---------- görünüm modları + araç çubuğu ----------

  function setView(v) {
    geo.setView(v);
    document.querySelectorAll('.viewport .view-switch .seg').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    syncTools();
  }
  function syncTools() {
    $('t-cap').classList.toggle('on', geo.isLidVisible());
    $('t-dims').classList.toggle('on', geo.isDimsVisible());
    $('t-light').classList.toggle('on', geo.isLightOn());
    $('t-light').textContent = geo.isLightOn() ? 'Lamba açık' : 'Lamba kapalı';
    $('t-real').classList.toggle('on', geo.isRealShadow());
  }
  document.querySelectorAll('.viewport .view-switch .seg').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('.view-toolbar [data-cam]').forEach((b) => b.addEventListener('click', () => geo.setCamPreset(b.dataset.cam)));
  $('t-cap').addEventListener('click', () => { geo.setShowLid(!geo.isLidVisible()); syncTools(); schedulePreview(); });
  $('t-dims').addEventListener('click', () => { geo.setShowDims(!geo.isDimsVisible()); syncTools(); });
  $('t-light').addEventListener('click', () => { geo.setLightOn(!geo.isLightOn()); syncTools(); });
  $('t-real').addEventListener('click', () => {
    geo.setRealShadow(!geo.isRealShadow());
    syncTools();
    if (geo.isRealShadow()) {
      showStatus('<strong>Gerçek gölge:</strong> duvardaki gölge artık simülasyon değil, gövdenin 3B geometrisinden LED ile hesaplanıyor. Kapatıp açarak simülasyonla karşılaştırın; yüklediğiniz model de gölge düşürür.');
    }
  });

  // ---------- durum kartı ----------

  const statusEl = $('lamp-status');
  function showStatus(html, warnings) {
    const full = html + (warnings && warnings.length
      ? '<br>' + warnings.map((w) => `<span class="warn">⚠ ${escapeHtml(w)}</span>`).join('<br>')
      : '');
    statusEl.hidden = false;
    statusEl.innerHTML = '<button class="close" title="Kapat">×</button>' + full;
    statusEl.querySelector('.close').addEventListener('click', () => { statusEl.hidden = true; });
    // İlerleme mesajları ("… iyileştiriliyor…") geçmişe yazılmaz, sonuçlar yazılır.
    if (!/…<\/strong>/.test(html)) logMessage(full, warnings && warnings.length ? 'warn' : 'info');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // ---------- STL ----------

  // Masaüstünde dosyalar pencere açılmadan İndirilenler'e yazılır (GTK kaydetme
  // penceresi Wayland'da sonraki dosya seçiciyi çökertiyordu); tarayıcıda indirilir.
  async function downloadBlob(blob, filename) {
    if (window.appAPI && window.appAPI.saveFile) {
      try {
        const file = await window.appAPI.saveFile(filename, await blob.arrayBuffer());
        exportLog.unshift({ name: file.split(/[\\/]/).pop(), path: file, time: new Date() });
        if (inspector) inspector.refreshFiles();
        showSavedToast(`İndirilenler'e kaydedildi: ${file.split(/[\\/]/).pop()}`, () => window.appAPI.revealFile(file));
      } catch (err) {
        alert('Kaydedilemedi: ' + err.message);
      }
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }


  // Dışa aktarma biçimi (STL, 3MF, OBJ, FBX, PLY, GLB) — seçim bu bilgisayarda hatırlanır.
  const formatSel = $('wf-format');
  ModelExport.FORMATS.forEach((f) => formatSel.add(new Option(f.label, f.id)));
  try { const f = localStorage.getItem('exportFormat'); if (ModelExport.FORMATS.some((x) => x.id === f)) formatSel.value = f; } catch (e) { /* depolama kapalı */ }
  function syncFormat() {
    const f = ModelExport.FORMATS.find((x) => x.id === formatSel.value);
    $('wf-stl').textContent = `${f.label.split(' ')[0]} İndir`;
    $('wf-stl').title = `${f.label} indir (Ctrl+E) — ${f.note}`;
    formatSel.title = f.note;
  }
  formatSel.addEventListener('change', () => {
    try { localStorage.setItem('exportFormat', formatSel.value); } catch (e) { /* depolama kapalı */ }
    syncFormat();
  });
  syncFormat();

  // Her indirmede sorulur; varsayılan: ışık parçaları dahil değil.
  const exportModal = $('modal-export');
  let exportPending = null;
  function askExport(format) {
    const f = ModelExport.FORMATS.find((x) => x.id === (format || formatSel.value));
    $('export-title').textContent = `${f.label} indir`;
    $('export-light').checked = false;
    exportPending = f.id;
    exportModal.hidden = false;
    $('export-confirm').focus();
  }
  function closeExport() { exportModal.hidden = true; exportPending = null; }
  $('export-confirm').addEventListener('click', () => {
    const fmt = exportPending, withLight = $('export-light').checked;
    closeExport();
    if (fmt) downloadModel(fmt, withLight);
  });
  $('export-cancel').addEventListener('click', closeExport);
  exportModal.addEventListener('click', (e) => { if (e.target === exportModal) closeExport(); });
  exportModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeExport(); }
    else if (e.key === 'Enter') { e.preventDefault(); $('export-confirm').click(); }
  });

  function downloadModel(format, withLight) {
    const fmt = format || formatSel.value;
    if (designer) designer.recomputeNow();
    const field = designer ? designer.getField() : null;
    if (!field) { alert('Henüz dışa aktarılacak bir şey yok.'); return; }
    let lamp, out, meshes;
    try {
      lamp = ShellMesher.buildLamp(field, printOpts(false));
      // Işık parçaları: tablada "Montaj parçaları" ile aynı grup.
      meshes = lamp.meshes.filter((m) => !m.previewOnly && (withLight || !ModelExport.isLightPart(m)));
      out = ModelExport.exportMeshes(fmt, meshes, `Shadow lamp ${field.shape.kind}`);
    } catch (err) {
      alert('Model oluşturulamadı: ' + err.message);
      return;
    }
    const buf = out.data;
    const name = (currentDesignName || 'golge-lambasi').replace(/\.json$/i, '');
    downloadBlob(new Blob([buf], { type: out.mime }), `${name}-${field.shape.kind}.${out.ext}`);
    const i = lamp.info;
    const mb = (buf.byteLength / 1048576).toFixed(1);
    const tris = meshes.reduce((a, m) => a + m.indices.length / 3, 0);
    const objs = meshes.map((m) => m.name).filter((n, k, a) => a.indexOf(n) === k).join(', ');
    showStatus(
      `<strong>${out.label} kaydedildi</strong> — ${escapeHtml(field.shape.label)}, gövde ${i.bodyMM.w.toFixed(0)}×${i.bodyMM.h.toFixed(0)}×${i.bodyMM.d.toFixed(0)} mm, `
      + `${tris.toLocaleString('tr-TR')} üçgen (${mb} MB). LED yüzeyi duvardan ${i.lightZcm.toFixed(1)} cm. Objeler: ${objs}.`
      + (withLight ? '' : ' Işık parçaları dahil edilmedi.')
      + (i.mount === 'tube' && withLight
        ? `<br><strong>Şeffaf tüp:</strong> dış çap ${numVal('g-tube', 40)} mm, boy <strong>${i.tubeLengthMM.toFixed(0)} mm</strong> (akrilik tüp; LED tüpün tepesindeki kapağa aşağı bakacak şekilde yapıştırılır).`
        : ''),
      lamp.warnings,
    );
  }
  $('wf-stl').addEventListener('click', () => askExport());

  // ---------- şekil önerisi ----------

  function applySuggestion() {
    // Taban boyutu: iki boyutlu şekillerde alanı koruyan geometrik ortalama.
    // (Büyük kenarı almak her tıklamada dikdörtgeni √oran kadar büyütüyordu.)
    const kind = $('s-shape').value;
    const twoD = Shapes.CATALOG[kind] && Shapes.CATALOG[kind].params.includes('H');
    const base = (twoD ? Math.sqrt(+$('s-W').value * +$('s-H').value) : +$('s-W').value) || 15;
    const sug = designer.suggestShape(base);
    $('s-shape').value = sug.kind;
    $('s-W').value = sug.W;
    $('s-H').value = sug.H;
    if (sug.kind === 'polygon') $('s-N').value = sug.N;
    updateShapeControls();
    recomputeAll();
    showStatus(`<strong>Önerilen gövde:</strong> ${escapeHtml(Shapes.CATALOG[sug.kind].label)} — ${escapeHtml(sug.reason)}. "Gövde Ayarları"ndan istediğiniz zaman değiştirebilirsiniz.`);
  }
  $('wf-suggest').addEventListener('click', applySuggestion);

  // ---------- tasarımcı ----------

  const simCanvas = document.createElement('canvas');
  const maskCanvas = document.createElement('canvas');
  updateShapeControls();
  designer = Designer.init({
    target: $('target'),
    sim: simCanvas,
    mask: maskCanvas,
    wallStrip: $('wall-strip'),
    onTargetClick: () => setWorkspace('editor'),
    onSilhouetteApplied: () => {
      if ($('wf-autoshape').checked) applySuggestion();
      else showStatus('<strong>Siluet uygulandı.</strong> Gölgeyi kontrol edip modeli indirin.');
    },
  });

  // ---------- fotoğraf → siluet ----------

  const photoModal = $('modal-photo');
  const photoPreview = $('photo-preview');
  const photoStatus = $('photo-status');
  const photoUse = $('photo-use');
  let photoImg = null;
  let photoMask = null;
  let photoMatte = null;      // AI matı önbellekte (modeli yeniden çalıştırmadan eşikleme)
  let photoRunId = 0;

  function photoOpts() {
    return {
      sensitivity: +$('photo-sens').value / 100,
      smooth: +$('photo-smooth').value,
      invert: $('photo-invert').checked,
      fillGaps: $('photo-solid').checked,
      local: +$('photo-local').value / 100,
      outline: +$('photo-outline').value,
    };
  }
  function syncPhotoControls() {
    const portrait = $('photo-method').value === 'portrait';
    $('photo-local-wrap').hidden = !portrait;
    $('photo-outline-wrap').hidden = !portrait;
    $('photo-solid').closest('label').hidden = portrait;
    $('photo-invert').closest('label').lastChild.textContent = portrait
      ? ' Ters çevir (açık bölgeler gölge olsun)' : ' Ters çevir (konu arka plandan açık renkli)';
  }
  // Kullanıcı yardımı: detay alanları (normalize kutular) ve fırça ipuçları (hintCv).
  // Ana çıkarma her zaman görselin tamamında yapılır; alanlar ve fırça üstüne eklenir.
  let photoRects = [];
  let hintCv = null;
  let hintCount = 0;
  let subjectCache = null;   // portre yöntemi için konu maskesi (fotoğraf başına)
  let previewBox = null;

  async function ensureMatte(id, detailed) {
    if (photoMatte) return photoMatte;
    photoStatus.textContent = 'Yapay zeka arka planı siliyor…';
    photoMatte = await Silhouette.aiMatte(photoImg, 'isnet-general-use', (msg) => {
      if (id !== photoRunId) return;
      if (msg.phase === 'download') {
        const pct = msg.total ? Math.round((msg.received / msg.total) * 100) : 0;
        photoStatus.textContent = `Yapay zeka modeli indiriliyor (yalnızca ilk sefer)… %${pct}` + (detailed ? ` / ${(msg.total / 1048576 || 0).toFixed(0)} MB` : '');
      } else if (msg.phase === 'load') photoStatus.textContent = 'Model yükleniyor…';
      else if (msg.phase === 'run') photoStatus.textContent = 'Arka plan siliniyor…';
      else if (msg.phase === 'fallback') photoStatus.textContent = 'Büyük model indirilemedi — küçük model kullanılıyor…';
    });
    return photoMatte;
  }
  function hints() { return hintCount ? hintCv : null; }
  function redrawPhoto(cursor, tempRect) {
    previewBox = Silhouette.drawPreview(photoPreview, photoImg, photoMask, { rects: tempRect ? photoRects.concat([tempRect]) : photoRects, hints: hints() });
    if (cursor && previewBox) {
      const ctx = photoPreview.getContext('2d');
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, +$('photo-brush').value, 0, Math.PI * 2);
      ctx.strokeStyle = photoTool === 'add' ? '#3ad16a' : '#ff4b3e';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  async function runSilhouette() {
    if (!photoImg) return;
    const id = ++photoRunId;
    $('photo-sens-out').textContent = $('photo-sens').value;
    $('photo-smooth-out').textContent = $('photo-smooth').value;
    $('photo-local-out').textContent = $('photo-local').value;
    $('photo-outline-out').textContent = $('photo-outline').value;
    syncPhotoControls();
    photoUse.disabled = true;
    const src = photoImg;
    const yieldUI = () => new Promise((r) => setTimeout(r, 0));
    try {
      if ($('photo-method').value === 'portrait') {
        // 1) Konu maskesi (arka plan ayrımı): AI varsa onunla, yoksa hızlı yöntemle.
        if (!subjectCache) {
          if (Silhouette.aiAvailable()) {
            subjectCache = Silhouette.fromMatte(await ensureMatte(id, false), { smooth: 1 });
          } else {
            photoStatus.textContent = 'Arka plan ayrılıyor…';
            await yieldUI();
            subjectCache = Silhouette.quick(src, { smooth: 1 });
          }
        }
        if (id !== photoRunId) return;
        // 2) Fırça ipuçları konu alanını düzeltir; konunun içindeki koyu hatlar gölge olur.
        photoStatus.textContent = 'Yüz hatları çıkarılıyor…';
        await yieldUI();
        photoMask = Silhouette.portrait(src, Silhouette.applyHints(subjectCache, hints()), photoOpts());
      } else if ($('photo-method').value === 'ai') {
        const matte = await ensureMatte(id, true);
        if (id !== photoRunId) return;
        photoMask = Silhouette.fromMatte(matte, photoOpts());
      } else {
        photoStatus.textContent = 'Konu aranıyor…';
        await yieldUI();
        photoMask = Silhouette.quick(src, photoOpts());
      }
      if (id !== photoRunId) return;
      // Detay alanları ana sonuca eklenir; fırça son sözü söyler
      // (portrede yeşil fırça konu alanını zaten genişletti, burada yalnızca "Çıkar").
      let skipped = 0;
      if (photoRects.length) {
        photoStatus.textContent = 'Seçilen alanlarda detay aranıyor…';
        await yieldUI();
        const r = Silhouette.addRegions(src, photoMask, photoRects, photoOpts());
        photoMask = r.mask;
        skipped = r.skipped;
      }
      photoMask = Silhouette.applyHints(photoMask, hints(), null, $('photo-method').value === 'portrait');
      redrawPhoto();
      let n = 0;
      for (let i = 0; i < photoMask.data.length; i++) n += photoMask.data[i];
      const pct = (100 * n) / photoMask.data.length;
      photoStatus.textContent = (pct < 2 || pct > 90
        ? `Konu fotoğrafın %${pct.toFixed(0)}'ini kaplıyor — bu yanlış görünüyor. Diğer yöntemi veya hassasiyeti deneyin.`
        : `Koyu = gölge (fotoğrafın %${pct.toFixed(0)}'i). Kaçan bir şey varsa etrafına "Detay alanı" çizin ya da "Ekle" fırçasıyla boyayın.`)
        + (skipped ? ` ${skipped} alanda belirgin hat bulunamadı (alan neredeyse tamamen koyu) — kutuyu nesneye daha yakın çizin.` : '');
      photoUse.disabled = false;
    } catch (err) {
      console.error(err);
      if (id === photoRunId) photoStatus.textContent = 'Başarısız: ' + err.message;
    }
  }

  // ---------- alan seçimi + fırça ----------
  let photoTool = null;
  function setPhotoTool(t) {
    photoTool = photoTool === t ? null : t;
    document.querySelectorAll('[data-ptool]').forEach((b) => b.classList.toggle('active', b.dataset.ptool === photoTool));
    photoPreview.className = photoTool ? 'tool-' + photoTool : '';
    if (photoImg) redrawPhoto();
  }
  document.querySelectorAll('[data-ptool]').forEach((b) => b.addEventListener('click', () => setPhotoTool(b.dataset.ptool)));
  function syncRegionButtons() {
    $('photo-clear-rect').disabled = !photoRects.length;
    $('photo-clear-hints').disabled = !hintCount;
  }
  let hintTimer = null;
  const rerunSoon = () => { clearTimeout(hintTimer); hintTimer = setTimeout(runSilhouette, 120); };
  $('photo-clear-rect').addEventListener('click', () => {
    if (!photoRects.length) return;
    photoUndo.push({ kind: 'rects', rects: photoRects.slice() });
    photoRects = [];
    syncRegionButtons();
    runSilhouette();
  });
  $('photo-clear-hints').addEventListener('click', () => {
    if (!hintCount) return;
    pushHintUndo();
    hintCv.getContext('2d').clearRect(0, 0, hintCv.width, hintCv.height);
    hintCount = 0;
    syncRegionButtons();
    runSilhouette();
  });
  function previewPoint(e) {
    const r = photoPreview.getBoundingClientRect();
    const x = ((e.clientX - r.left) * photoPreview.width) / r.width;
    const y = ((e.clientY - r.top) * photoPreview.height) / r.height;
    const b = previewBox;
    return { x, y, u: b ? Math.min(1, Math.max(0, (x - b.ox) / b.dw)) : 0, v: b ? Math.min(1, Math.max(0, (y - b.oy) / b.dh)) : 0 };
  }
  let photoDrag = null;
  // Geri al (Ctrl+Z): fırça darbeleri ve detay alanları aynı yığında.
  const photoUndo = [];
  function pushHintUndo() {
    photoUndo.push({ kind: 'hint', data: hintCv.getContext('2d').getImageData(0, 0, hintCv.width, hintCv.height), count: hintCount });
    if (photoUndo.length > 30) photoUndo.shift();
  }
  function undoHint() {
    const u = photoUndo.pop();
    if (!u) return;
    if (u.kind === 'hint') {
      hintCv.getContext('2d').putImageData(u.data, 0, 0);
      hintCount = u.count;
    } else if (u.kind === 'rect') photoRects.pop();
    else if (u.kind === 'rects') photoRects = u.rects;
    syncRegionButtons();
    redrawPhoto();
    rerunSoon();
  }
  function setBrush(v) {
    const el = $('photo-brush');
    el.value = Math.round(Math.min(+el.max, Math.max(+el.min, v)));
    if (photoImg) redrawPhoto(lastCursor);
  }
  let lastCursor = null;
  function paintHint(p, q) {
    const ctx = hintCv.getContext('2d');
    const k = hintCv.width / previewBox.dw;
    ctx.strokeStyle = ctx.fillStyle = photoTool === 'add' ? '#00ff00' : '#ff0000';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2 * +$('photo-brush').value * k;
    ctx.beginPath();
    ctx.moveTo(q.u * hintCv.width, q.v * hintCv.height);
    ctx.lineTo(p.u * hintCv.width, p.v * hintCv.height);
    ctx.stroke();
    hintCount++;
  }
  photoPreview.addEventListener('pointerdown', (e) => {
    if (!photoImg || !photoTool || !previewBox) return;
    photoPreview.setPointerCapture(e.pointerId);
    const p = previewPoint(e);
    photoDrag = { start: p, last: p };
    if (photoTool !== 'rect') { pushHintUndo(); paintHint(p, p); redrawPhoto(p); }
  });
  photoPreview.addEventListener('pointermove', (e) => {
    if (!photoImg || !photoTool || !previewBox) return;
    const p = previewPoint(e);
    lastCursor = photoTool !== 'rect' ? p : null;
    if (!photoDrag) { if (photoTool !== 'rect') redrawPhoto(p); return; }
    if (photoTool === 'rect') {
      const a = photoDrag.start;
      redrawPhoto(null, { x: Math.min(a.u, p.u), y: Math.min(a.v, p.v), w: Math.abs(p.u - a.u), h: Math.abs(p.v - a.v) });
    } else {
      paintHint(p, photoDrag.last);
      redrawPhoto(p);
    }
    photoDrag.last = p;
  });
  const endPhotoDrag = (e) => {
    if (!photoDrag) return;
    const a = photoDrag.start, p = previewPoint(e);
    photoDrag = null;
    if (photoTool === 'rect') {
      const r = { x: Math.min(a.u, p.u), y: Math.min(a.v, p.v), w: Math.abs(p.u - a.u), h: Math.abs(p.v - a.v) };
      if (r.w > 0.02 && r.h > 0.02) {                    // tıklama = değişiklik yok
        photoRects.push(r);
        photoUndo.push({ kind: 'rect' });
        syncRegionButtons();
        runSilhouette();
      } else redrawPhoto();
    } else {
      syncRegionButtons();
      rerunSoon();
    }
  };
  photoPreview.addEventListener('pointerup', endPhotoDrag);
  photoPreview.addEventListener('pointercancel', endPhotoDrag);
  photoPreview.addEventListener('pointerleave', () => { if (!photoDrag && photoImg) redrawPhoto(); });
  // Fotoğraf penceresi kısayolları: A alan · E ekle · R çıkar · X ekle↔çıkar ·
  // [ ] fırça (Shift: ince ayar) · Ctrl+Z son darbe · Delete fırçayı temizle · Esc aracı bırak.
  document.addEventListener('keydown', (e) => {
    if (photoModal.hidden || /INPUT|SELECT|TEXTAREA/.test((e.target && e.target.tagName) || '') || !photoImg) return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); e.stopImmediatePropagation(); undoHint(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const brush = +$('photo-brush').value;
    let handled = true;
    if (k === '[' || k === '{') setBrush(e.shiftKey ? brush - 1 : brush / 1.25);
    else if (k === ']' || k === '}') setBrush(e.shiftKey ? brush + 1 : brush * 1.25 + 1);
    else if (k === 'x' || k === 'X') setPhotoTool(photoTool === 'add' ? 'remove' : 'add');
    else if (k === 'Delete' || k === 'Backspace') $('photo-clear-hints').click();
    else if (k === 'Escape' && photoTool) { setPhotoTool(photoTool); e.stopImmediatePropagation(); }
    else {
      const t = { a: 'rect', e: 'add', r: 'remove' }[k.toLowerCase()];
      if (t) { if (photoTool !== t) setPhotoTool(t); } else handled = false;
    }
    if (handled) e.preventDefault();
  });

  $('wf-photo').addEventListener('click', () => {
    photoModal.hidden = false;
    if (!photoImg) $('photo-file').click();
  });
  $('photo-choose').addEventListener('click', () => $('photo-file').click());
  $('photo-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) loadPhotoFile(file);
  });
  // Fotoğraf penceresine görsel yükler (dosya seçici, sürükle-bırak, yapıştırma).
  function loadPhotoFile(file) {
    photoModal.hidden = false;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        photoImg = img;
        photoMatte = null;
        photoMask = null;
        subjectCache = null;
        photoRects = [];
        photoUndo.length = 0;
        const k = Math.min(1, 1024 / Math.max(img.width, img.height));
        hintCv = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(img.width * k)), height: Math.max(1, Math.round(img.height * k)) });
        hintCount = 0;
        syncRegionButtons();
        redrawPhoto();
        runSilhouette();
      };
      img.onerror = () => { photoStatus.textContent = 'Bu görsel okunamadı.'; };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }
  $('photo-method').addEventListener('change', runSilhouette);
  ['photo-sens', 'photo-smooth', 'photo-invert', 'photo-solid', 'photo-local', 'photo-outline'].forEach((id) => $(id).addEventListener('change', runSilhouette));
  syncPhotoControls();
  $('photo-cancel').addEventListener('click', () => { photoModal.hidden = true; });
  photoUse.addEventListener('click', async () => {
    if (!photoMask) return;
    const img = await Silhouette.maskToImage(photoMask);
    photoModal.hidden = true;
    document.querySelector('[data-panel="silhouette"]').classList.add('open');
    designer.loadSilhouetteImage(img);
    showStatus('<strong>Silueti yerleştirin:</strong> sağdaki kutuda sürükleyerek taşıyın, tekerlekle büyütün. Turuncu artı ışık, kırmızı çizgi lamba gövdesi. Sonra "Yerleştirmeyi uygula".');
  });

  // ---------- model karşılaştırma ----------

  const UNIT_CM = { mm: 0.1, cm: 1, m: 100, in: 2.54 };
  const cInfo = $('c-info'), cStats = $('c-stats');

  function compareOptions() {
    return {
      scale: UNIT_CM[$('c-units').value] || 0.1,
      up: $('c-up').value,
      align: $('c-align').value,
      rotZ: +$('c-rot').value || 0,
      offset: [+$('c-offx').value || 0, +$('c-offy').value || 0, +$('c-offz').value || 0],
      color: $('c-color').value,
      opacity: (+$('c-opacity').value || 60) / 100,
      visible: $('c-visible').checked,
      hideGenerated: $('c-hidegen').checked,
    };
  }

  function updateCompareStats() {
    const st = geo.compareStats();
    if (!st) { cStats.innerHTML = ''; return; }
    const sz = (b) => [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    const f = (v) => v.toFixed(1);
    const m = sz(st.model);
    let html = `Model: ${f(m[0])} × ${f(m[1])} × ${f(m[2])} mm`;
    if (st.lamp) {
      const l = sz(st.lamp);
      // Ölçüm lamba bölgesindeki model noktalarıyla: STL'de yanda duran kapak gibi parçalar karışmaz.
      const reg = st.region || st.model;
      const r = sz(reg);
      const d = [r[0] - l[0], r[1] - l[1], r[2] - l[2]];
      const pos = ['x', 'y', 'z'].map((k) => reg.min[k] - st.lamp.min[k]);
      if (st.region && st.region.share < 0.9995) {
        html += `<br>Lamba bölgesinde: ${f(r[0])} × ${f(r[1])} × ${f(r[2])} mm (model noktalarının %${(st.region.share * 100).toFixed(1)}'i; kalanı yanda duran parçalar, ör. kapak)`;
      }
      const ok = (v) => Math.abs(v) <= 0.5 ? '' : ' class="warn"';
      html += `<br>Lamba (gövde + taban): ${f(l[0])} × ${f(l[1])} × ${f(l[2])} mm`
        + `<br>Boyut farkı: <span${ok(d[0])}>X ${d[0] >= 0 ? '+' : ''}${f(d[0])}</span> · <span${ok(d[1])}>Y ${d[1] >= 0 ? '+' : ''}${f(d[1])}</span> · <span${ok(d[2])}>Z ${d[2] >= 0 ? '+' : ''}${f(d[2])}</span> mm`
        + `<br>Konum farkı (köşe): X ${f(pos[0])} · Y ${f(pos[1])} · Z ${f(pos[2])} mm`;
    }
    cStats.innerHTML = html;
  }

  function applyCompare() {
    geo.setCompareOptions(compareOptions());
    updateCompareStats();
  }

  $('c-load').addEventListener('click', () => $('c-file').click());
  $('c-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    loadCompareFile(file);
  });
  async function loadCompareFile(file) {
    if (!file) return;
    cInfo.textContent = `${file.name} okunuyor…`;
    try {
      const res = await ModelImport.load(file);
      $('c-units').value = res.defaults.units;
      $('c-up').value = res.defaults.up;
      compareLoaded = true;
      updateVisibility();
      $('c-remove').hidden = false;
      geo.setCompareModel(res.object);
      applyCompare();
      cInfo.textContent = `${file.name} · ${res.format} · ${res.triangles.toLocaleString('tr-TR')} üçgen`;
      document.querySelector('[data-panel="compare"]').classList.add('open');
    } catch (err) {
      console.error(err);
      cInfo.textContent = 'Model açılamadı: ' + err.message;
    }
  }
  $('c-remove').addEventListener('click', () => {
    geo.setCompareModel(null);
    compareLoaded = false;
    $('c-hidegen').checked = false;
    geo.setCompareOptions({ hideGenerated: false });
    updateVisibility();
    $('c-remove').hidden = true;
    cInfo.textContent = '';
    cStats.innerHTML = '';
  });
  SCHEMA.compare.forEach((def) => {
    const elx = $(def.id);
    elx.addEventListener(def.type === 'check' || def.type === 'select' ? 'change' : 'input', applyCompare);
  });

  // ---------- Siluet Editörü ve Görsel Dönüştürücü (ayrı çalışma alanları) ----------

  const editorHost = $('editor');
  const converterHost = $('converter');
  let editor = null;
  let converter = null;
  let workspace = 'lamp';

  function lampSummary() {
    const p = designer.getParams();
    const shapeSel = $('s-shape');
    const label = shapeSel.options[shapeSel.selectedIndex].textContent.split(' (')[0];
    const twoD = Shapes.CATALOG[shapeSel.value].params.includes('H');
    const mountTxt = mount() === 'tube' ? 'şeffaf tüp' : 'ön kapak';
    return `<b>${escapeHtml(label)}</b> ${p.shapeSpec.W} × ${twoD ? p.shapeSpec.H : p.shapeSpec.W} × ${p.d} cm · gölge ${2 * p.R} cm · ${mountTxt}`;
  }

  function setWorkspace(ws) {
    workspace = ws;
    document.querySelectorAll('.ws-switch .seg').forEach((b) => b.classList.toggle('active', b.dataset.ws === ws));
    const app = document.querySelector('.app');
    app.classList.toggle('editing', ws === 'editor');
    app.classList.toggle('converting', ws === 'convert');
    editorHost.hidden = ws !== 'editor';
    converterHost.hidden = ws !== 'convert';
    if (ws === 'editor') {
      if (!editor) {
        editor = SilhouetteEditor.init(editorHost, {
          getOverlay: () => designer.footprintInTarget(),
          onApply: async (dataUrl) => {
            await designer.loadTargetImageDataURL(dataUrl, designer.isOutsideLit());
            setWorkspace('lamp');
            showStatus('<strong>Siluet güncellendi.</strong> Gölgeyi kontrol edip modeli indirin.');
          },
          onClose: () => setWorkspace('lamp'),
        });
        inspector.attach(editorHost.querySelector('.ed-side'), { title: 'Siluet Editörü' });
      }
      editor.open(designer.getTargetImageDataURL());
    } else if (ws === 'convert') {
      if (!converter) {
        converter = ImageConverter.init(converterHost, {
          designer,
          lampSummary,
          download: downloadBlob,
          onApply: async (dataUrl, lit) => {
            await designer.loadTargetImageDataURL(dataUrl, lit);
            setWorkspace('lamp');
            showStatus('<strong>Şablon lambaya uygulandı.</strong> Karanlık Oda görünümünde gölgeyi kontrol edip modeli indirin.');
          },
          onClose: () => setWorkspace('lamp'),
        });
        inspector.attach(converterHost.querySelector('.cv-side'), { title: 'Görsel Dönüştürücü', reset: (ids) => converter.resetSettings(ids) });
      }
      converter.open();
    } else {
      window.dispatchEvent(new Event('resize'));
    }
  }
  document.querySelectorAll('.ws-switch .seg').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.ws !== workspace) setWorkspace(b.dataset.ws);
  }));
  $('wf-edit').addEventListener('click', () => setWorkspace('editor'));

  // ---------- kaydet / aç ----------

  let currentDesignName = null;
  const currentNameEl = $('current-design-name');
  function setCurrentName(name) {
    currentDesignName = name;
    currentNameEl.textContent = name || 'adsız';
  }

  function buildPayload() {
    return {
      version: 2,
      sliders: readState(),
      outsideLit: designer.isOutsideLit(),
      targetImage: designer.getTargetImageDataURL(),
    };
  }

  async function applyPayload(payload) {
    const legacy = payload && (!payload.version || payload.version < 2);
    if (legacy) {
      // v1 = eski kutu tasarımcısı: dikdörtgen gövde, ışık desenli hedef, kolon yok.
      writeState({ 's-shape': 'rect', 's-taper': 0, 'd-ribs': 0, 'g-mode': 'onepiece', 'g-mount': 'cap' });
    }
    if (payload && payload.sliders) {
      // Tüp montajından önce kaydedilmiş v2 tasarımlar kapak montajlıydı.
      if (!legacy && !('g-mount' in payload.sliders)) writeState({ 'g-mount': 'cap' });
      const sl = Object.assign({}, payload.sliders);
      // Eski tasarımlar tek (kare) tabla ölçüsü tutuyordu.
      if (sl['g-bed'] != null && sl['g-bedx'] == null) { sl['g-bedx'] = sl['g-bedy'] = sl['g-bedz'] = sl['g-bed']; }
      delete sl['g-bed'];
      writeState(sl);
    }
    updateShapeControls();
    if (payload && payload.targetImage) {
      const lit = legacy ? false : payload.outsideLit !== false;
      try { await designer.loadTargetImageDataURL(payload.targetImage, lit); }
      catch (_) { alert('Bu tasarım dosyasındaki görüntü yüklenemedi.'); }
    }
    recomputeAll();
  }

  const saveasModal  = $('modal-saveas');
  const openModal    = $('modal-open');
  const saveasName   = $('saveas-name');
  const saveasError  = $('saveas-error');
  const designListEl = $('design-list');
  const designEmpty  = $('design-list-empty');
  const openDataDir  = $('open-data-dir');

  function showSaveAs(initial) {
    saveasName.value = initial || currentDesignName || '';
    saveasError.hidden = true;
    saveasModal.hidden = false;
    setTimeout(() => saveasName.focus(), 0);
  }
  function hideSaveAs() { saveasModal.hidden = true; closeAfterSave = false; }

  async function showOpen() {
    openDataDir.textContent = `Klasör: ${await DesignStorage.dataDir()}`;
    const items = await DesignStorage.list();
    designListEl.innerHTML = '';
    designEmpty.hidden = items.length > 0;
    items.forEach((it) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = it.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      const dt = it.mtimeMs ? new Date(it.mtimeMs) : null;
      meta.textContent = dt ? dt.toLocaleString('tr-TR') : '';
      const del = document.createElement('button');
      del.className = 'delete';
      del.title = 'Sil';
      del.textContent = '×';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`"${it.name}" silinsin mi?`)) return;
        await DesignStorage.remove(it.name);
        if (currentDesignName === it.name) setCurrentName(null);
        showOpen();
      });
      li.appendChild(name);
      li.appendChild(meta);
      li.appendChild(del);
      li.addEventListener('click', async () => {
        try {
          const text = await DesignStorage.read(it.name);
          await openDesignText(text, it.name);
          hideOpen();
        } catch (err) {
          alert('Açılamadı: ' + err.message);
        }
      });
      designListEl.appendChild(li);
    });
    openModal.hidden = false;
  }
  function hideOpen() { openModal.hidden = true; }

  const saveToastEl = $('save-toast');
  let saveToastTimer = null;
  function showSavedToast(msg, onOpen) {
    logMessage(escapeHtml(msg || 'Kaydedildi'), 'info');
    saveToastEl.textContent = msg || 'Kaydedildi';
    if (onOpen) {
      const b = document.createElement('button');
      b.className = 'small';
      b.textContent = 'Klasörde göster';
      b.addEventListener('click', onOpen);
      saveToastEl.append(' ', b);
    }
    saveToastEl.hidden = false;
    if (saveToastTimer) clearTimeout(saveToastTimer);
    saveToastTimer = setTimeout(() => { saveToastEl.hidden = true; }, 5000);
  }

  let closeAfterSave = false;   // "Kaydet ve çık": kayıt bitince pencereyi kapat
  async function saveDesign() {
    if (!currentDesignName) { showSaveAs(''); return; }
    try {
      await DesignStorage.write(currentDesignName, JSON.stringify(buildPayload(), null, 2));
      showSavedToast(`"${currentDesignName}" kaydedildi`);
      markSaved(currentDesignName);
      if (closeAfterSave) window.close();
    } catch (err) {
      closeAfterSave = false;
      alert('Kaydedilemedi: ' + err.message);
    }
  }
  $('saveas-cancel').addEventListener('click', hideSaveAs);
  if (window.appAPI && window.appAPI.onSaveAndClose) {
    window.appAPI.onSaveAndClose(() => { closeAfterSave = true; saveDesign(); });
  }
  $('open-cancel').addEventListener('click', hideOpen);

  async function confirmSaveAs() {
    const raw = saveasName.value.trim();
    if (!raw) {
      saveasError.textContent = 'Lütfen bir ad girin.';
      saveasError.hidden = false;
      return;
    }
    const name = raw.endsWith('.json') ? raw : raw + '.json';
    try {
      if (await DesignStorage.exists(name) && name !== currentDesignName) {
        if (!confirm(`"${name}" zaten var. Üzerine yazılsın mı?`)) return;
      }
      const result = await DesignStorage.write(name, JSON.stringify(buildPayload(), null, 2));
      setCurrentName(result.name || name);
      markSaved(result.name || name);
      const close = closeAfterSave;
      hideSaveAs();
      if (close) window.close();
      showSavedToast(`"${result.name || name}" kaydedildi`);
    } catch (err) {
      saveasError.textContent = err.message;
      saveasError.hidden = false;
    }
  }

  $('saveas-confirm').addEventListener('click', confirmSaveAs);
  saveasName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); confirmSaveAs(); }
    if (e.key === 'Escape') { e.preventDefault(); hideSaveAs(); }
  });
  [saveasModal, openModal, photoModal].forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) { m.hidden = true; if (m === saveasModal) closeAfterSave = false; } });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideSaveAs(); openModal.hidden = true; photoModal.hidden = true; }
  });

  // ---------- belge durumu: kaydedilmemiş değişiklik, son açılanlar ----------

  let designDirty = false;
  const RECENT_KEY = 'shadowlamp.recent';
  function setDirty(on) {
    designDirty = on;
    $('dirty-dot').hidden = !on;
    $('sb-save').textContent = on ? 'Kaydedilmemiş değişiklikler' : (currentDesignName ? 'Kaydedildi' : '');
    document.title = `${on ? '● ' : ''}${currentDesignName || 'adsız'} — Gölge Lambası Tasarımcısı`;
  }
  function recentList() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (_) { return []; }
  }
  function pushRecent(name) {
    const list = [name].concat(recentList().filter((n) => n !== name)).slice(0, 8);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (_) { /* depolama yok */ }
  }
  function markSaved(name) {
    pushRecent(name);
    setDirty(false);
    history.markClean();
    inspector.refreshFiles();
  }
  function confirmDiscard() {
    return !designDirty || confirm('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?');
  }
  async function openDesignText(text, name) {
    history.pause();
    try {
      await applyPayload(JSON.parse(text));
    } finally {
      history.resume();
    }
    setCurrentName(name);
    history.reset();
    markSaved(name);
  }
  async function openRecent(name) {
    if (!confirmDiscard()) return;
    try {
      await openDesignText(await DesignStorage.read(name), name);
      showSavedToast(`"${name}" açıldı`);
    } catch (err) {
      alert('Açılamadı: ' + err.message);
    }
  }
  function newDesign() {
    if (!confirmDiscard()) return;
    history.pause();
    const defaults = {};
    ALL_FIELDS.forEach((def) => { if (!def.id.startsWith('c-') && def.value !== undefined) defaults[def.id] = def.value; });
    writeState(defaults);
    updateShapeControls();
    updateVisibility();
    $('clear').click();
    history.resume();
    setCurrentName(null);
    history.reset();
    setDirty(false);
    showStatus('<strong>Yeni tasarım.</strong> Dosya → Fotoğraf yükle veya Görsel Dönüştürücü ile başlayın.');
  }
  // Bilgisayardaki bir .json tasarım dosyası (sürükle-bırak veya Dosya → İçe aktar).
  async function importDesignFile(file) {
    if (!confirmDiscard()) return;
    try {
      const name = file.name.replace(/\.json$/i, '');
      await openDesignText(await file.text(), name);
      setDirty(true);   // uygulamanın kayıt klasöründe değil: Kaydet ile oraya yazılır
      showSavedToast(`"${name}" içe aktarıldı`);
    } catch (err) {
      alert('Tasarım dosyası okunamadı: ' + err.message);
    }
  }
  $('design-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importDesignFile(f);
  });
  function exportDesignFile() {
    const name = currentDesignName || 'golge-lambasi';
    downloadBlob(new Blob([JSON.stringify(buildPayload(), null, 2)], { type: 'application/json' }), name + '.json');
  }

  // ---------- lamba geri al / yinele ----------
  // Her yeniden hesaptan sonra (ayar, siluet, öneri, iyileştirme…) durum
  // anlık görüntüsü alınır; aynıysa yok sayılır. Hedef görüntü PNG olarak tutulur.

  const history = (() => {
    const undo = [], redo = [];
    let current = null, cleanRef = null, timer = null, paused = 0, applying = false;
    const snap = () => ({ sliders: JSON.stringify(readState()), lit: designer.isOutsideLit(), target: designer.getTargetImageDataURL() });
    const same = (a, b) => a && b && a.sliders === b.sliders && a.lit === b.lit && a.target === b.target;
    function commit() {
      timer = null;
      if (paused || applying) return;
      const s = snap();
      if (same(s, current)) return;
      if (current) { undo.push(current); if (undo.length > 40) undo.shift(); }
      redo.length = 0;
      current = s;
      setDirty(cleanRef ? !same(current, cleanRef) : true);
    }
    async function restore(s) {
      applying = true;
      try {
        writeState(JSON.parse(s.sliders));
        updateShapeControls();
        updateVisibility();
        await designer.loadTargetImageDataURL(s.target, s.lit);
        recomputeAll();
      } finally {
        setTimeout(() => { applying = false; }, 900);
      }
      current = s;
      setDirty(cleanRef ? !same(current, cleanRef) : true);
    }
    return {
      schedule() { if (!applying && !paused) { clearTimeout(timer); timer = setTimeout(commit, 700); } },
      pause() { paused++; clearTimeout(timer); },
      resume() { paused = Math.max(0, paused - 1); },
      reset() { undo.length = 0; redo.length = 0; current = snap(); cleanRef = current; },
      markClean() { current = snap(); cleanRef = current; },
      canUndo: () => undo.length > 0,
      canRedo: () => redo.length > 0,
      async undo() { if (!undo.length) return; redo.push(current); await restore(undo.pop()); showSavedToast('Geri alındı'); },
      async redo() { if (!redo.length) return; undo.push(current); await restore(redo.pop()); showSavedToast('Yinelendi'); },
    };
  })();
  const prevFieldHook = window.onWallFieldUpdated;
  window.onWallFieldUpdated = (field, p) => { prevFieldHook(field, p); history.schedule(); if (inspector) inspector.sync(); syncRoomTools(p.look); };
  // Işık/duvar görünümü: alan ve mesh'ler aynı, yalnızca oda yenilenir.
  window.onLookUpdated = (p) => {
    geo.updateRoom({ look: p.look, simCanvas, wallR: Math.max(p.R, p.look.wallSize / 2) });
    history.schedule();
    if (inspector) inspector.sync();
    syncRoomTools(p.look);
  };

  // Karanlık oda araç çubuğu: LED rengi ve ışık şiddeti (ayarlardaki alanlara bağlı).
  const roomColor = $('t-lcolor'), roomBright = $('t-lbright');
  function syncRoomTools(look) {
    if (!look) return;
    if (document.activeElement !== roomColor) roomColor.value = look.ledColor;
    if (document.activeElement !== roomBright) roomBright.value = look.brightness;
    roomBright.title = `Işık şiddeti: %${look.brightness}`;
  }
  roomColor.addEventListener('input', () => { $('l-color').value = roomColor.value; fire($('l-color')); });
  roomBright.addEventListener('input', () => { $('l-bright').value = roomBright.value; fire($('l-bright')); });

  // ---------- menü çubuğu ve kısayollar ----------

  const ws = (w) => () => workspace === w;
  const notWs = (w) => () => workspace !== w;
  const inLamp = ws('lamp');
  const modalOpen = () => !!document.querySelector('.modal:not([hidden])');
  function goConvert(fn) {
    if (workspace !== 'convert') setWorkspace('convert');
    if (fn) fn(converter);
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  function toggleSidebar() {
    appEl.classList.toggle('no-side');
    window.dispatchEvent(new Event('resize'));
  }

  // ---------- Inspector (Unity'deki gibi sağda: Özellikler | Dosyalar + ayar arama) ----------

  const exportLog = [];      // bu oturumda dışa aktarılan dosyalar
  inspector = Inspector.init({
    listDesigns: () => DesignStorage.list(),
    currentName: () => currentDesignName,
    isDirty: () => designDirty,
    openDesign: async (name) => { await openRecent(name); inspector.refreshFiles(); },
    deleteDesign: async (name) => {
      await DesignStorage.remove(name);
      if (currentDesignName === name) { setCurrentName(null); setDirty(true); }
    },
    newDesign: () => { newDesign(); inspector.refreshFiles(); },
    revealFolder: isDesktop ? () => DesignStorage.reveal() : null,
    exports: () => exportLog,
    revealExport: (path) => window.appAPI && window.appAPI.revealFile(path),
  });
  inspector.attach(document.querySelector('.workspace > .sidebar'), { title: 'Lamba' });

  const MENUS = [
    { label: 'Dosya', items: [
      { label: 'Yeni tasarım', shortcut: 'Ctrl+N', action: newDesign },
      { label: 'Aç…', shortcut: 'Ctrl+O', action: () => { if (confirmDiscard()) showOpen(); } },
      { label: 'Son açılanlar', submenu: () => recentList().map((n) => ({ label: n, action: () => openRecent(n) })) },
      '-',
      { label: 'Kaydet', shortcut: 'Ctrl+S', action: saveDesign },
      { label: 'Farklı kaydet…', shortcut: 'Ctrl+Shift+S', action: () => showSaveAs() },
      '-',
      { label: 'Fotoğraf yükle…', shortcut: 'Ctrl+I', action: () => { setWorkspace('lamp'); $('wf-photo').click(); } },
      { label: 'Tasarım dosyası içe aktar (.json)…', action: () => $('design-file').click() },
      { label: 'Karşılaştırma modeli yükle (STL · OBJ · 3MF · FBX)…', action: () => { setWorkspace('lamp'); $('c-file').click(); } },
      '-',
      { label: 'Modeli indir (seçili biçim)', shortcut: 'Ctrl+E', action: () => { setWorkspace('lamp'); askExport(); } },
      { label: 'Farklı biçimde indir', submenu: () => ModelExport.FORMATS.map((f) => ({ label: `${f.label} — ${f.note}`, action: () => { setWorkspace('lamp'); askExport(f.id); } })) },
      { label: 'Tasarımı dosya olarak dışa aktar (.json)', action: exportDesignFile },
      '-',
      { label: 'Tasarım klasörünü aç', visible: () => isDesktop, action: () => DesignStorage.reveal() },
      { label: 'Çıkış', shortcut: 'Ctrl+Q', action: () => window.close() },
    ] },
    { label: 'Düzen', items: [
      { label: 'Geri al', shortcut: 'Ctrl+Z', visible: notWs('editor'),
        enabled: () => (workspace === 'convert' ? !!converter && converter.canUndo() : history.canUndo()),
        action: () => (workspace === 'convert' ? converter.undo() : history.undo()) },
      { label: 'Yinele', shortcut: 'Ctrl+Y', altShortcuts: ['Ctrl+Shift+Z'], visible: notWs('editor'),
        enabled: () => (workspace === 'convert' ? !!converter && converter.canRedo() : history.canRedo()),
        action: () => (workspace === 'convert' ? converter.redo() : history.redo()) },
      '-',
      { label: 'Görseli panodan yapıştır', hint: 'Ctrl+V', visible: ws('convert'), action: () => converter.pasteFromClipboard() },
      { label: 'Şablonu lambaya uygula', shortcut: 'Ctrl+Enter', visible: ws('convert'), enabled: () => !!converter && converter.hasResult(), action: () => converter.apply() },
      '-',
      { label: 'Silueti temizle', action: () => { setWorkspace('lamp'); $('clear').click(); } },
      { label: 'Ayarları varsayılana döndür', action: () => {
        if (!confirm('Bütün lamba ayarları varsayılana dönsün mü? (Siluet korunur)')) return;
        const defaults = {};
        ALL_FIELDS.forEach((def) => { if (!def.id.startsWith('c-') && def.value !== undefined) defaults[def.id] = def.value; });
        writeState(defaults); updateShapeControls(); updateVisibility(); recomputeAll();
      } },
    ] },
    { label: 'Görünüm', items: [
      { label: 'Lamba', shortcut: 'Ctrl+1', radio: true, checked: ws('lamp'), action: () => setWorkspace('lamp') },
      { label: 'Siluet Editörü', shortcut: 'Ctrl+2', radio: true, checked: ws('editor'), action: () => setWorkspace('editor') },
      '-',
      { label: 'Yazıcı tablası', shortcut: 'Alt+1', visible: inLamp, radio: true, checked: () => geo.getView && geo.getView() === 'bed', action: () => setView('bed') },
      { label: 'Karanlık oda', shortcut: 'Alt+2', visible: inLamp, radio: true, checked: () => geo.getView && geo.getView() === 'room', action: () => setView('room') },
      { label: 'Kamera: izometrik', shortcut: 'Alt+3', visible: inLamp, action: () => geo.setCamPreset('iso') },
      { label: 'Kamera: üstten', shortcut: 'Alt+4', visible: inLamp, action: () => geo.setCamPreset('top') },
      { label: 'Kamera: önden', shortcut: 'Alt+5', visible: inLamp, action: () => geo.setCamPreset('front') },
      { label: 'Montaj parçalarını tablada göster', visible: inLamp, checked: () => geo.isLidVisible(), action: () => $('t-cap').click() },
      { label: 'Ölçüler', visible: inLamp, checked: () => geo.isDimsVisible(), action: () => $('t-dims').click() },
      { label: 'Lamba ışığı', shortcut: 'Alt+L', visible: inLamp, checked: () => geo.isLightOn(), action: () => $('t-light').click() },
      { label: 'Gerçek gölge (geometriden)', visible: inLamp, checked: () => geo.isRealShadow(), action: () => $('t-real').click() },
      { label: 'Şablon: orijinal', shortcut: 'Alt+1', visible: ws('convert'), radio: true, checked: () => converter && converter.getView() === 'original', action: () => converter.setView('original') },
      { label: 'Şablon: siyah-beyaz', shortcut: 'Alt+2', visible: ws('convert'), radio: true, checked: () => converter && converter.getView() === 'stencil', action: () => converter.setView('stencil') },
      { label: 'Şablon: baskı analizi', shortcut: 'Alt+3', visible: ws('convert'), radio: true, checked: () => converter && converter.getView() === 'analysis', action: () => converter.setView('analysis') },
      { label: 'Şablon: basılacak gölge', shortcut: 'Alt+4', visible: ws('convert'), radio: true, checked: () => converter && converter.getView() === 'shadow', action: () => converter.setView('shadow') },
      { label: 'Vektör yollarını göster', shortcut: 'Alt+P', visible: ws('convert'), checked: () => !!converter && converter.pathsShown(), action: () => converter.togglePaths() },
      { label: 'Şablonu yakınlaştır', shortcut: 'Alt+=', visible: ws('convert'), action: () => converter.zoomIn() },
      { label: 'Şablonu uzaklaştır', shortcut: 'Alt+-', visible: ws('convert'), action: () => converter.zoomOut() },
      { label: 'Şablonu sığdır', shortcut: 'Alt+0', visible: ws('convert'), action: () => converter.zoomFit() },
      '-',
      { label: 'Dosyalar (Inspector)', shortcut: 'Ctrl+J', checked: () => inspector.filesShown(), action: () => inspector.toggleFiles() },
      { label: 'Ayar ara…', shortcut: 'Ctrl+P', action: () => inspector.focusSearch() },
      { label: 'Kenar çubuğu', shortcut: 'Ctrl+B', visible: inLamp, checked: () => !appEl.classList.contains('no-side'), action: toggleSidebar },
      { label: 'Tam ekran', shortcut: 'F11', checked: () => !!document.fullscreenElement, action: toggleFullscreen },
    ] },
    { label: 'Araçlar', items: [
      { label: 'Siluetten gövde şekli öner', action: () => { setWorkspace('lamp'); applySuggestion(); } },
      { label: 'Detay için iyileştir', enabled: () => !optBtn.hidden, action: () => { setWorkspace('lamp'); optimizeDetail(); } },
      '-',
      { label: 'Silueti editörde düzenle', action: () => setWorkspace('editor') },
      { label: 'Fotoğraftan siluet çıkar…', action: () => { setWorkspace('lamp'); $('wf-photo').click(); } },
      '-',
      // Ek araç: ana akışın dışında, yalnızca buradan açılır.
      { label: 'Görsel Dönüştürücü (ek araç)', shortcut: 'Ctrl+Shift+G', checked: ws('convert'), action: () => setWorkspace(workspace === 'convert' ? 'lamp' : 'convert') },
      { label: 'Dönüştürücüde görsel aç…', shortcut: 'Ctrl+Shift+O', action: () => goConvert((c) => c.openFileDialog()) },
      { label: 'Lambadaki silueti dönüştürücüye al', action: () => goConvert((c) => c.loadFromLamp()) },
      { label: 'Şablonu SVG olarak kaydet', shortcut: 'Ctrl+Shift+E', enabled: () => !!converter && converter.hasResult(), action: () => converter.saveSVG() },
      { label: 'Şablonu PNG olarak kaydet', enabled: () => !!converter && converter.hasResult(), action: () => converter.savePNG() },
    ] },
    { label: 'Yardım', items: [
      { label: 'Klavye kısayolları', shortcut: 'F1', altShortcuts: ['Ctrl+/'], action: () => showHelp('keys') },
      { label: 'Nasıl kullanılır', action: () => showHelp('guide') },
      { label: 'Hakkında', action: () => showHelp('about') },
    ] },
  ];
  const menu = MenuBar.init($('menubar'), MENUS, { isBlocked: modalOpen });

  // ---------- yardım pencereleri ----------

  const EXTRA_KEYS = [
    { group: 'Fotoğraftan siluet penceresi', items: [
      { label: 'Detay alanı · Ekle fırçası · Çıkar fırçası', shortcut: 'A · E · R' },
      { label: 'Ekle ↔ Çıkar', shortcut: 'X' },
      { label: 'Fırçayı küçült / büyüt (Shift: ince)', shortcut: '[  /  ]' },
      { label: 'Son fırça darbesini / alanı geri al', shortcut: MenuBar.prettyShortcut('Ctrl+Z') },
      { label: 'Fırçayı temizle', shortcut: 'Delete' },
      { label: 'Aracı bırak', shortcut: 'Esc' },
    ] },
    { group: 'Görsel Dönüştürücü (klavye)', items: [
      { label: 'Görseli küçült / büyüt (Shift: ince)', shortcut: '[  /  ]' },
      { label: 'Döndür −5° / +5° (Shift: 1°)', shortcut: 'Q  /  W' },
      { label: 'Görseli taşı (Shift: 5 kat)', shortcut: 'ok tuşları' },
      { label: 'Yatay aynala', shortcut: 'H' },
      { label: 'Orijinal · şablon · analiz · basılacak gölge', shortcut: '1 · 2 · 3 · 4' },
      { label: 'Yol çizgileri', shortcut: 'P' },
      { label: 'Yakınlaştır · uzaklaştır · sığdır', shortcut: '+ · − · 0' },
    ] },
    { group: 'Görsel Dönüştürücü (fare)', items: [
      { label: 'Görseli taşı', shortcut: 'sürükle' },
      { label: 'Görünümü yakınlaştır', shortcut: 'tekerlek' },
      { label: 'Görsel boyutu', shortcut: MenuBar.prettyShortcut('Ctrl') + ' + tekerlek' },
      { label: 'Görünümü kaydır', shortcut: 'boşluk + sürükle / orta tuş' },
      { label: 'Görsel, SVG, tasarım (.json), model (STL…)', shortcut: 'pencereye sürükle-bırak' },
    ] },
    { group: 'Siluet Editörü', items: [
      { label: 'Fırça · ışık fırçası · silgi · kova', shortcut: 'B · L · E · G' },
      { label: 'Çizgi · dikdörtgen · elips · metin', shortcut: 'I · R · O · T' },
      { label: 'Taşı · el', shortcut: 'V · H' },
      { label: 'Fırça boyutu', shortcut: '[  /  ]' },
      { label: 'Gölge ↔ ışık', shortcut: 'X' },
      { label: 'Geri al / yinele', shortcut: MenuBar.prettyShortcut('Ctrl+Z') + '  /  ' + MenuBar.prettyShortcut('Ctrl+Y') },
      { label: 'Yakınlaştır · sığdır · %100', shortcut: '+ / − · 0 · 1' },
    ] },
  ];
  function showHelp(kind) {
    let modal = $('modal-help');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-help';
      modal.className = 'modal';
      modal.innerHTML = '<div class="modal-box modal-wide help-box"><h3></h3><div class="help-body"></div><div class="modal-actions"><button class="primary">Kapat</button></div></div>';
      modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('.modal-actions button')) modal.hidden = true; });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.hidden = true; });
      document.body.appendChild(modal);
    }
    const title = modal.querySelector('h3'), body = modal.querySelector('.help-body');
    if (kind === 'keys') {
      title.textContent = 'Klavye kısayolları';
      body.innerHTML = '<div class="keys-grid">' + menu.shortcutTable().concat(EXTRA_KEYS).map((g) => `<section><h4>${escapeHtml(g.group)}</h4><table>`
        + g.items.map((it) => `<tr><td>${escapeHtml(it.label)}</td><td><kbd>${escapeHtml(it.shortcut)}</kbd></td></tr>`).join('')
        + '</table></section>').join('') + '</div>'
        + '<p class="field-note">Menülerdeki kısayollar çalışma alanına göre değişir (ör. Alt+1 Lamba\'da yazıcı tablası, Dönüştürücü\'de orijinal görünüm).</p>';
    } else if (kind === 'guide') {
      title.textContent = 'Nasıl kullanılır';
      body.innerHTML = `<ol class="guide">
        <li><strong>Fotoğraf getirin.</strong> <strong>Fotoğraf yükle</strong> (<kbd>Ctrl+I</kbd>) ile seçin, pencereye sürükleyin ya da <kbd>Ctrl+V</kbd> ile yapıştırın; siluet otomatik çıkarılır.</li>
        <li><strong>Yerleştirin.</strong> Silueti sürükleyip boyutlandırın; kırmızı kesikli çizgi lamba gövdesi, turuncu artı ışık. "Yerleştirmeyi uygula".</li>
        <li><strong>Gerekirse düzeltin.</strong> Siluet Editörü'nde (<kbd>Ctrl+2</kbd>) fırçayla ekleyip çıkarın.</li>
        <li><strong>Kontrol edin.</strong> Karanlık Oda'da gölgeyi, Yazıcı Tablası'nda parçaları görün.</li>
        <li><strong>İndirin.</strong> Üst çubukta biçimi seçin (STL, 3MF, OBJ, FBX, PLY, GLB) ve <strong>İndir</strong> (<kbd>Ctrl+E</kbd>). Dosya → Farklı biçimde indir ile tek seferlik başka biçim.</li>
        <li><strong>Ek araç:</strong> logo/çizim gibi görselleri baskıya hazır şablona ve SVG'ye çevirmek için Araçlar → <strong>Görsel Dönüştürücü</strong> (<kbd>Ctrl+Shift+G</kbd>).</li></ol>`;
    } else {
      title.textContent = 'Hakkında';
      body.innerHTML = '<p><strong>Gölge Lambası Tasarımcısı</strong> — fotoğraftan duvara gölge düşüren, 3B yazıcıda basılabilir lamba tasarlar.</p>'
        + '<p class="field-note">Lisans: MIT. Arka plan silme modeli: IS-Net (Apache-2.0).</p>';
    }
    modal.hidden = false;
  }
  $('sb-keys').addEventListener('click', () => showHelp('keys'));
  $('sb-explorer').addEventListener('click', () => inspector.toggleFiles());
  $('sb-msgs').addEventListener('click', () => toggleMessages());
  $('sb-print').addEventListener('click', () => toggleMessages(true));
  $('msg-panel').querySelector('.close').addEventListener('click', () => toggleMessages(false));
  $('msg-panel').querySelector('.clear').addEventListener('click', () => { messageLog.length = 0; $('sb-msgs').textContent = '💬 Mesajlar'; renderMessages(); });

  // ---------- sürükle-bırak ve yapıştırma (uygulama geneli) ----------

  const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|svg)$/i;
  const MODEL_RE = /\.(stl|obj|3mf|fbx)$/i;
  function fileKind(f) {
    if (!f) return null;
    if (/^image\//.test(f.type) || IMAGE_RE.test(f.name)) return 'image';
    if (/\.json$/i.test(f.name) || f.type === 'application/json') return 'design';
    if (MODEL_RE.test(f.name)) return 'model';
    return null;
  }
  function handleFile(f) {
    const kind = fileKind(f);
    if (kind === 'image') {
      if (workspace === 'convert') converter.loadFile(f);
      else loadPhotoFile(f);
    }
    else if (kind === 'design') { setWorkspace('lamp'); importDesignFile(f); }
    else if (kind === 'model') {
      setWorkspace('lamp');
      loadCompareFile(f);
    } else showSavedToast('Bu dosya türü desteklenmiyor');
  }
  const dropOverlay = $('drop-overlay');
  let dragDepth = 0;
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragenter', (e) => {
    if (!hasFiles(e) || workspace === 'editor') return;
    dragDepth++;
    $('drop-what').textContent = `Görsel → ${workspace === 'convert' ? 'Dönüştürücü' : 'fotoğraftan siluet'} · .json → tasarım · STL/OBJ/3MF/FBX → karşılaştırma modeli`;
    dropOverlay.hidden = false;
  });
  document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.hidden = true; });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    dragDepth = 0;
    dropOverlay.hidden = true;
    if (!hasFiles(e) || workspace === 'editor') return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  document.addEventListener('paste', (e) => {
    if (workspace === 'editor' || modalOpen()) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type.startsWith('image/')) {
        e.preventDefault();
        if (workspace === 'convert') converter.loadFile(it.getAsFile());
        else loadPhotoFile(it.getAsFile());
        return;
      }
    }
  });

  // Durum çubuğu
  const WS_NAMES = { lamp: 'Lamba', convert: 'Görsel Dönüştürücü', editor: 'Siluet Editörü' };
  const WS_HINTS = {
    lamp: 'Görsel sürükleyip bırakın veya Ctrl+V ile yapıştırın',
    convert: 'Ctrl+Enter: lambaya uygula · Ctrl+Shift+E: SVG kaydet',
    editor: 'B fırça · L ışık · E silgi · [ ] boyut · Ctrl+Z geri al',
  };
  const baseSetWorkspace = setWorkspace;
  setWorkspace = (w) => {
    baseSetWorkspace(w);
    $('sb-ws').textContent = WS_NAMES[w];
    $('sb-msg').textContent = WS_HINTS[w];
    menu.close();
  };
  $('sb-msg').textContent = WS_HINTS.lamp;
  window.addEventListener('beforeunload', (e) => {
    if (designDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  setCurrentName(null);
  setView('bed');
  showStatus('<strong>Başlamak için:</strong> sağdan <strong>Fotoğraf yükle</strong> ile bir fotoğraf (veya SVG) seçin. Silüeti yerleştirip uygulayınca lamba ve gölgesi burada görünür; ardından <strong>İndir</strong> (STL, 3MF, OBJ, FBX, PLY veya GLB).');
  // Uzun not metinleri "?" ikonuna dönüşür (üzerine gel: ipucu, tıkla: sağ panelde açıklama).
  HelpTips.compact(document.querySelector('.workspace'));
  rebuildPreview();
  setTimeout(() => { history.reset(); setDirty(false); }, 1200);
})();
