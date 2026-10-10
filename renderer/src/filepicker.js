/**
 * Uygulama içi dosya seçici (masaüstü).
 *
 * Linux'ta sistem (GTK) dosya penceresi Electron sürecini çökertiyordu, bu yüzden
 * hiç açılmaz: her `<input type="file">` tıklaması yakalanır, bu pencere açılır,
 * seçilen dosya ana süreçten okunup aynı girişe `File` olarak verilir ve `change`
 * olayı gönderilir. Mevcut yükleme kodları değişmeden çalışır.
 * Tarayıcı modunda (appAPI yok) dokunulmaz.
 */
(function (global) {
  'use strict';

  const api = global.appAPI;
  if (!api || !api.listDir) { global.FilePicker = { available: false }; return; }

  const MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
    svg: 'image/svg+xml', json: 'application/json', stl: 'model/stl', obj: 'model/obj', '3mf': 'model/3mf', fbx: 'application/octet-stream',
  };
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'];
  const STORE = 'shadowlamp.pickdir';

  /** accept="image/png,.svg" → ['png', 'svg'] */
  function extsOf(accept) {
    const out = new Set();
    String(accept || '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean).forEach((a) => {
      if (a === 'image/*') IMAGE_EXT.forEach((e) => out.add(e));
      else if (a.startsWith('.')) out.add(a.slice(1));
      else Object.entries(MIME).forEach(([e, m]) => { if (m === a) out.add(e); });
    });
    return out.size ? out : null;
  }
  const extOf = (name) => (name.match(/\.([^.]+)$/) || [])[1] ? name.match(/\.([^.]+)$/)[1].toLowerCase() : '';
  const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
  const fmtDate = (ms) => new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let modal = null;

  function build() {
    modal = document.createElement('div');
    modal.className = 'modal picker-modal';
    modal.id = 'modal-picker';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal-box picker-box" role="dialog" aria-label="Dosya seç">
        <div class="picker-top">
          <h3>Dosya seç</h3>
          <div class="picker-nav">
            <button class="small pk-up" title="Üst klasör (Backspace)">↑</button>
            <div class="pk-path"></div>
            <input type="text" class="pk-filter" placeholder="Bu klasörde ara…" />
          </div>
        </div>
        <div class="picker-main">
          <ul class="pk-places"></ul>
          <ul class="pk-list" tabindex="0"></ul>
          <div class="pk-preview"><div class="pk-thumb"></div><div class="pk-info"></div></div>
        </div>
        <div class="modal-actions">
          <span class="pk-hint">Çift tıklayın veya Enter: aç · Backspace: üst klasör · Esc: iptal</span>
          <button class="primary pk-open" disabled>Aç</button>
          <button class="pk-cancel">İptal</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  /** Bir dosya seçtirir. Dönen: Promise<File|null>. */
  function pick(accept) {
    if (!modal) build();
    const exts = extsOf(accept);
    const $ = (s) => modal.querySelector(s);
    const list = $('.pk-list'), places = $('.pk-places'), pathEl = $('.pk-path'), filter = $('.pk-filter');
    const openBtn = $('.pk-open'), thumb = $('.pk-thumb'), info = $('.pk-info');
    let cur = null, items = [], sel = -1, thumbUrl = null;

    return new Promise((resolve) => {
      const done = (file) => {
        modal.hidden = true;
        window.removeEventListener('keydown', onKey, true);
        if (thumbUrl) URL.revokeObjectURL(thumbUrl);
        resolve(file);
      };
      const visibleItems = () => {
        const q = filter.value.trim().toLocaleLowerCase('tr-TR');
        return items.filter((it) => (it.dir || !exts || exts.has(extOf(it.name))) && (!q || it.name.toLocaleLowerCase('tr-TR').includes(q)));
      };
      function render() {
        const vis = visibleItems();
        list.innerHTML = '';
        if (!vis.length) list.innerHTML = '<li class="pk-empty">Bu klasörde uygun dosya yok.</li>';
        vis.forEach((it, i) => {
          const li = document.createElement('li');
          li.className = 'pk-item' + (it.dir ? ' dir' : '') + (i === sel ? ' sel' : '');
          const ext = extOf(it.name);
          li.innerHTML = `<span class="pk-ic">${it.dir ? '📁' : (IMAGE_EXT.includes(ext) ? '🖼' : '📄')}</span><span class="pk-name"></span><span class="pk-meta">${it.dir ? '' : fmtSize(it.size)}</span>`;
          li.querySelector('.pk-name').textContent = it.name;
          li.addEventListener('click', () => select(i));
          li.addEventListener('dblclick', () => activate(i));
          list.appendChild(li);
        });
        const s = list.querySelector('.sel');
        if (s) s.scrollIntoView({ block: 'nearest' });
      }
      async function select(i) {
        sel = i;
        const it = visibleItems()[i];
        openBtn.disabled = !it;
        list.querySelectorAll('.pk-item').forEach((li, k) => li.classList.toggle('sel', k === i));
        const s = list.querySelector('.sel');
        if (s) s.scrollIntoView({ block: 'nearest' });
        thumb.innerHTML = '';
        info.textContent = '';
        if (!it) return;
        if (it.dir) { info.textContent = 'Klasör'; return; }
        info.textContent = `${it.name}\n${fmtSize(it.size)} · ${fmtDate(it.mtimeMs)}`;
        if (IMAGE_EXT.includes(extOf(it.name)) && it.size < 40 * 1048576) {
          try {
            const buf = await api.readFile(cur.dir + cur.sep + it.name);
            if (visibleItems()[sel] !== it) return;
            if (thumbUrl) URL.revokeObjectURL(thumbUrl);
            thumbUrl = URL.createObjectURL(new Blob([buf], { type: MIME[extOf(it.name)] }));
            const img = new Image();
            img.src = thumbUrl;
            thumb.appendChild(img);
          } catch (_) { /* önizleme yok */ }
        }
      }
      async function go(dir) {
        try {
          cur = await api.listDir(dir);
        } catch (err) {
          info.textContent = 'Klasör açılamadı: ' + err.message;
          return;
        }
        try { localStorage.setItem(STORE, cur.dir); } catch (_) { /* depolama yok */ }
        items = cur.entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'tr', { numeric: true }));
        sel = -1;
        filter.value = '';
        openBtn.disabled = true;
        thumb.innerHTML = '';
        info.textContent = '';
        $('.pk-up').disabled = !cur.parent;
        // Yol: tıklanabilir parçalar
        pathEl.innerHTML = '';
        const parts = cur.dir.split(cur.sep).filter(Boolean);
        let acc = cur.dir.startsWith(cur.sep) ? '' : null;
        parts.forEach((p, k) => {
          acc = acc === null ? p : acc + cur.sep + p;
          const target = acc.startsWith(cur.sep) || !cur.dir.startsWith(cur.sep) ? acc : cur.sep + acc;
          const b = document.createElement('button');
          b.className = 'pk-crumb';
          b.textContent = p;
          b.addEventListener('click', () => go(cur.dir.startsWith(cur.sep) ? cur.sep + parts.slice(0, k + 1).join(cur.sep) : target));
          pathEl.appendChild(b);
          if (k < parts.length - 1) pathEl.appendChild(Object.assign(document.createElement('span'), { className: 'pk-sep', textContent: '›' }));
        });
        render();
        list.focus();
      }
      async function activate(i) {
        const it = visibleItems()[i];
        if (!it) return;
        if (it.dir) { go(cur.dir + cur.sep + it.name); return; }
        openBtn.disabled = true;
        info.textContent = 'Okunuyor…';
        try {
          const buf = await api.readFile(cur.dir + cur.sep + it.name);
          done(new File([buf], it.name, { type: MIME[extOf(it.name)] || '', lastModified: it.mtimeMs }));
        } catch (err) {
          info.textContent = 'Açılamadı: ' + err.message;
          openBtn.disabled = false;
        }
      }
      function onKey(e) {
        if (modal.hidden) return;
        const inFilter = e.target === filter;
        const n = visibleItems().length;
        if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(null); return; }
        if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); activate(sel >= 0 ? sel : 0); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); e.stopImmediatePropagation();
          if (n) select(Math.max(0, Math.min(n - 1, sel + (e.key === 'ArrowDown' ? 1 : -1))));
          return;
        }
        if (e.key === 'Backspace' && !inFilter) { e.preventDefault(); e.stopImmediatePropagation(); if (cur && cur.parent) go(cur.parent); return; }
        // Harf yazınca arama kutusuna geç.
        if (!inFilter && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { filter.focus(); }
        e.stopImmediatePropagation();   // uygulama kısayolları çalışmasın
      }

      filter.oninput = () => { sel = -1; render(); };
      $('.pk-up').onclick = () => { if (cur && cur.parent) go(cur.parent); };
      openBtn.onclick = () => activate(sel);
      $('.pk-cancel').onclick = () => done(null);
      modal.onclick = (e) => { if (e.target === modal) done(null); };
      window.addEventListener('keydown', onKey, true);

      places.innerHTML = '';
      api.places().then((ps) => ps.forEach((pl) => {
        const li = document.createElement('li');
        li.className = 'pk-place';
        li.textContent = pl.name;
        li.title = pl.path;
        li.addEventListener('click', () => go(pl.path));
        places.appendChild(li);
      }));
      modal.hidden = false;
      let start = null;
      try { start = localStorage.getItem(STORE); } catch (_) { /* depolama yok */ }
      go(start).catch(() => go(null));
    });
  }

  // Bütün dosya girişleri: sistem penceresi yerine bu seçici.
  document.addEventListener('click', (e) => {
    const inp = e.target;
    if (!(inp instanceof HTMLInputElement) || inp.type !== 'file') return;
    e.preventDefault();
    pick(inp.accept).then((file) => {
      if (!file) return;
      const dt = new DataTransfer();
      dt.items.add(file);
      inp.files = dt.files;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, true);

  global.FilePicker = { available: true, pick };
})(window);
