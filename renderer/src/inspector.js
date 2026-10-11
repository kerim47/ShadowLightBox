/**
 * Inspector — Unity'deki gibi sağdaki özellik sütunu. Her çalışma alanının
 * sağ panelini (Lamba `.sidebar`, Dönüştürücü `.cv-side`, Editör `.ed-side`)
 * sarar ve üstüne ortak bir başlık ekler:
 *
 *   [ Özellikler | Dosyalar ]   [ ara… ]
 *
 *  - Özellikler: panelin kendi ayarları. Arama kutusu ayarları yerinde süzer
 *    (eşleşen bölümler açılır, diğerleri gizlenir).
 *  - Dosyalar: kayıtlı tasarımlar ve bu oturumda dışa aktarılanlar.
 *  - ↺ Varsayılana dön: değeri değişmiş her ayarın yanında, bölüm başlığında
 *    (grup) ve en üstte (Tümü). attach(side, { reset(ids) }) verilirse toplu
 *    sıfırlama ona bırakılır (tek geri alma adımı); yoksa girişlere olay gönderilir.
 *
 * hooks: {
 *   listDesigns() → Promise<[{ name, mtimeMs }]>, currentName(), isDirty(),
 *   openDesign(name), deleteDesign(name), newDesign(), revealFolder?(),
 *   exports() → [{ name, path, time }], revealExport(path)
 * }
 */
(function (global) {
  'use strict';

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

  // Arama: Türkçe harfler katlanır (ı→i, ğ→g…); uzun sözcüklerde son harf
  // yok sayılır ki "kalınlık" → "kalınlığı" gibi ses değişimleri de eşleşsin.
  const FOLD = { ı: 'i', ğ: 'g', ş: 's', ç: 'c', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u' };
  const norm = (s) => String(s).toLocaleLowerCase('tr-TR').replace(/[ığşçöüâîû]/g, (c) => FOLD[c]);
  function matcher(raw) {
    const words = norm(raw.trim()).split(/\s+/).filter(Boolean).map((w) => (w.length > 4 ? w.slice(0, -1) : w));
    return (...texts) => {
      const hay = norm(texts.join(' '));
      return words.every((w) => hay.includes(w));
    };
  }

  function init(hooks) {
    const hosts = [];
    let designs = [];
    const collapsed = new Set();

    // ---------- dosyalar ----------
    function group(body, title, key, count, actions) {
      const g = el('section', 'ex-group' + (collapsed.has(key) ? ' collapsed' : ''));
      const h = el('button', 'ex-group-head');
      h.innerHTML = '<i class="chev"></i>';
      h.appendChild(el('span', null, title));
      if (count != null) h.appendChild(el('span', 'ex-count', String(count)));
      h.addEventListener('click', () => {
        if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
        g.classList.toggle('collapsed');
      });
      const row = el('div', 'ex-group-row');
      row.appendChild(h);
      (actions || []).forEach(([label, title2, fn]) => {
        const a = el('button', 'ex-act', label);
        a.title = title2;
        a.addEventListener('click', fn);
        row.appendChild(a);
      });
      const list = el('ul', 'ex-list');
      g.append(row, list);
      body.appendChild(g);
      return list;
    }

    function renderFiles(h) {
      const body = h.files;
      body.innerHTML = '';
      const q = h.search.value;
      const m = matcher(q);
      const cur = hooks.currentName();
      const items = designs.filter((d) => m(d.name));
      const actions = [['＋', 'Yeni tasarım (Ctrl+N)', () => hooks.newDesign()], ['⟳', 'Listeyi yenile', refreshFiles]];
      if (hooks.revealFolder) actions.push(['📁', 'Tasarım klasörünü aç', () => hooks.revealFolder()]);
      const list = group(body, 'Tasarımlar', 'designs', items.length, actions);
      if (!items.length) list.appendChild(el('li', 'ex-empty', q.trim() ? 'Eşleşen tasarım yok.' : 'Henüz kayıtlı tasarım yok. Ctrl+S ile kaydedin.'));
      items.forEach((d) => {
        const li = el('li', 'ex-item' + (d.name === cur ? ' current' : ''));
        li.title = d.name === cur ? 'Açık tasarım' : 'Açmak için tıklayın';
        li.appendChild(el('span', 'ex-icon', '◧'));
        const name = el('span', 'ex-name', d.name.replace(/\.json$/i, ''));
        if (d.name === cur && hooks.isDirty()) name.appendChild(el('span', 'ex-dirty', ' ●'));
        li.appendChild(name);
        li.appendChild(el('span', 'ex-meta', fmtTime(d.mtimeMs)));
        const del = el('button', 'ex-del', '×');
        del.title = 'Sil';
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(I18n.t('"{0}" silinsin mi?', [d.name]))) return;
          await hooks.deleteDesign(d.name);
          refreshFiles();
        });
        li.appendChild(del);
        li.addEventListener('click', () => { if (d.name !== cur) hooks.openDesign(d.name); });
        list.appendChild(li);
      });
      const ex = hooks.exports().filter((x) => m(x.name));
      const elist = group(body, 'Dışa aktarılanlar (bu oturum)', 'exports', ex.length);
      if (!ex.length) elist.appendChild(el('li', 'ex-empty', 'STL, SVG veya PNG kaydettiğinizde burada görünür.'));
      ex.forEach((x) => {
        const li = el('li', 'ex-item');
        li.title = `${x.path}\nTıklayın: klasörde göster`;
        const ext = (x.name.match(/\.(\w+)$/) || [])[1] || '';
        li.appendChild(el('span', 'ex-icon ex-ext', ext.toUpperCase()));
        li.appendChild(el('span', 'ex-name', x.name));
        li.appendChild(el('span', 'ex-meta', x.time.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })));
        li.addEventListener('click', () => hooks.revealExport(x.path));
        elist.appendChild(li);
      });
    }

    async function refreshFiles() {
      try { designs = await hooks.listDesigns(); } catch (_) { designs = []; }
      designs.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
      hosts.forEach((h) => { if (h.tab === 'files') renderFiles(h); });
    }

    // ---------- özellikleri süz ----------
    // Bir panelin "birim"leri: .panel-body'nin doğrudan çocukları (alan, onay
    // kutusu, düğme satırı…). Etiket metniyle eşleşenler kalır.
    function unitText(u) {
      const lab = u.querySelector(':scope > label');
      return (lab || u).textContent;
    }
    // İçinde ayrı alanlar taşıyan kapsayıcılar (ör. #fields-room) birim değildir: içine inilir.
    function unitsOf(container) {
      const out = [];
      Array.from(container.children).forEach((c) => {
        if (!c.matches('.field, .cv-range, label') && c.querySelector('.field, .cv-range')) out.push(...unitsOf(c));
        else out.push(c);
      });
      return out;
    }
    function filterProps(h) {
      const q = h.search.value.trim();
      const m = matcher(q);
      let shown = 0;
      h.props.querySelectorAll('.panel').forEach((panel) => {
        const body = panel.querySelector(':scope > .panel-body');
        if (!body) return;
        if (!q) {
          panel.classList.remove('insp-hide');
          body.querySelectorAll('.insp-hide').forEach((u) => u.classList.remove('insp-hide'));
          if (panel.dataset.inspOpen != null) { panel.classList.toggle('open', panel.dataset.inspOpen === '1'); delete panel.dataset.inspOpen; }
          return;
        }
        if (panel.dataset.inspOpen == null) panel.dataset.inspOpen = panel.classList.contains('open') ? '1' : '0';
        const head = panel.querySelector(':scope > .panel-head');
        const titleHit = head && m(head.textContent);
        let hits = 0;
        unitsOf(body).forEach((u) => {
          const hit = titleHit || m(unitText(u));
          u.classList.toggle('insp-hide', !hit);
          if (!hit || u.hidden || u.closest('[hidden]')) return;   // koşula bağlı gizli alan (showIf)
          hits++;
        });
        panel.classList.toggle('insp-hide', hits === 0);
        if (hits) panel.classList.add('open');
        shown += hits;
      });
      h.status.hidden = !q;
      if (q) h.status.textContent = shown ? `${shown} ayar bulundu · Enter: ilkine git` : 'Eşleşen ayar yok';
    }

    // ---------- varsayılana döndürme (↺) ----------
    // Varsayılanı olan her giriş `data-default` taşır. Değeri farklıysa alanın
    // yanında ↺ görünür; bölüm başlığında grup, en üstte "Tümü" sıfırlama.
    const fieldOf = (inp) => inp.closest('.field') || inp.closest('label.check') || inp.parentElement;
    function isDirty(inp) {
      const d = inp.dataset.default;
      if (inp.type === 'checkbox') return inp.checked !== (d === 'true');
      if (inp.type === 'number' || inp.type === 'range') return Math.abs(+inp.value - +d) > 1e-9;
      return String(inp.value).toLowerCase() !== String(d).toLowerCase();
    }
    function defaultText(inp) {
      const d = inp.dataset.default;
      if (inp.type === 'checkbox') return d === 'true' ? 'açık' : 'kapalı';
      if (inp.tagName === 'SELECT') {
        const o = Array.from(inp.options).find((x) => x.value === d);
        return o ? o.textContent.split(' (')[0].split(' — ')[0] : d;
      }
      return inp.type === 'number' ? (+d).toLocaleString(I18n.lang() === 'tr' ? 'tr-TR' : 'en-US') : d;
    }
    function resetInputs(h, inputs) {
      const list = inputs.filter(isDirty);
      if (!list.length) return;
      if (h.reset) {
        h.reset(list.map((i) => i.dataset.setting || i.id));
      } else {
        list.forEach((inp) => {
          if (inp.type === 'checkbox') inp.checked = inp.dataset.default === 'true';
          else inp.value = inp.dataset.default;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      sync(h);
    }
    function resetButton(title, onClick, cls) {
      const b = el('span', 'reset-btn' + (cls ? ' ' + cls : ''), '↺');
      b.setAttribute('role', 'button');
      b.setAttribute('tabindex', '0');
      b.title = title;
      const act = (e) => { e.preventDefault(); e.stopPropagation(); onClick(); };
      b.addEventListener('click', act);
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });
      return b;
    }
    function decorate(h) {
      h.props.querySelectorAll('[data-default]').forEach((inp) => {
        const field = fieldOf(inp);
        if (field.querySelector(':scope .reset-btn:not(.group)')) return;
        const label = field.matches('label') ? field : field.querySelector(':scope > label');
        if (!label) return;
        label.appendChild(resetButton(`Varsayılana dön (${defaultText(inp)})`, () => resetInputs(h, [inp])));
      });
      h.props.querySelectorAll('.panel').forEach((panel) => {
        const head = panel.querySelector(':scope > .panel-head > span');
        if (!head || head.querySelector('.reset-btn') || !panel.querySelector('[data-default]')) return;
        head.appendChild(resetButton('Bu bölümü varsayılana döndür', () => {
          resetInputs(h, Array.from(panel.querySelectorAll('[data-default]')));
        }, 'group'));
      });
    }
    function sync(h) {
      let any = false;
      h.props.querySelectorAll('[data-default]').forEach((inp) => {
        const dirty = isDirty(inp);
        fieldOf(inp).classList.toggle('dirty', dirty);
        if (dirty) any = true;
      });
      h.props.querySelectorAll('.panel').forEach((panel) => {
        const g = panel.querySelector(':scope > .panel-head .reset-btn.group');
        if (g) g.classList.toggle('on', !!panel.querySelector('.dirty'));
      });
      h.resetAll.disabled = !any;
    }
    let syncQueued = false;
    function queueSync() {
      if (syncQueued) return;
      syncQueued = true;
      requestAnimationFrame(() => { syncQueued = false; hosts.forEach(sync); });
    }

    // ---------- bir sağ panele bağlan ----------
    function attach(side, opts) {
      if (side.dataset.inspector) return hosts.find((x) => x.side === side);
      side.dataset.inspector = '1';
      side.classList.add('inspector');
      const head = el('div', 'insp-head');
      head.innerHTML = `
        <div class="insp-row">
          <div class="insp-tabs" role="tablist">
            <button class="seg active" data-t="props" role="tab" title="Özellikler">Özellikler</button>
            <button class="seg" data-t="files" role="tab" title="Dosyalar (Ctrl+J)">Dosyalar</button>
          </div>
          <button class="small insp-resetall" title="Bütün ayarları varsayılana döndür (Ctrl+Z ile geri alınabilir)">↺ Tümü</button>
        </div>
        <div class="insp-search"><input type="text" placeholder="Ayar ara… (Ctrl+P)" aria-label="Ayar ara" /><button class="insp-clear" title="Aramayı temizle (Esc)" hidden>×</button></div>
        <div class="insp-status" hidden></div>`;
      const props = el('div', 'insp-props');
      while (side.firstChild) props.appendChild(side.firstChild);
      const files = el('div', 'insp-files');
      files.hidden = true;
      side.append(head, props, files);
      const h = {
        side, head, props, files, tab: 'props', title: (opts && opts.title) || '',
        search: head.querySelector('input'), clear: head.querySelector('.insp-clear'), status: head.querySelector('.insp-status'),
        savedQuery: { props: '', files: '' },
        resetAll: head.querySelector('.insp-resetall'),
        reset: opts && opts.reset,
      };
      h.resetAll.addEventListener('click', () => {
        if (!confirm(I18n.t('Bu paneldeki bütün ayarlar varsayılana dönsün mü? (Ctrl+Z ile geri alabilirsiniz)'))) return;
        resetInputs(h, Array.from(h.props.querySelectorAll('[data-default]')));
      });
      decorate(h);
      ['input', 'change', 'settings-sync'].forEach((ev) => side.addEventListener(ev, queueSync));
      sync(h);
      head.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => setTab(h, b.dataset.t)));
      const onSearch = () => {
        h.clear.hidden = !h.search.value;
        if (h.tab === 'files') renderFiles(h); else filterProps(h);
      };
      h.search.addEventListener('input', onSearch);
      h.search.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.stopPropagation(); h.search.value = ''; onSearch(); h.search.blur(); }
        if (e.key === 'Enter' && h.tab === 'props') {
          // İlk eşleşen alana odaklan.
          const first = h.props.querySelector('.panel:not(.insp-hide) .panel-body > :not(.insp-hide) input:not([type=hidden]), .panel:not(.insp-hide) .panel-body > :not(.insp-hide) select');
          if (first) { first.focus(); first.scrollIntoView({ block: 'center' }); }
        }
      });
      h.clear.addEventListener('click', () => { h.search.value = ''; onSearch(); });
      hosts.push(h);
      return h;
    }

    function setTab(h, t) {
      if (h.tab === t) return;
      h.savedQuery[h.tab] = h.search.value;
      h.tab = t;
      h.head.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      h.props.hidden = t !== 'props';
      h.resetAll.hidden = t !== 'props';
      h.files.hidden = t !== 'files';
      h.search.value = h.savedQuery[t] || '';
      h.clear.hidden = !h.search.value;
      h.search.placeholder = t === 'files' ? 'Tasarım ara…' : 'Ayar ara… (Ctrl+P)';
      h.status.hidden = true;
      if (t === 'files') refreshFiles(); else filterProps(h);
      h.side.scrollTop = 0;
    }

    const visibleHost = () => hosts.find((h) => h.side.offsetParent !== null);

    return {
      attach,
      /** Görünen panelde Dosyalar ↔ Özellikler. */
      toggleFiles() {
        const h = visibleHost();
        if (h) setTab(h, h.tab === 'files' ? 'props' : 'files');
      },
      filesShown: () => { const h = visibleHost(); return !!h && h.tab === 'files'; },
      /** Görünen panelde ayar aramasına odaklan. */
      focusSearch() {
        const h = visibleHost();
        if (!h) return;
        setTab(h, 'props');
        h.search.focus();
        h.search.select();
      },
      /** Ayarlar programla değişti (geri al, tasarım açma): ↺ ikonlarını tazele. */
      sync: queueSync,
      /** Dosya listesi değişti (kayıt, silme, dışa aktarma). */
      refreshFiles,
    };
  }

  global.Inspector = { init };
})(window);
