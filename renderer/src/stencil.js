/**
 * Görsel Dönüştürücü çekirdeği (DOM kullanmaz; Node testleri de yükler).
 *
 *  1. Görüntü → şablon maskesi: ton ayarı, eşik (Otsu / yerel), renk
 *     katmanları (k-ortalama), kenar çizimi, benek ve delik temizliği,
 *     kalınlaştırma / inceltme (Öklid uzaklık dönüşümüyle).
 *  2. Baskı analizi: şablon lamba duvarına (açılmış s, z ızgarası, fiziksel
 *     mm) taşınır. Basılamayacak ince gölge çizgileri, kapanacak dar ışık
 *     aralıkları ve tabana bağlanmayan (havada kalan) parçalar orada bulunur
 *     ve düzeltilir; düzeltmeler hedef görüntüye geri yazılır. Uzaklıklar
 *     duvarda ölçüldüğü için gölgedeki büyüme (ρ/r yatay, ρ²/(r·cz) dikey)
 *     kendiliğinden hesaba katılır.
 *  3. Vektör: maske konturları (marching squares) → sadeleştirme (RDP) →
 *     köşeleri koruyan Bezier eğrileri → SVG.
 *
 * Maskeler Uint8Array, 1 = gölge (lamba duvarında malzeme), 0 = ışık.
 */
(function (global) {
  'use strict';

  // ---------- ton ve gri ----------

  function luminance(rgba, n) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    return out;
  }

  /** Kayan pencereli kutu bulanıklığı (O(n), yarıçap r). */
  function blurF(src, w, h, r) {
    r = Math.round(r);
    if (r <= 0) return src;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = s / n;
        s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / n;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  /**
   * Parlaklık / kontrast (-100..100), gama (0.2..3), doygunluk (-100..100),
   * bulanıklık (px). Yeni RGBA dizisi döndürür.
   */
  function adjust(rgba, w, h, o) {
    const n = w * h;
    const b = (o.brightness || 0) / 100;
    const c = (o.contrast || 0) / 100;
    const cf = c >= 0 ? 1 / Math.max(0.02, 1 - c * 0.98) : 1 + c;
    const g = o.gamma || 1;
    const sat = 1 + (o.saturation || 0) / 100;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      let v = Math.pow(i / 255, 1 / g);
      v = (v - 0.5) * cf + 0.5 + b;
      lut[i] = Math.round(v * 255);
    }
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      let r = lut[rgba[i * 4]], gg = lut[rgba[i * 4 + 1]], bb = lut[rgba[i * 4 + 2]];
      if (sat !== 1) {
        const l = 0.299 * r + 0.587 * gg + 0.114 * bb;
        r = l + (r - l) * sat; gg = l + (gg - l) * sat; bb = l + (bb - l) * sat;
      }
      out[i * 4] = r; out[i * 4 + 1] = gg; out[i * 4 + 2] = bb;
      out[i * 4 + 3] = 255;
    }
    const br = Math.round(o.blur || 0);
    if (br > 0) {
      for (let ch = 0; ch < 3; ch++) {
        const f = new Float32Array(n);
        for (let i = 0; i < n; i++) f[i] = out[i * 4 + ch];
        const bl = blurF(blurF(f, w, h, br), w, h, br);   // iki geçiş ≈ Gauss
        for (let i = 0; i < n; i++) out[i * 4 + ch] = bl[i];
      }
    }
    return out;
  }

  /** Otsu eşiği (0..255 değerler). */
  function otsu(values) {
    const hist = new Float64Array(256);
    for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, values[i] | 0))]++;
    const total = values.length;
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, best = -1, thr = 128;
    for (let i = 0; i < 256; i++) {
      wB += hist[i];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = i + 0.5; }
    }
    return thr;
  }

  /**
   * Parlaklık eşiği. o: { level (0..255, null = Otsu), adaptive 0..1, radius px }
   * Dönen { mask, level }: koyu = gölge.
   */
  function threshold(lum, w, h, o) {
    const T = o.level != null ? o.level : otsu(lum);
    const a = o.adaptive || 0;
    const mask = new Uint8Array(w * h);
    if (a > 0) {
      const local = blurF(lum, w, h, Math.max(2, o.radius || Math.round(Math.max(w, h) / 40)));
      for (let i = 0; i < w * h; i++) mask[i] = lum[i] < (1 - a) * T + a * (local[i] - 4) ? 1 : 0;
    } else {
      for (let i = 0; i < w * h; i++) mask[i] = lum[i] < T ? 1 : 0;
    }
    return { mask, level: T };
  }

  // sRGB → Lab (algısal renk uzaklığı için)
  const LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function toLab(r, g, b) {
    const R = LIN[r | 0], G = LIN[g | 0], B = LIN[b | 0];
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }

  /**
   * Renk katmanları: Lab uzayında k-ortalama (deterministik k-means++).
   * Dönen { labels, palette: [{rgb, lab, count}] } koyudan açığa sıralı.
   */
  function kmeans(rgba, w, h, k) {
    const n = w * h;
    const lab = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const L = toLab(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      lab[i * 3] = L[0]; lab[i * 3 + 1] = L[1]; lab[i * 3 + 2] = L[2];
    }
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    const step = Math.max(1, Math.floor(n / 30000));
    const samp = [];
    for (let i = 0; i < n; i += step) samp.push(i);
    const d2 = (i, c) => (lab[i * 3] - c[0]) ** 2 + (lab[i * 3 + 1] - c[1]) ** 2 + (lab[i * 3 + 2] - c[2]) ** 2;
    const centers = [];
    const first = samp[Math.floor(rnd() * samp.length)];
    centers.push([lab[first * 3], lab[first * 3 + 1], lab[first * 3 + 2]]);
    const best = new Float64Array(samp.length).fill(Infinity);
    while (centers.length < k) {
      let tot = 0;
      const c = centers[centers.length - 1];
      for (let j = 0; j < samp.length; j++) { best[j] = Math.min(best[j], d2(samp[j], c)); tot += best[j]; }
      if (tot <= 0) break;
      let r = rnd() * tot, pick = samp[samp.length - 1];
      for (let j = 0; j < samp.length; j++) { r -= best[j]; if (r <= 0) { pick = samp[j]; break; } }
      centers.push([lab[pick * 3], lab[pick * 3 + 1], lab[pick * 3 + 2]]);
    }
    const K = centers.length;
    for (let it = 0; it < 15; it++) {
      const acc = centers.map(() => [0, 0, 0, 0]);
      for (const i of samp) {
        let bk = 0, bd = Infinity;
        for (let q = 0; q < K; q++) { const d = d2(i, centers[q]); if (d < bd) { bd = d; bk = q; } }
        const a = acc[bk];
        a[0] += lab[i * 3]; a[1] += lab[i * 3 + 1]; a[2] += lab[i * 3 + 2]; a[3]++;
      }
      acc.forEach((a, q) => { if (a[3]) centers[q] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
    }
    const raw = new Uint8Array(n);
    const rgbAcc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bk = 0, bd = Infinity;
      for (let q = 0; q < K; q++) { const d = d2(i, centers[q]); if (d < bd) { bd = d; bk = q; } }
      raw[i] = bk;
      const a = rgbAcc[bk];
      a[0] += rgba[i * 4]; a[1] += rgba[i * 4 + 1]; a[2] += rgba[i * 4 + 2]; a[3]++;
    }
    const order = centers.map((c, q) => q).sort((a, b) => centers[a][0] - centers[b][0]);
    const remap = new Uint8Array(K);
    order.forEach((q, j) => { remap[q] = j; });
    const labels = new Uint8Array(n);
    for (let i = 0; i < n; i++) labels[i] = remap[raw[i]];
    const palette = order.map((q) => {
      const a = rgbAcc[q], cnt = a[3] || 1;
      return { rgb: [Math.round(a[0] / cnt), Math.round(a[1] / cnt), Math.round(a[2] / cnt)], lab: centers[q], count: a[3] };
    });
    return { labels, palette };
  }

  /** Kenar çizimi: Sobel büyüklüğü (%98'lik dilime normalize) > seviye → gölge çizgisi. */
  function edges(lum, w, h, level) {
    const n = w * h;
    const mag = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1];
        const gy = lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1];
        mag[i] = Math.hypot(gx, gy);
      }
    }
    const samp = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20000))) samp.push(mag[i]);
    samp.sort((a, b) => a - b);
    const ref = samp[Math.floor(samp.length * 0.98)] || 1;
    const mask = new Uint8Array(n);
    const thr = (level / 255) * ref;
    for (let i = 0; i < n; i++) mask[i] = mag[i] > thr ? 1 : 0;
    return mask;
  }

  // ---------- ikili maske işlemleri ----------

  /** 4-komşu bileşenler; periodicX: x yönünde sarar (açılmış duvar). */
  function components(mask, w, h, value, periodicX) {
    const lab = new Int32Array(w * h).fill(-1);
    const sizes = [], border = [], seeds = [];
    const stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (mask[s] !== value || lab[s] >= 0) continue;
      const id = sizes.length;
      let sp = 0, cnt = 0, b = 0;
      stack[sp++] = s; lab[s] = id;
      while (sp) {
        const i = stack[--sp];
        cnt++;
        const x = i % w, y = (i / w) | 0;
        if (y === 0) b |= 1;
        if (y === h - 1) b |= 2;
        if (!periodicX && (x === 0 || x === w - 1)) b |= 4;
        const l = x > 0 ? i - 1 : (periodicX ? i + w - 1 : -1);
        const r = x < w - 1 ? i + 1 : (periodicX ? i - w + 1 : -1);
        const u = y > 0 ? i - w : -1, d = y < h - 1 ? i + w : -1;
        if (l >= 0 && mask[l] === value && lab[l] < 0) { lab[l] = id; stack[sp++] = l; }
        if (r >= 0 && mask[r] === value && lab[r] < 0) { lab[r] = id; stack[sp++] = r; }
        if (u >= 0 && mask[u] === value && lab[u] < 0) { lab[u] = id; stack[sp++] = u; }
        if (d >= 0 && mask[d] === value && lab[d] < 0) { lab[d] = id; stack[sp++] = d; }
      }
      sizes.push(cnt); border.push(b); seeds.push(s);
    }
    return { lab, sizes, border, seeds };
  }

  /** Küçük gölge lekelerini ve kapalı küçük ışık deliklerini temizler (piksel alanı). */
  function despeckle(mask, w, h, minDark, minLight) {
    const out = mask.slice();
    if (minDark > 0) {
      const c = components(out, w, h, 1);
      for (let i = 0; i < w * h; i++) if (c.lab[i] >= 0 && c.sizes[c.lab[i]] < minDark) out[i] = 0;
    }
    if (minLight > 0) {
      const c = components(out, w, h, 0);
      for (let i = 0; i < w * h; i++) {
        const id = c.lab[i];
        if (id >= 0 && !c.border[id] && c.sizes[id] < minLight) out[i] = 1;
      }
    }
    return out;
  }

  /** Kenara değmeyen bütün ışık bölgelerini doldurur (dolu siluet). */
  function fillHoles(mask, w, h) {
    const out = mask.slice();
    const c = components(out, w, h, 0);
    for (let i = 0; i < w * h; i++) if (c.lab[i] >= 0 && !c.border[c.lab[i]]) out[i] = 1;
    return out;
  }

  // Felzenszwalb–Huttenlocher kare Öklid uzaklık dönüşümü (1B).
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s <= z[k] && k > 0) k--; else break;
      }
      if (s <= z[k]) { v[0] = q; z[0] = -Infinity; z[1] = Infinity; k = 0; continue; }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const p = v[k];
      d[q] = (q - p) * (q - p) + f[p];
    }
  }

  /**
   * Her pikselin, değeri `value` olan en yakın piksele uzaklığı (piksel).
   * periodicX: x yönünde sarar (açılmış duvar için); sarma payı `reach`
   * hücreye kadar doğru (analizde yalnızca kısa uzaklıklar karşılaştırılır).
   */
  function distanceTo(mask, w, h, value, periodicX, reach) {
    const pad = periodicX ? Math.min(w, Math.ceil(reach || 64)) : 0;
    const W = w + 2 * pad;
    const INF = 1e20;
    const g = new Float64Array(W * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < W; x++) {
        const sx = ((x - pad) % w + w) % w;
        g[y * W + x] = mask[y * w + sx] === value ? 0 : INF;
      }
    }
    const nmax = Math.max(W, h);
    const f = new Float64Array(nmax), d = new Float64Array(nmax), v = new Int32Array(nmax), z = new Float64Array(nmax + 1);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < h; y++) f[y] = g[y * W + x];
      edt1d(f, h, d, v, z);
      for (let y = 0; y < h; y++) g[y * W + x] = d[y];
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < W; x++) f[x] = g[y * W + x];
      edt1d(f, W, d, v, z);
      for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x + pad]);
    }
    return out;
  }

  /** r > 0: gölgeyi r piksel genişlet; r < 0: daralt. */
  function offset(mask, w, h, r, periodicX) {
    if (!r) return mask;
    const out = new Uint8Array(w * h);
    if (r > 0) {
      const dd = distanceTo(mask, w, h, 1, periodicX);
      for (let i = 0; i < w * h; i++) out[i] = dd[i] <= r ? 1 : 0;
    } else {
      const dl = distanceTo(mask, w, h, 0, periodicX);
      for (let i = 0; i < w * h; i++) out[i] = dl[i] > -r ? 1 : 0;
    }
    return out;
  }

  /**
   * Genişliği `width` pikselden dar kısımlar (açma işlemiyle kaybolanlar).
   * Disk yarıçapı ρ = (width − 1) / 2: k piksellik çizginin ortası ışığa
   * (k + 1) / 2 uzakta olduğundan tam `width` kalınlığındaki çizgi kalır.
   * Açma dış köşeleri de yuvarlar; köşeler ince sayılmasın diye kapsama
   * √2·ρ + 1'e kadar kabul edilir (yalnızca gerçek ince uzantılar kalır).
   */
  function thinParts(mask, w, h, width, periodicX) {
    const thin = new Uint8Array(w * h);
    const rho = (width - 1) / 2;
    if (rho < 0.5) return thin;
    const dl = distanceTo(mask, w, h, 0, periodicX);
    const core = new Uint8Array(w * h);
    let any = false;
    for (let i = 0; i < w * h; i++) if (dl[i] > rho) { core[i] = 1; any = true; }
    if (!any) { for (let i = 0; i < w * h; i++) thin[i] = mask[i]; return thin; }
    const dc = distanceTo(core, w, h, 1, periodicX);
    const reach = Math.SQRT2 * rho + 1;
    for (let i = 0; i < w * h; i++) if (mask[i] && dc[i] > reach) thin[i] = 1;
    return thin;
  }

  // ---------- baskı geometrisi (hedef ↔ açılmış duvar) ----------

  /**
   * geo: { shape, cz, margin, zb (taban bandı, cm), R, openTop,
   *        toTarget(X, Y) → [x, y], toWall(x, y) → [X, Y] }   (cm)
   * S: hedef maskenin kenar uzunluğu (piksel).
   * Duvar ızgarası yaklaşık kare hücreli (cm); sütunlar s (çevre boyunca, sarar),
   * satırlar z = 0 … cz − margin.
   */
  function buildPrintMap(geo, S, Projection) {
    const { shape, cz, R } = geo;
    const P = shape.perimeter;
    const zTop = cz - (geo.margin || 0);
    // ~500 bin hücre: 0,8 mm çizgi ≥ 3 hücre, analiz ~0,2 s.
    const cell = Math.max(0.015, Math.min(0.05, Math.sqrt((P * zTop) / 5e5)));
    const ns = Math.max(8, Math.ceil(P / cell));
    const nz = Math.max(4, Math.ceil(zTop / cell) + 1);
    const cellS = P / ns, cellZ = zTop / (nz - 1);
    const wallToPx = new Int32Array(ns * nz);
    const pts = new Array(ns);
    for (let c = 0; c < ns; c++) pts[c] = shape.pointAt((c + 0.5) * cellS);
    for (let r = 0; r < nz; r++) {
      const z = r * cellZ;
      const m = shape.scaleAt(z) * cz / (cz - z);
      for (let c = 0; c < ns; c++) {
        const t = geo.toTarget(pts[c].x * m, pts[c].y * m);
        const px = Math.floor(((t[0] / R) * 0.5 + 0.5) * S);
        const py = Math.floor((0.5 - (t[1] / R) * 0.5) * S);
        wallToPx[r * ns + c] = px >= 0 && py >= 0 && px < S && py < S ? py * S + px : -1;
      }
    }
    // Hedef pikseli → duvar hücresi; −1 lamba izi (taban, hep gölge), −2 ışığın önü / erişilemez.
    const pxToWall = new Int32Array(S * S);
    for (let py = 0; py < S; py++) {
      const y = (0.5 - (py + 0.5) / S) * 2 * R;
      for (let px = 0; px < S; px++) {
        const x = ((px + 0.5) / S - 0.5) * 2 * R;
        const wpt = geo.toWall(x, y);
        const inv = Projection.inverseShell(wpt[0], wpt[1], shape, cz, geo.margin || 0);
        let k;
        if (!inv) k = -1;
        else if (inv.blocked) k = -2;
        else {
          const r = Math.min(nz - 1, Math.max(0, Math.round(inv.z / cellZ)));
          let c = Math.floor(inv.s / cellS) % ns;
          if (c < 0) c += ns;
          k = r * ns + c;
        }
        pxToWall[py * S + px] = k;
      }
    }
    const zbRow = Math.min(nz - 1, Math.ceil((geo.zb || 0) / cellZ));
    return { S, ns, nz, cellS, cellZ, cellMm: cell * 10, wallToPx, pxToWall, zbRow, openTop: !!geo.openTop };
  }

  /**
   * Baskı analizi + düzeltme. mask: S×S hedef maskesi (1 = gölge).
   * o: { outsideLit, minLineMm, minGapMm, bridgeMm, minIslandMm2,
   *      thin: 'thicken'|'remove'|'keep', gaps: 'close'|'widen'|'keep',
   *      floating: 'bridge'|'remove'|'keep' }
   * Dönen: { mask (düzeltilmiş), overlay (S×S kod), stats }
   *   overlay: 1 eklendi (köprü/kalınlaştırma), 2 silindi, 3 kalan sorun (ince/yüzen), 4 lamba izi, 5 erişilemez
   */
  function analyzePrint(mask, map, o) {
    const { S, ns, nz, wallToPx, pxToWall, zbRow } = map;
    const N = ns * nz;
    const cellMm = map.cellMm;
    const cellArea = (map.cellS * map.cellZ) * 100;       // mm²
    const outside = o.outsideLit === false ? 1 : 0;
    const W0 = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      const r = (k / ns) | 0;
      if (r < zbRow) { W0[k] = 1; continue; }
      const px = wallToPx[k];
      W0[k] = px >= 0 ? mask[px] : outside;
    }
    // Duvarda bir hücreden ince düşen gölgeler (ışığa yakın, çok büyüyen
    // bölgedeki ince çizgiler) merkez örneklemede kaybolur; hücreye düşen
    // her gölge pikseli hücreyi gölge sayar ki kalınlaştırılabilsin.
    for (let p = 0; p < S * S; p++) {
      if (!mask[p]) continue;
      const k = pxToWall[p];
      if (k >= 0) W0[k] = 1;
    }
    const W = W0.slice();
    // Düzeltmelerin dokunduğu hücreler; yalnızca bunlar hedefe geri yazılır.
    const added = new Uint8Array(N), removed = new Uint8Array(N);
    const add = (k) => { W[k] = 1; added[k] = 1; removed[k] = 0; };
    const del = (k) => { W[k] = 0; removed[k] = 1; added[k] = 0; };
    const stats = {
      cellMm, thinLineMm2: 0, thinGapMm2: 0, floating: 0, floatingMm2: 0, bridges: 0, islandsRemoved: 0,
      residualThin: 0, residualFloating: 0, residualGap: 0,
    };
    const lineCells = (o.minLineMm || 0) / cellMm;
    const gapCells = (o.minGapMm || 0) / cellMm;
    const bandOnly = (arr) => { for (let k = 0; k < zbRow * ns; k++) arr[k] = 0; return arr; };

    // 1) İnce gölge çizgileri
    let thin = bandOnly(thinParts(W, ns, nz, lineCells, true));
    for (let k = 0; k < N; k++) if (thin[k]) stats.thinLineMm2 += cellArea;
    if (o.thin === 'thicken' && stats.thinLineMm2 > 0) {
      const dt = distanceTo(thin, ns, nz, 1, true);
      const rr = lineCells / 2;
      for (let k = 0; k < N; k++) if (dt[k] <= rr) add(k);
    } else if (o.thin === 'remove') {
      for (let k = 0; k < N; k++) if (thin[k]) del(k);
    }

    // 2) Dar ışık aralıkları (dilimleyicide kapanır)
    const lit = new Uint8Array(N);
    for (let k = 0; k < N; k++) lit[k] = W[k] ? 0 : 1;
    let gap = bandOnly(thinParts(lit, ns, nz, gapCells, true));
    for (let k = 0; k < N; k++) if (gap[k]) stats.thinGapMm2 += cellArea;
    if (o.gaps === 'close') {
      for (let k = 0; k < N; k++) if (gap[k]) add(k);
    } else if (o.gaps === 'widen' && stats.thinGapMm2 > 0) {
      const dt = distanceTo(gap, ns, nz, 1, true);
      const rr = gapCells / 2;
      for (let k = 0; k < N; k++) if (dt[k] <= rr && ((k / ns) | 0) >= zbRow) del(k);
    }

    // 3) Havada kalan parçalar: tabana (kapakta ön çembere de) bağlanmayan gölge
    const minIsland = o.minIslandMm2 != null ? o.minIslandMm2 : 0.5;
    const fixFloating = (Wm, mode, count) => {
      const comp = components(Wm, ns, nz, 1, true);
      const anchored = new Uint8Array(N);
      const islands = [];
      comp.sizes.forEach((sz, id) => {
        const b = comp.border[id];
        if ((b & 1) || ((b & 2) && !map.openTop)) anchored[id] = 1;
        else islands.push(id);
      });
      if (count) {
        islands.forEach((id) => {
          if (comp.sizes[id] * cellArea >= minIsland) { stats.floating++; stats.floatingMm2 += comp.sizes[id] * cellArea; }
        });
      }
      if (!islands.length || mode === 'keep') return { comp, islands, anchored };
      const isl = new Uint8Array(comp.sizes.length);
      islands.forEach((id) => { isl[id] = 1; });
      // Kırıntılar her durumda silinir (lamba da siler).
      const tiny = new Uint8Array(comp.sizes.length);
      islands.forEach((id) => { if (comp.sizes[id] * cellArea < minIsland) tiny[id] = 1; });
      for (let k = 0; k < N; k++) { const id = comp.lab[k]; if (id >= 0 && tiny[id]) del(k); }
      if (mode === 'remove') {
        for (let k = 0; k < N; k++) { const id = comp.lab[k]; if (id >= 0 && isl[id]) del(k); }
        stats.islandsRemoved += islands.length;
        return { comp, islands, anchored };
      }
      // Köprü: bağlı gölgeden çok kaynaklı 0-1 BFS. Gölgeden geçmek bedava,
      // ışığı kesmek 1 → köprü duvarda en kısa ışık yolundan geçer.
      const parent = new Int32Array(N).fill(-2);
      const dist = new Int32Array(N).fill(0x3fffffff);
      const dq = new Int32Array(2 * N + 2);
      let head = N, tail = N;
      for (let k = 0; k < N; k++) {
        const id = comp.lab[k];
        if (id >= 0 && anchored[id]) { parent[k] = -1; dist[k] = 0; dq[tail++] = k; }
      }
      while (head < tail) {
        const i = dq[head++];
        const r = (i / ns) | 0, c = i - r * ns;
        const nb = [r > 0 ? i - ns : -1, r < nz - 1 ? i + ns : -1, r * ns + ((c + 1) % ns), r * ns + ((c - 1 + ns) % ns)];
        for (const j of nb) {
          if (j < 0) continue;
          const wgt = Wm[j] ? 0 : 1;
          if (dist[i] + wgt >= dist[j]) continue;
          dist[j] = dist[i] + wgt;
          parent[j] = i;
          if (wgt === 0) dq[--head] = j; else dq[tail++] = j;
        }
      }
      const rb = Math.max(0.5, (o.bridgeMm || 1.2) / cellMm / 2);
      const rbi = Math.ceil(rb);
      const paint = (i) => {
        const r0 = (i / ns) | 0, c0 = i - r0 * ns;
        for (let dr = -rbi; dr <= rbi; dr++) {
          const r = r0 + dr;
          if (r < 0 || r >= nz) continue;
          for (let dc = -rbi; dc <= rbi; dc++) {
            if (dr * dr + dc * dc > rb * rb + 0.25) continue;
            add(r * ns + ((c0 + dc + ns) % ns));
          }
        }
      };
      const best = new Int32Array(comp.sizes.length).fill(-1);
      for (let k = 0; k < N; k++) {
        const id = comp.lab[k];
        if (id < 0 || !isl[id] || tiny[id]) continue;
        if (best[id] < 0 || dist[k] < dist[best[id]]) best[id] = k;
      }
      islands.forEach((id) => {
        const b = best[id];
        if (b < 0) return;
        if (dist[b] >= 0x3fffffff) return;
        for (let i = parent[b]; i >= 0 && parent[i] !== -1; i = parent[i]) if (!Wm[i]) paint(i);
        stats.bridges++;
      });
      return { comp, islands, anchored };
    };
    fixFloating(W.slice(), o.floating || 'bridge', true);

    // 4) Kalan sorunlar: düzeltme yapıldıysa yeniden ölç
    let changed = false;
    for (let k = 0; k < N && !changed; k++) if (added[k] || removed[k]) changed = true;
    if (changed) {
      thin = bandOnly(thinParts(W, ns, nz, lineCells, true));
      for (let k = 0; k < N; k++) lit[k] = W[k] ? 0 : 1;
      gap = bandOnly(thinParts(lit, ns, nz, gapCells, true));
    }
    const after = components(W, ns, nz, 1, true);
    const floatId = new Uint8Array(after.sizes.length);
    after.sizes.forEach((sz, id) => {
      const b = after.border[id];
      if (!((b & 1) || ((b & 2) && !map.openTop)) && sz * cellArea >= minIsland) { floatId[id] = 1; stats.residualFloating++; }
    });
    const problem = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      const id = after.lab[k];
      if (thin[k]) { problem[k] = 1; stats.residualThin += cellArea; }
      if (gap[k]) { problem[k] = 1; stats.residualGap += cellArea; }
      if (id >= 0 && floatId[id]) problem[k] = 1;
    }

    // 5) Duvardaki değişiklikler hedef görüntüye geri yazılır.
    const out = mask.slice();
    const overlay = new Uint8Array(S * S);
    for (let p = 0; p < S * S; p++) {
      const k = pxToWall[p];
      if (k === -1) { overlay[p] = 4; continue; }
      if (k === -2) { overlay[p] = 5; continue; }
      if (k < zbRow * ns) { overlay[p] = 4; continue; }     // taban bandı: hep dolu
      if (added[k]) {
        out[p] = 1;
        if (!mask[p]) overlay[p] = 1;
      } else if (removed[k]) {
        out[p] = 0;
        if (mask[p]) overlay[p] = 2;
      }
      if (!overlay[p] && problem[k]) overlay[p] = 3;
    }
    // İnce eklemeler (köprü) taban yakınında bir hedef pikselinden dar olabilir:
    // eklenen her hücre kendi düştüğü pikseli de boyar, köprü kopmaz.
    for (let k = zbRow * ns; k < N; k++) {
      if (added[k]) {
        const p = wallToPx[k];
        if (p >= 0 && pxToWall[p] >= 0) { out[p] = 1; overlay[p] = 1; }
      }
    }
    return { mask: out, overlay, stats };
  }

  // ---------- vektör izleme ----------

  /**
   * Marching squares: maskenin kapalı konturları (piksel koordinatı; piksel
   * (x, y) karesi [x, x+1] × [y, y+1]). Yalnızca çapraz değen gölgeler ayrı
   * tutulur (4-komşuluk, analizle tutarlı). Dönen: Float64Array[] (x, y, x, y …).
   */
  function trace(mask, w, h) {
    const W2 = w + 2;
    const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
    const hId = (x, y) => ((y + 1) * W2 + (x + 1)) * 2;
    const vId = (x, y) => ((y + 1) * W2 + (x + 1)) * 2 + 1;
    const size = (h + 2) * W2 * 2;
    const l1 = new Int32Array(size).fill(-1), l2 = new Int32Array(size).fill(-1);
    const link = (a, b) => {
      if (l1[a] < 0) l1[a] = b; else l2[a] = b;
      if (l1[b] < 0) l1[b] = a; else l2[b] = a;
    };
    for (let cy = -1; cy < h; cy++) {
      for (let cx = -1; cx < w; cx++) {
        const tl = at(cx, cy), tr = at(cx + 1, cy), br = at(cx + 1, cy + 1), bl = at(cx, cy + 1);
        const cs = tl * 8 + tr * 4 + br * 2 + bl;
        if (cs === 0 || cs === 15) continue;
        const T = hId(cx, cy), B = hId(cx, cy + 1), L = vId(cx, cy), Rr = vId(cx + 1, cy);
        switch (cs) {
          case 1: case 14: link(L, B); break;
          case 2: case 13: link(B, Rr); break;
          case 3: case 12: link(L, Rr); break;
          case 4: case 11: link(T, Rr); break;
          case 6: case 9: link(T, B); break;
          case 7: case 8: link(L, T); break;
          case 5: link(L, B); link(T, Rr); break;      // çapraz gölgeler ayrı
          case 10: link(L, T); link(B, Rr); break;
        }
      }
    }
    const pos = (id) => {
      const v = id & 1, cell = id >> 1;
      const x = (cell % W2) - 1, y = ((cell / W2) | 0) - 1;
      return v ? [x + 0.5, y + 1] : [x + 1, y + 0.5];
    };
    const seen = new Uint8Array(size);
    const loops = [];
    for (let s = 0; s < size; s++) {
      if (l1[s] < 0 || seen[s]) continue;
      const pts = [];
      let prev = -1, cur = s;
      while (cur >= 0 && !seen[cur]) {
        seen[cur] = 1;
        const p = pos(cur);
        pts.push(p[0], p[1]);
        const nx = l1[cur] !== prev ? l1[cur] : l2[cur];
        prev = cur;
        cur = nx;
      }
      if (pts.length >= 6) loops.push(Float64Array.from(pts));
    }
    return loops;
  }

  /** Kapalı çokgen için Ramer–Douglas–Peucker. */
  function simplify(loop, tol) {
    const n = loop.length / 2;
    if (n < 4 || tol <= 0) return loop;
    // En uzak iki nokta arasında böl, iki yarıyı ayrı sadeleştir.
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) {
      const d = (loop[i * 2] - loop[0]) ** 2 + (loop[i * 2 + 1] - loop[1]) ** 2;
      if (d > fd) { fd = d; far = i; }
    }
    const keep = new Uint8Array(n + 1);
    keep[0] = keep[far] = keep[n] = 1;
    const X = (i) => loop[(i % n) * 2], Y = (i) => loop[(i % n) * 2 + 1];
    const stack = [[0, far], [far, n]];
    const t2 = tol * tol;
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      const ax = X(a), ay = Y(a), bx = X(b), by = Y(b);
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
      let bi = -1, bd = t2;
      for (let i = a + 1; i < b; i++) {
        const px = X(i) - ax, py = Y(i) - ay;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / L2));
        const ex = px - t * dx, ey = py - t * dy;
        const d = ex * ex + ey * ey;
        if (d > bd) { bd = d; bi = i; }
      }
      if (bi >= 0) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(X(i), Y(i));
    return out.length >= 6 ? Float64Array.from(out) : loop;
  }

  /**
   * SVG yol verisi. smooth 0..1: Catmull-Rom → kübik Bezier; dönüşü
   * `cornerDeg`'den keskin köşeler sivri kalır. scale: koordinat çarpanı.
   */
  function pathData(loops, o) {
    const sm = o.smooth || 0, sc = o.scale || 1;
    const cornerCos = Math.cos(((o.cornerDeg != null ? o.cornerDeg : 60) * Math.PI) / 180);
    const f = (v) => (Math.round(v * sc * 100) / 100).toString();
    const parts = [];
    let nodes = 0;
    loops.forEach((lp) => {
      const n = lp.length / 2;
      if (n < 3) return;
      const P = (i) => [lp[((i + n) % n) * 2], lp[((i + n) % n) * 2 + 1]];
      parts.push(`M${f(lp[0])} ${f(lp[1])}`);
      nodes += n;
      if (sm <= 0) {
        for (let i = 1; i < n; i++) parts.push(`L${f(lp[i * 2])} ${f(lp[i * 2 + 1])}`);
        parts.push('Z');
        return;
      }
      const sharp = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const a = P(i - 1), b = P(i), c = P(i + 1);
        const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
        const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
        sharp[i] = (ux * vx + uy * vy) / (lu * lv) < cornerCos ? 1 : 0;
      }
      const k = sm / 6;
      for (let i = 0; i < n; i++) {
        const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
        const c1 = sharp[i] ? p1 : [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
        const c2 = sharp[(i + 1) % n] ? p2 : [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
        parts.push(`C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`);
      }
      parts.push('Z');
    });
    return { d: parts.join(''), nodes, paths: loops.length };
  }

  /** Tek renkli SVG: gölge siyah; sizeCm verilirse gerçek duvar ölçüsü (cm). */
  function toSVG(d, S, o) {
    const size = o.sizeCm ? ` width="${o.sizeCm}cm" height="${o.sizeCm}cm"` : '';
    const bg = o.background ? `<rect width="${S}" height="${S}" fill="#ffffff"/>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"${size}>`
      + (o.title ? `<title>${String(o.title).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</title>` : '')
      + bg + `<path fill="${o.color || '#000000'}" fill-rule="evenodd" d="${d}"/></svg>`;
  }

  global.Stencil = {
    luminance, blurF, adjust, otsu, threshold, kmeans, edges,
    components, despeckle, fillHoles, distanceTo, offset, thinParts,
    buildPrintMap, analyzePrint,
    trace, simplify, pathData, toSVG,
  };
})(typeof window !== 'undefined' ? window : globalThis);
