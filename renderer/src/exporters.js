/**
 * Lamba mesh'lerini 3B dosya biçimlerine yazar (DOM'suz; Node testleri de yükler).
 *
 * Girdi ShellMesher.buildLamp().meshes: { name, positions (mm), indices, previewOnly? }.
 * previewOnly mesh'ler hiçbir dosyaya girmez. STL dışındaki biçimlerde aynı konumdaki
 * köşeler birleştirilir (extrude kapak/yan yüzleri ayrı köşe kullanır), böylece
 * dosya indekslere göre de su geçirmezdir; bozulan (sıfır alanlı) üçgenler atılır.
 *
 *   STL  — ikili, mm, Z-yukarı (ShellMesher.toBinarySTL)
 *   3MF  — mm, Z-yukarı; her parça bir obje, hepsi tek bir montaj objesinde (bileşen)
 *   OBJ  — metin, mm, Z-yukarı (3B yazıcı dilimleyicilerinin beklediği gibi)
 *   PLY  — ikili little-endian, mm, Z-yukarı, tek gövde
 *   FBX  — ikili 7.4, mm (UnitScaleFactor 0.1), Z-yukarı GlobalSettings'te bildirilir
 *   GLB  — glTF 2.0 ikili, spesifikasyon gereği metre ve Y-yukarı
 */
(function (global) {
  'use strict';

  const APP = 'Golge Lambasi (Shadow Lamp Designer)';

  const FORMATS = [
    { id: 'stl', label: 'STL', ext: 'stl', mime: 'model/stl', note: 'Her dilimleyici açar (tek gövde).' },
    { id: '3mf', label: '3MF', ext: '3mf', mime: 'model/3mf', note: 'Bambu / Prusa / Cura; birim ve parça adları dosyada.' },
    { id: 'obj', label: 'OBJ', ext: 'obj', mime: 'model/obj', note: 'Metin; mm, Z-yukarı, her parça ayrı obje.' },
    { id: 'fbx', label: 'FBX', ext: 'fbx', mime: 'application/octet-stream', note: 'İkili FBX 7.4 (Blender, Unity, 3ds Max).' },
    { id: 'ply', label: 'PLY', ext: 'ply', mime: 'application/octet-stream', note: 'İkili PLY; MeshLab vb. için tek gövde.' },
    { id: 'glb', label: 'GLB (glTF)', ext: 'glb', mime: 'model/gltf-binary', note: 'glTF 2.0; web ve oyun motorları (metre, Y-yukarı).' },
  ];

  const enc = new TextEncoder();

  // ---------- ortak ----------

  function printable(meshes) {
    return meshes.filter((m) => !m.previewOnly && m.indices.length);
  }

  /** Aynı konumdaki (1e-4 mm) köşeleri birleştirir, sıfır alanlı üçgenleri atar. */
  function weld(m) {
    const p = m.positions, ix = m.indices, n = p.length / 3;
    const ids = new Map(), remap = new Uint32Array(n), pos = [];
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const k = Math.round(x * 1e4) + ',' + Math.round(y * 1e4) + ',' + Math.round(z * 1e4);
      let id = ids.get(k);
      if (id === undefined) { id = ids.size; ids.set(k, id); pos.push(x, y, z); }
      remap[i] = id;
    }
    const idx = [];
    for (let t = 0; t < ix.length; t += 3) {
      const a = remap[ix[t]], b = remap[ix[t + 1]], c = remap[ix[t + 2]];
      if (a !== b && b !== c && a !== c) idx.push(a, b, c);
    }
    return { name: m.name, positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
  }

  function prepared(meshes) {
    const used = new Map();
    return printable(meshes).map(weld).filter((m) => m.indices.length).map((m) => {
      // Aynı adlı parçalar (ör. panel kopyaları) ayrı obje adı alır.
      const base = String(m.name || 'part').replace(/[^\w.-]+/g, '_');
      const k = (used.get(base) || 0) + 1;
      used.set(base, k);
      m.name = k > 1 ? `${base}_${k}` : base;
      return m;
    });
  }

  function num(v) {
    const s = (+v.toFixed(4)).toString();
    return s === '-0' ? '0' : s;
  }

  function concat(parts) {
    let n = 0;
    parts.forEach((u) => { n += u.byteLength; });
    const out = new Uint8Array(n);
    let o = 0;
    parts.forEach((u) => { out.set(u, o); o += u.byteLength; });
    return out;
  }

  // Büyük metinler parça parça kodlanır (tek dev string bellek sınırına takılmasın).
  function TextSink() { this.parts = []; this.buf = []; this.len = 0; }
  TextSink.prototype.push = function (s) {
    this.buf.push(s);
    this.len += s.length;
    if (this.len > 1 << 20) this.flush();
  };
  TextSink.prototype.flush = function () {
    if (this.buf.length) this.parts.push(enc.encode(this.buf.join('')));
    this.buf = []; this.len = 0;
  };
  TextSink.prototype.bytes = function () { this.flush(); return concat(this.parts); };

  // ---------- OBJ ----------

  function toOBJ(meshes, title) {
    const out = new TextSink();
    out.push(`# ${title || 'Shadow lamp'}\n# ${APP}\n# birim: mm, Z-yukari\n`);
    let base = 1;
    prepared(meshes).forEach((m) => {
      const p = m.positions, ix = m.indices;
      out.push(`o ${m.name}\n`);
      for (let i = 0; i < p.length; i += 3) out.push(`v ${num(p[i])} ${num(p[i + 1])} ${num(p[i + 2])}\n`);
      for (let t = 0; t < ix.length; t += 3) out.push(`f ${ix[t] + base} ${ix[t + 1] + base} ${ix[t + 2] + base}\n`);
      base += p.length / 3;
    });
    return out.bytes().buffer;
  }

  // ---------- PLY ----------

  function toPLY(meshes, title) {
    const ms = prepared(meshes);
    let nv = 0, nf = 0;
    ms.forEach((m) => { nv += m.positions.length / 3; nf += m.indices.length / 3; });
    const head = enc.encode(
      'ply\nformat binary_little_endian 1.0\n'
      + `comment ${(title || 'Shadow lamp').replace(/[^\x20-\x7e]/g, '_')}\ncomment ${APP}, birim mm\n`
      + `element vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\n`
      + `element face ${nf}\nproperty list uchar int vertex_indices\nend_header\n`);
    const buf = new ArrayBuffer(head.byteLength + nv * 12 + nf * 13);
    new Uint8Array(buf).set(head);
    const dv = new DataView(buf);
    let o = head.byteLength;
    ms.forEach((m) => {
      const p = m.positions;
      for (let i = 0; i < p.length; i++, o += 4) dv.setFloat32(o, p[i], true);
    });
    let base = 0;
    ms.forEach((m) => {
      const ix = m.indices;
      for (let t = 0; t < ix.length; t += 3) {
        dv.setUint8(o, 3);
        dv.setInt32(o + 1, ix[t] + base, true);
        dv.setInt32(o + 5, ix[t + 1] + base, true);
        dv.setInt32(o + 9, ix[t + 2] + base, true);
        o += 13;
      }
      base += m.positions.length / 3;
    });
    return buf;
  }

  // ---------- 3MF ----------

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /** Sıkıştırmasız (stored) ZIP; fflate yoksa kullanılır. */
  function storedZip(files) {
    const locals = [], centrals = [];
    let offset = 0;
    Object.keys(files).forEach((name) => {
      const nm = enc.encode(name), data = files[name], crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
      locals.push(new Uint8Array(lh.buffer), nm, data);
      centrals.push(new Uint8Array(ch.buffer), nm);
      offset += 30 + nm.length + data.length;
    });
    const cd = concat(centrals);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
    end.setUint32(12, cd.length, true); end.setUint32(16, offset, true);
    return concat(locals.concat([cd, new Uint8Array(end.buffer)]));
  }

  function zip(files) {
    const ff = global.fflate;
    if (ff && ff.zipSync) return ff.zipSync(files, { level: 6 });
    return storedZip(files);
  }

  function xmlEsc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function to3MF(meshes, title) {
    const ms = prepared(meshes);
    const x = new TextSink();
    x.push('<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
      + ` <metadata name="Title">${xmlEsc(title || 'Shadow lamp')}</metadata>\n`
      + ` <metadata name="Application">${xmlEsc(APP)}</metadata>\n <resources>\n`);
    ms.forEach((m, k) => {
      const p = m.positions, ix = m.indices;
      x.push(`  <object id="${k + 1}" type="model" name="${xmlEsc(m.name)}"><mesh><vertices>\n`);
      for (let i = 0; i < p.length; i += 3) x.push(`<vertex x="${num(p[i])}" y="${num(p[i + 1])}" z="${num(p[i + 2])}"/>\n`);
      x.push('</vertices><triangles>\n');
      for (let t = 0; t < ix.length; t += 3) x.push(`<triangle v1="${ix[t]}" v2="${ix[t + 1]}" v3="${ix[t + 2]}"/>\n`);
      x.push('</triangles></mesh></object>\n');
    });
    // Tek montaj objesi: dilimleyici parçaları tek obje olarak yükler (STL ile aynı yerleşim).
    const asm = ms.length + 1;
    x.push(`  <object id="${asm}" type="model" name="${xmlEsc(title || 'Shadow lamp')}"><components>\n`);
    ms.forEach((m, k) => x.push(`<component objectid="${k + 1}"/>\n`));
    x.push(`</components></object>\n </resources>\n <build><item objectid="${asm}"/></build>\n</model>\n`);
    const files = {
      '[Content_Types].xml': enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
      '_rels/.rels': enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
      '3D/3dmodel.model': x.bytes(),
    };
    const z = zip(files);
    return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
  }

  // ---------- FBX (ikili 7.4) ----------
  //
  // Düğüm: endOffset u32, numProps u32, propListLen u32, nameLen u8, ad, özellikler,
  // alt düğümler + 13 baytlık boş kayıt (alt düğüm varsa ya da özellik yoksa).

  const FBX_VERSION = 7400;
  const FBX_HEAD = 'Kaydara FBX Binary  \u0000\u001a\u0000';
  const FBX_FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
  const FBX_FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];

  const N = (name, props, children) => ({ name, props: props || [], children: children || [] });
  const S = (v) => ['S', enc.encode(v)];
  const I = (v) => ['I', v];
  const L = (v) => ['L', v];
  const Dn = (v) => ['D', v];
  const C = (v) => ['C', v ? 1 : 0];
  const P = (name, type, label, flags, ...vals) => N('P', [S(name), S(type), S(label), S(flags), ...vals]);

  function propSize(p) {
    switch (p[0]) {
      case 'C': return 2;
      case 'I': return 5;
      case 'L': case 'D': return 9;
      case 'S': return 5 + p[1].length;
      case 'd': return 13 + (p[2] ? p[2].length : p[1].length * 8);
      case 'i': return 13 + (p[2] ? p[2].length : p[1].length * 4);
      default: throw new Error('FBX: bilinmeyen özellik ' + p[0]);
    }
  }
  function fbxNeedsSentinel(n) { return n.children.length > 0 || n.props.length === 0; }
  function fbxSize(n) {
    if (n.size !== undefined) return n.size;
    let s = 13 + n.name.length;
    n.props.forEach((p) => { s += propSize(p); });
    if (fbxNeedsSentinel(n)) {
      n.children.forEach((c) => { s += fbxSize(c); });
      s += 13;
    }
    n.size = s;
    return s;
  }

  function fbxWrite(dv, u8, o, n) {
    const start = o;
    let plen = 0;
    n.props.forEach((p) => { plen += propSize(p); });
    dv.setUint32(o, start + fbxSize(n), true);
    dv.setUint32(o + 4, n.props.length, true);
    dv.setUint32(o + 8, plen, true);
    dv.setUint8(o + 12, n.name.length);
    o += 13;
    for (let i = 0; i < n.name.length; i++) u8[o++] = n.name.charCodeAt(i);
    n.props.forEach((p) => {
      u8[o++] = p[0].charCodeAt(0);
      const v = p[1];
      switch (p[0]) {
        case 'C': u8[o++] = v; break;
        case 'I': dv.setInt32(o, v, true); o += 4; break;
        case 'L': dv.setBigInt64(o, BigInt(v), true); o += 8; break;
        case 'D': dv.setFloat64(o, v, true); o += 8; break;
        case 'S': dv.setUint32(o, v.length, true); u8.set(v, o + 4); o += 4 + v.length; break;
        case 'd': case 'i': {
          const w = p[0] === 'd' ? 8 : 4;
          if (p[2]) {   // zlib ile sıkıştırılmış (kodlama 1)
            dv.setUint32(o, v.length, true); dv.setUint32(o + 4, 1, true); dv.setUint32(o + 8, p[2].length, true);
            u8.set(p[2], o + 12);
            o += 12 + p[2].length;
            break;
          }
          dv.setUint32(o, v.length, true); dv.setUint32(o + 4, 0, true); dv.setUint32(o + 8, v.length * w, true);
          o += 12;
          if (w === 8) for (let i = 0; i < v.length; i++, o += 8) dv.setFloat64(o, v[i], true);
          else for (let i = 0; i < v.length; i++, o += 4) dv.setInt32(o, v[i], true);
          break;
        }
      }
    });
    if (fbxNeedsSentinel(n)) {
      n.children.forEach((c) => { o = fbxWrite(dv, u8, o, c); });
      o += 13; // boş kayıt (sıfırlar)
    }
    return o;
  }

  /**
   * Köşe-başı normaller (üçgen köşesi sırasıyla): komşu yüzlerden yalnızca
   * aradaki açı < 30° olanlar ortalanır — silindir yumuşak, keskin kenarlar keskin.
   */
  function cornerNormals(m) {
    const p = m.positions, ix = m.indices, nt = ix.length / 3, nv = p.length / 3;
    const fn = new Float64Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      const l = Math.hypot(x, y, z) || 1;
      fn[t * 3] = x / l; fn[t * 3 + 1] = y / l; fn[t * 3 + 2] = z / l;
    }
    // Köşe → üçgen listesi (CSR).
    const start = new Int32Array(nv + 1);
    for (let i = 0; i < ix.length; i++) start[ix[i] + 1]++;
    for (let v = 0; v < nv; v++) start[v + 1] += start[v];
    const fill = start.slice(0, nv), tris = new Int32Array(ix.length);
    for (let i = 0; i < ix.length; i++) tris[fill[ix[i]]++] = (i / 3) | 0;
    const cos = Math.cos(Math.PI / 6);
    const out = new Float64Array(ix.length * 3);
    for (let i = 0; i < ix.length; i++) {
      const t = (i / 3) | 0, v = ix[i];
      let x = 0, y = 0, z = 0;
      for (let k = start[v]; k < start[v + 1]; k++) {
        const u = tris[k];
        if (fn[u * 3] * fn[t * 3] + fn[u * 3 + 1] * fn[t * 3 + 1] + fn[u * 3 + 2] * fn[t * 3 + 2] < cos) continue;
        x += fn[u * 3]; y += fn[u * 3 + 1]; z += fn[u * 3 + 2];
      }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
    return out;
  }

  function toFBX(meshes, title) {
    const ms = prepared(meshes);
    const objects = [], conns = [];
    let nextId = 100000;
    // Unity / Autodesk FBX SDK: normaller, malzeme ve katman (Layer) tanımlı olsun.
    const matId = nextId++;
    objects.push(N('Material', [L(matId), S('lamp\u0000\u0001Material'), S('')], [
      N('Version', [I(102)]),
      N('ShadingModel', [S('phong')]),
      N('MultiLayer', [I(0)]),
      N('Properties70', [], [
        P('DiffuseColor', 'Color', '', 'A', Dn(0.86), Dn(0.84), Dn(0.8)),
        P('Diffuse', 'Vector3D', 'Vector', '', Dn(0.86), Dn(0.84), Dn(0.8)),
      ]),
    ]));
    ms.forEach((m) => {
      const gid = nextId++, mid = nextId++;
      const p = m.positions, ix = m.indices;
      const pvi = new Int32Array(ix.length);
      for (let t = 0; t < ix.length; t += 3) { pvi[t] = ix[t]; pvi[t + 1] = ix[t + 1]; pvi[t + 2] = -ix[t + 2] - 1; }
      objects.push(N('Geometry', [L(gid), S(`${m.name}\u0000\u0001Geometry`), S('Mesh')], [
        N('Vertices', [['d', Float64Array.from(p)]]),
        N('PolygonVertexIndex', [['i', pvi]]),
        N('GeometryVersion', [I(124)]),
        N('LayerElementNormal', [I(0)], [
          N('Version', [I(102)]),
          N('Name', [S('')]),
          N('MappingInformationType', [S('ByPolygonVertex')]),
          N('ReferenceInformationType', [S('Direct')]),
          N('Normals', [['d', cornerNormals(m)]]),
        ]),
        N('LayerElementMaterial', [I(0)], [
          N('Version', [I(101)]),
          N('Name', [S('')]),
          N('MappingInformationType', [S('AllSame')]),
          N('ReferenceInformationType', [S('IndexToDirect')]),
          N('Materials', [['i', new Int32Array([0])]]),
        ]),
        N('Layer', [I(0)], [
          N('Version', [I(100)]),
          N('LayerElement', [], [N('Type', [S('LayerElementNormal')]), N('TypedIndex', [I(0)])]),
          N('LayerElement', [], [N('Type', [S('LayerElementMaterial')]), N('TypedIndex', [I(0)])]),
        ]),
      ]));
      objects.push(N('Model', [L(mid), S(`${m.name}\u0000\u0001Model`), S('Mesh')], [
        N('Version', [I(232)]),
        N('Properties70', [], [
          P('Lcl Translation', 'Lcl Translation', '', 'A', Dn(0), Dn(0), Dn(0)),
          P('Lcl Rotation', 'Lcl Rotation', '', 'A', Dn(0), Dn(0), Dn(0)),
          P('Lcl Scaling', 'Lcl Scaling', '', 'A', Dn(1), Dn(1), Dn(1)),
        ]),
        N('Shading', [C(true)]),
        N('Culling', [S('CullingOff')]),
      ]));
      conns.push(N('C', [S('OO'), L(mid), L(0)]), N('C', [S('OO'), L(gid), L(mid)]), N('C', [S('OO'), L(matId), L(mid)]));
    });
    const root = [
      N('FBXHeaderExtension', [], [
        N('FBXHeaderVersion', [I(1003)]),
        N('FBXVersion', [I(FBX_VERSION)]),
        N('Creator', [S(APP)]),
      ]),
      N('Creator', [S(APP)]),
      N('GlobalSettings', [], [
        N('Version', [I(1000)]),
        N('Properties70', [], [
          P('UpAxis', 'int', 'Integer', '', I(2)),
          P('UpAxisSign', 'int', 'Integer', '', I(1)),
          P('FrontAxis', 'int', 'Integer', '', I(1)),
          P('FrontAxisSign', 'int', 'Integer', '', I(-1)),
          P('CoordAxis', 'int', 'Integer', '', I(0)),
          P('CoordAxisSign', 'int', 'Integer', '', I(1)),
          P('OriginalUpAxis', 'int', 'Integer', '', I(2)),
          P('OriginalUpAxisSign', 'int', 'Integer', '', I(1)),
          P('UnitScaleFactor', 'double', 'Number', '', Dn(0.1)),
          P('OriginalUnitScaleFactor', 'double', 'Number', '', Dn(0.1)),
        ]),
      ]),
      N('Documents', [], [N('Count', [I(0)])]),
      N('References', [], []),
      N('Definitions', [], [
        N('Version', [I(100)]),
        N('Count', [I(2 + ms.length * 2)]),
        N('ObjectType', [S('GlobalSettings')], [N('Count', [I(1)])]),
        N('ObjectType', [S('Model')], [N('Count', [I(ms.length)])]),
        N('ObjectType', [S('Geometry')], [N('Count', [I(ms.length)])]),
        N('ObjectType', [S('Material')], [N('Count', [I(1)])]),
      ]),
      N('Objects', [], objects),
      N('Connections', [], conns),
    ];
    // Büyük diziler zlib ile sıkıştırılır (FBX kodlama 1; fflate yüklüyse).
    const ff = global.fflate;
    if (ff && ff.zlibSync) {
      const pack = (n) => {
        n.props.forEach((p) => {
          if ((p[0] !== 'd' && p[0] !== 'i') || p[1].length < 64) return;
          const T = p[0] === 'd' ? Float64Array : Int32Array;
          const le = new T(p[1].length);
          le.set(p[1]);
          const raw = new Uint8Array(le.buffer);
          // Platform big-endian ise baytlar çevrilir (FBX little-endian).
          if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
            const w = T.BYTES_PER_ELEMENT;
            for (let i = 0; i < raw.length; i += w) raw.subarray(i, i + w).reverse();
          }
          p[2] = ff.zlibSync(raw, { level: 6 });
        });
        n.children.forEach(pack);
      };
      root.forEach(pack);
    }
    const head = FBX_HEAD.length + 4;
    let body = 0;
    root.forEach((n) => { body += fbxSize(n); });
    const afterRoot = head + body + 13;
    const ofs = afterRoot + 16 + 4;
    let pad = ((ofs + 15) & ~15) - ofs;
    if (pad === 0) pad = 16;
    const total = ofs + pad + 4 + 120 + 16;
    const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
    for (let i = 0; i < FBX_HEAD.length; i++) u8[i] = FBX_HEAD.charCodeAt(i);
    dv.setUint32(FBX_HEAD.length, FBX_VERSION, true);
    let o = head;
    root.forEach((n) => { o = fbxWrite(dv, u8, o, n); });
    o += 13;
    u8.set(FBX_FOOT_ID, o);
    o += 16 + 4 + pad;
    dv.setUint32(o, FBX_VERSION, true);
    o += 4 + 120;
    u8.set(FBX_FOOT_MAGIC, o);
    return buf;
  }

  // ---------- GLB (glTF 2.0) ----------

  function toGLB(meshes, title) {
    const ms = prepared(meshes);
    const json = {
      asset: { version: '2.0', generator: APP },
      scene: 0,
      scenes: [{ name: title || 'Shadow lamp', nodes: ms.map((m, k) => k) }],
      nodes: [], meshes: [], accessors: [], bufferViews: [],
      materials: [{ name: 'lamp', pbrMetallicRoughness: { baseColorFactor: [0.86, 0.84, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.7 } }],
      buffers: [],
    };
    const chunks = [];
    let off = 0;
    ms.forEach((m, k) => {
      // mm, Z-yukarı → m, Y-yukarı: (x, y, z) → (x, z, −y); dönme olduğundan sargı yönü korunur.
      const p = m.positions, n = p.length / 3;
      const pos = new Float32Array(p.length);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        const v = [p[i * 3] / 1000, p[i * 3 + 2] / 1000, -p[i * 3 + 1] / 1000];
        for (let c = 0; c < 3; c++) {
          pos[i * 3 + c] = v[c];
          if (pos[i * 3 + c] < min[c]) min[c] = pos[i * 3 + c];
          if (pos[i * 3 + c] > max[c]) max[c] = pos[i * 3 + c];
        }
      }
      const posBytes = new Uint8Array(pos.buffer), idxBytes = new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength);
      json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: posBytes.length, target: 34962 });
      chunks.push(posBytes); off += posBytes.length;
      json.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: idxBytes.length, target: 34963 });
      chunks.push(idxBytes); off += idxBytes.length;
      json.accessors.push({ bufferView: k * 2, componentType: 5126, count: n, type: 'VEC3', min, max });
      json.accessors.push({ bufferView: k * 2 + 1, componentType: 5125, count: m.indices.length, type: 'SCALAR' });
      json.meshes.push({ name: m.name, primitives: [{ attributes: { POSITION: k * 2 }, indices: k * 2 + 1, material: 0, mode: 4 }] });
      json.nodes.push({ name: m.name, mesh: k });
    });
    json.buffers.push({ byteLength: off });
    let jb = enc.encode(JSON.stringify(json));
    const jpad = (4 - (jb.length % 4)) % 4;
    if (jpad) { const t = new Uint8Array(jb.length + jpad).fill(0x20); t.set(jb); jb = t; }
    const bpad = (4 - (off % 4)) % 4; // köşe/indeks verisi 4 baytın katı; yine de hizala
    const total = 12 + 8 + jb.length + 8 + off + bpad;
    const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jb.length, true); dv.setUint32(16, 0x4e4f534a, true);
    u8.set(jb, 20);
    let o = 20 + jb.length;
    dv.setUint32(o, off + bpad, true); dv.setUint32(o + 4, 0x004e4942, true);
    o += 8;
    chunks.forEach((c) => { u8.set(c, o); o += c.length; });
    return buf;
  }

  // ---------- giriş noktası ----------

  /** Dönen: { data: ArrayBuffer, ext, mime, label } */
  function exportMeshes(format, meshes, title) {
    const f = FORMATS.find((x) => x.id === format);
    if (!f) throw new Error('desteklenmeyen biçim: ' + format);
    if (!printable(meshes).length) throw new Error('dışa aktarılacak mesh yok');
    let data;
    switch (f.id) {
      case 'stl': data = global.ShellMesher.toBinarySTL(meshes, title); break;
      case '3mf': data = to3MF(meshes, title); break;
      case 'obj': data = toOBJ(meshes, title); break;
      case 'fbx': data = toFBX(meshes, title); break;
      case 'ply': data = toPLY(meshes, title); break;
      case 'glb': data = toGLB(meshes, title); break;
    }
    return { data, ext: f.ext, mime: f.mime, label: f.label };
  }

  // Işık parçaları (LED kapağı / ışık çubuğu, tüp tutucu): dışa aktarırken isteğe bağlı.
  const LIGHT_PARTS = /^(cap|led-|tube-cap|tube-holder)/;
  const isLightPart = (m) => LIGHT_PARTS.test(m.name || '');

  global.ModelExport = { FORMATS, exportMeshes, isLightPart, toOBJ, toPLY, to3MF, toFBX, toGLB, weld };
})(typeof window !== 'undefined' ? window : globalThis);
