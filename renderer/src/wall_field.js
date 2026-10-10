/**
 * Wall field: the unrolled lamp wall sampled on an (s, z) grid.
 *
 * Each grid vertex holds a value in [0, 1]: > 0.5 means "light passes" (cut
 * away), ≤ 0.5 means solid material. The value comes from back-projecting the
 * vertex onto the projection wall and sampling the target image there, so the
 * marching-squares mesher can place smooth (sub-cell) contour edges.
 *
 * After sampling, structural fixes are applied so the part is printable:
 *   - solid bands at the wall side (base plate) and in front of the light,
 *   - optional support ribs, placed where the silhouette already casts shadow,
 *   - solid corner posts (flat-panel mode),
 *   - tiny light holes filled, floating solid islands removed.
 *
 * Units: centimetres.
 */
(function (global) {
  'use strict';

  /**
   * opts: {
   *   shape, d, cz, margin,            // geometry (cm)
   *   sample(X, Y) → 0..1 (lit),       // target sampler on the projection wall
   *   grid,                            // cell size (cm); auto when falsy
   *   maxCells,                        // auto-grid budget
   *   bottomBand,                      // solid band at z = 0 (cm)
   *   ribs, ribWidth,                  // support ribs (count, cm)
   *   cornerPosts,                     // force solid strips at polygon vertices
   *   minHole,                         // fill light holes smaller than this (cm²)
   * }
   */
  function compute(opts) {
    const { shape, d, cz, sample } = opts;
    const margin = opts.margin || 0;
    const P = shape.perimeter;
    const zb = opts.bottomBand != null ? opts.bottomBand : 0.2;
    const zTop = cz - margin;
    const rMean = P / (2 * Math.PI);

    // Rows: a wall point at depth z lands on the projection wall magnified by
    // t = cz/(cz − z) horizontally and r·t²/cz vertically. Spacing rows by
    // Δz ∝ 1/t (uniform in log t) keeps the projected resolution roughly
    // isotropic — fine near the light where the far parts of the image (heads,
    // hands) land, coarser near the base. Clamped to printable limits.
    function rowsFor(g) {
      const zs = [0];
      if (zb > 0) zs.push(Math.min(zb, zTop));
      let z = zs[zs.length - 1];
      while (z < zTop) {
        const t = cz / (cz - z);
        const dz = Math.max(0.02, Math.min(g, (g * cz) / (rMean * t)));
        z = Math.min(zTop, z + dz);
        zs.push(z);
      }
      // Solid band in front of the light up to the rim: a few rows suffice.
      const nTop = Math.max(1, Math.ceil((d - zTop) / 0.2));
      for (let k = 1; k <= nTop; k++) zs.push(zTop + ((d - zTop) * k) / nTop);
      return zs;
    }
    function colsFor(g) {
      return shape.vertexS().reduce((n, s0, i, vs) => {
        const s1 = i + 1 < vs.length ? vs[i + 1] : P;
        return n + Math.max(1, Math.ceil((s1 - s0) / g - 1e-9));
      }, 0);
    }

    let g = opts.grid;
    if (!g) {
      const budget = opts.maxCells || 180000;
      g = 0.04;
      while (colsFor(g) * rowsFor(g).length > budget && g < 1) g *= 1.06;
    }

    // Columns: every outline vertex is a column (keeps corners crisp), each
    // edge subdivided uniformly to ≤ g.
    const vs = shape.vertexS();
    const colS = [];
    const colEdge = [];
    const vertexCol = [];
    for (let i = 0; i < vs.length; i++) {
      const s0 = vs[i];
      const s1 = i + 1 < vs.length ? vs[i + 1] : P;
      const m = Math.max(1, Math.ceil((s1 - s0) / g - 1e-9));
      vertexCol.push(colS.length);
      for (let j = 0; j < m; j++) {
        colS.push(s0 + ((s1 - s0) * j) / m);
        colEdge.push(i);
      }
    }
    const nc = colS.length;
    const rowZ = Float64Array.from(rowsFor(g));
    const nr = rowZ.length;

    const F = new Float32Array(nr * nc);
    const colPt = colS.map((s) => shape.pointAt(s));

    // openTop (şeffaf tüp montajı): ışığın önünde duvar yok, üst kenar siluetle biter.
    const openTop = !!opts.openTop;
    for (let r = 0; r < nr; r++) {
      const z = rowZ[r];
      if (z > zTop && openTop) { for (let c = 0; c < nc; c++) F[r * nc + c] = 1; continue; }
      if (z < zb || z > zTop) continue; // solid (F = 0)
      const m = shape.scaleAt(z) * cz / (cz - z);
      for (let c = 0; c < nc; c++) {
        const p = colPt[c];
        F[r * nc + c] = sample(p.x * m, p.y * m);
      }
    }

    // Area represented by each vertex (rows are non-uniform).
    const rowH = new Float64Array(nr);
    for (let r = 0; r < nr; r++) rowH[r] = ((rowZ[Math.min(nr - 1, r + 1)] - rowZ[Math.max(0, r - 1)]) / 2) || g;
    const areaOf = (cells) => cells.reduce((a, i) => a + rowH[(i / nc) | 0] * (P / nc), 0);

    const stats = { holesFilled: 0, islandsRemoved: 0, bridges: 0, rimFloating: false, ribS: [], grid: g, nr, nc };
    const idx = (r, c) => r * nc + c;

    // ---- fill tiny light holes ----
    if (opts.minHole > 0) {
      const comps = components(F, nr, nc, (v) => v > 0.5);
      comps.forEach((cells) => {
        if (areaOf(cells) < opts.minHole) {
          cells.forEach((i) => { F[i] = 0; });
          stats.holesFilled++;
        }
      });
    }

    // ---- corner posts (flat panels need solid edges to glue) ----
    const postW = opts.ribWidth || 0.25;
    function solidColumnBand(sCenter, width) {
      for (let c = 0; c < nc; c++) {
        let ds = Math.abs(colS[c] - sCenter);
        ds = Math.min(ds, P - ds);
        if (ds <= width / 2) for (let r = 0; r < nr; r++) F[idx(r, c)] = 0;
      }
    }
    if (opts.cornerPosts) {
      vs.forEach((s) => solidColumnBand(s, postW));
    }

    // ---- support ribs ----
    // The front rim (solid band in front of the light) must connect to the
    // base. A rib only needs to run from the rim down to the nearest solid
    // that's already anchored to the base (usually the silhouette), so its
    // visible shadow is just the stretch between silhouette edge and rim.
    // Columns are picked globally by that cost, kept apart for stability.
    const nRibs = openTop ? 0 : Math.max(0, Math.round(opts.ribs || 0));
    if (nRibs > 0) {
      let rTop = nr - 1;
      while (rTop > 0 && rowZ[rTop - 1] > zTop) rTop--;      // first row of the front band
      const anchored = new Uint8Array(nr * nc);
      const stack = [];
      for (let c = 0; c < nc; c++) if (F[c] <= 0.5) { anchored[c] = 1; stack.push(c); }
      while (stack.length) {
        const i = stack.pop();
        const r = (i / nc) | 0, c = i - r * nc;
        const nb = [r > 0 ? i - nc : -1, r < nr - 1 ? i + nc : -1, r * nc + ((c + 1) % nc), r * nc + ((c - 1 + nc) % nc)];
        for (const j of nb) {
          if (j < 0 || anchored[j] || F[j] > 0.5) continue;
          anchored[j] = 1;
          stack.push(j);
        }
      }
      // Per column: highest anchored row below the rim, and lit cells above it.
      const stopRow = new Int32Array(nc);
      const litAbove = new Float64Array(nc);
      for (let c = 0; c < nc; c++) {
        let r = rTop - 1, lit = 0;
        while (r > 0 && !anchored[idx(r, c)]) { if (F[idx(r, c)] > 0.5) lit++; r--; }
        stopRow[c] = r;
        litAbove[c] = lit;
      }
      const half = Math.max(0, Math.round(postW / 2 / (P / nc)));
      const cost = new Float64Array(nc);
      for (let c = 0; c < nc; c++) {
        let sum = 0;
        for (let k = -half; k <= half; k++) sum += litAbove[(c + k + nc) % nc];
        cost[c] = sum;
      }
      const order = Array.from({ length: nc }, (_, c) => c).sort((a, b) => cost[a] - cost[b]);
      const minSep = P / (2 * nRibs);
      const picked = [];
      for (const c of order) {
        if (picked.length >= nRibs) break;
        const ok = picked.every((q) => { const ds = Math.abs(colS[q] - colS[c]); return Math.min(ds, P - ds) >= minSep; });
        if (ok) picked.push(c);
      }
      picked.forEach((c0) => {
        stats.ribS.push(colS[c0]);
        for (let k = -half; k <= half; k++) {
          const c = (c0 + k + nc) % nc;
          for (let r = Math.max(0, stopRow[c]); r < nr; r++) F[idx(r, c)] = 0;
        }
      });
    }

    // ---- floating solid islands ----
    // A dark shape that doesn't touch the rest of the silhouette (a head above
    // a thin neck, a separate bird…) becomes a loose piece of wall. Instead of
    // dropping it, connect it with a thin bridge along the shortest path to
    // solid that's anchored to the base or rim. Only specks are removed.
    if (!opts.keepIslands) {
      const comps = components(F, nr, nc, (v) => v <= 0.5);
      const anchored = new Uint8Array(nr * nc);
      const islands = [];
      comps.forEach((cells) => {
        let bottom = false, top = false;
        for (let i = 0; i < cells.length; i++) {
          const r = (cells[i] / nc) | 0;
          if (r === 0) bottom = true;
          if (r === nr - 1) top = true;
        }
        if (bottom || (top && !openTop)) cells.forEach((i) => { anchored[i] = 1; });
        else islands.push(cells);
        if (top && !bottom && !openTop) stats.rimFloating = true; // front rim + cap would fall off
      });
      // Yalnızca gerçek kırıntılar (≈0,5 mm²) silinir; diğer her kopuk parça köprülenir.
      const minIsland = opts.minIsland != null ? opts.minIsland : 0.005;
      const bridgeHalf = postW / 2;
      const bridgeC = Math.max(1, Math.round(bridgeHalf / (P / nc)));
      // Tek çok-kaynaklı 0-1 tarama: bağlı (tabana/çembere değen) dolu bölgeden
      // dışarı doğru. Dolu hücreye girmek bedava, ışıklı hücreye girmek 1 → köprüler
      // silüetin kendi içinden ilerler, aydınlık alanı en kısa yerden keser
      // (gölgede en az görünen yol).
      const N2 = nr * nc;
      const parent = new Int32Array(N2).fill(-2);
      const dist = new Int32Array(N2).fill(0x3fffffff);
      const dq = new Int32Array(N2 * 2 + 2);
      let head = N2, tail = N2;   // çift uçlu kuyruk (ortadan başlar)
      for (let i = 0; i < N2; i++) if (anchored[i]) { parent[i] = -1; dist[i] = 0; dq[tail++] = i; }
      while (head < tail) {
        const i = dq[head++];
        const r = (i / nc) | 0, c = i - r * nc;
        const nb = [r > 0 ? i - nc : -1, r < nr - 1 ? i + nc : -1, r * nc + ((c + 1) % nc), r * nc + ((c - 1 + nc) % nc)];
        for (const j of nb) {
          if (j < 0) continue;
          const w = F[j] <= 0.5 ? 0 : 1;
          if (dist[i] + w >= dist[j]) continue;
          dist[j] = dist[i] + w;
          parent[j] = i;
          if (w === 0) dq[--head] = j; else dq[tail++] = j;
        }
      }
      const paintBridgeCell = (i) => {
        const r0 = (i / nc) | 0, c0 = i - r0 * nc;
        let rA = r0, rB = r0;
        while (rA > 0 && rowZ[r0] - rowZ[rA - 1] <= bridgeHalf) rA--;
        while (rB < nr - 1 && rowZ[rB + 1] - rowZ[r0] <= bridgeHalf) rB++;
        for (let r = rA; r <= rB; r++) {
          const dzn = (rowZ[r] - rowZ[r0]) / bridgeHalf;
          for (let dc = -bridgeC; dc <= bridgeC; dc++) {
            const dcn = dc / bridgeC;
            if (dzn * dzn + dcn * dcn > 1.3) continue;
            F[r * nc + ((c0 + dc + nc) % nc)] = 0;
          }
        }
      };
      stats.bridges = 0;
      islands.forEach((cells) => {
        if (areaOf(cells) < minIsland) {
          cells.forEach((i) => { F[i] = 1; });
          stats.islandsRemoved++;
          return;
        }
        // Adanın bağlı bölgeye en yakın hücresinden yolu izle.
        let bestCell = -1, bestD = Infinity;
        for (const i of cells) if (dist[i] < bestD) { bestD = dist[i]; bestCell = i; }
        if (bestCell < 0 || bestD >= 0x3fffffff) { cells.forEach((i) => { F[i] = 1; }); stats.islandsRemoved++; return; }
        // Yalnızca ışıklı hücrelere köprü boyanır (dolu hücreler zaten gölge).
        for (let i = parent[bestCell]; i >= 0 && parent[i] !== -1; i = parent[i]) paintBridgeCell(i);
        stats.bridges++;
      });
    }

    // ---- desteksiz baskı: gerçek yazıcı kurallarına göre sarkma düzeltmesi ----
    // Gövde tabanı tablada dik basılır (z = yukarı). İnce duvarda yazıcı:
    //  - dikeyden `overhangAngle` dereceye kadar eğimi desteksiz basar,
    //  - iki ucu tutunan `maxBridge` mm'ye kadar yatay aralığı köprü olarak basar.
    // Sorunlu olanlar: tek ucu bağlı uzun çıkıntılar ve hiçbir yere tutunmayan
    // aralıklar. Bunların altına açı sınırında çatı eklenir (tek ucu bağlıysa
    // tek eğim). Kontrol, satır aralığı Δz = Δs / tan(açı) olan ızgarada yapılır:
    // böylece "bir satır aşağıda ±1 sütun" tam açı sınırına karşılık gelir.
    // Kapak montajında ön çember köprü olarak basılır, o satırlar hariç tutulur.
    if (opts.supportFree) {
      const colW = P / nc;
      const angle = Math.min(70, Math.max(30, opts.overhangAngle || 60));
      const dzR = colW / Math.tan((angle * Math.PI) / 180);
      const bridgeCells = Math.round(((opts.maxBridge != null ? opts.maxBridge : 12) / 10) / colW);
      // İnce duvarda kısa sarkan uçlar (tek ucu bağlı veya serbest) desteksiz basılır.
      const cantCells = Math.round(((opts.maxCantilever != null ? opts.maxCantilever : 2.5) / 10) / colW);
      const H = Math.max(2, Math.floor(zTop / dzR) + 1);
      const solidAt = (c, z) => {
        let lo = 0, hi = nr - 2;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rowZ[mid] <= z) lo = mid; else hi = mid - 1; }
        const f = Math.min(1, Math.max(0, (z - rowZ[lo]) / ((rowZ[lo + 1] - rowZ[lo]) || 1)));
        return F[lo * nc + c] * (1 - f) + F[(lo + 1) * nc + c] * f <= 0.5;
      };
      const solid = new Uint8Array(H * nc);
      const added = new Uint8Array(H * nc);
      for (let h = 0; h < H; h++) for (let c = 0; c < nc; c++) solid[h * nc + c] = solidAt(c, h * dzR) ? 1 : 0;
      let bridges = 0;
      for (let h = H - 1; h >= 1; h--) {
        const row = h * nc, below = (h - 1) * nc;
        const unsup = new Uint8Array(nc);
        let any = false;
        for (let c = 0; c < nc; c++) {
          if (!solid[row + c]) continue;
          const l = (c - 1 + nc) % nc, rr = (c + 1) % nc;
          if (!solid[below + l] && !solid[below + c] && !solid[below + rr]) { unsup[c] = 1; any = true; }
        }
        if (!any) continue;
        let start = unsup.indexOf(0);
        if (start < 0) start = 0;
        for (let k = 0; k < nc; k++) {
          const c = (start + k) % nc;
          if (!unsup[c] || (unsup[(c - 1 + nc) % nc] && k > 0)) continue;
          let len = 0;
          while (len < nc && unsup[(c + len) % nc]) len++;
          const leftAnch = len < nc && solid[row + ((c - 1 + nc) % nc)];
          const rightAnch = len < nc && solid[row + ((c + len) % nc)];
          if (leftAnch && rightAnch && len <= bridgeCells) { bridges++; continue; }   // kısa köprü: basılabilir
          if (len <= cantCells) continue;                                             // kısa sarkma: basılabilir
          // Çatı: desteklenen komşuya yaslanan taraf daraltılmaz.
          for (let j = leftAnch ? 0 : 1; j < (rightAnch ? len : len - 1); j++) {
            const cc = (c + j) % nc;
            if (!solid[below + cc]) { solid[below + cc] = 1; added[below + cc] = 1; }
          }
        }
      }
      for (let r = 0; r < nr; r++) {
        if (rowZ[r] > zTop) break;
        const h = Math.min(H - 1, Math.round(rowZ[r] / dzR));
        for (let c = 0; c < nc; c++) {
          if (added[h * nc + c] && F[r * nc + c] > 0.5) F[r * nc + c] = 0;
        }
      }
      let roof = 0;
      for (let i = 0; i < added.length; i++) roof += added[i];
      stats.roofArea = roof * colW * dzR;   // cm²
      stats.printBridges = bridges;
    }

    return {
      F, nr, nc, colS: Float64Array.from(colS), colEdge: Int32Array.from(colEdge),
      vertexCol, rowZ, periodic: true, shape, d, cz, margin, stats,
    };
  }

  // ---------- smooth target sampler (signed distance) ----------
  //
  // Far from the light one wall cell lands on many target pixels (t = ρ/r),
  // so sampling the sharp target directly gives grid vertices that are just
  // 0 or 1 and marching squares draws stair steps (and the support-free pass
  // turns those steps into saw teeth). A signed distance field of the target
  // varies linearly across an edge at any scale, so interpolating it between
  // vertices finds the true edge position. Sign is exact: > 0.5 ⇔ lit pixel.

  /** 1-D squared Euclidean distance transform (Felzenszwalb & Huttenlocher). */
  function edt1d(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      while (true) {
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
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  }

  /** Distance (px) from every pixel to the nearest pixel where mask is 1. */
  function distanceTo(mask, N) {
    const INF = 1e20;
    const out = new Float32Array(N * N);
    const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
    for (let x = 0; x < N; x++) {
      for (let y = 0; y < N; y++) f[y] = mask[y * N + x] ? 0 : INF;
      edt1d(f, N, d, v, z);
      for (let y = 0; y < N; y++) out[y * N + x] = d[y];
    }
    for (let y = 0; y < N; y++) {
      const o = y * N;
      for (let x = 0; x < N; x++) f[x] = out[o + x];
      edt1d(f, N, d, v, z);
      for (let x = 0; x < N; x++) out[o + x] = Math.sqrt(d[x]);
    }
    return out;
  }

  /** Signed distance (px, + = lit) of an RGBA target (red channel, > 127 = lit). */
  function signedDistance(data, N) {
    const lit = new Uint8Array(N * N);
    let any = false, all = true;
    for (let i = 0; i < N * N; i++) { lit[i] = data[i * 4] > 127 ? 1 : 0; if (lit[i]) any = true; else all = false; }
    const sd = new Float32Array(N * N);
    if (!any || all) { sd.fill(all ? 1e4 : -1e4); return sd; }
    const toLit = distanceTo(lit, N);
    for (let i = 0; i < N * N; i++) lit[i] ^= 1;
    const toDark = distanceTo(lit, N);
    // Edge halfway between the last lit and the first dark pixel.
    for (let i = 0; i < N * N; i++) sd[i] = toDark[i] > 0 ? toDark[i] - 0.5 : 0.5 - toLit[i];
    return sd;
  }

  /**
   * sample(X, Y) over [-R, R]² cm for an N² RGBA target; outside the image
   * returns `outside` (0 or 1). `sd` may be passed to reuse a cached field.
   */
  function smoothSampler(data, N, R, outside, sd) {
    const S = sd || signedDistance(data, N);
    const W = 48;                                          // px for the 0..1 ramp
    return function sample(X, Y) {
      const u = ((X / R) * 0.5 + 0.5) * N - 0.5;
      const v = (0.5 - (Y / R) * 0.5) * N - 0.5;
      if (u < 0 || v < 0 || u > N - 1 || v > N - 1) return outside;
      const x0 = Math.floor(u), y0 = Math.floor(v);
      const x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
      const fx = u - x0, fy = v - y0;
      const a = S[y0 * N + x0], b = S[y0 * N + x1], c = S[y1 * N + x0], d = S[y1 * N + x1];
      const s = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      return Math.max(0, Math.min(1, 0.5 + s / (2 * W)));
    };
  }

  /** 4-connected components (periodic along s) of vertices matching pred. */
  function components(F, nr, nc, pred) {
    const seen = new Uint8Array(nr * nc);
    const out = [];
    const stack = new Int32Array(nr * nc);
    for (let start = 0; start < nr * nc; start++) {
      if (seen[start] || !pred(F[start])) continue;
      const cells = [];
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      while (sp) {
        const i = stack[--sp];
        cells.push(i);
        const r = (i / nc) | 0, c = i - r * nc;
        const nb = [
          r > 0 ? i - nc : -1,
          r < nr - 1 ? i + nc : -1,
          r * nc + ((c + 1) % nc),
          r * nc + ((c - 1 + nc) % nc),
        ];
        for (let k = 0; k < 4; k++) {
          const j = nb[k];
          if (j < 0 || seen[j] || !pred(F[j])) continue;
          seen[j] = 1;
          stack[sp++] = j;
        }
      }
      out.push(cells);
    }
    return out;
  }

  /** Bilinear sample of the field at (s, z) → 0..1 (0 outside the usable band). */
  function sampleField(field, s, z) {
    const { F, nr, nc, colS, rowZ, shape } = field;
    if (z < 0 || z > rowZ[nr - 1]) return 0;
    const P = shape.perimeter;
    let ss = s % P;
    if (ss < 0) ss += P;
    let lo = 0, hi = nc - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (colS[mid] <= ss) lo = mid; else hi = mid - 1;
    }
    const c0 = lo, c1 = (lo + 1) % nc;
    const s1 = c1 === 0 ? P : colS[c1];
    const fs = (ss - colS[c0]) / ((s1 - colS[c0]) || 1);
    let rlo = 0, rhi = nr - 2;
    while (rlo < rhi) {
      const mid = (rlo + rhi + 1) >> 1;
      if (rowZ[mid] <= z) rlo = mid; else rhi = mid - 1;
    }
    const r0 = rlo;
    const fz = Math.min(1, Math.max(0, (z - rowZ[r0]) / ((rowZ[r0 + 1] - rowZ[r0]) || 1)));
    const a = F[r0 * nc + c0], b = F[r0 * nc + c1];
    const c = F[(r0 + 1) * nc + c0], e = F[(r0 + 1) * nc + c1];
    return (a * (1 - fs) + b * fs) * (1 - fz) + (c * (1 - fs) + e * fs) * fz;
  }

  global.WallField = { compute, sampleField, signedDistance, smoothSampler };
})(typeof window !== 'undefined' ? window : globalThis);
