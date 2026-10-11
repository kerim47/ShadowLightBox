/**
 * Photo → silhouette mask.
 *
 * Quick mode (no model): estimate the background colour from the image border,
 * score every pixel by colour distance to it, Otsu-threshold the score, flood
 * the background in from the border, then clean up (largest subject, fill
 * specks, smooth). Works well on plain / studio backgrounds.
 *
 * AI mode: an IS-Net / U²-Net-p background-removal model run by the Electron
 * main process (window.appAPI.removeBackground). Returns a soft alpha matte
 * that goes through the same cleanup.
 *
 * Direct mode: a ready black-and-white image is only thresholded (no cleanup).
 *
 * Masks are { w, h, data: Uint8Array } with 1 = subject (casts shadow).
 */
(function (global) {
  'use strict';

  const WORK_MAX = 2048; // işleme çözünürlüğü (uzun kenar) — ince detay için yüksek

  function imageToCanvas(img, maxSide) {
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * s));
    const h = Math.max(1, Math.round(img.height * s));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { cv, ctx, w, h };
  }

  // sRGB → approximate Lab (D65) for perceptual colour distance.
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toLab(r, g, b) {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    let y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  function otsu(values, bins) {
    const hist = new Float64Array(bins);
    let max = 0;
    for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
    if (max <= 0) return 0;
    for (let i = 0; i < values.length; i++) hist[Math.min(bins - 1, Math.floor((values[i] / max) * (bins - 1)))]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < bins; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = 0, thr = 0;
    for (let i = 0; i < bins; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i; }
    }
    return ((thr + 0.5) / (bins - 1)) * max;
  }

  /** Background-likeness score per pixel (0 = exactly the border colour). */
  function backgroundDistance(ctx, w, h) {
    const px = ctx.getImageData(0, 0, w, h).data;
    const lab = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const L = toLab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2];
    }
    // Border samples → a few background clusters (handles gradients / two-tone walls).
    const border = [];
    const step = Math.max(1, Math.floor((w + h) / 400));
    for (let x = 0; x < w; x += step) { border.push(x); border.push((h - 1) * w + x); }
    for (let y = 0; y < h; y += step) { border.push(y * w); border.push(y * w + w - 1); }
    const K = 4;
    const centers = [];
    for (let k = 0; k < K; k++) {
      const i = border[Math.floor(((k + 0.5) / K) * border.length)];
      centers.push([lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]]);
    }
    for (let iter = 0; iter < 8; iter++) {
      const acc = centers.map(() => [0, 0, 0, 0]);
      border.forEach((i) => {
        let bk = 0, bd = Infinity;
        centers.forEach((c, k) => {
          const d = (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2;
          if (d < bd) { bd = d; bk = k; }
        });
        acc[bk][0] += lab[i * 3]; acc[bk][1] += lab[i * 3 + 1]; acc[bk][2] += lab[i * 3 + 2]; acc[bk][3]++;
      });
      acc.forEach((a, k) => { if (a[3]) centers[k] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
    const dist = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      let bd = Infinity;
      for (let k = 0; k < K; k++) {
        const c = centers[k];
        const d = (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2;
        if (d < bd) bd = d;
      }
      dist[i] = Math.sqrt(bd);
    }
    return blur(dist, w, h, 1);
  }

  function blur(src, w, h, r) {
    if (r <= 0) return src;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
        tmp[y * w + x] = s / n;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        out[y * w + x] = s / n;
      }
    }
    return out;
  }

  // ---------- binary mask ops ----------

  function labelComponents(mask, w, h, value) {
    const lab = new Int32Array(w * h).fill(-1);
    const sizes = [];
    const touchesBorder = [];
    const stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (mask[s] !== value || lab[s] >= 0) continue;
      const id = sizes.length;
      let sp = 0, n = 0, border = false;
      stack[sp++] = s; lab[s] = id;
      while (sp) {
        const i = stack[--sp];
        n++;
        const x = i % w, y = (i / w) | 0;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        if (x > 0 && mask[i - 1] === value && lab[i - 1] < 0) { lab[i - 1] = id; stack[sp++] = i - 1; }
        if (x < w - 1 && mask[i + 1] === value && lab[i + 1] < 0) { lab[i + 1] = id; stack[sp++] = i + 1; }
        if (y > 0 && mask[i - w] === value && lab[i - w] < 0) { lab[i - w] = id; stack[sp++] = i - w; }
        if (y < h - 1 && mask[i + w] === value && lab[i + w] < 0) { lab[i + w] = id; stack[sp++] = i + w; }
      }
      sizes.push(n);
      touchesBorder.push(border);
    }
    return { lab, sizes, touchesBorder };
  }

  /** Box-blur then re-threshold: rounds corners and removes 1–2 px fuzz. */
  function smooth(mask, w, h, r) {
    if (r <= 0) return mask;
    const f = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) f[i] = mask[i];
    const b = blur(f, w, h, r);
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = b[i] >= 0.5 ? 1 : 0;
    return out;
  }

  /**
   * Clean a raw subject mask: keep the largest subject blob (plus big
   * secondary ones), fill specks, keep enclosed background gaps above a
   * size (arm-to-body gaps etc.), smooth.
   */
  function cleanup(mask, w, h, opts) {
    const o = opts || {};
    const total = w * h;
    let m = mask;

    // Subject blobs: keep the largest plus any real secondary part (a head
    // separated by a thin neck, a held object…); drop specks.
    const fg = labelComponents(m, w, h, 1);
    if (fg.sizes.length) {
      const maxSize = Math.max(...fg.sizes);
      // Yalnızca piksel gürültüsü atılır; harfler, dal uçları gibi küçük parçalar detaydır.
      const keep = fg.sizes.map((s) => s >= Math.max(maxSize * 0.0005, total * 0.00002, 6));
      m = new Uint8Array(total);
      for (let i = 0; i < total; i++) if (fg.lab[i] >= 0 && keep[fg.lab[i]]) m[i] = 1;
    }

    // Enclosed background: fill small ones (noise); large ones stay as gaps
    // unless the user asked for a solid silhouette.
    const bg = labelComponents(m, w, h, 0);
    // Küçük kapalı boşluklar (parmak araları, saç telleri arası) detaydır: yalnızca piksel gürültüsü doldurulur.
    const minGap = o.fillGaps ? Infinity : total * (o.minGapFrac != null ? o.minGapFrac : 0.00002);
    for (let i = 0; i < total; i++) {
      const id = bg.lab[i];
      if (id >= 0 && !bg.touchesBorder[id] && bg.sizes[id] < minGap) m[i] = 1;
    }

    return smooth(m, w, h, o.smooth != null ? o.smooth : 1);
  }

  /**
   * Quick (model-free) segmentation.
   * opts: { sensitivity: -1..1 (shifts the Otsu threshold), invert, fillGaps, smooth }
   */
  function quick(img, opts) {
    const o = opts || {};
    const { ctx, w, h } = imageToCanvas(img, WORK_MAX);
    const dist = backgroundDistance(ctx, w, h);
    let thr = otsu(dist, 256);
    thr *= Math.pow(2, -(o.sensitivity || 0)); // sensitivity > 0 → lower threshold → more subject

    // Background = border-connected region of background-like pixels.
    const bgLike = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) bgLike[i] = dist[i] < thr ? 1 : 0;
    const comp = labelComponents(bgLike, w, h, 1);
    const minGap = w * h * 0.0004;
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const id = comp.lab[i];
      // Enclosed background-coloured regions count as background too when big.
      const isBg = id >= 0 && (comp.touchesBorder[id] || comp.sizes[id] >= minGap);
      raw[i] = isBg ? 0 : 1;
    }
    if (o.invert) for (let i = 0; i < w * h; i++) raw[i] = 1 - raw[i];
    return { w, h, data: cleanup(raw, w, h, o) };
  }

  // ---------- AI (main process) ----------

  const MODELS = {
    'isnet-general-use': { size: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1] },
    'u2netp':            { size: 320,  mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
  };

  function aiAvailable() {
    return !!(global.appAPI && typeof global.appAPI.removeBackground === 'function');
  }

  /** Returns { w, h, alpha: Float32Array 0..1 } at working resolution. */
  async function aiMatte(img, model, onProgress) {
    const spec = MODELS[model] || MODELS['isnet-general-use'];
    const S = spec.size;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, S, S);
    const px = ctx.getImageData(0, 0, S, S).data;
    let max = 1e-6;
    for (let i = 0; i < S * S; i++) max = Math.max(max, px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    const tensor = new Float32Array(3 * S * S);
    for (let i = 0; i < S * S; i++) {
      for (let c = 0; c < 3; c++) tensor[c * S * S + i] = (px[i * 4 + c] / max - spec.mean[c]) / spec.std[c];
    }
    const out = await global.appAPI.removeBackground({ model, size: S, data: tensor }, onProgress);
    if (out && out.fallback) return aiMatte(img, out.fallback, onProgress);
    const pred = out instanceof Float32Array ? out : new Float32Array(out);
    let mi = Infinity, ma = -Infinity;
    for (let i = 0; i < pred.length; i++) { if (pred[i] < mi) mi = pred[i]; if (pred[i] > ma) ma = pred[i]; }
    const span = ma - mi || 1;

    // Resample the S×S matte to the working resolution of the photo.
    const { w, h } = imageToCanvas(img, WORK_MAX);
    const m = document.createElement('canvas');
    m.width = S; m.height = S;
    const mctx = m.getContext('2d');
    const mid = mctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const v = Math.round(((pred[i] - mi) / span) * 255);
      mid.data[i * 4] = mid.data[i * 4 + 1] = mid.data[i * 4 + 2] = v;
      mid.data[i * 4 + 3] = 255;
    }
    mctx.putImageData(mid, 0, 0);
    const r = document.createElement('canvas');
    r.width = w; r.height = h;
    const rctx = r.getContext('2d', { willReadFrequently: true });
    rctx.drawImage(m, 0, 0, w, h);
    const rd = rctx.getImageData(0, 0, w, h).data;
    const alpha = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) alpha[i] = rd[i * 4] / 255;
    return { w, h, alpha };
  }

  function fromMatte(matte, opts) {
    const o = opts || {};
    const thr = 0.5 - 0.35 * (o.sensitivity || 0);
    const raw = new Uint8Array(matte.w * matte.h);
    for (let i = 0; i < raw.length; i++) raw[i] = matte.alpha[i] >= thr ? 1 : 0;
    if (o.invert) for (let i = 0; i < raw.length; i++) raw[i] = 1 - raw[i];
    return { w: matte.w, h: matte.h, data: cleanup(raw, matte.w, matte.h, o) };
  }

  /**
   * Hazır siyah-beyaz görsel: yalnızca eşikleme, temizleme / yumuşatma / konu
   * arama yok. Koyu = gölge (1), açık ve saydam = ışık (0).
   * opts: { sensitivity -1..1 (eşiği kaydırır; + daha çok gölge), invert }
   */
  function direct(img, opts) {
    const o = opts || {};
    const { ctx, w, h } = imageToCanvas(img, WORK_MAX);
    const px = ctx.getImageData(0, 0, w, h).data;
    const thr = 128 + 100 * (o.sensitivity || 0);
    const data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) {
      const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      data[i] = (lum < thr) !== !!o.invert ? 1 : 0;
    }
    return { w, h, data };
  }

  /** Görsel zaten siyah-beyaz mı (piksellerin ≥ %97'si çok koyu ya da çok açık)? */
  function isBlackWhite(img) {
    const { ctx, w, h } = imageToCanvas(img, 256);
    const px = ctx.getImageData(0, 0, w, h).data;
    let bw = 0;
    for (let i = 0; i < w * h; i++) {
      const lum = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
      const sat = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) - Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      if ((lum < 50 || lum > 205) && sat < 40) bw++;
    }
    return bw >= 0.97 * w * h;
  }

  /**
   * Detaylı portre (şablon / stencil): konunun içindeki koyu bölgeler (saç, kaş,
   * göz, sakal, koyu kıyafet) gölge, açık bölgeler (ten, gömlek) ışık olur.
   * subject: konu maskesi (AI veya hızlı yöntem), aynı çalışma çözünürlüğünde.
   * opts: { sensitivity -1..1 (eşik kaydırma), local 0..1 (yerel kontrast ağırlığı),
   *         outline px (konu dış hattı, gölge), invert, smooth }
   */
  function portrait(img, subject, opts) {
    const o = opts || {};
    const w = subject.w, h = subject.h, n = w * h;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(n);
    for (let i = 0; i < n; i++) lum[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];

    // Konu içinde parlaklığı normalleştir (%2–%98) → farklı pozlamalarda aynı davranış.
    const vals = [];
    for (let i = 0; i < n; i += 3) if (subject.data[i]) vals.push(lum[i]);
    if (vals.length < 50) return { w, h, data: new Uint8Array(n) };
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.floor(vals.length * 0.98)];
    const span = Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) lum[i] = Math.max(0, Math.min(255, ((lum[i] - lo) / span) * 255));

    // Genel eşik: konu pikselleri üzerinde Otsu, hassasiyetle kaydırılır.
    const subjVals = new Float32Array(vals.length);
    for (let i = 0, k = 0; i < n; i += 3) if (subject.data[i]) subjVals[k++] = lum[i];
    let T = otsu(subjVals, 256);
    T = Math.max(10, Math.min(245, T + (o.sensitivity || 0) * 70));

    // Yerel ortalama (kutu bulanıklığı): eşit dağılmayan ışıkta da göz/kaş yakalanır.
    const rl = Math.max(2, Math.round(Math.max(w, h) / 45));
    const local = blur(lum, w, h, rl);
    const a = o.local != null ? o.local : 0.5;

    const dark = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!subject.data[i]) continue;
      const thr = (1 - a) * T + a * (local[i] - 8);
      let d = lum[i] < Math.min(thr, T * 1.35) ? 1 : 0;
      if (o.invert) d = 1 - d;
      dark[i] = d;
    }

    // Dış hat: aydınlık yüz beyaz arka planla birleşmesin.
    const ow = Math.round(o.outline != null ? o.outline : 0);
    if (ow > 0) {
      const f = new Float32Array(n);
      for (let i = 0; i < n; i++) f[i] = subject.data[i];
      const b2 = blur(f, w, h, ow);
      for (let i = 0; i < n; i++) if (subject.data[i] && b2[i] < 0.999) dark[i] = 1;
    }

    // Gürültü temizliği: tek tük koyu benekler ve küçük ışık delikleri.
    const minA = Math.max(4, Math.round(n * 0.000015));
    [1, 0].forEach((val) => {
      const comp = labelComponents(dark, w, h, val);
      for (let i = 0; i < n; i++) {
        const id = comp.lab[i];
        if (id >= 0 && comp.sizes[id] < minA && (val === 1 || subject.data[i])) dark[i] = 1 - val;
      }
    });
    return { w, h, data: smooth(dark, w, h, o.smooth != null ? o.smooth : 1) };
  }

  /** Render a mask as an Image: subject black, background white (target convention: white = lit). */
  function maskToImage(mask) {
    const cv = document.createElement('canvas');
    cv.width = mask.w; cv.height = mask.h;
    const ctx = cv.getContext('2d');
    const id = ctx.createImageData(mask.w, mask.h);
    for (let i = 0; i < mask.w * mask.h; i++) {
      const v = mask.data[i] ? 0 : 255;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
      id.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = cv.toDataURL('image/png');
    });
  }

  // ---------- kullanıcı yardımı: alan seçimi ve fırça ipuçları ----------
  // rect: görüntüye göre normalize { x, y, w, h } (0..1).
  // hints: görüntüyle aynı en/boy oranında tuval; yeşil = konuya ekle, kırmızı = çıkar.

  /** Seçilen alanı ayrı bir tuvale kırpar (siluet yalnızca orada, daha çok piksel ile çıkarılır). */
  function cropCanvas(img, rect) {
    const sx = rect.x * img.width, sy = rect.y * img.height;
    const sw = Math.max(1, Math.round(rect.w * img.width)), sh = Math.max(1, Math.round(rect.h * img.height));
    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, sw, sh);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return cv;
  }

  /** Fırça ipuçlarını maskeye uygular: yeşil → 1, kırmızı → 0 (removeOnly: yalnızca kırmızı). */
  function applyHints(mask, hints, rect, removeOnly) {
    if (!hints) return mask;
    const r = rect || { x: 0, y: 0, w: 1, h: 1 };
    const cv = document.createElement('canvas');
    cv.width = mask.w; cv.height = mask.h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(hints, r.x * hints.width, r.y * hints.height, r.w * hints.width, r.h * hints.height, 0, 0, mask.w, mask.h);
    const d = ctx.getImageData(0, 0, mask.w, mask.h).data;
    const out = mask.data.slice();
    for (let i = 0; i < out.length; i++) {
      if (d[i * 4 + 3] < 128) continue;
      const add = d[i * 4 + 1] > d[i * 4];
      if (add && removeOnly) continue;
      out[i] = add ? 1 : 0;
    }
    return { w: mask.w, h: mask.h, data: out };
  }

  /**
   * Detay alanları: kullanıcının çizdiği her kutuda, kutunun kendi
   * parlaklığına göre (portre yöntemiyle, yerel kontrast) koyu hatlar aranır
   * ve ana maskeye eklenir. Algoritmanın kaçırdığı nesneler (arkadaki kılıç…)
   * böylece kendi kenarlarıyla gelir; kutu dolu siyaha dönmez.
   * Dönen: { mask, skipped } — skipped: neredeyse tamamı koyu çıkan (anlamsız) alan sayısı.
   */
  function addRegions(img, mask, rects, opts) {
    if (!rects || !rects.length) return { mask, skipped: 0 };
    const out = mask.data.slice();
    let skipped = 0;
    rects.forEach((r) => {
      const crop = cropCanvas(img, r);
      const k = Math.min(1, 1024 / Math.max(crop.width, crop.height));
      const w = Math.max(1, Math.round(crop.width * k)), h = Math.max(1, Math.round(crop.height * k));
      const all = { w, h, data: new Uint8Array(w * h).fill(1) };
      const o = opts || {};
      const local = portrait(crop, all, { sensitivity: o.sensitivity || 0, local: Math.max(0.5, o.local != null ? o.local : 0.5), outline: 0, invert: o.invert, smooth: 1 });
      let n = 0;
      for (let i = 0; i < local.data.length; i++) n += local.data[i];
      if (n > local.data.length * 0.85) { skipped++; return; }
      const x0 = Math.floor(r.x * mask.w), y0 = Math.floor(r.y * mask.h);
      const x1 = Math.min(mask.w, Math.ceil((r.x + r.w) * mask.w)), y1 = Math.min(mask.h, Math.ceil((r.y + r.h) * mask.h));
      const sx = local.w / Math.max(1, x1 - x0), sy = local.h / Math.max(1, y1 - y0);
      for (let y = y0; y < y1; y++) {
        const ly = Math.min(local.h - 1, Math.floor((y - y0 + 0.5) * sy));
        for (let x = x0; x < x1; x++) {
          if (local.data[ly * local.w + Math.min(local.w - 1, Math.floor((x - x0 + 0.5) * sx))]) out[y * mask.w + x] = 1;
        }
      }
    });
    return { mask: { w: mask.w, h: mask.h, data: out }, skipped };
  }

  /**
   * Önizleme: fotoğraf, üzerinde konu maskesi (koyu = gölge, turuncu = ışık).
   * o: { rects (detay alanları, kesikli çerçeve), hints (fırça katmanı) }.
   * Dönen kutu, tuval pikselinden görüntü koordinatına çevirmek için kullanılır.
   */
  function drawPreview(canvas, img, mask, o) {
    const opt = o || {};
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, W, H);
    if (!img) return null;
    const s = Math.min(W / img.width, H / img.height);
    const dw = img.width * s, dh = img.height * s;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    ctx.drawImage(img, ox, oy, dw, dh);
    if (mask) {
      const ov = document.createElement('canvas');
      ov.width = mask.w; ov.height = mask.h;
      const octx = ov.getContext('2d');
      const id = octx.createImageData(mask.w, mask.h);
      for (let i = 0; i < mask.w * mask.h; i++) {
        if (mask.data[i]) { id.data[i * 4] = 20; id.data[i * 4 + 1] = 20; id.data[i * 4 + 2] = 20; id.data[i * 4 + 3] = 235; }
        else { id.data[i * 4] = 255; id.data[i * 4 + 1] = 205; id.data[i * 4 + 2] = 90; id.data[i * 4 + 3] = 150; }
      }
      octx.putImageData(id, 0, 0);
      ctx.drawImage(ov, ox, oy, dw, dh);
    }
    if (opt.hints) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(opt.hints, ox, oy, dw, dh);
      ctx.restore();
    }
    (opt.rects || []).forEach((r, i) => {
      const rx = ox + r.x * dw, ry = oy + r.y * dh;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#1f8fff';
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, r.w * dw, r.h * dh);
      ctx.setLineDash([]);
      ctx.fillStyle = '#1f8fff';
      ctx.fillRect(rx, ry - 16, 18, 16);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(String(i + 1), rx + 5, ry - 4);
      ctx.restore();
    });
    return { ox, oy, dw, dh };
  }

  global.Silhouette = { quick, direct, isBlackWhite, portrait, aiAvailable, aiMatte, fromMatte, maskToImage, drawPreview, cropCanvas, applyHints, addRegions };
})(window);
