/**
 * 3B görünüm, iki mod:
 *
 *  - "bed"  (Yazıcı Tablası): beyaz model yazıcı tablasının üzerinde, gölge
 *    zemine gri şekil olarak çizilir, kırmızı ölçü çizgileri ve etiketler.
 *    Duvar düzlemi = zemin; lamba tabanı üzerinde dik durur.
 *  - "room" (Karanlık Oda): duvara asılı lamba, içte yanan LED ve duvara
 *    düşen gölge (tasarımcının simülasyonu doku olarak).
 *
 * Lamba koordinatları cm (mesh'ler mm, 0.1 ölçekli): z = duvardan uzaklık.
 */

(function (global) {
  'use strict';

  function init(wrapEl) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(wrapEl.clientWidth || 800, wrapEl.clientHeight || 600);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    // Gerçek gölge (karanlık oda): yalnızca bir şey değişince yeniden hesaplanır.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    const dirtyShadow = () => { renderer.shadowMap.needsUpdate = true; };
    wrapEl.insertBefore(renderer.domElement, wrapEl.firstChild);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    // ---------- ortak yardımcılar ----------

    function textSprite(text, color, height) {
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d');
      const font = '600 72px -apple-system, "Segoe UI", system-ui, sans-serif';
      ctx.font = font;
      const w = Math.ceil(ctx.measureText(text).width) + 24;
      cv.width = w; cv.height = 96;
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 12, 50);
      const tex = new THREE.CanvasTexture(cv);
      tex.encoding = THREE.sRGBEncoding;
      tex.anisotropy = maxAniso;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, toneMapped: false }));
      sp.scale.set(height * (w / 96), height, 1);
      sp.renderOrder = 10;
      return sp;
    }

    function disposeTree(obj) {
      obj.traverse((o) => {
        if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
        if (o.material) {
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
            if (m.map && !m.userData.keepMap) m.map.dispose();
            if (!m.userData.keep) m.dispose();
          });
        }
      });
    }

    function clearGroup(g) {
      while (g.children.length) {
        const c = g.children.pop();
        disposeTree(c);
      }
    }

    // =====================================================================
    // Yazıcı tablası sahnesi
    // =====================================================================

    const bed = new THREE.Scene();
    bed.background = new THREE.Color(0x1e1e1f);
    bed.add(new THREE.HemisphereLight(0xffffff, 0x3a3a3a, 0.75));
    const bedKey = new THREE.DirectionalLight(0xffffff, 0.85);
    bedKey.position.set(60, 140, 90);
    bed.add(bedKey);
    const bedFill = new THREE.DirectionalLight(0xffffff, 0.3);
    bedFill.position.set(-80, 60, -60);
    bed.add(bedFill);

    // Lamba uzayı: lamba z'si dünya y'si (yukarı) olur.
    const bedSpace = new THREE.Group();
    bedSpace.rotation.x = -Math.PI / 2;
    bed.add(bedSpace);

    const bedPlateGroup = new THREE.Group();   // tabla (dünya koordinatı)
    bed.add(bedPlateGroup);
    const bedLamp = new THREE.Group();
    bedLamp.scale.setScalar(0.1);
    bedSpace.add(bedLamp);
    const bedDims = new THREE.Group();
    bedSpace.add(bedDims);

    const maskTex = new THREE.CanvasTexture(document.createElement('canvas'));
    maskTex.encoding = THREE.sRGBEncoding;
    maskTex.anisotropy = maxAniso;
    const maskPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: maskTex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    maskPlane.position.z = -0.5; // tablanın altında: tabla gölgenin üstünde görünür
    maskPlane.renderOrder = 1;
    bedSpace.add(maskPlane);

    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.62, metalness: 0, side: THREE.DoubleSide });
    whiteMat.userData.keep = true;

    // Tabla { x, y } mm (dikdörtgen); ızgara 20 mm aralıklı.
    const bedOf = (o) => { const b = (o && o.bed) || 256; return typeof b === 'number' ? { x: b, y: b, z: b } : b; };
    function buildBedPlate(bed, fits) {
      clearGroup(bedPlateGroup);
      const sx = bed.x / 10, sz = bed.y / 10;
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(sx, 0.4, sz),
        new THREE.MeshStandardMaterial({ color: 0x3c3c40, roughness: 0.8 }),
      );
      plate.position.y = -0.21;
      bedPlateGroup.add(plate);
      const pts = [];
      for (let x = -sx / 2; x <= sx / 2 + 1e-6; x += 2) pts.push(new THREE.Vector3(x, 0, -sz / 2), new THREE.Vector3(x, 0, sz / 2));
      for (let z = -sz / 2; z <= sz / 2 + 1e-6; z += 2) pts.push(new THREE.Vector3(-sx / 2, 0, z), new THREE.Vector3(sx / 2, 0, z));
      const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x4d4d52 }));
      grid.position.y = 0.01;
      bedPlateGroup.add(grid);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, 0.4, sz)),
        new THREE.LineBasicMaterial({ color: fits ? 0x6a6a70 : 0xff4d4d }),
      );
      edge.position.y = -0.21;
      bedPlateGroup.add(edge);
    }

    function dimLine(group, a, b, label, color, h, labelOffset) {
      const mat = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
      const dir = new THREE.Vector3().subVectors(b, a).normalize();
      const n = new THREE.Vector3(-dir.y, dir.x, 0).multiplyScalar(h * 0.5);
      const pts = [a, b, a.clone().add(n), a.clone().sub(n), b.clone().add(n), b.clone().sub(n)];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      geo.setIndex([0, 1, 2, 3, 4, 5]);
      const line = new THREE.LineSegments(geo, mat);
      line.renderOrder = 9;
      group.add(line);
      const sp = textSprite(label, color === 0xff3b30 ? '#ff4b3e' : '#4cd964', h);
      sp.position.copy(a).add(b).multiplyScalar(0.5).add(labelOffset || new THREE.Vector3());
      group.add(sp);
    }

    function buildBedDims(opts) {
      clearGroup(bedDims);
      if (!showDims) return;
      const R = opts.R;
      // Etiket boyu sahnenin gerçek boyutuna göre (silüet yokken sahne küçüktür).
      const h = Math.max(0.6, Math.min(R * 0.045, sceneExtent() * 0.045));
      const bb = opts.shadowBBox;
      const red = 0xff3b30, green = 0x34c759;
      // Eksenler (MakerWorld tarzı yeşil çizgiler).
      const axisMat = new THREE.LineBasicMaterial({ color: green, transparent: true, opacity: 0.8 });
      const L = R * 1.15;
      const axes = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-L, 0, 0.1), new THREE.Vector3(L, 0, 0.1),
        new THREE.Vector3(0, -L, 0.1), new THREE.Vector3(0, L, 0.1),
      ]);
      bedDims.add(new THREE.LineSegments(axes, axisMat));
      if (bb) {
        const off = h * 1.4;
        const wmm = Math.round((bb.maxX - bb.minX) * 10), hmm = Math.round((bb.maxY - bb.minY) * 10);
        dimLine(bedDims, new THREE.Vector3(bb.minX, bb.minY - off, 0.2), new THREE.Vector3(bb.maxX, bb.minY - off, 0.2),
          `Gölge genişliği = ${wmm} mm`, red, h, new THREE.Vector3(0, -h * 0.9, 0));
        dimLine(bedDims, new THREE.Vector3(bb.minX - off, bb.minY, 0.2), new THREE.Vector3(bb.minX - off, bb.maxY, 0.2),
          `Gölge uzunluğu = ${hmm} mm`, red, h, new THREE.Vector3(-h * 5, 0, 0));
      }
      if (opts.bodyMM) {
        const b = opts.bodyMM;
        const sp = textSprite(`Gövde ${b.w.toFixed(0)} × ${b.h.toFixed(0)} × ${b.d.toFixed(0)} mm`, '#ff4b3e', h * 0.8);
        sp.position.set(0, 0, opts.d + h * 2.2);
        bedDims.add(sp);
      }
      const bed = bedOf(opts);
      const bedLabel = textSprite(`Tabla ${bed.x} × ${bed.y} mm${opts.fitsBed ? '' : '  —  sığmıyor!'}`,
        opts.fitsBed ? '#9a9aa0' : '#ff4b3e', h * 0.7);
      bedLabel.position.set(0, -bed.y / 20 - h * 0.9, 0.2);
      bedDims.add(bedLabel);
    }

    // =====================================================================
    // Karanlık oda sahnesi
    // =====================================================================

    const room = new THREE.Scene();
    room.background = new THREE.Color(0x050505);
    room.fog = new THREE.Fog(0x050505, 300, 900);

    // Işık açıkken duvar, gölge dokusunun karanlık rengiyle birebir aynı olmalı (doku
    // sRGB ve ton eşlemesiz): yoksa gölge alanı griye karşı siyah bir kare gibi görünür.
    const wallMatOn = new THREE.MeshBasicMaterial({ color: 0x080706, toneMapped: false });
    const wallMatOff = new THREE.MeshStandardMaterial({ color: 0x8f887d, roughness: 0.95 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(900, 600), wallMatOn);
    room.add(wall);

    const shadowTex = new THREE.CanvasTexture(document.createElement('canvas'));
    shadowTex.encoding = THREE.sRGBEncoding;
    shadowTex.anisotropy = maxAniso;
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: shadowTex, toneMapped: false }),
    );
    shadowPlane.position.z = 0.03;
    room.add(shadowPlane);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 600),
      new THREE.MeshStandardMaterial({ color: 0x1f1813, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    room.add(floor);

    const ambient = new THREE.AmbientLight(0xffffff, 0.03);
    room.add(ambient);
    const hemi = new THREE.HemisphereLight(0xf4efe6, 0x2a2420, 0);
    room.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.position.set(-90, 140, 120);
    room.add(sun);
    const led = new THREE.PointLight(0xffc46e, 2.2, 300, 2);
    led.shadow.mapSize.set(2048, 2048);
    led.shadow.camera.near = 0.05;
    led.shadow.camera.far = 600;
    led.shadow.bias = -0.0008;
    led.shadow.radius = 1.5;
    room.add(led);
    // Gerçek gölge modunda duvar: LED ile aydınlanan ve gölge alan malzeme.
    const wallMatShadow = new THREE.MeshStandardMaterial({ color: 0xefe9df, roughness: 1 });
    wall.receiveShadow = true;
    const ledBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false }),
    );
    room.add(ledBulb);

    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    function paintGlow(hex) {
      const c = new THREE.Color(hex);
      const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
      const ctx = glowCanvas.getContext('2d');
      ctx.clearRect(0, 0, 128, 128);
      const grd = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, 'rgba(255,248,235,1)');
      grd.addColorStop(0.25, `rgba(${r},${g},${b},0.45)`);
      grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 128);
    }
    paintGlow(0xffc46e);
    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false,
    }));
    glow.scale.set(7, 7, 1);
    room.add(glow);

    const roomLamp = new THREE.Group();
    roomLamp.scale.setScalar(0.1);
    room.add(roomLamp);

    // ---------- karşılaştırma modeli (lamba koordinatlarında, cm) ----------
    const cmpBed = new THREE.Group();
    bedSpace.add(cmpBed);
    const cmpRoom = new THREE.Group();
    room.add(cmpRoom);
    const cmpMat = new THREE.MeshStandardMaterial({
      color: 0xff8a3d, roughness: 0.5, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false,
    });
    cmpMat.userData.keep = true;
    const cmp = { loaded: false, visible: true, hideGenerated: false, scale: 0.1, up: 'z', rotZ: 0, align: 'auto', offset: [0, 0, 0] };
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    darkMat.userData.keep = true;
    // Şeffaf akrilik tüp (yalnızca önizleme, STL'e girmez).
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xdfefff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.22,
      side: THREE.DoubleSide, depthWrite: false,
    });
    glassMat.userData.keep = true;

    // =====================================================================
    // Durum, kamera
    // =====================================================================

    let view = 'bed';
    let realShadow = false;
    let ledBase = 2.2;
    let wallR = 60;           // aydınlanan duvar dokusunun yarı genişliği (cm)
    let floorBelowLamp = -25; // zemin en fazla lambanın altında bu yükseklikte (cm)
    // Montaj parçaları (LED kapağı + tüp tutucu halkası) tablada varsayılan olarak
    // gizli ("Montaj parçaları" gösterir). Karanlık odada hiç çizilmez: orada
    // yalnızca basılan gövde ve ışığın kendisi görünür, lambanın önü açık kalır.
    let showLid = false;
    let showDims = true;
    let lightOn = true;
    let lastOpts = null;
    let sharedGeos = [];
    let lastExtent = 1;

    const cams = {
      bed:  { target: new THREE.Vector3(0, 3, 0), radius: 140, theta: 0.65, phi: 0.95, free: true },
      room: { target: new THREE.Vector3(0, 0, 3), radius: 100, theta: 0.5, phi: 1.25, free: false },
    };

    function cam() { return cams[view]; }

    function updateCam() {
      const c = cam();
      camera.position.set(
        c.target.x + c.radius * Math.sin(c.phi) * Math.sin(c.theta),
        c.target.y + c.radius * Math.cos(c.phi),
        c.target.z + c.radius * Math.sin(c.phi) * Math.cos(c.theta),
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(c.target);
    }

    // Gölgenin tamamı ve ölçü etiketleri kadraja girecek uzaklık.
    function sceneExtent() {
      if (!lastOpts) return 60;
      const bb = lastOpts.shadowBBox;
      const e = bb ? Math.max(-bb.minX, bb.maxX, -bb.minY, bb.maxY) : lastOpts.R;
      const bed = bedOf(lastOpts);
      return Math.max(e * 1.15, Math.max(bed.x, bed.y) / 20, 15);
    }

    function setCamPreset(name) {
      const E = sceneExtent();
      const R = lastOpts ? lastOpts.R : 60;
      const c = cam();
      if (view === 'bed') {
        const p = { iso: [0.65, 0.9, E * 2.7], top: [0, 0.001, E * 3.0], front: [0, 1.3, E * 2.6] }[name] || [0.65, 0.9, E * 2.7];
        [c.theta, c.phi, c.radius] = p;
      } else {
        // Duvar büyütülünce kamera da geri çekilir (tamamı kadraja girsin).
        const W = Math.max(R, wallR * 0.75);
        const p = { iso: [0.5, 1.3, W * 3.0], top: [0, 0.5, W * 3.1], front: [0, Math.PI / 2, W * 2.8] }[name] || [0.5, 1.3, W * 3.0];
        [c.theta, c.phi, c.radius] = p;
      }
      updateCam();
    }

    let dragging = false, lastX = 0, lastY = 0;
    renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const c = cam();
      c.theta -= (e.clientX - lastX) * 0.008;
      if (!c.free) c.theta = Math.max(-1.45, Math.min(1.45, c.theta));
      const minPhi = c.free ? 0.001 : 0.25;
      const maxPhi = c.free ? Math.PI / 2 - 0.02 : Math.PI - 0.25;
      c.phi = Math.max(minPhi, Math.min(maxPhi, c.phi - (e.clientY - lastY) * 0.008));
      lastX = e.clientX; lastY = e.clientY;
      updateCam();
    });
    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      const c = cam();
      const R = lastOpts ? lastOpts.R : 60;
      c.radius = Math.max(8, Math.min(Math.max(R, wallR, sceneExtent()) * 10, c.radius * (1 + e.deltaY * 0.001)));
      updateCam();
    }, { passive: false });

    function applyVisibility() {
      const capVis = (m) => !m.userData.isCap || showLid;
      bedLamp.children.forEach((m) => { m.visible = capVis(m); });
      roomLamp.children.forEach((m) => { m.visible = !m.userData.isCap; });

      const real = realShadow && lightOn;
      wall.material = real ? wallMatShadow : (lightOn ? wallMatOn : wallMatOff);
      shadowPlane.visible = lightOn && !real;
      led.castShadow = real;
      // Gerçek gölgede mesafe sönümü kapalı: uzak gölge de görünsün (açı etkisi kalır).
      led.decay = real ? 0 : 2;
      led.distance = real ? 0 : 300;
      led.intensity = ledBase * (real ? 1.2 : 1);
      bedLamp.visible = roomLamp.visible = !cmp.hideGenerated;
      cmpBed.visible = cmpRoom.visible = cmp.loaded && cmp.visible;
      dirtyShadow();
      led.visible = ledBulb.visible = glow.visible = lightOn;
      ambient.intensity = lightOn ? 0.03 : 0.12;
      hemi.intensity = lightOn ? 0 : 0.45;
      sun.intensity = lightOn ? 0 : 0.9;
      const bg = lightOn ? 0x050505 : 0x2b2925;
      room.background.set(bg);
      room.fog.color.set(bg);
      wrapEl.dataset.view = view;
    }

    // Karanlık oda ışığı ve duvarı: LED rengi/şiddeti, duvar rengi, aydınlanan duvar
    // dokusu (opts.wallR yarı genişlik, cm). Mesh'lere dokunmaz; ayar sürüklenirken hızlı.
    function applyLook(opts) {
      const look = opts.look || {};
      if (look.ledColor != null) {
        led.color.set(look.ledColor);
        ledBulb.material.color.set(look.ledColor).lerp(new THREE.Color(0xffffff), 0.7);
        paintGlow(look.ledColor);
        glowTex.needsUpdate = true;
      }
      const k = (look.brightness != null ? look.brightness : 100) / 100;
      ledBase = 2.2 * k;
      led.intensity = ledBase * (realShadow && lightOn ? 1.2 : 1);
      glow.scale.setScalar(7 * Math.sqrt(Math.max(0.2, k)));
      if (look.wallColor != null) {
        wallMatShadow.color.set(look.wallColor);
        wallMatOff.color.set(look.wallColor);
        wallMatOn.color.set(look.wallColor).multiplyScalar(0.035).convertSRGBToLinear();
      }
      if (opts.simCanvas) { shadowTex.image = opts.simCanvas; shadowTex.needsUpdate = true; }
      wallR = Math.max(opts.R || 60, opts.wallR || 0);
      shadowPlane.scale.set(2 * wallR, 2 * wallR, 1);
      // Duvar ve zemin kameranın gördüğü her yeri kaplar (kenarı görünmesin); sis de ölçeklenir.
      const ws = Math.max(1, (wallR * 10) / 900);
      wall.scale.set(ws, ws, 1);
      floor.scale.set(ws, ws, 1);
      room.fog.near = 300 * Math.max(1, wallR / 90);
      room.fog.far = 900 * Math.max(1, wallR / 90);
      floor.position.y = Math.min(floorBelowLamp, -wallR * 0.75);
    }

    /** Yalnızca ışık/duvar görünümü değişti (mesh'ler aynı). */
    function updateRoom(opts) {
      if (!lastOpts) return;
      lastOpts = Object.assign({}, lastOpts, opts);
      const before = wallR;
      applyLook(lastOpts);
      // Duvar boyutu belirgin değiştiyse oda kadrajını yeniden ayarla (renk/şiddette kamera kalır).
      if (Math.abs(wallR - before) / before > 0.2) {
        const saved = view;
        view = 'room'; setCamPreset('iso');
        view = saved;
        updateCam();
      }
    }

    /**
     * opts: {
     *   meshes (mm, monte edilmiş — oda görünümü için),
     *   printMeshes (mm, baskı düzeni — tabla görünümü için; yoksa meshes kullanılır),
     *   floatingNames (string[] — havada kalan parça adları; kırmızı gösterilir),
     *   d, cz, R (cm),
     *   simCanvas (oda dokusu, [-wallR, wallR]²), maskCanvas (tabla gölge şekli, [-R, R]²), shadowBBox (cm), wallR (cm),
     *   bed (mm), bodyMM, fitsBed, look: { ledColor, brightness, wallColor }
     * }
     */
    function buildScene(opts) {
      const first = !lastOpts;
      lastOpts = opts;
      const { cz, R, d } = opts;

      // Tablada baskı düzeni meshlerini göster (yoksa montaj meshlerini kullan)
      const printMeshes = opts.printMeshes || opts.meshes || [];
      const floatingSet = new Set(opts.floatingNames || []);

      const floatMat = new THREE.MeshStandardMaterial({
        color: 0xff3b30, roughness: 0.6, metalness: 0, side: THREE.DoubleSide,
      });
      floatMat.userData.keep = false;

      clearGroup(bedLamp);
      clearGroup(roomLamp);
      sharedGeos.forEach((g) => g.dispose());
      sharedGeos = [];

      // Oda görünümü: monte edilmiş meshler (assembled: true)
      (opts.meshes || []).forEach((m) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
        geo.computeVertexNormals();
        sharedGeos.push(geo);
        // Işık parçaları (kapak, LED yuvası, tüp, tüp tutucu) odada gizli.
        const isCap = /^(cap|led-|tube-)/.test(m.name);
        const isGlass = m.name === 'tube-glass';
        const mesh = new THREE.Mesh(geo, isGlass ? glassMat : darkMat);
        if (isGlass) mesh.renderOrder = 5;
        mesh.castShadow = !isGlass;
        mesh.userData.sharedGeo = true;
        mesh.userData.isCap = isCap;
        roomLamp.add(mesh);
      });

      // Tabla görünümü: baskı düzeni meshler; havada olanlar kırmızı
      printMeshes.forEach((m) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
        geo.computeVertexNormals();
        sharedGeos.push(geo);
        // Montaj parçaları: LED kapağı ve tüp tutucu halkası (tablada varsayılan gizli).
        const isCap = /^(cap|led-|tube-cap|tube-holder)/.test(m.name);
        const isGlass = m.name === 'tube-glass';
        const isFloating = floatingSet.has(m.name);
        const mat = isGlass ? glassMat : (isFloating ? floatMat : whiteMat);
        const mesh = new THREE.Mesh(geo, mat);
        if (isGlass) mesh.renderOrder = 5;
        mesh.castShadow = !isGlass;
        mesh.userData.sharedGeo = true;
        mesh.userData.isCap = isCap;
        bedLamp.add(mesh);
      });

      // Tabla
      buildBedPlate(bedOf(opts), opts.fitsBed !== false);
      if (opts.maskCanvas) { maskTex.image = opts.maskCanvas; maskTex.needsUpdate = true; }
      maskPlane.scale.set(2 * R, 2 * R, 1);
      buildBedDims(opts);
      cams.bed.target.set(0, d / 2, 0);

      // Oda
      const b = opts.meshes && opts.meshes.length ? ShellMesher.bbox(opts.meshes) : { minY: -80 };
      floorBelowLamp = b.minY / 10 - 25;
      applyLook(opts);
      led.position.set(0, 0, cz);
      ledBulb.position.set(0, 0, cz);
      glow.position.set(0, 0, cz);
      cams.room.target.set(0, 0, d / 2);

      applyVisibility();
      // İlk kurulumda ve gölge boyutu belirgin değiştiğinde kadrajı yeniden ayarla.
      const ext = sceneExtent();
      const refit = first || Math.abs(ext - lastExtent) / lastExtent > 0.35;
      lastExtent = ext;
      if (refit) {
        const saved = view;
        view = 'room'; setCamPreset('iso');
        view = 'bed'; setCamPreset('iso');
        view = saved;
      }
      updateCam();
    }

    function setView(v) {
      view = v === 'room' ? 'room' : 'bed';
      applyVisibility();
      updateCam();
    }

    function loop() {
      requestAnimationFrame(loop);
      renderer.render(view === 'bed' ? bed : room, camera);
    }
    loop();

    function resize() {
      const w = wrapEl.clientWidth, h = wrapEl.clientHeight;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    new ResizeObserver(resize).observe(wrapEl);
    resize();
    updateCam();

    function applyCompareTransform() {
      [cmpBed, cmpRoom].forEach((g) => {
        g.scale.setScalar(cmp.scale);
        // Önce yukarı ekseni lamba Z'sine çevir (Y-yukarı → Z), sonra eksen etrafında döndür.
        g.rotation.set(cmp.up === 'y' ? Math.PI / 2 : 0, 0, (cmp.rotZ * Math.PI) / 180, 'ZXY');
        g.position.set(0, 0, 0);
      });
      cmpRoom.updateMatrixWorld(true);
      let shift = new THREE.Vector3();
      if (cmp.align === 'auto' && cmpRoom.children.length) {
        // Lamba eksenine ortala, duvara (z = 0) oturt.
        const bb = new THREE.Box3().setFromObject(cmpRoom);
        shift.set(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
      }
      const off = new THREE.Vector3(cmp.offset[0], cmp.offset[1], cmp.offset[2]).multiplyScalar(0.1);
      [cmpBed, cmpRoom].forEach((g) => g.position.copy(shift).add(off));
      dirtyShadow();
    }

    function setCompareModel(object) {
      [cmpBed, cmpRoom].forEach((g) => {
        while (g.children.length) g.remove(g.children[0]);
      });
      if (cmp.geos) cmp.geos.forEach((geo) => geo.dispose());
      cmp.geos = [];
      cmp.loaded = !!object;
      if (object) {
        object.children.forEach((m) => {
          cmp.geos.push(m.geometry);
          [cmpBed, cmpRoom].forEach((g) => {
            const mesh = new THREE.Mesh(m.geometry, cmpMat);
            mesh.castShadow = true;
            mesh.renderOrder = 4;
            g.add(mesh);
          });
        });
      }
      applyCompareTransform();
      applyVisibility();
    }

    function setCompareOptions(o) {
      Object.assign(cmp, o);
      if (o.color != null) cmpMat.color.set(o.color);
      if (o.opacity != null) {
        cmpMat.opacity = o.opacity;
        cmpMat.transparent = o.opacity < 0.999;
        cmpMat.depthWrite = !cmpMat.transparent;
        cmpMat.needsUpdate = true;
      }
      applyCompareTransform();
      applyVisibility();
    }

    /** Model ve üretilen lamba sınır kutuları (lamba koordinatları, mm). */
    function compareStats() {
      if (!cmp.loaded) return null;
      cmpRoom.updateMatrixWorld(true);
      const mb = new THREE.Box3().setFromObject(cmpRoom);
      const toMM = (b) => ({ min: b.min.clone().multiplyScalar(10), max: b.max.clone().multiplyScalar(10) });
      const out = { model: toMM(mb) };
      if (lastOpts && lastOpts.meshes && lastOpts.meshes.length) {
        const lb = ShellMesher.bbox(lastOpts.meshes.filter((m) => !m.previewOnly && !/^(cap|led-|tube-cap)/.test(m.name)));
        out.lamp = { min: new THREE.Vector3(lb.minX, lb.minY, lb.minZ), max: new THREE.Vector3(lb.maxX, lb.maxY, lb.maxZ) };
        // Lamba bölgesindeki model noktaları (yan tarafta duran kapak vb. hariç).
        const pad = 5;
        const lo = out.lamp.min.clone().subScalar(pad), hi = out.lamp.max.clone().addScalar(pad);
        const rb = new THREE.Box3();
        const v = new THREE.Vector3();
        let inside = 0, total = 0;
        cmpRoom.children.forEach((m) => {
          const pos = m.geometry.attributes.position;
          for (let i = 0; i < pos.count; i++) {
            v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).multiplyScalar(10);
            total++;
            if (v.x >= lo.x && v.x <= hi.x && v.y >= lo.y && v.y <= hi.y && v.z >= lo.z && v.z <= hi.z) { rb.expandByPoint(v); inside++; }
          }
        });
        if (inside) out.region = { min: rb.min, max: rb.max, share: inside / total };
      }
      return out;
    }

    return {
      setCompareModel,
      setCompareOptions,
      compareStats,
      setRealShadow: (v) => { realShadow = v; applyVisibility(); },
      isRealShadow: () => realShadow,
      buildScene,
      updateRoom,
      setView,
      getView: () => view,
      setCamPreset,
      setShowLid: (v) => { showLid = v; applyVisibility(); },
      isLidVisible: () => showLid,
      setShowDims: (v) => { showDims = v; if (lastOpts) buildBedDims(lastOpts); },
      isDimsVisible: () => showDims,
      setLightOn: (v) => { lightOn = v; applyVisibility(); },
      isLightOn: () => lightOn,
    };
  }

  global.Geometry = { init };
})(window);
