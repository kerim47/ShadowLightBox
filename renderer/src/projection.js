/**
 * Shadow box projection math.
 *
 * Coordinate system:
 *   - Wall (projection plane) is at z = 0.
 *   - Box occupies x ∈ [-W/2, W/2], y ∈ [-H/2, H/2], z ∈ [0, d].
 *   - Light source at L = (0, 0, cz). Default cz = d/2 (geometric center).
 *   - Lid is parallel to the wall at z = cz + h (forward of light).
 *
 * Box has no back face — the wall itself seals the back. Light reaches
 * the wall ONLY through cutouts in the four side walls (top/bot/left/right).
 *
 * For a target wall point (X, Y) outside the box footprint, we choose
 * the side wall through which the ray from L exits, then back-solve for
 * the cutout coordinate (u, z_cut) on that wall.
 *
 * `dim` is { W, H, d, cz }. `cz` defaults to d/2 if omitted.
 */

(function (global) {
  'use strict';

  function lightZ(dim) {
    return dim.cz != null ? dim.cz : dim.d / 2;
  }

  function primaryFace(X, Y, W, H) {
    if (Math.abs(X) <= W / 2 && Math.abs(Y) <= H / 2) return null;
    const ax = Math.abs(X) - W / 2;
    const ay = Math.abs(Y) - H / 2;
    if (ax > ay) return X > 0 ? 'right' : 'left';
    return Y > 0 ? 'top' : 'bot';
  }

  function inverseMap(X, Y, dim, marginZ) {
    const face = primaryFace(X, Y, dim.W, dim.H);
    if (!face) return null;

    const cz = lightZ(dim);
    let t, u;

    if (face === 'top' || face === 'bot') {
      const Hf = face === 'top' ? dim.H / 2 : -dim.H / 2;
      t = Hf / Y;
      if (t <= 0 || t > 1) return null;
      u = X * t;
      if (Math.abs(u) > dim.W / 2) return null;
    } else {
      const Wf = face === 'right' ? dim.W / 2 : -dim.W / 2;
      t = Wf / X;
      if (t <= 0 || t > 1) return null;
      u = Y * t;
      if (Math.abs(u) > dim.H / 2) return null;
    }

    const z = cz * (1 - t);
    if (z < 0 || z > cz - marginZ) return null;
    return { face, u, z };
  }

  // ---------- generalized shell (any star-shaped cross-section, optional taper) ----------
  //
  // The wall is unrolled into (s, z): s = arc length along the z = 0 outline,
  // z = distance from the projection wall. At depth z the outline is scaled by
  // (1 + k·z). A ray from L = (0,0,cz) through the wall point at (s, z) lands on
  // the projection wall at radius ρ = r0·(1 + k·z)·cz / (cz − z).
  // Inverting for z (closed form, linear taper):  z = (ρ − r0) / (ρ/cz + r0·k).

  /** Wall point (s, z) → projection-wall point {X, Y}, or null if it points forward. */
  function forwardShell(s, z, shape, cz) {
    if (z >= cz) return null;
    const p = shape.pointAt(s);
    const m = shape.scaleAt(z) * cz / (cz - z);
    return { X: p.x * m, Y: p.y * m };
  }

  /**
   * Projection-wall point (X, Y) → wall coordinate {s, z}.
   * Returns null inside the lamp footprint; {s, z, blocked: true} when the
   * required z falls outside the usable band [0, cz − margin].
   */
  function inverseShell(X, Y, shape, cz, margin) {
    const rho = Math.hypot(X, Y);
    const hit = shape.hitAngle(Math.atan2(Y, X));
    if (rho <= hit.r) return null;
    const den = rho / cz + hit.r * shape.k;
    if (den <= 0) return { s: hit.s, z: Infinity, blocked: true };
    const z = (rho - hit.r) / den;
    const blocked = !(z >= 0 && z <= cz - (margin || 0));
    return { s: hit.s, z, blocked };
  }

  global.Projection = {
    inverseMap,      // eski kutu formülü — yalnızca testte genel formülle karşılaştırma için
    forwardShell,
    inverseShell,
  };
})(typeof window !== 'undefined' ? window : globalThis);
