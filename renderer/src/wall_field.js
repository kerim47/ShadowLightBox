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
   *   panels,                          // flat panels: bridge islands per facet (no wrap across corners)
   *   minHole,                         // fill light holes smaller than this (cm²)
   *   minWall, minGap,                 // printable widths (mm): thicken thinner wall strips, widen narrower light gaps
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
      // 0,2 mm'den başlar: büyük gövdede bütçe hücreyi büyütür, "Çok yüksek" gerçekten incelir.
      g = 0.02;
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

    // ---- basılabilir kalınlık: ince duvar şeritleri ve dar ışık aralıkları ----
    // Yazıcı (0,4 mm nozul) 0,8 mm'den ince duvarı basamaz/kırar, çok dar ışık
    // aralığını da kapatır. Her noktada yatay (h) ve dikey (v) koşu uzunluğu,
    // 0,5 geçişleri alt hücre hassasiyetinde hesaplanarak mm cinsinden ölçülür;
    // düz bir şeridin gerçek genişliği t = 1/√(1/h² + 1/v²)'dir (açısından
    // bağımsız). Eşiğin altındaki noktaların çevresi elips fırçayla boyanır.
    // Önce aralıklar genişletilir, sonra duvarlar kalınlaştırılır (sağlamlık öncelikli).
    // Bantlar (taban, ışığın önü) hariç tutulur.
    const minWallMM = opts.minWall != null ? opts.minWall : 0;
    const minGapMM = opts.minGap != null ? opts.minGap : 0;
    stats.thickened = 0;
    stats.widened = 0;
    if (minWallMM > 0 || minGapMM > 0) {
      const sMM = (c) => colS[c] * 10;
      const editable = (r) => rowZ[r] >= zb && rowZ[r] <= zTop;
      // c sütunundan c±1'e doğru geçiş noktası (komşu sütun tarafında, cm·10 = mm).
      const crossH = (r, c, dir) => {
        const c2 = c + dir;
        if (c2 < 0 || c2 >= nc) return 0;
        const a = F[r * nc + c], b = F[r * nc + c2];
        const u = (0.5 - a) / ((b - a) || 1e-9);
        return Math.max(0, Math.min(1, u)) * Math.abs(sMM(c2) - sMM(c));
      };
      // isSet(v) → nokta kümeye ait mi (dolu ya da ışık). Her nokta için kalınlık (mm)
      // ve şeridin orta çizgisi: kısa eksendeki koşunun ortası (s veya z, cm).
      function thickness(isSet) {
        const N = nr * nc;
        const th = new Float32Array(N).fill(Infinity);
        const hRun = new Float32Array(N).fill(Infinity), hMid = new Float32Array(N);
        const vRun = new Float32Array(N).fill(Infinity), vMid = new Float32Array(N);
        for (let r = 0; r < nr; r++) {
          if (!editable(r)) continue;
          const k = shape.scaleAt(rowZ[r]);
          let c = 0;
          while (c < nc) {
            if (!isSet(F[r * nc + c])) { c++; continue; }
            let e = c;
            while (e + 1 < nc && isSet(F[r * nc + e + 1])) e++;
            const open = c === 0 || e === nc - 1;           // satır sınırına (dikiş) değen: uzun say
            const lo = sMM(c) - crossH(r, c, -1), hi = sMM(e) + crossH(r, e, 1);
            const len = open ? Infinity : (hi - lo) * k;
            for (let i = c; i <= e; i++) { hRun[r * nc + i] = len; hMid[r * nc + i] = (lo + hi) / 20; }
            c = e + 1;
          }
        }
        for (let c = 0; c < nc; c++) {
          let r = 0;
          while (r < nr) {
            if (!editable(r) || !isSet(F[r * nc + c])) { r++; continue; }
            let e = r;
            while (e + 1 < nr && editable(e + 1) && isSet(F[(e + 1) * nc + c])) e++;
            const touchBand = (r === 0 || !editable(r - 1)) || (e === nr - 1 || !editable(e + 1));
            let len = Infinity, mid = (rowZ[r] + rowZ[e]) / 2;
            if (!touchBand) {
              const cross = (rr, dir) => {
                const a = F[rr * nc + c], b = F[(rr + dir) * nc + c];
                const u = Math.max(0, Math.min(1, (0.5 - a) / ((b - a) || 1e-9)));
                return u * Math.abs(rowZ[rr + dir] - rowZ[rr]);
              };
              const lo = rowZ[r] - cross(r, -1), hi = rowZ[e] + cross(e, 1);
              len = (hi - lo) * 10;
              mid = (lo + hi) / 2;
            }
            for (let i = r; i <= e; i++) {
              vRun[i * nc + c] = len; vMid[i * nc + c] = mid;
              const h = hRun[i * nc + c];
              th[i * nc + c] = 1 / Math.sqrt(1 / (h * h) + 1 / (len * len));
            }
            r = e + 1;
          }
        }
        return { th, hRun, hMid, vRun, vMid };
      }
      // Merkezi (zc, sc) cm, yarıçapı radMM olan daireyi alana "çizer": noktalara sert
      // 0/1 yerine kenara işaretli uzaklıkla orantılı değer yazılır (rampa). Marching
      // squares 0,5 geçişini ara değerle bulduğu için sınır tam daire kenarına düşer;
      // ızgara daireden kaba olsa bile genişlik doğru çıkar. value 0 → dolu (min),
      // 1 → ışık (max): mevcut değer yalnızca o yöne değişir.
      function paintDisk(zc, sc, radMM, value) {
        const k = shape.scaleAt(zc);
        let r0 = 0;
        while (r0 + 1 < nr && rowZ[r0 + 1] <= zc) r0++;
        // Rampa eğimi: en kaba yerel aralık (satır/sütun), değerler bir hücre içinde kırpılmasın.
        const colSp = (P / nc) * 10 * k;
        const rowSp = Math.abs(rowZ[Math.min(nr - 1, r0 + 1)] - rowZ[r0]) * 10 || colSp;
        const S = Math.max(colSp, rowSp, 1e-3);
        const reach = radMM + S;
        const put = (i, sd) => {
          const ramp = Math.max(0, Math.min(1, 0.5 - sd / S));   // dolu ölçeğinde: 0 içeride
          if (value === 0) { if (ramp < F[i]) F[i] = ramp; } else { const v = 1 - ramp; if (v > F[i]) F[i] = v; }
        };
        const rowOk = (r) => editable(r) && Math.abs(rowZ[r] - zc) * 10 <= reach;
        for (let r = r0; r >= 0 && rowOk(r); r--) paintRow(r);
        for (let r = r0 + 1; r < nr && rowOk(r); r++) paintRow(r);
        function paintRow(r) {
          const dz = (rowZ[r] - zc) * 10;
          const half = Math.sqrt(Math.max(0, reach * reach - dz * dz)) / (10 * k);   // cm cinsinden s yarı genişliği
          let lo = 0, hi = nc - 1;
          const s0 = sc - half;
          while (lo < hi) { const m = (lo + hi) >> 1; if (colS[m] < s0) lo = m + 1; else hi = m; }
          for (let c = lo; c < nc && colS[c] <= sc + half; c++) {
            const ds = (colS[c] - sc) * 10 * k;
            put(r * nc + c, radMM - Math.sqrt(ds * ds + dz * dz));
          }
        }
      }
      // Eşiğin altındaki her koşu için orta çizgiye eşik çapında daire: genişlik ≥ eşik.
      function enforce(isSet, minMM, value) {
        const { th, hRun, hMid, vRun, vMid } = thickness(isSet);
        const done = new Set();
        let n = 0;
        for (let i = 0; i < nr * nc; i++) {
          if (!(th[i] < minMM)) continue;
          const r = (i / nc) | 0, c = i % nc;
          // Kısa eksen şeridin enine yöndür: orta nokta o eksende alınır.
          const zc = vRun[i] <= hRun[i] ? vMid[i] : rowZ[r];
          const sc = vRun[i] <= hRun[i] ? colS[c] : hMid[i];
          const key = vRun[i] <= hRun[i] ? 'v' + c + ':' + vMid[i].toFixed(4) : 'h' + r + ':' + hMid[i].toFixed(4);
          if (done.has(key)) continue;
          done.add(key);
          paintDisk(zc, sc, minMM / 2, value);
          n++;
        }
        return n;
      }
      if (minGapMM > 0) stats.widened = enforce((v) => v > 0.5, minGapMM, 1);
      if (minWallMM > 0) stats.thickened = enforce((v) => v <= 0.5, minWallMM, 0);
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
    // Düz panel: duvar köşelerden kesilir, her panel ayrı basılır. Bağlantı
    // köşeden komşu panele geçerek kurulamaz → adalar panel panel köprülenir.
    // Köşe sütunu iki panelde de vardır (ortak kenar): köprü oraya boyanmaz,
    // kırıntı silinirken de o sütuna dokunulmaz; böylece paneller birbirini bozmaz.
    if (!opts.keepIslands && opts.panels && vertexCol.length > 1) {
      const minIsland = opts.minIsland != null ? opts.minIsland : 0.005;
      const bridgeHalf = postW / 2;
      const bridgeC = Math.max(1, Math.round(bridgeHalf / (P / nc)));
      stats.bridges = 0;
      for (let e = 0; e < vertexCol.length; e++) {
        const ca = vertexCol[e];
        const cb = e + 1 < vertexCol.length ? vertexCol[e + 1] : nc;
        const nl = cb - ca + 1;                       // yerel sütun sayısı (iki kenar dahil)
        const gcol = (lc) => (ca + lc) % nc;
        const L = nr * nl;
        const at = (li) => F[((li / nl) | 0) * nc + gcol(li % nl)];
        const solid = (li) => at(li) <= 0.5;
        const nbs = (li) => {
          const r = (li / nl) | 0, c = li - r * nl;
          return [r > 0 ? li - nl : -1, r < nr - 1 ? li + nl : -1, c < nl - 1 ? li + 1 : -1, c > 0 ? li - 1 : -1];
        };
        // Yerel bileşenler.
        const comp = new Int32Array(L).fill(-1);
        const groups = [];
        const stack = [];
        for (let s0 = 0; s0 < L; s0++) {
          if (comp[s0] >= 0 || !solid(s0)) continue;
          const cells = [s0];
          comp[s0] = groups.length;
          stack.push(s0);
          while (stack.length) {
            const i = stack.pop();
            for (const j of nbs(i)) {
              if (j < 0 || comp[j] >= 0 || !solid(j)) continue;
              comp[j] = groups.length;
              cells.push(j);
              stack.push(j);
            }
          }
          groups.push(cells);
        }
        const anchoredL = new Uint8Array(L);
        const islands = [];
        groups.forEach((cells) => {
          let bottom = false, top = false;
          for (const i of cells) {
            const r = (i / nl) | 0;
            if (r === 0) bottom = true;
            if (r === nr - 1) top = true;
          }
          if (bottom || (top && !openTop)) cells.forEach((i) => { anchoredL[i] = 1; });
          if (top && !bottom && !openTop) stats.rimFloating = true; // bu paneldeki ön çember tabana bağlı değil
          else islands.push(cells);
        });
        if (!islands.length) continue;
        const clear = (cells) => cells.forEach((i) => {
          const c = i % nl;
          if (c > 0 && c < nl - 1) F[((i / nl) | 0) * nc + gcol(c)] = 1;
        });
        const areaL = (cells) => cells.reduce((a, i) => a + rowH[(i / nl) | 0] * (P / nc), 0);
        const onEdge = (cells) => cells.some((i) => { const c = i % nl; return c === 0 || c === nl - 1; });
        // Kırıntılar taramadan ÖNCE silinir: aksi halde başka bir adanın köprüsü
        // (özellikle tek hücrelik ince bağ) sonradan silinen kırıntının üzerinden geçer ve kopar.
        const keep = islands.filter((cells) => {
          if (areaL(cells) < minIsland && !onEdge(cells)) { clear(cells); stats.islandsRemoved++; return false; }
          return true;
        });
        // 0-1 tarama (yalnızca bu panelin içinde); kenar sütunlarına yalnızca dolu
        // hücreden girilir (oraya köprü boyanamaz).
        const parent = new Int32Array(L).fill(-2);
        const dist = new Int32Array(L).fill(0x3fffffff);
        const dq = new Int32Array(L * 2 + 2);
        let head = L, tail = L;
        for (let i = 0; i < L; i++) if (anchoredL[i]) { parent[i] = -1; dist[i] = 0; dq[tail++] = i; }
        while (head < tail) {
          const i = dq[head++];
          for (const j of nbs(i)) {
            if (j < 0) continue;
            const c = j % nl, sol = solid(j);
            if (!sol && (c === 0 || c === nl - 1)) continue;
            const w = sol ? 0 : 1;
            if (dist[i] + w >= dist[j]) continue;
            dist[j] = dist[i] + w;
            parent[j] = i;
            if (w === 0) dq[--head] = j; else dq[tail++] = j;
          }
        }
        const paint = (li) => {
          const r0 = (li / nl) | 0, c0 = li - r0 * nl;
          let rA = r0, rB = r0;
          while (rA > 0 && rowZ[r0] - rowZ[rA - 1] <= bridgeHalf) rA--;
          while (rB < nr - 1 && rowZ[rB + 1] - rowZ[r0] <= bridgeHalf) rB++;
          for (let r = rA; r <= rB; r++) {
            const dzn = (rowZ[r] - rowZ[r0]) / bridgeHalf;
            for (let dc = -bridgeC; dc <= bridgeC; dc++) {
              const c = c0 + dc;
              if (c < 1 || c > nl - 2) continue;
              const dcn = dc / bridgeC;
              if (dzn * dzn + dcn * dcn > 1.3) continue;
              F[r * nc + gcol(c)] = 0;
            }
          }
        };
        keep.forEach((cells) => {
          const area = areaL(cells);
          // Köşe sütununa değen kırıntı komşu panelde gerçek desenin parçası
          // olabilir (silinemez): bu panelde tek nokta genişliğinde bağla tutturulur.
          let best = -1, bestD = Infinity;
          for (const i of cells) if (dist[i] < bestD) { bestD = dist[i]; best = i; }
          if (best < 0 || bestD >= 0x3fffffff) { clear(cells); stats.islandsRemoved++; return; }
          const thin = area < minIsland;
          for (let i = parent[best]; i >= 0 && parent[i] !== -1; i = parent[i]) {
            const c = i % nl;
            if (!thin) paint(i);
            else if (c > 0 && c < nl - 1) F[((i / nl) | 0) * nc + gcol(c)] = 0;
          }
          stats.bridges++;
        });
      }
    } else if (!opts.keepIslands) {
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

  // ---------- gerçekçi ışık: yayıcısı olan LED (yarı gölge) ----------
  //
  // Gerçek LED nokta değil, çapı 1–3 mm'lik bir yayıcıdır (duvara bakan disk,
  // z = cz düzleminde). Duvardaki (X, Y) noktasına yayıcının her noktasından ayrı
  // bir ışın gelir ve lamba duvarını biraz farklı (s, z)'de keser; nokta, ışınların
  // geçen kesri kadar aydınlanır. Küçük yayıcı için kesişim kayması doğrusaldır:
  // radyal kayma e_r → Δz = cz·(ρ − r)/ρ² · e_r, teğetsel kayma e_t → Δs = (ρ − r)/ρ · e_t
  // (r: kesişimdeki gövde yarıçapı). Kesim LED'e yaklaştıkça (z → cz) yarı gölge
  // büyür: genişliği ≈ yayıcı · z / (cz − z).
  const EMIT = (() => {           // birim diskte eşit alanlı 16 nokta (Vogel)
    const n = 16, ga = Math.PI * (3 - Math.sqrt(5)), pts = [];
    for (let i = 0; i < n; i++) { const r = Math.sqrt((i + 0.5) / n); pts.push([r * Math.cos(i * ga), r * Math.sin(i * ga)]); }
    return pts;
  })();
  const QUICK = [[0, 0]].concat(Array.from({ length: 6 }, (_, i) => [0.85 * Math.cos(i * Math.PI / 3), 0.85 * Math.sin(i * Math.PI / 3)]));

  /**
   * Duvar noktası (X, Y) cm → aydınlanma oranı 0..1 (yayıcı çapı emitterCm; 0 = nokta LED).
   * null: gövdenin arkası (lambanın izi).
   */
  function litFraction(field, X, Y, emitterCm) {
    const shape = field.shape, cz = field.cz, mg = field.margin || 0;
    const inv = global.Projection.inverseShell(X, Y, shape, cz, mg);
    if (!inv) return null;
    const ok = (s, z) => z >= 0 && z <= cz - mg && sampleField(field, s, z) > 0.5;
    if (!(emitterCm > 0)) return !inv.blocked && ok(inv.s, inv.z) ? 1 : 0;
    const rho = Math.hypot(X, Y);
    if (!isFinite(inv.z) || inv.z >= cz) return 0;
    const reff = rho * (cz - inv.z) / cz;                 // kesişimdeki gövde yarıçapı (ölçekli)
    const kz = cz * (rho - reff) / (rho * rho), ks = (rho - reff) / rho;
    const ux = X / rho, uy = Y / rho, er = emitterCm / 2;
    const at = (p) => {
      const ex = p[0] * er, ey = p[1] * er;
      return ok(inv.s + ks * (ex * -uy + ey * ux), inv.z + kz * (ex * ux + ey * uy)) ? 1 : 0;
    };
    // Önce merkez + halka: hepsi aynıysa yarı gölgede değil (hızlı yol).
    const q0 = at(QUICK[0]);
    let same = true;
    for (let i = 1; i < QUICK.length && same; i++) if (at(QUICK[i]) !== q0) same = false;
    if (same) return q0;
    let n = 0;
    for (const p of EMIT) n += at(p);
    return n / EMIT.length;
  }

  global.WallField = { compute, sampleField, signedDistance, smoothSampler, litFraction };
})(typeof window !== 'undefined' ? window : globalThis);
