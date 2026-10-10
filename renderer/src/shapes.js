/**
 * Lamp body cross-section library.
 *
 * Every shape is a closed, CCW polygon that is star-shaped around the light
 * axis (0,0): any ray from the axis crosses the outline exactly once. Smooth
 * shapes (circle, flower, rounded rect, heart) are just finely sampled. That
 * single representation drives the projection math, the wall mesher, and the
 * base plate / cap outlines, so adding a new shape is only a vertex generator.
 *
 * Units: centimetres (same as the shared sliders). The polygon is the wall's
 * mid-surface at z = 0; an optional taper scales it by (1 + k·z) with depth.
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;

  // ---------- vertex generators ----------

  function regularPolygon(n, acrossFlats, rotation) {
    const apothem = acrossFlats / 2;
    const R = apothem / Math.cos(Math.PI / n);
    const pts = [];
    // Default rotation puts a flat edge at the bottom (sits nicely on a shelf / wall).
    const rot = rotation != null ? rotation : -Math.PI / 2 + Math.PI / n;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * TAU;
      pts.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    return pts;
  }

  function rectangle(W, H) {
    return [[W / 2, -H / 2], [W / 2, H / 2], [-W / 2, H / 2], [-W / 2, -H / 2]];
  }

  function sampled(n, radiusFn) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const r = radiusFn(a);
      pts.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  }

  function superellipse(W, H, n) {
    const a = W / 2, b = H / 2;
    return sampled(360, (phi) => {
      const c = Math.abs(Math.cos(phi)) / a;
      const s = Math.abs(Math.sin(phi)) / b;
      return Math.pow(Math.pow(c, n) + Math.pow(s, n), -1 / n);
    });
  }

  function star(points, outerD, innerRatio) {
    const R = outerD / 2, r = R * innerRatio;
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const a = Math.PI / 2 + (i / (points * 2)) * TAU;
      const rr = i % 2 === 0 ? R : r;
      pts.push([rr * Math.cos(a), rr * Math.sin(a)]);
    }
    return pts;
  }

  function flower(D, petals, amp) {
    const R = D / 2 / (1 + amp);
    return sampled(Math.max(240, petals * 48), (phi) => R * (1 + amp * Math.cos(petals * (phi - Math.PI / 2))));
  }

  function heart(W) {
    // Classic parametric heart, re-centred so the light axis sits inside the
    // "belly" where the outline is star-shaped, then scaled to width W.
    const raw = [];
    const n = 400;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      const x = 16 * Math.pow(Math.sin(t), 3);
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
      raw.push([x, y + 2]);
    }
    const s = W / 32;
    // Parametric order is clockwise; reverse to CCW.
    return raw.map(([x, y]) => [x * s, y * s]).reverse();
  }

  // ---------- shape catalogue ----------
  // `params` keys map onto UI controls: W (width / diameter), H (height),
  // N (sides / points / petals), A (amplitude / inner ratio).

  const CATALOG = {
    square:      { label: 'Kare',          faceted: true,  params: ['W'],           build: (p) => rectangle(p.W, p.W) },
    rect:        { label: 'Dikdörtgen',       faceted: true,  params: ['W', 'H'],      build: (p) => rectangle(p.W, p.H) },
    roundedRect: { label: 'Yuvarlak köşeli',    faceted: false, params: ['W', 'H'],      build: (p) => superellipse(p.W, p.H, 4) },
    circle:      { label: 'Silindir',        faceted: false, params: ['W'],           build: (p) => sampled(360, () => p.W / 2) },
    polygon:     { label: 'Çokgen',         faceted: true,  params: ['W', 'N'],      build: (p) => regularPolygon(Math.max(3, Math.round(p.N)), p.W) },
    star:        { label: 'Yıldız',            faceted: false, params: ['W', 'N', 'A'], build: (p) => star(Math.max(3, Math.round(p.N)), p.W, p.A) },
    flower:      { label: 'Çiçek',          faceted: false, params: ['W', 'N', 'A'], build: (p) => flower(p.W, Math.max(3, Math.round(p.N)), Math.min(0.3, p.A * 0.3)) },
    heart:       { label: 'Kalp',           faceted: false, params: ['W'],           build: (p) => heart(p.W) },
  };

  // ---------- polygon helpers ----------

  function signedArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  /**
   * Offset a CCW polygon by `dist` along its outward normals (negative = inward),
   * with mitred vertices (miter length clamped so spikes don't explode).
   */
  function offsetPolygon(pts, dist) {
    const n = pts.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const n0 = edgeNormal(p0, p1), n1 = edgeNormal(p1, p2);
      let mx = n0[0] + n1[0], my = n0[1] + n1[1];
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      const cos = Math.max(0.35, mx * n1[0] + my * n1[1]);
      const k = dist / cos;
      out.push([p1[0] + mx * k, p1[1] + my * k]);
    }
    return keepStarShaped(out);
  }

  // Offsetting a concave corner (heart cusp, star inner points) folds a small
  // loop back on itself. The outline must stay star-shaped around the axis, so
  // drop any vertex whose polar angle doesn't advance, plus near-duplicates.
  function keepStarShaped(pts) {
    const n = pts.length;
    const angOf = (p) => Math.atan2(p[1], p[0]);
    // Start from the vertex farthest from the axis (never part of a fold).
    let start = 0, best = -1;
    pts.forEach((p, i) => { const r = Math.hypot(p[0], p[1]); if (r > best) { best = r; start = i; } });
    const out = [pts[start]];
    const a0 = angOf(pts[start]);
    let last = 0;
    for (let j = 1; j < n; j++) {
      const p = pts[(start + j) % n];
      let a = angOf(p) - a0;
      while (a < 0) a += TAU;
      while (a >= TAU) a -= TAU;
      const q = out[out.length - 1];
      if (a > last + 1e-6 && a < TAU - 1e-6 && Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-4) {
        out.push(p);
        last = a;
      }
    }
    return out;
  }

  function edgeNormal(a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l]; // outward for CCW polygons
  }

  /**
   * Build the runtime shape object.
   * spec: { kind, W, H, N, A, taper } where taper = fractional radius change
   * from the wall side (z = 0) to the front (z = d). depth is d in cm.
   */
  function make(spec, depth) {
    const entry = CATALOG[spec.kind] || CATALOG.square;
    let pts = entry.build(spec);
    if (signedArea(pts) < 0) pts = pts.slice().reverse();
    const n = pts.length;

    // Angles of vertices (monotone CCW, unwrapped from vertex 0).
    const ang = new Float64Array(n + 1);
    let prev = Math.atan2(pts[0][1], pts[0][0]);
    ang[0] = prev;
    for (let i = 1; i <= n; i++) {
      const p = pts[i % n];
      let a = Math.atan2(p[1], p[0]);
      while (a <= prev) a += TAU;
      while (a - prev > Math.PI) a -= TAU;
      ang[i] = a;
      prev = a;
    }
    const starShaped = Math.abs(ang[n] - ang[0] - TAU) < 1e-6;

    // Cumulative arc length.
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      cum[i + 1] = cum[i] + Math.hypot(q[0] - p[0], q[1] - p[1]);
    }
    const perimeter = cum[n];

    // Per-vertex mitred normals (for wall offsetting).
    const vnorm = [];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const n0 = edgeNormal(p0, p1), n1 = edgeNormal(p1, p2);
      let mx = n0[0] + n1[0], my = n0[1] + n1[1];
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml; my /= ml;
      const cos = Math.max(0.35, mx * n1[0] + my * n1[1]);
      vnorm.push([mx / cos, my / cos]); // miter-scaled: offset by d·vnorm keeps d from both edges
    }

    const k = depth > 0 ? (spec.taper || 0) / depth : 0;

    function segmentForAngle(phi) {
      let a = phi;
      while (a < ang[0]) a += TAU;
      while (a >= ang[0] + TAU) a -= TAU;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ang[mid] <= a) lo = mid; else hi = mid - 1;
      }
      return lo;
    }

    /** Ray from axis at angle phi → {r, s, i, f} on the z = 0 outline. */
    function hitAngle(phi) {
      const i = segmentForAngle(phi);
      const p = pts[i], q = pts[(i + 1) % n];
      const dx = Math.cos(phi), dy = Math.sin(phi);
      const ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      let r, f;
      if (Math.abs(den) < 1e-12) {
        r = Math.hypot(p[0], p[1]); f = 0;
      } else {
        r = (p[0] * ey - p[1] * ex) / den;
        f = (p[0] * dy - p[1] * dx) / den;
        f = Math.max(0, Math.min(1, f));
      }
      const segLen = cum[i + 1] - cum[i];
      return { r, s: cum[i] + f * segLen, i, f };
    }

    /** Arc length s → point + segment index on the z = 0 outline. */
    function pointAt(s) {
      let ss = s % perimeter;
      if (ss < 0) ss += perimeter;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (cum[mid] <= ss) lo = mid; else hi = mid - 1;
      }
      const segLen = cum[lo + 1] - cum[lo] || 1;
      const f = (ss - cum[lo]) / segLen;
      const p = pts[lo], q = pts[(lo + 1) % n];
      return { x: p[0] + (q[0] - p[0]) * f, y: p[1] + (q[1] - p[1]) * f, i: lo, f };
    }

    /** Outward normal at arc length s (mitred at vertices, flat along edges). */
    function normalAt(s) {
      const pt = pointAt(s);
      const segLen = cum[pt.i + 1] - cum[pt.i];
      const eps = 1e-9 * Math.max(1, perimeter);
      if (pt.f * segLen < eps) return vnorm[pt.i];
      if ((1 - pt.f) * segLen < eps) return vnorm[(pt.i + 1) % n];
      return edgeNormal(pts[pt.i], pts[(pt.i + 1) % n]);
    }

    /** Arc-length positions of every vertex (wall-grid columns snap to these). */
    function vertexS() {
      return Array.from(cum.subarray(0, n));
    }

    function scaleAt(z) { return 1 + k * z; }

    return {
      kind: spec.kind,
      label: entry.label,
      faceted: entry.faceted,
      starShaped,
      pts,
      perimeter,
      k,
      depth,
      hitAngle,
      pointAt,
      normalAt,
      vertexS,
      scaleAt,
      offset: (dist) => offsetPolygon(pts, dist),
      bounds() {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        pts.forEach(([x, y]) => {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        });
        return { minX, minY, maxX, maxY };
      },
    };
  }

  /**
   * Suggest a body shape from a silhouette.
   * `isDark(x, y)` → true for silhouette pixels on an n×n grid.
   * Returns { kind, W, H, N, A, reason }.
   */
  function autoSuggest(isDark, n, baseSize) {
    let minX = n, minY = n, maxX = -1, maxY = -1, area = 0;
    let sx = 0, sy = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (!isDark(x, y)) continue;
        area++;
        sx += x; sy += y;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    const size = baseSize || 15;
    if (!area) return { kind: 'circle', W: size, H: size, N: 6, A: 0.5, reason: 'siluet bulunamadı' };
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const aspect = bh / bw;
    const fill = area / (bw * bh);
    // Compactness: area vs. circle of the bounding diameter.
    const circ = area / (Math.PI * Math.pow(Math.max(bw, bh) / 2, 2));

    if (aspect > 1.35) {
      const ratio = Math.min(2, aspect);
      return { kind: 'rect', W: Math.round(size / Math.sqrt(ratio)), H: Math.round(size * Math.sqrt(ratio)), N: 6, A: 0.5,
        reason: `uzun siluet (boy/en ≈ ${aspect.toFixed(2)}) → dikey dikdörtgen` };
    }
    if (aspect < 1 / 1.35) {
      const ratio = Math.min(2, 1 / aspect);
      return { kind: 'rect', W: Math.round(size * Math.sqrt(ratio)), H: Math.round(size / Math.sqrt(ratio)), N: 6, A: 0.5,
        reason: `geniş siluet (en/boy ≈ ${(1 / aspect).toFixed(2)}) → yatay dikdörtgen` };
    }
    if (circ > 0.62) {
      return { kind: 'circle', W: size, H: size, N: 6, A: 0.5, reason: 'yuvarlak, toplu siluet → silindir' };
    }
    if (fill > 0.7) {
      return { kind: 'square', W: size, H: size, N: 4, A: 0.5, reason: 'köşeli siluet → kare' };
    }
    return { kind: 'polygon', W: size, H: size, N: 6, A: 0.5, reason: 'düzensiz siluet → altıgen' };
  }

  global.Shapes = { CATALOG, make, autoSuggest };
})(typeof window !== 'undefined' ? window : globalThis);
