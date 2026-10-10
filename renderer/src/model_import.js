/**
 * 3B model okuma (STL, OBJ, 3MF, FBX) — önizleme doğruluğunu ölçmek için.
 *
 * Model orijinal birim ve koordinatlarıyla döner (ölçekleme / ortalama yok):
 * bu uygulamanın indirdiği STL "orijinal koordinatlar" ile yüklendiğinde
 * üretilen gövdeyle birebir üst üste gelmelidir.
 */
(function (global) {
  'use strict';

  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  function readFile(file, asText) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('dosya okunamadı'));
      if (asText) r.readAsText(file); else r.readAsArrayBuffer(file);
    });
  }

  /**
   * Dosya → { object: THREE.Group (dünya dönüşümleri geometriye işlenmiş),
   *           triangles, format, defaults: { units, up } }
   */
  async function load(file) {
    const ext = extOf(file.name);
    let obj;
    if (ext === 'stl') {
      obj = new THREE.Mesh(new THREE.STLLoader().parse(await readFile(file, false)));
    } else if (ext === 'obj') {
      obj = new THREE.OBJLoader().parse(await readFile(file, true));
    } else if (ext === '3mf') {
      obj = new THREE.ThreeMFLoader().parse(await readFile(file, false));
    } else if (ext === 'fbx') {
      obj = new THREE.FBXLoader().parse(await readFile(file, false), '');
    } else {
      throw new Error(`desteklenmeyen biçim: .${ext || '?'} (STL, OBJ, 3MF veya FBX olmalı)`);
    }

    // Yalnızca üçgen mesh'ler; dönüşümler geometriye işlenir.
    const root = new THREE.Group();
    let tris = 0;
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      g.deleteAttribute && ['uv', 'uv2', 'color', 'skinIndex', 'skinWeight'].forEach((a) => g.attributes[a] && g.deleteAttribute(a));
      g.computeVertexNormals();
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      root.add(new THREE.Mesh(g));
    });
    if (!root.children.length) throw new Error('dosyada üçgen mesh bulunamadı');

    // 3D yazıcı biçimleri mm ve Z-yukarı; OBJ/FBX genelde Y-yukarı (FBX çoğunlukla cm).
    const defaults = {
      units: ext === 'fbx' ? 'cm' : 'mm',
      up: ext === 'stl' || ext === '3mf' ? 'z' : 'y',
    };
    return { object: root, triangles: Math.round(tris), format: ext.toUpperCase(), defaults };
  }

  global.ModelImport = { load };
})(window);
