/**
 * Printable lamp geometry from a WallField.
 *
 * Marching squares turns the (s, z) field into solid 2-D polygons with smooth
 * sub-cell edges. Every vertex is keyed by its grid corner / grid edge, so
 * neighbouring cells share vertices exactly and the result is watertight.
 * The same 2-D mesh is mapped to 3-D two ways:
 *   - "one-piece": wrapped around the body outline (curved shell, any shape),
 *   - "flat":      one planar panel per facet (polygonal shapes only).
 * Plus a base plate (keyhole hanger) and a front cap holding the LED facing
 * the wall at the light position.
 *
 * Output meshes are { positions: Float32Array, indices: Uint32Array, name }
 * in millimetres. STL is written as binary.
 */
(function (global) {
  'use strict';

  const MM = 10; // cm → mm

  // ---------- mesh accumulator ----------

  function MeshBuilder(name) {
    this.name = name;
    this.pos = [];
    this.idx = [];
  }
  MeshBuilder.prototype.v = function (x, y, z) {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  };
  MeshBuilder.prototype.tri = function (a, b, c) { this.idx.push(a, b, c); };
  MeshBuilder.prototype.done = function () {
    return { name: this.name, positions: Float32Array.from(this.pos), indices: Uint32Array.from(this.idx) };
  };

  // ---------- marching squares wall ----------
  //
  // Corner order (CCW in the s→right, z→up plane): bl, br, tr, tl.
  // Side bits: bottom 1, right 2, top 4, left 8.

  const CORNER_SIDES = [1 | 8, 1 | 2, 2 | 4, 4 | 8];
  const EDGE_SIDE = [1, 2, 4, 8];

  /**
   * field: { F, nr, nc, rowZ, periodic }; columns [c0, c1] (inclusive, may wrap
   * when periodic). map(c, f, z, side) → [x, y, z]: c = local column index,
   * f ∈ [0,1] fraction to c+1, side = +1 outer / −1 inner.
   */
  function wallMesh(field, map, opts) {
    const { F, nc: NC, rowZ } = field;
    const nr = field.nr;
    const periodic = !!opts.periodic;
    const c0 = opts.c0 || 0;
    const ncol = opts.ncol || NC; // number of columns in this piece
    const ncell = periodic ? ncol : ncol - 1;
    const mb = new MeshBuilder(opts.name || 'wall');

    const val = (r, lc) => {
      let v = F[r * NC + ((c0 + lc) % NC)];
      if (v > 0.499 && v < 0.501) v = v < 0.5 ? 0.499 : 0.501;
      return v;
    };
    const wrap = (lc) => (periodic ? lc % ncol : lc);

    const nkeys = nr * ncol * 3;
    const vout = new Int32Array(nkeys).fill(-1);
    const vin = new Int32Array(nkeys).fill(-1);

    function vertex(key, lc, f, z) {
      if (vout[key] < 0) {
        const o = map(lc, f, z, +1);
        const i = map(lc, f, z, -1);
        vout[key] = mb.v(o[0], o[1], o[2]);
        vin[key] = mb.v(i[0], i[1], i[2]);
      }
      return key;
    }

    function cornerPt(r, lc) {
      const c = wrap(lc);
      return vertex((r * ncol + c) * 3, c, 0, rowZ[r]);
    }
    function hEdgePt(r, lc, va, vb) {
      const c = wrap(lc);
      const f = clamp01((0.5 - va) / (vb - va));
      return vertex((r * ncol + c) * 3 + 1, c, f, rowZ[r]);
    }
    function vEdgePt(r, lc, va, vb) {
      const c = wrap(lc);
      const f = clamp01((0.5 - va) / (vb - va));
      return vertex((r * ncol + c) * 3 + 2, c, 0, rowZ[r] + (rowZ[r + 1] - rowZ[r]) * f);
    }

    function emitPoly(poly) {
      // Fan triangulation (marching-squares polygons are convex).
      for (let k = 1; k + 1 < poly.length; k++) {
        const a = poly[0].k, b = poly[k].k, c = poly[k + 1].k;
        mb.tri(vout[a], vout[b], vout[c]);
        mb.tri(vin[a], vin[c], vin[b]);
      }
    }

    function emitSide(a, b) {
      // a→b with solid on the left (CCW); quad facing to the right of travel.
      const ai = vin[a.k], bi = vin[b.k], bo = vout[b.k], ao = vout[a.k];
      mb.tri(ai, bi, bo);
      mb.tri(ai, bo, ao);
    }

    // ---- Dolu bölgeleri birleştir (dosya boyutu) ----
    // Dört köşesi de dolu, kenara değmeyen hücreler dikdörtgenlerde birleşir.
    // Dikdörtgenin kenarında yalnızca komşuların da kullandığı ızgara noktaları
    // tutulur (aynı nokta kümesi iki tarafta da → T-birleşimi yok, su geçirmez);
    // yüz, merkez noktasından yelpazeyle örülür. Eğri duvarda dikdörtgen,
    // kiriş sapması `mergeTol` mm'yi geçmeyecek genişlikte kalır.
    const rectOf = new Int32Array((nr - 1) * ncell).fill(-1);
    const rects = [];
    if (opts.merge !== false) {
      const tol = opts.mergeTol != null ? opts.mergeTol : 0.02;
      const eligible = (r, lc) => r > 0 && r < nr - 2 && (periodic || (lc > 0 && lc < ncell - 1))
        && val(r, lc) <= 0.5 && val(r, wrap(lc + 1)) <= 0.5 && val(r + 1, wrap(lc + 1)) <= 0.5 && val(r + 1, lc) <= 0.5;
      const free = (r, lc) => rectOf[r * ncell + lc] < 0 && eligible(r, lc);
      // Sütunlar boyunca biriken yay boyu (S) ve dönme açısı (T): [lc0, lc1]
      // aralığının kirişten sapması ≤ uzunluk × dönme / 4 (köşe için de güvenli).
      const z0 = rowZ[0];
      const S = new Float64Array(ncell + 2), T = new Float64Array(ncell + 2);
      let prev = map(0, 0, z0, +1), prevDir = null;
      for (let m = 1; m <= ncell; m++) {
        const P = map(wrap(m), 0, z0, +1);
        const d = [P[0] - prev[0], P[1] - prev[1], P[2] - prev[2]];
        const len = Math.hypot(d[0], d[1], d[2]) || 1e-12;
        S[m] = S[m - 1] + len;
        let turn = 0;
        if (prevDir) {
          const dot = (d[0] * prevDir[0] + d[1] * prevDir[1] + d[2] * prevDir[2]) / len;
          turn = Math.acos(Math.max(-1, Math.min(1, dot)));
        }
        T[m] = T[m - 1] + turn;   // T[m]: 1 … m−1. noktalardaki dönmelerin toplamı
        prevDir = [d[0] / len, d[1] / len, d[2] / len];
        prev = P;
      }
      const flatEnough = (lc0, lc1) => (S[lc1] - S[lc0]) * (T[lc1] - T[lc0 + 1]) / 4 <= tol;
      const MAXW = 256, MAXH = 256;
      for (let r = 1; r < nr - 2; r++) {
        for (let lc = 0; lc < ncell; lc++) {
          if (!free(r, lc)) continue;
          let w = 1;
          while (w < MAXW && lc + w < ncell && free(r, lc + w) && flatEnough(lc, lc + w + 1)) w++;
          let h = 1;
          while (h < MAXH && r + h < nr - 2) {
            let ok = true;
            for (let k = 0; k < w && ok; k++) ok = free(r + h, lc + k);
            if (!ok) break;
            h++;
          }
          if (w < 2 || h < 2) continue;
          const id = rects.length;
          rects.push({ r, lc, w, h });
          for (let i = 0; i < h; i++) for (let k = 0; k < w; k++) rectOf[(r + i) * ncell + lc + k] = id;
        }
      }
    }
    // Izgara noktası (r, c) bir dikdörtgenin kenarında tutulmalı mı?
    const cellRect = (r, lc) => {
      if (r < 0 || r >= nr - 1) return -2;
      if (!periodic && (lc < 0 || lc >= ncell)) return -2;
      return rectOf[r * ncell + col(lc)];
    };
    const col = (c) => (periodic ? ((c % ncell) + ncell) % ncell : c);
    const needed = (r, c) => {
      for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
        const id = cellRect(r + dr, c + dc);
        if (id === -1) return true;               // birleşmemiş komşu hücre
        if (id >= 0) {
          const q = rects[id];
          if ((r === q.r || r === q.r + q.h) && (col(c) === col(q.lc) || col(c) === col(q.lc + q.w))) return true;
        }
      }
      return false;
    };
    rects.forEach((q) => {
      const ring = [];
      for (let c = q.lc; c < q.lc + q.w; c++) if (needed(q.r, c)) ring.push(cornerPt(q.r, c));
      for (let r = q.r; r < q.r + q.h; r++) if (needed(r, q.lc + q.w)) ring.push(cornerPt(r, q.lc + q.w));
      for (let c = q.lc + q.w; c > q.lc; c--) if (needed(q.r + q.h, c)) ring.push(cornerPt(q.r + q.h, c));
      for (let r = q.r + q.h; r > q.r; r--) if (needed(r, q.lc)) ring.push(cornerPt(r, q.lc));
      const cc = q.lc + Math.floor(q.w / 2), cf = (q.w % 2) / 2;
      const cz = (rowZ[q.r] + rowZ[q.r + q.h]) / 2;
      const o = map(wrap(cc), cf, cz, +1), i = map(wrap(cc), cf, cz, -1);
      const co = mb.v(o[0], o[1], o[2]), ci = mb.v(i[0], i[1], i[2]);
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], b = ring[(k + 1) % ring.length];
        mb.tri(co, vout[a], vout[b]);
        mb.tri(ci, vin[b], vin[a]);
      }
    });

    for (let r = 0; r < nr - 1; r++) {
      for (let lc = 0; lc < ncell; lc++) {
        if (rectOf[r * ncell + lc] >= 0) continue;
        const v = [val(r, lc), val(r, wrap(lc + 1)), val(r + 1, wrap(lc + 1)), val(r + 1, lc)];
        const s = v.map((x) => x <= 0.5);
        if (!s[0] && !s[1] && !s[2] && !s[3]) continue;

        const border = (r === 0 ? 1 : 0) | (r === nr - 2 ? 4 : 0)
          | (!periodic && lc === 0 ? 8 : 0) | (!periodic && lc === ncell - 1 ? 2 : 0);

        // Corner + crossing points in CCW traversal order.
        const pts = [];
        const cornerKey = [
          () => cornerPt(r, lc), () => cornerPt(r, lc + 1),
          () => cornerPt(r + 1, lc + 1), () => cornerPt(r + 1, lc),
        ];
        const edgeKey = [
          () => hEdgePt(r, lc, v[0], v[1]),
          () => vEdgePt(r, lc + 1, v[1], v[2]),
          () => hEdgePt(r + 1, lc, v[3], v[2]),
          () => vEdgePt(r, lc, v[0], v[3]),
        ];
        for (let k = 0; k < 4; k++) {
          if (s[k]) pts.push({ k: cornerKey[k](), sides: CORNER_SIDES[k] });
          const n = (k + 1) % 4;
          if (s[k] !== s[n]) pts.push({ k: edgeKey[k](), sides: EDGE_SIDE[k] });
        }

        let polys;
        const saddle = (s[0] && s[2] && !s[1] && !s[3]) || (s[1] && s[3] && !s[0] && !s[2]);
        if (saddle && (v[0] + v[1] + v[2] + v[3]) / 4 > 0.5) {
          // Centre is lit → two separate corner triangles.
          polys = s[0] ? [[pts[0], pts[1], pts[5]], [pts[2], pts[3], pts[4]]]
                       : [[pts[0], pts[1], pts[2]], [pts[3], pts[4], pts[5]]];
        } else {
          polys = [pts];
        }

        polys.forEach((poly) => {
          emitPoly(poly);
          for (let k = 0; k < poly.length; k++) {
            const a = poly[k], b = poly[(k + 1) % poly.length];
            const shared = a.sides & b.sides;
            if (shared === 0 || (shared & border)) emitSide(a, b);
          }
        });
      }
    }
    return mb.done();
  }

  function clamp01(f) { return Math.max(0.01, Math.min(0.99, f)); }

  // ---------- 2-D polygon extrusion (plates, cap, LED holder) ----------

  function area2(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  function circle(cx, cy, r, n) {
    const pts = [];
    const m = n || Math.max(24, Math.ceil(r * 4));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  /** contour: CCW [[x,y]...]; holes: arrays of [x,y]. Extrude z0 → z1 (mm). */
  function extrude(name, contour, holes, z0, z1) {
    const outer = area2(contour) < 0 ? contour.slice().reverse() : contour;
    const hs = (holes || []).map((h) => (area2(h) > 0 ? h.slice().reverse() : h));
    const mb = new MeshBuilder(name);
    const loops = [outer, ...hs];
    const flat = [];
    loops.forEach((l) => l.forEach((p) => flat.push(p)));

    const bot = flat.map((p) => mb.v(p[0], p[1], z0));
    const top = flat.map((p) => mb.v(p[0], p[1], z1));

    const tris = THREE.ShapeUtils.triangulateShape(
      outer.map((p) => new THREE.Vector2(p[0], p[1])),
      hs.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))),
    );
    tris.forEach(([a, b, c]) => {
      const pa = flat[a], pb = flat[b], pc = flat[c];
      const ccw = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0;
      if (ccw) { mb.tri(top[a], top[b], top[c]); mb.tri(bot[a], bot[c], bot[b]); }
      else     { mb.tri(top[a], top[c], top[b]); mb.tri(bot[a], bot[b], bot[c]); }
    });

    let base = 0;
    loops.forEach((l) => {
      for (let i = 0; i < l.length; i++) {
        const a = base + i, b = base + ((i + 1) % l.length);
        mb.tri(bot[a], bot[b], top[b]);
        mb.tri(bot[a], top[b], top[a]);
      }
      base += l.length;
    });
    return mb.done();
  }

  function keyhole(cx, cy, rBig, rSlot, len) {
    // Big circle on top, slot running downward, rounded end. CCW.
    const pts = [];
    const alpha = Math.asin(rSlot / rBig);
    const n = 28;
    const a0 = -Math.PI / 2 + alpha, a1 = 1.5 * Math.PI - alpha;
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([cx + rBig * Math.cos(a), cy + rBig * Math.sin(a)]);
    }
    const yEnd = cy - len;
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + (Math.PI * i) / 12;
      pts.push([cx + rSlot * Math.cos(a), yEnd + rSlot * Math.sin(a)]);
    }
    return pts;
  }

  // Radius of a star-shaped polygon (around the origin) along angle phi.
  function radialAt(poly, phi) {
    const dx = Math.cos(phi), dy = Math.sin(phi);
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const r = (p[0] * ey - p[1] * ex) / den;
      const f = (p[0] * dy - p[1] * dx) / den;
      if (r > 0 && f >= -1e-9 && f <= 1 + 1e-9 && r < best) best = r;
    }
    return best;
  }

  /** Pull points of `inner` radially so they stay ≥ gap inside `outer`. */
  function keepInside(inner, outer, gap) {
    return inner.map(([x, y]) => {
      const r = Math.hypot(x, y);
      if (r < 1e-9) return [x, y];
      const lim = radialAt(outer, Math.atan2(y, x)) - gap;
      if (r <= lim) return [x, y];
      const k = Math.max(0, lim) / r;
      return [x * k, y * k];
    });
  }

  function fitsInside(pts, outer, gap) {
    return pts.every(([x, y]) => Math.hypot(x, y) <= radialAt(outer, Math.atan2(y, x)) - gap);
  }

  function transform(mesh, fn, name) {
    const p = mesh.positions;
    const out = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const q = fn(p[i], p[i + 1], p[i + 2]);
      out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2];
    }
    return { name: name || mesh.name, positions: out, indices: mesh.indices };
  }

  function bbox(meshes) {
    const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
    meshes.forEach((m) => {
      const p = m.positions;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] < b.minX) b.minX = p[i]; if (p[i] > b.maxX) b.maxX = p[i];
        if (p[i + 1] < b.minY) b.minY = p[i + 1]; if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
        if (p[i + 2] < b.minZ) b.minZ = p[i + 2]; if (p[i + 2] > b.maxZ) b.maxZ = p[i + 2];
      }
    });
    return b;
  }

  const translate = (m, dx, dy, dz) => transform(m, (x, y, z) => [x + dx, y + dy, z + dz]);

  /** Birden çok mesh'i tek mesh'te toplar (her biri kendi içinde kapalı kalır). */
  function concat(name, meshes) {
    let np = 0, ni = 0;
    meshes.forEach((m) => { np += m.positions.length; ni += m.indices.length; });
    const positions = new Float32Array(np), indices = new Uint32Array(ni);
    let po = 0, io = 0;
    meshes.forEach((m) => {
      positions.set(m.positions, po);
      for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + po / 3;
      po += m.positions.length; io += m.indices.length;
    });
    return { name, positions, indices };
  }

  // ---------- montaj numarası (7 segment kabartma) ----------

  const SEGMENTS = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  /** Rakam boyutu: yükseklik h → { w (tek rakam), gap, sw (çizgi), total(n) }. */
  function digitMetrics(h) {
    const w = 0.6 * h, gap = 0.35 * h, sw = Math.max(0.8, 0.17 * h);
    return { w, gap, sw, total: (n) => n * w + (n - 1) * gap };
  }
  /**
   * Yazı (rakamlar) → kabartma mesh. (cx, cy) merkez, (ux, uy) yazının "yukarı"
   * yönü (birim), z0 → z1 yükseklik. Segmentler birbirine değmez (0,05 mm aralık):
   * her kutu ayrı kapalı gövde kalır, dilimleyici birleştirir.
   */
  function labelMesh(name, text, h, cx, cy, ux, uy, z0, z1) {
    const { w, gap, sw, total } = digitMetrics(h);
    const e = 0.05, rx = uy, ry = -ux;   // sağ yön
    const boxes = [];
    let x0 = -total(text.length) / 2;
    for (const ch of text) {
      const segs = SEGMENTS[ch] || '';
      const R = {
        a: [x0 + sw + e, h - sw, x0 + w - sw - e, h],
        d: [x0 + sw + e, 0, x0 + w - sw - e, sw],
        g: [x0 + sw + e, h / 2 - sw / 2, x0 + w - sw - e, h / 2 + sw / 2],
        f: [x0, h / 2 + e, x0 + sw, h],
        e: [x0, 0, x0 + sw, h / 2 - e],
        b: [x0 + w - sw, h / 2 + e, x0 + w, h],
        c: [x0 + w - sw, 0, x0 + w, h / 2 - e],
      };
      for (const s of segs) {
        const [a0, b0, a1, b1] = R[s];
        const pts = [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(([lx, ly]) => {
          const yy = ly - h / 2;
          return [cx + lx * rx + yy * ux, cy + lx * ry + yy * uy];
        });
        boxes.push(extrude(name, pts, [], z0, z1));
      }
      x0 += w + gap;
    }
    return boxes.length ? concat(name, boxes) : null;
  }

  // ---------- lamp assembly ----------

  /**
   * field: WallField result. opts (mm unless noted): {
   *   mode: 'onepiece' | 'flat', thickness, plateThickness, capThickness,
   *   ledSeat (diameter), bed (size), assembled (true → lamp coords, for preview)
   * }
   * Returns { meshes, warnings, info }.
   */
  /**
   * opts (mm): {
   *   mode: 'onepiece' | 'flat', mount: 'cap' | 'tube',
   *   thickness, plateThickness, capThickness, ledSeat, keyhole,
   *   tubeOD, holderHeight,              // şeffaf tüp montajı
   *   chamfer, supportLayer,             // düz paneller
   *   merge (false → dolu bölgeler birleştirilmez; yalnızca test/karşılaştırma),
   *   bed ({ x, y, z } mm veya kare için tek sayı), assembled (true → lamba koordinatlarında önizleme)
   * }
   */
  function buildLamp(field, opts) {
    const shape = field.shape;
    const t = opts.thickness || 1.6;
    const tb = opts.plateThickness || 3;
    const tc = opts.capThickness || 2.4;
    const seat = opts.ledSeat || 20;
    // Tabla: { x, y, z } mm (eski çağrılar için tek sayı = kare tabla).
    const bedIn = opts.bed || 256;
    const bed = typeof bedIn === 'number' ? { x: bedIn, y: bedIn, z: bedIn } : bedIn;
    const fitsXY = (w, h) => (w <= bed.x && h <= bed.y) || (w <= bed.y && h <= bed.x);
    const bedTxt = `${bed.x} × ${bed.y} mm`;
    const tubeMount = opts.mount === 'tube';
    const dmm = field.d * MM;
    const czmm = field.cz * MM;
    const warnings = [];
    const preview = [];   // yalnızca önizlemede görünen parçalar (şeffaf tüp)
    if (field.stats && field.stats.rimFloating) {
      warnings.push('Ön çember tabana bağlı değil (destek kolonu 0 ve siluet oraya ulaşmıyor) — basılan lamba dağılır. Destek kolonu ekleyin.');
    }
    const flat = opts.mode === 'flat' && shape.faceted;
    if (opts.mode === 'flat' && !shape.faceted) {
      warnings.push(`${shape.label} kavisli duvarlı — düz panel yalnızca köşeli şekillerde olur; tek parça olarak verildi.`);
    }
    const b = shape.bounds();
    const innerSpan = Math.min(b.maxX - b.minX, b.maxY - b.minY) * MM - 2 * t;

    // ----- şeffaf tüp tutucu halka -----
    const tubeOD = opts.tubeOD || 40;
    const holderH = opts.holderHeight || 10;
    const ringIn = tubeOD / 2 + 0.3, ringOut = ringIn + 2.2;
    if (tubeMount && ringOut * 2 > innerSpan - 4) {
      warnings.push('Tüp tutucu gövdenin içine sığmıyor — tüp çapını küçültün veya gövdeyi büyütün.');
    }

    // ----- arka plaka (z = 0 … tb, duvara dayanır) -----
    const outerMm = shape.offset(t / 2 / MM).map(([x, y]) => [x * MM, y * MM]);
    const plateHoles = [];
    // Askı deliği: ortadaki tutucunun dışında, duvardan uzak, olabildiğince yukarıda.
    const innerMm = shape.offset(-t / 2 / MM).map(([x, y]) => [x * MM, y * MM]);
    const centerKeep = tubeMount ? ringOut + 3 : 0;
    let hanger = null;
    for (let y = b.maxY * MM * 0.85; opts.keyhole !== false && y > 14; y -= 1) {
      const kh = keyhole(0, y, 4.5, 2.2, 9);
      if (y - 9 - 2.2 < centerKeep) break;
      if (fitsInside(kh, innerMm, 3)) { hanger = kh; break; }
    }
    if (hanger) plateHoles.push(hanger);
    else if (opts.keyhole !== false) warnings.push('Askı deliği için yer yok — çift taraflı bant kullanın.');
    const plate = extrude('base-plate', outerMm, plateHoles, 0, tb);
    // Düz panelde plakanın üstüne, her kenarın yanına o kenarın panel numarası
    // (yazının üstü kenara bakar); askı deliğine / tüp tutucuya değmeyen yere.
    const plateLabels = [];
    if (flat && opts.labels !== false) {
      const P = shape.pts, nv = P.length, h = 6;
      const avoid = (hanger || []).concat(tubeMount ? circle(0, 0, ringOut + 2, 48) : []);
      for (let e = 0; e < nv; e++) {
        const A = P[e], B = P[(e + 1) % nv];
        const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
        const ox = dy / L, oy = -dx / L;           // dışa normal (CCW şekil)
        const inset = t / 2 + 2 + h / 2 + 1;
        const half = digitMetrics(h).total(String(e + 1).length) / 2 + 1.5;
        let placed = null;
        for (const fr of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const cx = (A[0] + dx * fr) * MM - ox * inset, cy = (A[1] + dy * fr) * MM - oy * inset;
          const near = avoid.some(([x, y]) => Math.abs((x - cx) * oy - (y - cy) * ox) < half && Math.abs((x - cx) * ox + (y - cy) * oy) < h / 2 + 1.5)
            || (tubeMount && Math.hypot(cx, cy) < ringOut + 2 + Math.hypot(half, h / 2 + 1.5));   // tüp tutucunun içi/altı
          if (near || !fitsInside([[cx, cy]], innerMm, half)) continue;
          placed = labelMesh(`base-plate-label-${e + 1}`, String(e + 1), h, cx, cy, ox, oy, tb - 0.01, tb + 0.6);
          break;
        }
        if (placed) plateLabels.push(placed);
      }
    }

    // ----- ışık tutma: kapak (ön çember) veya şeffaf tüp -----
    const capParts = [];
    const emitter = 2.0;
    let lightZmm = czmm;
    let tubeLength = 0;
    const plateParts = [plate, ...plateLabels];
    if (tubeMount) {
      // Tabanda tüp tutucu halka. Tüpün tepesinde: tüpün İÇİNE giren tapa +
      // kapaktan aşağı inen direk; LED direğin ucunda, aşağı (duvara) bakar.
      // LED düzeneğin en alt noktasıdır: yanında/altında ışığı kesen opak parça
      // kalmaz (dıştan saran etek uzak duvara giden yatay ışınları keserdi).
      plateParts.push(extrude('tube-holder', circle(0, 0, ringOut, 96), [circle(0, 0, ringIn, 96)], tb - 0.01, tb + holderH));
      const tubeWall = 1.5;
      const plugR = (tubeOD - 2 * tubeWall) / 2 - 0.2;
      const plugH = 4, cupDepth = 2;
      const cupFloor = czmm + emitter;          // LED arkası; yüzü ≈ cz
      const plugBottom = cupFloor + 3;
      const top = plugBottom + plugH;           // tüpün üst ucu
      tubeLength = top - tb;
      const postR = seat / 2 + 2;
      capParts.push(extrude('tube-cap', circle(0, 0, ringOut, 96), [circle(0, 0, 3)], top, top + tc));
      capParts.push(extrude('tube-cap-plug', circle(0, 0, plugR, 96), [circle(0, 0, plugR - 1.6, 96)], plugBottom, top + 0.01));
      capParts.push(extrude('tube-cap-post', circle(0, 0, postR, 64), [circle(0, 0, 3)], cupFloor, top + 0.01));
      capParts.push(extrude('tube-cap-cup', circle(0, 0, postR, 64), [circle(0, 0, seat / 2, 64)], cupFloor - cupDepth, cupFloor + 0.01));
      if (postR > plugR - 2.5) warnings.push('LED tüpün içine sığmıyor — LED yuva çapını küçültün veya daha geniş tüp kullanın.');
      // Önizleme: şeffaf tüp.
      preview.push(Object.assign(extrude('tube-glass', circle(0, 0, tubeOD / 2, 96), [circle(0, 0, tubeOD / 2 - tubeWall, 96)], tb, top), { previewOnly: true }));
    } else {
      const clear = 0.25, lipW = 2.0, lipH = 4.0;
      const lipOuter = shape.offset(-(t / 2 + clear) / MM).map(([x, y]) => [x * MM, y * MM]);
      const lipInner = keepInside(
        shape.offset(-(t / 2 + clear + lipW) / MM).map(([x, y]) => [x * MM, y * MM]), lipOuter, 0.8);
      const cableR = 3;
      const tubeR = seat / 2 + 2;
      capParts.push(extrude('cap', outerMm, [circle(0, 0, cableR)], dmm, dmm + tc));
      capParts.push(extrude('cap-lip', lipOuter, [lipInner], dmm - lipH, dmm + 0.01));
      const cupDepth = 2.0;
      let cupFloor = czmm + emitter;
      if (cupFloor > dmm - 0.5) {
        cupFloor = dmm;
        warnings.push(`Işık çok önde — LED yüzeyi ${field.cz.toFixed(1)} cm yerine ~${((dmm - emitter) / MM).toFixed(1)} cm'de kalıyor. Tam uyum için "Işık konumu"nu düşürün.`);
      }
      if (dmm - cupFloor > 0.3) {
        capParts.push(extrude('led-tube', circle(0, 0, tubeR), [circle(0, 0, cableR)], cupFloor, dmm + 0.01));
      }
      capParts.push(extrude('led-cup', circle(0, 0, tubeR), [circle(0, 0, seat / 2)], cupFloor - cupDepth, cupFloor + 0.01));
      if (tubeR * 2 > innerSpan) warnings.push('LED tutucu gövdenin içinden geniş — LED yuva çapını küçültün.');
      lightZmm = cupFloor - emitter;
    }

    // ----- duvarlar -----
    const colPt = Array.from(field.colS, (s) => shape.pointAt(s));
    const colN = Array.from(field.colS, (s) => shape.normalAt(s));
    const NC = field.nc;

    function shellWall() {
      const map = (c, f, z, side) => {
        const c1 = (c + 1) % NC;
        const p0 = colPt[c], p1 = colPt[c1], n0 = colN[c], n1 = colN[c1];
        const k = shape.scaleAt(z);
        const off = (side * t) / 2 / MM;
        const x = (p0.x + (p1.x - p0.x) * f) * k + (n0[0] + (n1[0] - n0[0]) * f) * off;
        const y = (p0.y + (p1.y - p0.y) * f) * k + (n0[1] + (n1[1] - n0[1]) * f) * off;
        return [x * MM, y * MM, z * MM];
      };
      return wallMesh(field, map, { periodic: true, name: 'shell', merge: opts.merge });
    }

    // Panel dış yüzüne (baskıda üstte) kabartma montaj numarası. Yer, duvarın
    // tamamen dolu olduğu bir pencerede aranır (gölge değişmez): alttan yukarı,
    // panel ortasından kenarlara doğru; uçlarda pah + 2 mm boşluk bırakılır.
    function panelLabel(e, ca, ncol, sOf, sA, len, slant, miter) {
      const text = String(e + 1);
      const nr = field.nr, F = field.F, rowZ = field.rowZ;
      const P = new Int32Array((nr + 1) * (ncol + 1));   // dolu olmayan nokta sayısı (önek toplamı)
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < ncol; c++) {
          const bad = F[r * NC + ((ca + c) % NC)] > 0.4 ? 1 : 0;
          P[(r + 1) * (ncol + 1) + c + 1] = bad + P[r * (ncol + 1) + c + 1] + P[(r + 1) * (ncol + 1) + c] - P[r * (ncol + 1) + c];
        }
      }
      const badIn = (r0, r1, c0, c1) => P[(r1 + 1) * (ncol + 1) + c1 + 1] - P[r0 * (ncol + 1) + c1 + 1]
        - P[(r1 + 1) * (ncol + 1) + c0] + P[r0 * (ncol + 1) + c0];
      const ls = (c) => sOf(ca + c) - sA;                 // panel başından uzaklık (cm)
      const endGap = (t + 2) / MM + miter * len / 2;
      for (const h of [6, 4.5]) {
        const pad = 1.2;
        // Panel genişliği yükseklikle ölçeklenir (koniklik): en dar yere göre aranır.
        const minScale = Math.min(shape.scaleAt(0), shape.scaleAt(field.d));
        const Wcm = (digitMetrics(h).total(text.length) + 2 * pad) / MM / minScale;
        const Hcm = (h + 2 * pad) / (slant * MM);
        // Ortadan başlayıp iki yana: aday pencereler [c0, c1].
        const mid = len / 2 - Wcm / 2;
        const cands = [];
        for (let c0 = 0, c1 = 0; c0 < ncol - 1; c0++) {
          if (ls(c0) < endGap || ls(c0) + Wcm > len - endGap) continue;
          c1 = Math.max(c1, c0);
          while (c1 < ncol - 1 && ls(c1) - ls(c0) < Wcm) c1++;
          if (ls(c1) - ls(c0) >= Wcm) cands.push([c0, c1]);
        }
        cands.sort((a, b) => Math.abs(ls(a[0]) - mid) - Math.abs(ls(b[0]) - mid));
        for (let r0 = 0; r0 < nr - 1; r0++) {
          let r1 = r0;
          while (r1 < nr - 1 && rowZ[r1] - rowZ[r0] < Hcm) r1++;
          if (rowZ[r1] - rowZ[r0] < Hcm) break;
          for (const [c0, c1] of cands) {
            if (badIn(r0, r1, c0, c1)) continue;
            const sMid = (ls(c0) + ls(c1)) / 2, zMid = (rowZ[r0] + rowZ[r1]) / 2;
            // Dış yüz pah payı kadar uzar (map ile aynı: 1 + miter).
            const cx = (sMid - len / 2) * shape.scaleAt(zMid) * MM * (1 + miter), cy = zMid * slant * MM;
            return labelMesh(`panel-${e + 1}-label`, text, h, cx, cy, 0, 1, t - 0.01, t + 0.6);
          }
        }
      }
      return null;
    }

    function flatPanels() {
      const out = [];
      const nv = field.vertexCol.length;
      const pts = shape.pts;
      // Dış dönme açısı (köşe başına): 45° pah için iç yüz her uçta t/2·tan(θ/2) kısalır.
      const turn = (i) => {
        const p0 = pts[(i - 1 + nv) % nv], p1 = pts[i], p2 = pts[(i + 1) % nv];
        const a1 = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), a2 = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
        let d = a2 - a1;
        while (d <= -Math.PI) d += 2 * Math.PI;
        while (d > Math.PI) d -= 2 * Math.PI;
        return Math.abs(d);
      };
      for (let e = 0; e < nv; e++) {
        const ca = field.vertexCol[e];
        const cb = e + 1 < nv ? field.vertexCol[e + 1] : NC;
        const ncol = cb - ca + 1;
        const sA = field.colS[ca];
        const pA = pts[e], pB = pts[(e + 1) % nv];
        const len = Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
        const apo = Math.abs(pA[0] * pB[1] - pB[0] * pA[1]) / (len || 1);
        const slant = Math.sqrt(1 + Math.pow(shape.k * apo, 2));
        const miter = opts.chamfer !== false
          ? ((t / 2) * Math.tan((turn(e) + turn((e + 1) % nv)) / 4)) / (len * MM / 2)
          : 0;
        const sOf = (i) => (i < NC ? field.colS[i] : shape.perimeter);
        const map = (c, f, z, side) => {
          const gc = ca + c;
          const s0 = sOf(gc), s1 = sOf(gc + 1);
          const sl = s0 + (s1 - s0) * f - sA - len / 2;
          // Dış yüz (side +1, üstte) uzun, iç yüz (tablada) kısa → pahlı uçlar.
          return [sl * shape.scaleAt(z) * MM * (1 + side * miter), z * slant * MM, ((side + 1) * t) / 2];
        };
        const panel = wallMesh(field, map, { periodic: false, c0: ca, ncol, name: `panel-${e + 1}`, merge: opts.merge });
        const group = [panel];
        if (opts.supportLayer) {
          // 0,2 mm ince taban: kopuk parçaları tutar, ışığı büyük ölçüde geçirir.
          const k0 = (1 - miter), hz = field.d * slant * MM;
          const w0 = (len / 2) * MM * k0, w1 = (len / 2) * shape.scaleAt(field.d) * MM * k0;
          group.push(extrude(`panel-${e + 1}-layer`, [[-w0, 0], [w0, 0], [w1, hz], [-w1, hz]], [], 0, 0.2));
        }
        if (opts.labels !== false) {
          const lab = panelLabel(e, ca, ncol, sOf, sA, len, slant, miter);
          if (lab) group.push(lab);
          else warnings.push(`Panel ${e + 1}: montaj numarası için dolu (deliksiz) yer bulunamadı — panelin içine kalemle yazın.`);
        }
        out.push(group);
      }
      return out;
    }

    const info = {
      triangles: 0,
      lightZcm: lightZmm / MM,
      tubeLengthMM: tubeLength,
      mount: tubeMount ? 'tube' : 'cap',
      beds: 1,              // baskı düzeninin kapladığı tabla sayısı (düz panelde > 1 olabilir)
      bedPitchMM: 0,        // tablalar arası X adımı
      bodyMM: {
        w: (b.maxX - b.minX) * MM + t,
        h: (b.maxY - b.minY) * MM + t,
        d: tubeMount ? Math.max(czmm, tb + tubeLength + tc) : dmm + tc,
      },
    };

    // Kapak/tüp kapağı baskı için ters çevrilir (düz yüzü tablada).
    const capTop = capParts.length ? bbox(capParts).maxZ : 0;
    const flipCap = () => capParts.map((m) => transform(m, (x, y, z) => [-x, y, capTop - z]));

    let meshes;
    if (opts.assembled) {
      // Önizleme her zaman monte edilmiş gövdeyi gösterir (düz panelde bile).
      meshes = [shellWall(), ...plateParts, ...capParts, ...preview];
    } else if (!flat) {
      const body = [shellWall(), ...plateParts];
      const cap = flipCap();
      const bb = bbox(body), cb = bbox(cap);
      const dx = bb.maxX - cb.minX + 10;
      meshes = [...body, ...cap.map((m) => translate(m, dx, 0, 0))];
      const all = bbox(meshes);
      info.fitsBed = fitsXY(bb.maxX - bb.minX, bb.maxY - bb.minY) && bb.maxZ <= bed.z;
      if (!fitsXY(bb.maxX - bb.minX, bb.maxY - bb.minY) || bb.maxZ > bed.z) {
        warnings.push(`Gövde (${(bb.maxX - bb.minX).toFixed(0)}×${(bb.maxY - bb.minY).toFixed(0)}×${bb.maxZ.toFixed(0)} mm) ${bedTxt} × ${bed.z} mm yazıcıya sığmıyor.`);
      } else if (!fitsXY(all.maxX - all.minX, all.maxY - all.minY)) {
        warnings.push('Not: gövde ve kapak aynı tablaya birlikte sığmıyor — dilimleyicide kapağı (ayrı obje) ikinci tablaya taşıyın.');
      }
    } else {
      // Düz yerleşim: paneller (+ ince katman), plaka (+ tutucu), kapak.
      // Raf yerleşimi: büyük parça önce, gerekirse 90° döndürülür; sığmayan
      // parça sonraki tablaya geçer. 1. tabla lamba ekseninde ortalanır
      // (önizlemedeki tabla), diğerleri +X yönünde yan yana dizilir.
      const pieces = flatPanels();
      pieces.push(plateParts);
      pieces.push(flipCap());
      const gap = 8;
      const rot90 = (group) => group.map((m) => transform(m, (x, y, z) => [-y, x, z]));
      const items = pieces.filter((g) => g.length).map((group) => {
        const gb = bbox(group);
        return { group, w: gb.maxX - gb.minX, h: gb.maxY - gb.minY };
      }).sort((a, b) => b.w * b.h - a.w * a.h);
      const beds = [];
      const newBed = () => { const bd = { shelves: [], items: [] }; beds.push(bd); return bd; };
      const tryBed = (bd, it) => {
        // Önce açık raflar (en az boşa giden yükseklik), yoksa yeni raf (en alçak yön).
        // Son raf, tabla boyu yetiyorsa yükselebilir.
        let best = null;
        bd.shelves.forEach((sh, i) => {
          const grow = i === bd.shelves.length - 1;
          [false, true].forEach((rot) => {
            const w = rot ? it.h : it.w, h = rot ? it.w : it.h;
            if (sh.x + w > bed.x || (h > sh.h && !(grow && sh.y + h <= bed.y))) return;
            const waste = Math.abs(sh.h - h);
            if (!best || waste < best.waste) best = { sh, rot, w, h, waste };
          });
        });
        if (best) { best.sh.h = Math.max(best.sh.h, best.h); return best; }
        const last = bd.shelves[bd.shelves.length - 1];
        const y0 = last ? last.y + last.h + gap : 0;
        [false, true].forEach((rot) => {
          const w = rot ? it.h : it.w, h = rot ? it.w : it.h;
          if (w > bed.x || y0 + h > bed.y) return;
          if (!best || h < best.h) best = { rot, w, h, y0 };
        });
        if (best) { best.sh = { x: 0, y: best.y0, h: best.h }; bd.shelves.push(best.sh); }
        return best;
      };
      let fitsAll = true;
      items.forEach((it) => {
        let spot = null, bd = null;
        for (const b0 of beds) { spot = tryBed(b0, it); if (spot) { bd = b0; break; } }
        if (!spot) { bd = newBed(); spot = tryBed(bd, it); }
        if (!spot) {
          // Boş tablaya da sığmıyor: kendi tablasına konur, uyarı verilir.
          fitsAll = false;
          warnings.push(`${it.group[0].name} (${it.w.toFixed(0)}×${it.h.toFixed(0)} mm) ${bedTxt} tablaya sığmıyor.`);
          spot = { sh: { x: 0, y: 0, h: it.h }, rot: false, w: it.w };
          bd.shelves.push(spot.sh);
        }
        bd.items.push({ group: spot.rot ? rot90(it.group) : it.group, x: spot.sh.x, y: spot.sh.y });
        spot.sh.x += spot.w + gap;
      });
      const pitch = bed.x + 20;
      meshes = [];
      beds.forEach((bd, k) => {
        // Tabla içinde ortala.
        const placed = bd.items.map((p) => ({ p, gb: bbox(p.group) }));
        const usedW = Math.max(...placed.map(({ p, gb }) => p.x + gb.maxX - gb.minX));
        const usedH = Math.max(...placed.map(({ p, gb }) => p.y + gb.maxY - gb.minY));
        const ox = k * pitch - bed.x / 2 + Math.max(0, (bed.x - usedW) / 2);
        const oy = -bed.y / 2 + Math.max(0, (bed.y - usedH) / 2);
        placed.forEach(({ p, gb }) => {
          p.group.forEach((m) => meshes.push(translate(m, ox + p.x - gb.minX, oy + p.y - gb.minY, -gb.minZ)));
        });
      });
      info.beds = beds.length;
      info.bedPitchMM = pitch;
      info.fitsBed = fitsAll && bbox(meshes).maxZ <= bed.z;
      if (beds.length > 1) {
        warnings.push(`Parçalar ${beds.length} tablaya dağıtıldı (tablada yan yana gösterilir) — dilimleyicide her tablayı ayrı basın.`);
      }
    }

    meshes.forEach((m) => { if (!m.previewOnly) info.triangles += m.indices.length / 3; });
    return { meshes, warnings, info };
  }

  // ---------- baskı fiziği doğrulaması ----------

  /**
   * Baskı düzenindeki parçaların fiziksel olarak basılabilir olduğunu doğrular:
   *  - Her mesh bağlantılı bileşenlere ayrılır (ortak köşe indeksleri).
   *  - Tablaya oturan bileşen: en alt noktası z ≈ 0 ve tabana bakan, z ≈ 0'da
   *    duran yüzeylerinin alanı > minContact mm² (gerçek temas, nokta değil).
   *  - Tablaya oturan bir bileşene değen (kesişen) bileşen de taşınır; dilimleyici
   *    çakışan katıları birleştirir. Değmeyen her bileşen havadadır → basılamaz.
   * Düz panelde panelin ana gövdesine bağlı olmayan bileşen tablada olsa da kopuktur (loose).
   * Dönen: { ok, parts, grounded, floating: [{ name, loose, minZ, size }], contactMM2, names (bileşen başına mesh adı) }
   */
  function validatePrint(meshes, opts) {
    const o = opts || {};
    const eps = o.eps || 0.05, minContact = o.minContact || 4, touch = o.touch || 0.05;
    const comps = [];
    const layered = new Set(meshes.filter((m) => /^panel-\d+-layer$/.test(m.name)).map((m) => m.name.replace(/-layer$/, '')));
    meshes.filter((m) => !m.previewOnly).forEach((m) => {
      const p = m.positions, ix = m.indices, nv = p.length / 3;
      // Aynı konumdaki köşeleri birleştir (extrude kapak/yan yüzleri ayrı köşe kullanır).
      const key = new Map(), vid = new Int32Array(nv);
      for (let i = 0; i < nv; i++) {
        const k = `${p[i * 3].toFixed(3)},${p[i * 3 + 1].toFixed(3)},${p[i * 3 + 2].toFixed(3)}`;
        if (!key.has(k)) key.set(k, key.size);
        vid[i] = key.get(k);
      }
      const parent = new Int32Array(key.size).map((_, i) => i);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      for (let t = 0; t < ix.length; t += 3) {
        const a = find(vid[ix[t]]), b = find(vid[ix[t + 1]]), c = find(vid[ix[t + 2]]);
        parent[b] = a; parent[find(c)] = a;
      }
      const byRoot = new Map();
      const boxOf = (r) => {
        if (!byRoot.has(r)) byRoot.set(r, { name: m.name, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], contact: 0 });
        return byRoot.get(r);
      };
      for (let i = 0; i < nv; i++) {
        const c = boxOf(find(vid[i]));
        for (let k = 0; k < 3; k++) {
          const v = p[i * 3 + k];
          if (v < c.min[k]) c.min[k] = v;
          if (v > c.max[k]) c.max[k] = v;
        }
      }
      // Temas alanı: üç köşesi de z ≈ 0 olan, aşağı bakan üçgenler.
      for (let t = 0; t < ix.length; t += 3) {
        const A = ix[t] * 3, B = ix[t + 1] * 3, C = ix[t + 2] * 3;
        if (p[A + 2] > eps || p[B + 2] > eps || p[C + 2] > eps) continue;
        const ux = p[B] - p[A], uy = p[B + 1] - p[A + 1], vx = p[C] - p[A], vy = p[C + 1] - p[A + 1];
        const nz = ux * vy - uy * vx;           // z bileşeni (2 × alan, işaretli)
        if (nz < 0) boxOf(find(vid[ix[t]])).contact += -nz / 2;
      }
      // Düz panel: panelin ana gövdesine bağlı olmayan parça tablaya otursa da
      // kopuktur (basılır ama panelden düşer). İnce destek katmanı varsa onu tutar.
      const own = [...byRoot.values()];
      if (/^panel-\d+$/.test(m.name) && own.length > 1 && !layered.has(m.name)) {
        let main = own[0];
        own.forEach((c) => { if (c.contact > main.contact) main = c; });
        own.forEach((c) => { if (c !== main) c.loose = true; });
      }
      own.forEach((c) => comps.push(c));
    });
    comps.forEach((c) => { c.grounded = !c.loose && c.min[2] <= eps && c.contact >= minContact; });
    // Tablaya oturana değen bileşen de taşınır (yinelemeli).
    const overlap = (a, b) => [0, 1, 2].every((k) => a.min[k] <= b.max[k] + touch && b.min[k] <= a.max[k] + touch);
    let changed = true;
    while (changed) {
      changed = false;
      comps.forEach((c) => {
        if (c.grounded || c.loose) return;
        if (comps.some((g) => g.grounded && g !== c && overlap(c, g))) { c.grounded = true; changed = true; }
      });
    }
    const floating = comps.filter((c) => !c.grounded).map((c) => ({
      name: c.name, loose: !!c.loose, minZ: c.min[2], size: [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]],
    }));
    const contactMM2 = comps.reduce((a, c) => a + c.contact, 0);
    return { ok: floating.length === 0, parts: comps.length, grounded: comps.length - floating.length, floating, contactMM2, names: comps.map((c) => c.name) };
  }

  // ---------- STL ----------

  function toBinarySTL(allMeshes, header) {
    const meshes = allMeshes.filter((m) => !m.previewOnly);
    let n = 0;
    meshes.forEach((m) => { n += m.indices.length / 3; });
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const h = (header || 'Shadow Box Designer').slice(0, 79);
    for (let i = 0; i < h.length; i++) dv.setUint8(i, h.charCodeAt(i) & 0x7f);
    dv.setUint32(80, n, true);
    let o = 84;
    meshes.forEach((m) => {
      const p = m.positions, ix = m.indices;
      for (let t = 0; t < ix.length; t += 3) {
        const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
        o += 12;
        [a, b, c].forEach((q) => {
          dv.setFloat32(o, p[q], true); dv.setFloat32(o + 4, p[q + 1], true); dv.setFloat32(o + 8, p[q + 2], true);
          o += 12;
        });
        o += 2;
      }
    });
    return buf;
  }

  global.ShellMesher = { buildLamp, toBinarySTL, bbox, validatePrint };
})(typeof window !== 'undefined' ? window : globalThis);
