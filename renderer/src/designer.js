/**
 * Gölge tasarımcısı: hedef görüntü → duvar alanı (açılmış lamba duvarı) +
 * duvardaki gölgenin simülasyonu.
 *
 * Hedef görüntü kuralı: beyaz = duvarda ışık, siyah = gölge. Siluet modunda
 * görüntünün dışında kalan alan da ışık sayılır (eski kutu tasarımlarında
 * karanlık).
 */

(function (global) {
  'use strict';

  // İnce detaylı silüetler için yüksek çözünürlük (duvarda ~0,6 mm/piksel @ 60 cm).
  const N = 2048;
  const SIM_RES = 1024;
  const QUALITY_CELLS = { low: 120000, medium: 220000, high: 380000, ultra: 650000 };

  function init(refs) {
    const tctx = refs.target.getContext('2d', { willReadFrequently: true });
    refs.target.width = N;
    refs.target.height = N;
    refs.sim.width = SIM_RES;
    refs.sim.height = SIM_RES;
    const sctx = refs.sim.getContext('2d');
    const MASK_RES = 768;
    refs.mask.width = MASK_RES;
    refs.mask.height = MASK_RES;
    const mctx = refs.mask.getContext('2d');
    let lastShadowBBox = null;
    let currentTargetData = null;
    let outsideLit = true;

    function clearTarget() {
      tctx.fillStyle = outsideLit ? '#fff' : '#000';
      tctx.fillRect(0, 0, N, N);
    }

    // ---------- fırça + yerleştirme modu ----------

    let editMode = false;
    let loadedImage = null;
    let imgScale = 1, imgOffX = 0, imgOffY = 0;
    let snapshotBeforeEdit = null;
    let snapshotOutside = true;
    let panning = false;
    let panLastX = 0, panLastY = 0;
    const targetStack = refs.target.parentElement;

    refs.target.addEventListener('pointerdown', (e) => {
      if (editMode) {
        panning = true;
        panLastX = e.clientX;
        panLastY = e.clientY;
        refs.target.setPointerCapture(e.pointerId);
        return;
      }
      // Rötuş artık Siluet Editörü'nde: küçük önizlemeye tıklamak editörü açar.
      if (typeof refs.onTargetClick === 'function') refs.onTargetClick();
    });
    window.addEventListener('pointerup', (e) => {
      if (panning) {
        panning = false;
        try { refs.target.releasePointerCapture(e.pointerId); } catch (_) {}
        return;
      }
    });
    refs.target.addEventListener('pointermove', (e) => {
      if (panning) {
        const rect = refs.target.getBoundingClientRect();
        imgOffX += (e.clientX - panLastX) * (N / rect.width);
        imgOffY += (e.clientY - panLastY) * (N / rect.height);
        panLastX = e.clientX;
        panLastY = e.clientY;
        drawEditPreview();
        return;
      }
    });
    refs.target.addEventListener('wheel', (e) => {
      if (!editMode) return;
      e.preventDefault();
      const rect = refs.target.getBoundingClientRect();
      const cx = (e.clientX - rect.left) * (N / rect.width);
      const cy = (e.clientY - rect.top) * (N / rect.height);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const newScale = Math.max(0.02, Math.min(40, imgScale * factor));
      const k = newScale / imgScale;
      imgOffX = (imgOffX + N / 2 - cx) * k - N / 2 + cx;
      imgOffY = (imgOffY + N / 2 - cy) * k - N / 2 + cy;
      imgScale = newScale;
      drawEditPreview();
    }, { passive: false });

    function startEdit(img) {
      loadedImage = img;
      imgScale = Math.min(N / img.width, N / img.height) * 0.92;
      imgOffX = 0;
      imgOffY = 0;
      snapshotBeforeEdit = tctx.getImageData(0, 0, N, N);
      snapshotOutside = outsideLit;
      editMode = true;
      targetStack.classList.add('editing');
      document.getElementById('image-edit-controls').hidden = false;
      document.getElementById('brush-controls').hidden = true;
      drawEditPreview();
    }

    function exitEditMode() {
      editMode = false;
      loadedImage = null;
      snapshotBeforeEdit = null;
      targetStack.classList.remove('editing');
      document.getElementById('image-edit-controls').hidden = true;
      document.getElementById('brush-controls').hidden = false;
    }

    function paintLoadedImage() {
      const cx = N / 2, cy = N / 2;
      const w = loadedImage.width * imgScale;
      const h = loadedImage.height * imgScale;
      tctx.fillStyle = '#fff';
      tctx.fillRect(0, 0, N, N);
      tctx.drawImage(loadedImage, cx - w / 2 + imgOffX, cy - h / 2 + imgOffY, w, h);
    }

    function drawEditPreview() {
      if (!loadedImage) return;
      paintLoadedImage();
      // Lamba gövdesinin izi + ışık konumu: siluet buna göre yerleştirilir.
      const cx = N / 2, cy = N / 2;
      const p = readParams();
      const shape = Shapes.make(p.shapeSpec, p.d);
      const k = N / (2 * p.R);
      tctx.save();
      tctx.strokeStyle = '#d85a30';
      tctx.lineWidth = 4;
      tctx.beginPath();
      // Lamba, döndürme/kaydırma sonrası hedef görüntüde nereye düşüyor.
      const toTarget = makeWallToTarget(p);
      shape.pts.forEach(([x, y], i) => {
        const t = toTarget(x, y);
        const X = cx + t[0] * k, Y = cy - t[1] * k;
        if (i === 0) tctx.moveTo(X, Y); else tctx.lineTo(X, Y);
      });
      tctx.closePath();
      tctx.stroke();
      const c0 = toTarget(0, 0);
      const lx = cx + c0[0] * k, ly = cy - c0[1] * k;
      tctx.strokeStyle = '#ef9f27';
      tctx.beginPath();
      tctx.moveTo(lx - 24, ly); tctx.lineTo(lx + 24, ly);
      tctx.moveTo(lx, ly - 24); tctx.lineTo(lx, ly + 24);
      tctx.stroke();
      tctx.restore();
    }

    function applyCrop() {
      if (!loadedImage) { exitEditMode(); return; }
      outsideLit = true;
      // Kenarlar eşiklenmez: yumuşak (gri) kenar, duvar ızgarasında piksel altı
      // hassasiyet sağlar (0,5 kontur aradeğerlenir) → ince detay korunur.
      paintLoadedImage();
      exitEditMode();
      recompute();
      if (typeof refs.onSilhouetteApplied === 'function') refs.onSilhouetteApplied();
    }

    function cancelCrop() {
      if (snapshotBeforeEdit) tctx.putImageData(snapshotBeforeEdit, 0, 0);
      outsideLit = snapshotOutside;
      exitEditMode();
    }

    // ---------- parametreler ----------

    function num(id, fallback) {
      const el = document.getElementById(id);
      if (!el) return fallback;
      const v = +el.value;
      return isFinite(v) ? v : fallback;
    }

    function readParams() {
      // Gövde ölçü kutuları mm; tasarım hesabı cm.
      const d = num('s-d', 60) / 10;
      const shapeSpec = {
        kind: (document.getElementById('s-shape') || {}).value || 'square',
        W: num('s-W', 130) / 10,
        H: num('s-H', 130) / 10,
        N: num('s-N', 6),
        A: num('s-A', 50) / 100,
        taper: num('s-taper', 0) / 100,
      };
      const val = (id, fb) => (document.getElementById(id) || {}).value || fb;
      return {
        shapeSpec,
        d,
        cz: (num('s-lightz', 90) / 100) * d,
        R: num('d-R', 60),
        rot: num('d-rot', 0),
        offX: num('d-offx', 0),
        offY: num('d-offy', 0),
        margin: num('d-margin', 3) / 10,
        ribs: num('d-ribs', 3),
        ribWidth: num('d-ribw', 1.2) / 10,
        minHole: num('d-minhole', 2) / 100,
        minWall: num('d-minwall', 0.8),
        minGap: num('d-mingap', 0.5),
        plate: num('g-plate', 3),
        maxCells: QUALITY_CELLS[val('g-quality', 'high')] || QUALITY_CELLS.high,
        mode: val('g-mode', 'onepiece'),
        mount: val('g-mount', 'tube'),
        supportLayer: !!(document.getElementById('g-layer') || {}).checked,
        supportFree: !!(document.getElementById('g-supportfree') || { checked: false }).checked,
        look: {
          ledColor: val('l-color', '#ffc46e'),
          brightness: num('l-bright', 100),
          wallColor: val('l-wall', '#efe9df'),
          wallSize: num('l-wallsize', 240),
          emitter: Math.max(0, num('l-emitter', 2)) / 10,     // LED yayıcı çapı (cm); 0 = nokta
        },
        outsideLit,
      };
    }

    function updateOutputs(p) {
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      set('d-R-out', p.R);
      set('d-margin-out', Math.round(p.margin * 10));
      set('d-ribs-out', p.ribs);
      set('d-ribw-out', (p.ribWidth * 10).toFixed(1));
    }

    // ---------- hedef örnekleme ----------

    // Duvar noktası → hedef görüntü koordinatı (gölge döndürme + kaydırma).
    function makeWallToTarget(p) {
      const a = (-(p.rot || 0) * Math.PI) / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const ox = p.offX || 0, oy = p.offY || 0;
      return (X, Y) => {
        const x = X - ox, y = Y - oy;
        return [x * ca - y * sa, x * sa + y * ca];
      };
    }

    // Hedefin işaretli uzaklık alanı (WallField.smoothSampler): ışıktan uzak
    // kenarlar merdiven gibi basamaklı çıkmasın. Hedef değişmedikçe yeniden hesaplanmaz.
    let sdCache = { hash: null, sd: null };
    function targetSD(data) {
      let h = 0x811c9dc5;
      for (let i = 0; i < data.length; i += 4) h = Math.imul(h ^ data[i], 0x01000193);
      if (sdCache.hash !== h || !sdCache.sd) sdCache = { hash: h, sd: WallField.signedDistance(data, N) };
      return sdCache.sd;
    }

    function makeSampler(p) {
      const outside = outsideLit ? 1 : 0;
      const toTarget = makeWallToTarget(p);
      const base = WallField.smoothSampler(currentTargetData, N, p.R, outside, targetSD(currentTargetData));
      return function sample(Xw, Yw) {
        const t = toTarget(Xw, Yw);
        return base(t[0], t[1]);
      };
    }

    // ---------- duvar alanı + önizlemeler ----------

    let lastField = null;
    let lastParams = null;

    function computeField(p, data) {
      currentTargetData = data || tctx.getImageData(0, 0, N, N).data;
      const shape = Shapes.make(p.shapeSpec, p.d);
      return WallField.compute({
        shape,
        d: p.d,
        cz: p.cz,
        margin: p.margin,
        sample: makeSampler(p),
        maxCells: p.maxCells,
        bottomBand: p.plate / 10 + 0.05,
        ribs: p.ribs,
        ribWidth: p.ribWidth,
        // Köşe direkleri yalnızca ön çemberi taşımak için (kapak montajı); tüpte paneller tabana yapıştırılır.
        cornerPosts: p.mode === 'flat' && shape.faceted && p.mount === 'cap',
        minHole: p.minHole,
        minWall: p.minWall,
        minGap: p.minGap,
        openTop: p.mount === 'tube',
        keepIslands: p.mode === 'flat' && shape.faceted && p.supportLayer,
        // Düz panel: adalar her panelin kendi içinde köprülenir (köşeden bağlantı kesimde kopar).
        panels: p.mode === 'flat' && shape.faceted,
        // Dik basılan tek parça gövdede sarkmalara 45° çatı (düz panel tablada yatık basılır).
        supportFree: p.supportFree && !(p.mode === 'flat' && shape.faceted),
      });
    }

    function drawWallStrip(field, p) {
      const host = refs.wallStrip;
      if (!host) return;
      const P = field.shape.perimeter;
      const cssW = Math.max(200, host.clientWidth || 800);
      const cssH = Math.max(70, Math.min(260, cssW * (p.d / P)));
      const dpr = window.devicePixelRatio || 1;
      const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
      host.style.height = cssH + 'px';
      host.width = W;
      host.height = H;
      const ctx = host.getContext('2d');
      const img = ctx.createImageData(W, H);
      const zTop = p.cz - p.margin;
      for (let y = 0; y < H; y++) {
        const z = (1 - (y + 0.5) / H) * p.d;            // şeridin üstü = lambanın önü
        for (let x = 0; x < W; x++) {
          const s = ((x + 0.5) / W) * P;
          const lit = WallField.sampleField(field, s, z) > 0.5;
          const i = (y * W + x) * 4;
          let r, g, b;
          if (lit) { r = 250; g = 238; b = 218; }
          else if (z > zTop) { r = 126; g = 62; b = 61; }
          else { r = 83; g = 74; b = 183; }
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      ctx.lineWidth = Math.max(1, dpr);
      if (field.shape.faceted) {
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.setLineDash([4 * dpr, 4 * dpr]);
        field.shape.vertexS().forEach((s) => {
          const x = (s / P) * W;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        });
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ef9f27';
      field.stats.ribS.forEach((s) => {
        const x = (s / P) * W;
        ctx.beginPath(); ctx.moveTo(x, H * 0.02); ctx.lineTo(x, H * 0.12); ctx.stroke();
      });

      const st = document.getElementById('wall-stats');
      if (st) {
        const parts = [
          `${field.shape.label}: çevre ${(P * 10).toFixed(0)} mm × derinlik ${(p.d * 10).toFixed(0)} mm`,
        ];
        if (field.stats.ribS.length) parts.push(`${field.stats.ribS.length} destek kolonu (turuncu işaretler)`);
        if (field.stats.bridges) parts.push(`${field.stats.bridges} kopuk parça ince köprüyle bağlandı`);
        if (field.stats.islandsRemoved) parts.push(`${field.stats.islandsRemoved} kırıntı temizlendi`);
        if (field.stats.holesFilled) parts.push(`${field.stats.holesFilled} iğne deliği dolduruldu`);
        if (field.stats.thickened) parts.push(`${field.stats.thickened} ince duvar kalınlaştırıldı`);
        if (field.stats.widened) parts.push(`${field.stats.widened} dar aralık genişletildi`);
        if (field.stats.roofArea > 0.01) parts.push(`desteksiz baskı için ${(field.stats.roofArea * 100).toFixed(0)} mm² 45° çatı`);
        st.textContent = parts.join(' · ');
        if (field.stats.rimFloating) {
          st.innerHTML += '<br><span class="warn">⚠ Ön çember tabana bağlı değil — lamba dağılır. Destek kolonu ekleyin.</span>';
        }
      }
    }

    /**
     * Duvardaki aydınlatma: nokta ışık için ters kare + eğim (cos³θ) gerçekte
     * çok hızlı söner; göz için yumuşatılmış bir eğri ve görüntü kenarında
     * karanlığa geçiş kullanılır (3B sahnede kenar dikişi görünmesin diye).
     * Aynı döngü tabla görünümü için gölge maskesini ve ölçü kutusunu üretir.
     */
    function hexRgb(hex) {
      const h = String(hex || '#ffffff').replace('#', '');
      return [parseInt(h.slice(0, 2), 16) || 0, parseInt(h.slice(2, 4), 16) || 0, parseInt(h.slice(4, 6), 16) || 0];
    }

    /** Karanlık odada aydınlanan duvarın yarı genişliği (cm): en az gölge boyutu. */
    function wallExtent(p) {
      return Math.max(p.R, ((p.look && p.look.wallSize) || 0) / 2);
    }

    function simulateShadow(field, p) {
      const shape = field.shape;
      const E = wallExtent(p);
      // Duvar büyüdükçe çözünürlük de artar (gölge alanındaki piksel boyu korunur, üst sınırlı).
      // Yayıcı varsa yarı gölge kenarları zaten yumuşak: daha düşük çözünürlük yeter (her piksel çok örnekli).
      const base = p.look.emitter > 0 ? Math.round(SIM_RES * 0.75) : SIM_RES;
      const res = Math.min(1600, Math.max(base, Math.round((base * E) / p.R)));
      if (refs.sim.width !== res) { refs.sim.width = res; refs.sim.height = res; }
      const w = res, h = res;
      const img = sctx.createImageData(w, h);
      const lc = hexRgb(p.look.ledColor), wc = hexRgb(p.look.wallColor);
      const gain = 1.25 * (p.look.brightness / 100);
      const lit = [0, 1, 2].map((c) => (lc[c] / 255) * wc[c]);
      const dark = wc.map((v) => v * 0.035);
      const near = Math.max(p.R * 0.42, (shape.perimeter / (2 * Math.PI)) * 2.2);

      const litAt = (X, Y) => {
        const inv = Projection.inverseShell(X, Y, shape, p.cz, p.margin);
        return { inv, lit: !!inv && !inv.blocked && WallField.sampleField(field, inv.s, inv.z) > 0.5 };
      };
      // Oda dokusu: gerçek LED yayıcısıyla aydınlanma oranı (yarı gölge).
      const emitter = p.look.emitter || 0;

      // Oda dokusu: [-E, E]² (gölge alanının dışında da lamba duvarı aydınlatır).
      for (let py = 0; py < h; py++) {
        const Y = (0.5 - (py + 0.5) / h) * 2 * E;
        for (let px = 0; px < w; px++) {
          const X = ((px + 0.5) / w - 0.5) * 2 * E;
          const i = (py * w + px) * 4;
          let r = dark[0], g = dark[1], b = dark[2];
          const frac = WallField.litFraction(field, X, Y, emitter) || 0;
          if (frac > 0) {
            const rho = Math.hypot(X, Y);
            const fall = 1 / (1 + Math.pow(rho / near, 1.6));
            const edge = Math.max(0, Math.min(1, (E - rho) / (0.3 * E)));
            const k = Math.min(1.2, gain * fall) * edge * edge * (3 - 2 * edge) * frac;
            r += lit[0] * k; g += lit[1] * k; b += lit[2] * k;
          }
          img.data[i] = Math.min(255, r);
          img.data[i + 1] = Math.min(255, g);
          img.data[i + 2] = Math.min(255, b);
          img.data[i + 3] = 255;
        }
      }

      // Tabla maskesi ve ölçü kutusu: yalnızca gölge alanı [-R, R]², gölge = açık gri, ışık = şeffaf.
      const mw = refs.mask.width;
      const mimg = mctx.createImageData(mw, mw);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let my = 0; my < mw; my++) {
        const Y = (0.5 - (my + 0.5) / mw) * 2 * p.R;
        for (let mx = 0; mx < mw; mx++) {
          const X = ((mx + 0.5) / mw - 0.5) * 2 * p.R;
          const { inv, lit: isLit } = litAt(X, Y);
          if (isLit) continue;
          if (inv) {
            // Gölge (gövde izi hariç): tabla görünümü için ölçü kutusu.
            if (X < minX) minX = X; if (X > maxX) maxX = X;
            if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
          }
          const j = (my * mw + mx) * 4;
          const v = inv ? 168 : 120;  // gövde izi biraz daha koyu
          mimg.data[j] = v; mimg.data[j + 1] = v - 4; mimg.data[j + 2] = v - 4; mimg.data[j + 3] = 255;
        }
      }
      sctx.putImageData(img, 0, 0);
      mctx.putImageData(mimg, 0, 0);
      lastShadowBBox = isFinite(minX) ? { minX, maxX, minY, maxY } : null;
    }

    /**
     * Gölge uyumu: hedef silüetin gölgesi ile lambanın oluşturduğu gölgenin
     * örtüşmesi (IoU, gövde izi hariç). Ayrıca kaybolan detay (hedefte gölge,
     * sonuçta ışık) ve fazladan gölge oranları.
     */
    function measureAccuracy(field, p, A) {
      const res = A || 640;
      const sample = makeSampler(p);
      // Kenar (detay) uyumu: yalnızca hedefin gölge kenarına 4 mm'den yakın noktalar.
      // Genel uyum büyük dolu alanlarla şişer; ince detay kenar bandında yaşar.
      // Bulanık: kenar bandının LED yarı gölgesinde kalan (%10–90 aydınlık) oranı.
      const sd = targetSD(currentTargetData);
      const toT = makeWallToTarget(p);
      const band = (0.4 * N) / (2 * p.R);
      let inter = 0, uni = 0, lost = 0, extra = 0, target = 0, eI = 0, eU = 0, eN = 0, eSoft = 0;
      for (let py = 0; py < res; py++) {
        const Y = (0.5 - (py + 0.5) / res) * 2 * p.R;
        for (let px = 0; px < res; px++) {
          const X = ((px + 0.5) / res - 0.5) * 2 * p.R;
          // Gerçek LED (yayıcı çaplı) ile: yarı gölgenin ortası (aydınlanma < %50) gölge sayılır.
          const frac = WallField.litFraction(field, X, Y, (p.look && p.look.emitter) || 0);
          if (frac == null) continue;                            // gövdenin arkası
          const t = sample(X, Y) < 0.5;
          const sdark = frac < 0.5;
          if (t) target++;
          if (t && sdark) inter++;
          if (t || sdark) uni++;
          if (t && !sdark) lost++;
          if (!t && sdark) extra++;
          const tt = toT(X, Y);
          const u = Math.round(((tt[0] / p.R) * 0.5 + 0.5) * N - 0.5), v = Math.round((0.5 - (tt[1] / p.R) * 0.5) * N - 0.5);
          if (u >= 0 && v >= 0 && u < N && v < N && Math.abs(sd[v * N + u]) < band) {
            eN++;
            if (t && sdark) eI++;
            if (t || sdark) eU++;
            if (frac > 0.1 && frac < 0.9) eSoft++;
          }
        }
      }
      if (target < res * res * 0.002) return null;   // silüet yok
      return {
        iou: uni ? inter / uni : 1,
        lost: target ? lost / target : 0,
        extra: target ? extra / target : 0,
        edge: eU ? eI / eU : 1,
        soft: eN ? eSoft / eN : 0,
      };
    }

    /** Optimize edici için: verilen gövde ayarlarıyla (hızlı) alan + uyum. */
    function evaluate(overrides) {
      const base = readParams();
      const p = Object.assign({}, base, overrides);
      p.shapeSpec = Object.assign({}, base.shapeSpec, overrides.shapeSpec || {});
      p.look = Object.assign({}, base.look, overrides.look || {});
      p.cz = (num('s-lightz', 90) / 100) * p.d;
      const field = computeField(p);
      // Gösterge ile aynı çözünürlük: ince detaylı silüetlerde ölçüm çözünürlüğe çok duyarlı.
      return measureAccuracy(field, p, 640);
    }

    let lastAccuracy = null;
    let recomputeTimer = null;
    function recompute() {
      if (recomputeTimer) return;
      recomputeTimer = setTimeout(() => { recomputeTimer = null; recomputeNow(); }, 16);
    }

    function recomputeNow() {
      const p = readParams();
      updateOutputs(p);
      let field;
      try {
        field = computeField(p);
      } catch (err) {
        console.error('wall field', err);
        return;
      }
      lastField = field;
      lastParams = p;
      drawWallStrip(field, p);
      simulateShadow(field, p);
      lastAccuracy = measureAccuracy(field, p);
      if (typeof window.onWallFieldUpdated === 'function') window.onWallFieldUpdated(field, p);
    }

    // ---------- siluetten şekil önerisi ----------

    function suggestShape(baseSize) {
      const S = 256;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const cctx = cv.getContext('2d', { willReadFrequently: true });
      cctx.drawImage(refs.target, 0, 0, S, S);
      const d = cctx.getImageData(0, 0, S, S).data;
      return Shapes.autoSuggest((x, y) => (outsideLit ? d[(y * S + x) * 4] < 128 : d[(y * S + x) * 4] >= 128), S, baseSize);
    }

    // ---------- bağlantılar ----------

    document.getElementById('image-apply').onclick  = applyCrop;
    document.getElementById('image-cancel').onclick = cancelCrop;
    document.getElementById('clear').onclick = () => { outsideLit = true; clearTarget(); recompute(); };

    // l-emitter alanı değiştirmez ama gölge uyumunu değiştirir: tam yeniden hesap.
    ['l-emitter', 'd-R', 'd-rot', 'd-offx', 'd-offy', 'd-margin', 'd-ribs', 'd-ribw', 'd-minhole', 'd-minwall', 'd-mingap', 'g-plate', 'g-quality', 'g-mount', 'g-layer', 'g-supportfree'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', recompute);
    });
    // Işık ve duvar görünümü alanı değiştirmez: yalnızca oda simülasyonu yenilenir.
    let relookTimer = null;
    function relook() {
      if (relookTimer) return;
      relookTimer = setTimeout(() => {
        relookTimer = null;
        if (!lastField || !lastParams) { recompute(); return; }
        lastParams = Object.assign({}, lastParams, { look: readParams().look });
        simulateShadow(lastField, lastParams);
        if (typeof window.onLookUpdated === 'function') window.onLookUpdated(lastParams);
      }, 16);
    }
    ['l-color', 'l-bright', 'l-wall', 'l-wallsize'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', relook);
    });
    window.addEventListener('resize', () => { if (lastField && lastParams) drawWallStrip(lastField, lastParams); });

    clearTarget();
    recomputeNow();

    function loadTargetImageDataURL(dataUrl, lit) {
      outsideLit = lit !== false;
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          tctx.imageSmoothingEnabled = true;
          tctx.drawImage(img, 0, 0, N, N);
          recompute();
          resolve();
        };
        img.onerror = reject;
        img.src = dataUrl;
      });
    }

    /** Lamba izi ve ışık merkezi, hedef görüntü piksellerinde (editör katmanı için). */
    function footprintInTarget() {
      const p = readParams();
      const shape = Shapes.make(p.shapeSpec, p.d);
      const toTarget = makeWallToTarget(p);
      const k = N / (2 * p.R);
      const toPx = (x, y) => { const t = toTarget(x, y); return [N / 2 + t[0] * k, N / 2 - t[1] * k]; };
      return { poly: shape.pts.map(([x, y]) => toPx(x, y)), light: toPx(0, 0) };
    }

    /** Görsel Dönüştürücü için: hedef ↔ lamba duvarı eşlemesi (cm). */
    function getPrintGeometry() {
      const p = readParams();
      const shape = Shapes.make(p.shapeSpec, p.d);
      const b = ((p.rot || 0) * Math.PI) / 180;
      const cb = Math.cos(b), sb = Math.sin(b);
      const ox = p.offX || 0, oy = p.offY || 0;
      return {
        shape, cz: p.cz, margin: p.margin, R: p.R, zb: p.plate / 10 + 0.05,
        openTop: p.mount === 'tube', ribWidthMm: p.ribWidth * 10, N,
        toTarget: makeWallToTarget(p),
        toWall: (x, y) => [x * cb - y * sb + ox, x * sb + y * cb + oy],
        key: JSON.stringify([p.shapeSpec, p.d, p.cz, p.margin, p.R, p.rot, p.offX, p.offY, p.plate, p.mount]),
      };
    }

    /**
     * Verilen hedef görüntüyle (N×N RGBA) lambanın gerçek duvar alanı —
     * köprüler, çatılar, delik doldurma dahil. Mevcut hedef değişmez.
     */
    function fieldForTarget(data, lit) {
      const p = readParams();
      const prevData = currentTargetData, prevLit = outsideLit;
      outsideLit = lit !== false;
      try {
        return { field: computeField(p, data), p };
      } finally {
        currentTargetData = prevData;
        outsideLit = prevLit;
      }
    }

    return {
      getPrintGeometry,
      fieldForTarget,
      footprintInTarget,
      recompute,
      recomputeNow,
      getTargetImageDataURL: () => refs.target.toDataURL('image/png'),
      loadTargetImageDataURL,
      isOutsideLit: () => outsideLit,
      loadSilhouetteImage: startEdit,
      suggestShape,
      getField: () => lastField,
      getShadowBBox: () => lastShadowBBox,
      getAccuracy: () => lastAccuracy,
      evaluate,
      getParams: () => lastParams || readParams(),
      readParams,
    };
  }

  global.Designer = { init };
})(window);
