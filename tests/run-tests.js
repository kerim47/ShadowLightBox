/**
 * Geometri çekirdeği testleri (tarayıcı/Electron gerekmez): `npm test`
 *
 *  1. İzdüşüm: her şekil + daralma için ileri ∘ ters = özdeşlik; kutu durumunda
 *     eski kutu formülüyle birebir aynı sonuç.
 *  2. Mesh: bütün şekiller × baskı modları × montajlar için her parça su geçirmez
 *     (her kenar tam 2 üçgende, zıt yönlü), dışa dönük (pozitif hacim) ve baskı
 *     düzeninde havada parça yok (her bileşen tablaya oturur veya oturana değer).
 *  3. Yapısal: kopuk parça köprülenir, ön çember bağlantısı tespit edilir,
 *     desteksiz baskı sarkmaları azaltır, pah 45°, askı deliği yer bulur.
 *  4. Görsel Dönüştürücü çekirdeği (Stencil): havada kalan parça hedefte
 *     köprülenir, ince çizgi kalınlaştırılır, konturlar kapalıdır.
 *  5. Dışa aktarma (STL, 3MF, OBJ, FBX, PLY, GLB): her dosya three.js'in kendi
 *     yükleyicisiyle (3MF: zip + XML, GLB: yapı) hatasız açılır, üçgen sayısı
 *     tutar, birleştirilmiş köşelerle indekslere göre de su geçirmezdir.
 *
 * Renderer modülleri IIFE + global (window/globalThis) desenini kullanır;
 * burada globalThis üzerine yüklenir. THREE yalnızca plaka üçgenlemesi için.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
globalThis.THREE = require(path.join(ROOT, 'node_modules/three'));
['shapes', 'projection', 'wall_field', 'shell_mesher', 'stencil', 'exporters'].forEach((f) => require(path.join(ROOT, 'renderer/src', f + '.js')));
const { Shapes, Projection, WallField, ShellMesher, Stencil, ModelExport } = globalThis;

let failures = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  ok   ' + name); }
  else { failures++; console.log('  FAIL ' + name + (detail ? '  → ' + detail : '')); }
}

const KINDS = ['square', 'rect', 'roundedRect', 'circle', 'polygon', 'star', 'flower', 'heart'];
const D = 6, CZ = 5.4, MARGIN = 0.3;

// İnsan silüeti: gövde (lambanın arkası), ayrı kafa, kalkık kol.
function person(X, Y) {
  const body = ((X / 22) ** 2 + ((Y + 5) / 45) ** 2) < 1;
  const head = (X ** 2 + (Y - 52) ** 2) < 12 ** 2;
  const arm = Math.abs(Y - 15 + 0.6 * X) < 4 && X > 0 && X < 55;
  return (body || head || arm) ? 0 : 1;
}

function meshCheck(m) {
  const p = m.positions, ix = m.indices;
  const key = (i) => `${p[i * 3].toFixed(4)},${p[i * 3 + 1].toFixed(4)},${p[i * 3 + 2].toFixed(4)}`;
  const id = new Map(); const vid = new Int32Array(p.length / 3);
  for (let i = 0; i < vid.length; i++) { const k = key(i); if (!id.has(k)) id.set(k, id.size); vid[i] = id.get(k); }
  const dir = new Map(); let vol = 0;
  for (let t = 0; t < ix.length; t += 3) {
    const v = [vid[ix[t]], vid[ix[t + 1]], vid[ix[t + 2]]];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let k = 0; k < 3; k++) { const e = v[k] + '>' + v[(k + 1) % 3]; dir.set(e, (dir.get(e) || 0) + 1); }
    const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
    vol += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
  }
  let bad = 0;
  for (const [e, n] of dir) { const [a, b] = e.split('>'); if (n !== 1 || dir.get(b + '>' + a) !== 1) bad++; }
  return { bad, vol };
}

console.log('\n1) İzdüşüm');
for (const taper of [0, 0.3, -0.2]) for (const kind of KINDS) {
  const sh = Shapes.make({ kind, W: 15, H: 20, N: 6, A: 0.5, taper }, D);
  let maxErr = 0;
  for (let i = 0; i < 400; i++) {
    const s = Math.random() * sh.perimeter, z = Math.random() * (CZ - 0.3);
    const f = Projection.forwardShell(s, z, sh, CZ);
    const inv = Projection.inverseShell(f.X, f.Y, sh, CZ, 0.1);
    if (!inv) { maxErr = Infinity; break; }
    let ds = Math.abs(inv.s - s); ds = Math.min(ds, sh.perimeter - ds);
    maxErr = Math.max(maxErr, ds, Math.abs(inv.z - z));
  }
  check(`${kind} taper=${taper}: yıldız biçimli + ileri∘ters`, sh.starShaped && maxErr < 1e-6, `hata ${maxErr}`);
}
{
  const W = 15, H = 12, cz = 4.8, sh = Shapes.make({ kind: 'rect', W, H }, 6);
  let maxDz = 0;
  for (let i = 0; i < 3000; i++) {
    const X = (Math.random() - 0.5) * 100, Y = (Math.random() - 0.5) * 100;
    const a = Projection.inverseMap(X, Y, { W, H, d: 6, cz }, 0.1), b = Projection.inverseShell(X, Y, sh, cz, 0.1);
    if (a && b && !b.blocked) maxDz = Math.max(maxDz, Math.abs(a.z - b.z));
  }
  check('kutu: yeni formül = eski kutu formülü', maxDz < 1e-9, `|dz| ${maxDz}`);
}

console.log('\n2) Su geçirmez mesh');
const cases = [];
KINDS.forEach((kind) => cases.push({ kind, mode: 'onepiece', mount: 'tube', taper: 0 }));
KINDS.forEach((kind) => cases.push({ kind, mode: 'onepiece', mount: 'cap', taper: 0, ribs: 3 }));
['square', 'rect', 'polygon'].forEach((kind) => cases.push({ kind, mode: 'flat', mount: 'tube', taper: 0, layer: true }));
['square', 'polygon'].forEach((kind) => cases.push({ kind, mode: 'flat', mount: 'cap', taper: -0.2, ribs: 2, chamfer: false }));
cases.push({ kind: 'circle', mode: 'onepiece', mount: 'tube', taper: 0.3 });
for (const cs of cases) {
  const shape = Shapes.make({ kind: cs.kind, W: 15, H: 20, N: 6, A: 0.5, taper: cs.taper }, D);
  const field = WallField.compute({
    shape, d: D, cz: CZ, margin: MARGIN, sample: person, bottomBand: 0.35, ribs: cs.ribs || 0, ribWidth: 0.12,
    cornerPosts: cs.mode === 'flat' && cs.mount === 'cap', minHole: 0.02, maxCells: 90000,
    openTop: cs.mount === 'tube', keepIslands: !!cs.layer, supportFree: cs.mode !== 'flat',
  });
  const lamp = ShellMesher.buildLamp(field, { mode: cs.mode, mount: cs.mount, thickness: 1.6, supportLayer: !!cs.layer, chamfer: cs.chamfer !== false });
  const broken = lamp.meshes.filter((m) => !m.previewOnly).map((m) => ({ name: m.name, ...meshCheck(m) })).filter((r) => r.bad || r.vol <= 0);
  // Fizik: baskı düzeninde her parça tablaya oturur ya da oturan parçaya değer (havada parça yok).
  const phys = ShellMesher.validatePrint(lamp.meshes);
  check(`${cs.kind} ${cs.mode} ${cs.mount}${cs.layer ? ' +katman' : ''} taper=${cs.taper}: su geçirmez + havada parça yok`,
    !broken.length && phys.ok, JSON.stringify(broken) + ' havada: ' + phys.floating.map((x) => x.name).join(','));
}

console.log('\n3) Yapısal kurallar');
{
  const sample = (X, Y) => (((X / 20) ** 2 + ((Y + 5) / 30) ** 2 < 1) || (X ** 2 + (Y - 42) ** 2 < 81)) ? 0 : 1;
  const shape = Shapes.make({ kind: 'rect', W: 12, H: 19 }, D);
  const f = WallField.compute({ shape, d: D, cz: CZ, margin: MARGIN, sample, bottomBand: 0.35, openTop: true, ribWidth: 0.12 });
  const inv = Projection.inverseShell(0, 42, shape, CZ, MARGIN);
  check('ayrı kafa köprülenir ve gölgede kalır', f.stats.bridges >= 1 && WallField.sampleField(f, inv.s, inv.z) <= 0.5);
  const f0 = WallField.compute({ shape, d: D, cz: CZ, margin: MARGIN, sample, bottomBand: 0.35, ribs: 0 });
  const f3 = WallField.compute({ shape, d: D, cz: CZ, margin: MARGIN, sample, bottomBand: 0.35, ribs: 3 });
  check('kapak montajı: kolon yoksa ön çember "havada" uyarısı', f0.stats.rimFloating === true && f3.stats.rimFloating === false);
}
{
  const sq = Shapes.make({ kind: 'square', W: 15 }, D);
  const f = WallField.compute({ shape: sq, d: D, cz: CZ, margin: MARGIN, sample: () => 0, openTop: true });
  const lamp = ShellMesher.buildLamp(f, { mode: 'flat', mount: 'tube', thickness: 1.6, chamfer: true });
  const p = lamp.meshes.find((m) => m.name === 'panel-1').positions;
  let inMin = Infinity, inMax = -Infinity, outMin = Infinity, outMax = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    if (p[i + 2] < 0.01) { inMin = Math.min(inMin, p[i]); inMax = Math.max(inMax, p[i]); }
    if (p[i + 2] > 1.59) { outMin = Math.min(outMin, p[i]); outMax = Math.max(outMax, p[i]); }
  }
  const diff = (outMax - outMin) - (inMax - inMin);
  check('düz panel kenarı 45° pahlı (dış − iç = 2 × kalınlık)', Math.abs(diff - 3.2) < 0.05, `fark ${diff.toFixed(2)} mm`);
  const t = ShellMesher.buildLamp(f, { mount: 'tube', tubeOD: 40 });
  check('tüp montajı: tüp boyu hesaplanır, kapak parçaları var', t.info.tubeLengthMM > 40 && t.meshes.some((m) => m.name === 'tube-cap-post'));
}
{
  // Gövdeden yukarı uzanan çubuk + ucunda sabit uzaklıkta yay ("T"): yay duvar
  // şeridinde yatay bir banttır ve çubuktan iki yana uzun çıkıntı yapar → çatı gerekir.
  const sample = (X, Y) => {
    const rho = Math.hypot(X, Y), ang = Math.atan2(Y, X);
    const body = ((X / 18) ** 2 + ((Y + 5) / 30) ** 2) < 1;
    const spoke = Math.abs(X) < 2.5 && Y > 0 && Y < 44;
    const bar = rho > 40 && rho < 44 && Math.abs(ang - Math.PI / 2) < 0.45;
    return (body || spoke || bar) ? 0 : 1;
  };
  const shape = Shapes.make({ kind: 'rect', W: 12, H: 19 }, D);
  const off = WallField.compute({ shape, d: D, cz: CZ, margin: MARGIN, sample, bottomBand: 0.35, openTop: true, supportFree: false });
  const on = WallField.compute({ shape, d: D, cz: CZ, margin: MARGIN, sample, bottomBand: 0.35, openTop: true, supportFree: true });
  check('desteksiz baskı uzun çıkıntının altına çatı ekler', (on.stats.roofArea || 0) > 0.05 && !off.stats.roofArea, `çatı ${(on.stats.roofArea || 0).toFixed(3)} cm²`);
}
{
  let ok = true;
  for (const kind of ['circle', 'square', 'rect', 'star']) for (const mount of ['tube', 'cap']) {
    const shape = Shapes.make({ kind, W: 12, H: 19, N: 6, A: 0.5 }, D);
    const f = WallField.compute({ shape, d: D, cz: CZ, margin: MARGIN, sample: () => 0, openTop: mount === 'tube' });
    if (ShellMesher.buildLamp(f, { mount }).warnings.some((w) => /Askı/.test(w))) ok = false;
  }
  check('askı deliği yaygın şekillerde yer bulur', ok);
}

{
  // Görsel Dönüştürücü: hedef (S²) → açılmış duvar analizi → düzeltme hedefe geri yazılır.
  const S = 512, R = 60;
  const shape = Shapes.make({ kind: 'square', W: 15, H: 15 }, D);
  const id = (x, y) => [x, y];
  const map = Stencil.buildPrintMap({ shape, cz: CZ, margin: MARGIN, R, zb: 0.35, openTop: true, toTarget: id, toWall: id }, S, Projection);
  const mask = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const X = ((i + 0.5) / S - 0.5) * 2 * R, Y = (0.5 - (j + 0.5) / S) * 2 * R;
    const body = (X / 22) ** 2 + ((Y + 5) / 40) ** 2 < 1;
    const head = X ** 2 + (Y - 50) ** 2 < 36;                      // gövdeden ayrı: havada kalır
    const line = Math.abs(Y + 30) < 0.15 && X > -50 && X < -24;    // duvarda ~0,1 mm: basılamaz, ayrı
    mask[j * S + i] = body || head || line ? 1 : 0;
  }
  const opt = { outsideLit: true, minLineMm: 0.8, minGapMm: 0.6, bridgeMm: 1.2, thin: 'thicken', gaps: 'close', floating: 'bridge' };
  const a = Stencil.analyzePrint(mask, map, opt);
  check('dönüştürücü: havada kalan parçaları bulur ve köprüler', a.stats.floating >= 2 && a.stats.bridges === a.stats.floating, `yüzen ${a.stats.floating}, köprü ${a.stats.bridges}`);
  check('dönüştürücü: basılamayacak ince çizgiyi bulur', a.stats.thinLineMm2 > 0, `${a.stats.thinLineMm2.toFixed(2)} mm²`);
  const b = Stencil.analyzePrint(a.mask, map, Object.assign({}, opt, { thin: 'keep', gaps: 'keep', floating: 'keep' }));
  check('dönüştürücü: düzeltilmiş şablonda yüzen parça ve ince çizgi kalmaz', b.stats.floating === 0 && b.stats.thinLineMm2 < 0.5,
    `yüzen ${b.stats.floating}, ince ${b.stats.thinLineMm2.toFixed(2)} mm²`);
  const comps = Stencil.components(a.mask, S, S, 1);
  check('dönüştürücü: köprülü şablon tek parça', comps.sizes.filter((n) => n > 4).length === 1, `${comps.sizes.length} parça`);
  // Konturlar: her döngü kapalı, ardışık noktalar komşu (yarım piksel adımlar), çift-tek dolgu alanı maskeyle aynı.
  const loops = Stencil.trace(a.mask, S, S);
  let closed = true, area = 0;
  loops.forEach((lp) => {
    const n = lp.length / 2;
    for (let k = 0; k < n; k++) {
      const x0 = lp[k * 2], y0 = lp[k * 2 + 1], x1 = lp[((k + 1) % n) * 2], y1 = lp[((k + 1) % n) * 2 + 1];
      if (Math.abs(x1 - x0) > 1 || Math.abs(y1 - y0) > 1) closed = false;
      area += x0 * y1 - x1 * y0;
    }
  });
  let px = 0;
  for (let i = 0; i < S * S; i++) px += a.mask[i];
  // Kesik köşeler nedeniyle kontur alanı piksel sayısından biraz küçüktür (sınır başına ≤ ½ piksel).
  check('dönüştürücü: konturlar kapalı ve alanı maskeyle uyumlu', closed && Math.abs(Math.abs(area / 2) - px) / px < 0.03,
    `kontur ${Math.abs(area / 2).toFixed(0)} px², maske ${px} px²`);
  const pd = Stencil.pathData(loops.map((l) => Stencil.simplify(l, 0.7)), { smooth: 0.8 });
  check('dönüştürücü: SVG yolu üretilir', /^M[\d.]+ [\d.]+C/.test(pd.d) && pd.paths === loops.length && /<svg[^>]+viewBox="0 0 512 512"/.test(Stencil.toSVG(pd.d, S, { sizeCm: 120 })));
}

{
  // Işıktan uzak kenar (büyütme ~6×): keskin hedef doğrudan örneklenince kenar
  // merdiven gibi basamaklanır; işaretli uzaklık örnekleyicisiyle gerçek çembere oturur.
  const N = 1024, R = 60, data = new Uint8ClampedArray(N * N * 4);
  const disk = (X, Y) => Math.hypot(X + 12, Y) < 34;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    data[(j * N + i) * 4] = disk(((i + 0.5) / N - 0.5) * 2 * R, (0.5 - (j + 0.5) / N) * 2 * R) ? 255 : 0;
  }
  const shape = Shapes.make({ kind: 'circle', W: 15 }, D);
  const f = WallField.compute({ shape, d: D, cz: CZ, margin: MARGIN, sample: WallField.smoothSampler(data, N, R, 0), bottomBand: 0.35, openTop: true });
  let worst = 0;
  for (let a = 150; a <= 210; a += 0.5) {
    const cx = Math.cos(a * Math.PI / 180), cy = Math.sin(a * Math.PI / 180);
    const b = 12 * cx, rTrue = -b + Math.sqrt(b * b - (144 - 34 * 34));
    let rho = 30;
    for (; rho < 55; rho += 0.02) {
      const inv = Projection.inverseShell(rho * cx, rho * cy, shape, CZ, 0.03);
      if (!inv || inv.blocked || WallField.sampleField(f, inv.s, inv.z) <= 0.5) break;
    }
    worst = Math.max(worst, Math.abs(rho - rTrue));
  }
  check('uzak kenar pürüzsüz: gölge kenarı gerçek çemberden < 2 mm sapar (merdiven yok)', worst < 0.2, `${(worst * 10).toFixed(1)} mm`);
}

console.log('\n5) Dışa aktarma biçimleri');
{
  // Uygulamadaki yükleyiciler (examples/js, THREE global'ine eklenir).
  globalThis.THREE = Object.assign({}, globalThis.THREE);
  const fflate = require(path.join(ROOT, 'node_modules/three/examples/js/libs/fflate.min.js'));
  ['curves/NURBSUtils', 'curves/NURBSCurve', 'loaders/STLLoader', 'loaders/OBJLoader', 'loaders/FBXLoader', 'loaders/PLYLoader']
    .forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'node_modules/three/examples/js', f + '.js'), 'utf8')));
  const T = globalThis.THREE;
  const geoms = (obj) => {
    const out = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, pos = g.attributes.position.array;
      out.push({ positions: pos, indices: g.index ? g.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i) });
    });
    return out;
  };
  const tris = (gs) => gs.reduce((a, g) => a + g.indices.length / 3, 0);
  // Katı indeks kontrolü: her yönlü kenar tam bir kez ve tersiyle eşli.
  const indexManifold = (m) => {
    const ix = m.indices, dir = new Set();
    for (let t = 0; t < ix.length; t += 3) for (let k = 0; k < 3; k++) {
      const e = ix[t + k] + '>' + ix[t + (k + 1) % 3];
      if (dir.has(e)) return false;
      dir.add(e);
    }
    for (const e of dir) { const [a, b] = e.split('>'); if (!dir.has(b + '>' + a)) return false; }
    return true;
  };
  const lampCases = [
    { kind: 'star', mode: 'onepiece', mount: 'tube' },
    { kind: 'square', mode: 'flat', mount: 'cap', ribs: 2 },
  ];
  for (const cs of lampCases) {
    const shape = Shapes.make({ kind: cs.kind, W: 15, H: 20, N: 6, A: 0.5 }, D);
    const field = WallField.compute({
      shape, d: D, cz: CZ, margin: MARGIN, sample: person, bottomBand: 0.35, ribs: cs.ribs || 0, ribWidth: 0.12,
      cornerPosts: cs.mode === 'flat' && cs.mount === 'cap', minHole: 0.02, maxCells: 30000, openTop: cs.mount === 'tube',
    });
    const lamp = ShellMesher.buildLamp(field, { mode: cs.mode, mount: cs.mount, thickness: 1.6 });
    // Işık parçaları hariç (varsayılan dışa aktarma): yalnızca duvar + taban kalır.
    const bodyOnly = lamp.meshes.filter((m) => !m.previewOnly && !ModelExport.isLightPart(m)).map((m) => m.name);
    check(`${cs.kind} ${cs.mode} ${cs.mount}: ışık parçaları ayrılır (kalan: ${bodyOnly.filter((n, i, a) => a.indexOf(n) === i).join(', ')})`,
      bodyOnly.length > 0 && bodyOnly.every((n) => /^(shell|panel-\d+|base-plate|layer)/.test(n)) && bodyOnly.length < lamp.meshes.filter((m) => !m.previewOnly).length);
    const parts = lamp.meshes.filter((m) => !m.previewOnly).map(ModelExport.weld);
    const want = tris(parts);
    const tag = `${cs.kind} ${cs.mode} ${cs.mount}`;
    check(`${tag}: birleştirilmiş parçalar indekslere göre su geçirmez`, parts.every(indexManifold) && want === lamp.info.triangles,
      `${want} / ${lamp.info.triangles} üçgen`);
    for (const f of ModelExport.FORMATS) {
      let got = -1, closed = true, err = '';
      try {
        const out = ModelExport.exportMeshes(f.id, lamp.meshes, 'test');
        const buf = out.data;
        let gs;
        if (f.id === 'stl') gs = geoms(new T.Mesh(new T.STLLoader().parse(buf)));
        else if (f.id === 'obj') gs = geoms(new T.OBJLoader().parse(new TextDecoder().decode(buf)));
        else if (f.id === 'fbx') gs = geoms(new T.FBXLoader().parse(buf, ''));
        else if (f.id === 'ply') { const g = new T.PLYLoader().parse(buf); gs = [{ positions: g.attributes.position.array, indices: g.index.array }]; }
        else if (f.id === '3mf') {
          const z = fflate.unzipSync(new Uint8Array(buf));
          const x = new TextDecoder().decode(z['3D/3dmodel.model']);
          if (!z['[Content_Types].xml'] || !z['_rels/.rels'] || !/unit="millimeter"/.test(x)) throw new Error('3MF paketi eksik');
          gs = x.split('<object ').slice(1).filter((o) => /<mesh>/.test(o)).map((o) => {
            const v = [...o.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
            const t = [...o.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)].flatMap((m) => [+m[1], +m[2], +m[3]]);
            if (t.some((i) => i >= v.length / 3)) throw new Error('3MF: geçersiz köşe indeksi');
            return { positions: v, indices: t };
          });
          closed = gs.every(indexManifold);
        } else if (f.id === 'glb') {
          const dv = new DataView(buf);
          if (dv.getUint32(0, true) !== 0x46546c67 || dv.getUint32(8, true) !== buf.byteLength) throw new Error('GLB başlığı');
          const jl = dv.getUint32(12, true);
          const j = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
          const binLen = dv.getUint32(20 + jl, true);
          j.bufferViews.forEach((v) => { if (v.byteOffset % 4 || v.byteOffset + v.byteLength > binLen) throw new Error('GLB bufferView'); });
          gs = j.meshes.map((m) => {
            const pa = j.accessors[m.primitives[0].attributes.POSITION], ia = j.accessors[m.primitives[0].indices];
            const pv = j.bufferViews[pa.bufferView], iv = j.bufferViews[ia.bufferView];
            if (pv.byteLength !== pa.count * 12 || iv.byteLength !== ia.count * 4) throw new Error('GLB accessor');
            return {
              positions: new Float32Array(buf.slice(20 + jl + 8 + pv.byteOffset, 20 + jl + 8 + pv.byteOffset + pv.byteLength)),
              indices: new Uint32Array(buf.slice(20 + jl + 8 + iv.byteOffset, 20 + jl + 8 + iv.byteOffset + iv.byteLength)),
            };
          });
          closed = gs.every(indexManifold);
        }
        got = tris(gs);
        // Parça başına (birleştirilmiş tek gövdeli STL/PLY hariç) su geçirmez ve dışa dönük.
        if (f.id === 'obj' || f.id === 'fbx') closed = gs.every((g) => { const r = meshCheck(g); return !r.bad && r.vol > 0; });
      } catch (e) { err = e.message; }
      check(`${tag}: ${f.label} hatasız yazılır/okunur, ${want} üçgen`, !err && got === want && closed, err || `${got} üçgen, kapalı=${closed}`);
    }
  }
}

console.log(`\n${passes} geçti, ${failures} başarısız`);
process.exit(failures ? 1 : 0);
