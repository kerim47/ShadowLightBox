/**
 * Uygulama menü çubuğu (Dosya · Düzen · Görünüm · Araçlar · Yardım) ve
 * klavye kısayolları.
 *
 * Menüler veri olarak tanımlanır:
 *   { label, items: [ item | '-' ] }
 *   item: { label, shortcut?, action, enabled?(), checked?(), visible?(),
 *           radio?: true, submenu?: () => item[],
 *           hint?: yalnızca gösterilen kısayol (tarayıcıya bırakılır, ör. Ctrl+V) }
 * Kısayol dizgesi menüde gösterilir ve klavyeden de çalışır:
 * "Ctrl+Shift+S", "F1", "Alt+1", "Ctrl+." … (Ctrl macOS'ta ⌘ da olur).
 */
(function (global) {
  'use strict';

  const KEY_NAMES = { '.': 'Period', ',': 'Comma', '/': 'Slash', '\\': 'Backslash', '=': 'Equal', '-': 'Minus', '+': 'Equal' };

  function parseShortcut(s) {
    const parts = s.split('+').map((p) => p.trim());
    // "Ctrl++" → son parça boş: artı tuşu
    if (s.endsWith('++')) { parts.splice(parts.length - 2, 2, '+'); }
    const key = parts.pop();
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    return { ctrl: mods.has('ctrl'), shift: mods.has('shift'), alt: mods.has('alt'), key };
  }

  function codeFor(key) {
    if (/^F\d{1,2}$/.test(key)) return key;
    if (/^[0-9]$/.test(key)) return 'Digit' + key;
    if (/^[A-Za-z]$/.test(key)) return 'Key' + key.toUpperCase();
    if (KEY_NAMES[key]) return KEY_NAMES[key];
    return key;   // Escape, Delete, Enter…
  }

  function matches(sc, e) {
    if (!!(e.ctrlKey || e.metaKey) !== sc.ctrl || !!e.altKey !== sc.alt) return false;
    const code = codeFor(sc.key);
    // Simge tuşları klavye düzenine göre yer değiştirir (Türkçe Q'da "." başka tuşta): karaktere bak.
    if (sc.key.length === 1 && !/[a-z0-9]/i.test(sc.key)) {
      if (e.key === sc.key) return true;
      if (sc.key === '+' && (e.code === 'NumpadAdd' || e.code === 'Equal')) return true;
      if (sc.key === '-' && e.code === 'NumpadSubtract') return true;
      return !!e.shiftKey === sc.shift && e.code === code;
    }
    // Harf / rakam / F tuşları: fiziksel tuş kodu, Shift birebir.
    if (!!e.shiftKey !== sc.shift) return false;
    return e.code === code || (code.startsWith('Digit') && e.code === 'Numpad' + code.slice(5));
  }

  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  function prettyShortcut(s) {
    return isMac ? s.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : s;
  }

  function isTextTarget(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    return t.tagName === 'INPUT' && !/^(checkbox|radio|range|button|color|file)$/i.test(t.type);
  }

  function init(host, menus, opts) {
    const o = opts || {};
    host.innerHTML = '';
    host.classList.add('menubar');
    host.setAttribute('role', 'menubar');
    let openIdx = -1;
    let dropdown = null;
    const buttons = menus.map((m, i) => {
      const b = document.createElement('button');
      b.className = 'mb-top';
      b.textContent = m.label;
      b.setAttribute('role', 'menuitem');
      b.addEventListener('mousedown', (e) => { e.preventDefault(); openIdx === i ? close() : open(i); });
      b.addEventListener('mouseenter', () => { if (openIdx >= 0 && openIdx !== i) open(i); });
      host.appendChild(b);
      return b;
    });

    const visible = (it) => !it.visible || it.visible();
    const enabled = (it) => !it.enabled || it.enabled();

    function buildList(items, parentEl) {
      const list = document.createElement('div');
      list.className = 'mb-drop';
      list.setAttribute('role', 'menu');
      let lastSep = true;
      items.forEach((it) => {
        if (it === '-') {
          if (!lastSep) { list.appendChild(Object.assign(document.createElement('div'), { className: 'mb-sep' })); lastSep = true; }
          return;
        }
        if (!visible(it)) return;
        lastSep = false;
        const row = document.createElement('button');
        row.className = 'mb-item';
        row.setAttribute('role', it.checked ? (it.radio ? 'menuitemradio' : 'menuitemcheckbox') : 'menuitem');
        const on = it.checked ? it.checked() : false;
        row.innerHTML = `<span class="mb-check">${it.checked ? (on ? (it.radio ? '●' : '✓') : '') : ''}</span>`
          + `<span class="mb-label"></span><span class="mb-sc">${it.submenu ? '▸' : ((it.shortcut || it.hint) ? prettyShortcut(it.shortcut || it.hint) : '')}</span>`;
        row.querySelector('.mb-label').textContent = it.label;
        if (!enabled(it)) row.disabled = true;
        if (it.submenu) {
          row.classList.add('has-sub');
          row.addEventListener('mouseenter', () => {
            list.querySelectorAll('.mb-drop').forEach((d) => d.remove());
            const subItems = it.submenu();
            const sub = buildList(subItems.length ? subItems : [{ label: '(boş)', enabled: () => false, action() {} }], row);
            sub.classList.add('mb-sub');
            sub.style.top = row.offsetTop - 4 + 'px';
            sub.style.left = list.offsetWidth - 4 + 'px';
            list.appendChild(sub);
          });
        } else {
          row.addEventListener('mouseenter', () => { if (parentEl === null) list.querySelectorAll('.mb-sub').forEach((d) => d.remove()); });
          row.addEventListener('click', () => { close(); run(it); });
        }
        list.appendChild(row);
      });
      if (list.lastChild && list.lastChild.className === 'mb-sep') list.lastChild.remove();
      return list;
    }

    function open(i) {
      close();
      openIdx = i;
      buttons[i].classList.add('open');
      dropdown = buildList(menus[i].items, null);
      const r = buttons[i].getBoundingClientRect();
      dropdown.style.left = r.left + 'px';
      dropdown.style.top = r.bottom + 2 + 'px';
      document.body.appendChild(dropdown);
    }
    function close() {
      if (dropdown) dropdown.remove();
      dropdown = null;
      if (openIdx >= 0) buttons[openIdx].classList.remove('open');
      openIdx = -1;
    }
    function run(it) {
      if (!enabled(it) || !visible(it)) return;
      try { it.action(); } catch (err) { console.error(err); }
      if (o.onAction) o.onAction(it);
    }

    document.addEventListener('mousedown', (e) => {
      if (!dropdown) return;
      if (dropdown.contains(e.target) || host.contains(e.target)) return;
      close();
    });
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);

    // Kısayollar: düz liste (alt menüler hariç; dinamik oldukları için).
    const flat = [];
    menus.forEach((m) => m.items.forEach((it) => {
      if (it === '-' || !it.shortcut) return;
      [it.shortcut].concat(it.altShortcuts || []).forEach((s) => flat.push({ it, sc: parseShortcut(s) }));
    }));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dropdown) { close(); e.preventDefault(); return; }
      if (dropdown && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        open((openIdx + (e.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length);
        e.preventDefault();
        return;
      }
      if (o.isBlocked && o.isBlocked()) return;            // açık iletişim kutusu
      const text = isTextTarget(e.target);
      for (const { it, sc } of flat) {
        if (!matches(sc, e)) continue;
        // Yazı alanında düzenleme kısayolları (Ctrl+Z, Ctrl+A…) ve kipsiz tuşlar alana kalır.
        if (text && (!sc.ctrl || /^[ZYAXCV]$/i.test(sc.key))) return;
        if (!visible(it)) continue;              // aynı kısayol başka çalışma alanında başka işe bağlı olabilir
        e.preventDefault();
        if (!enabled(it)) return;
        e.stopPropagation();
        close();
        run(it);
        return;
      }
    });

    /** Kısayol listesi: [{ group, items: [{ label, shortcut }] }] */
    function shortcutTable() {
      return menus.map((m) => ({
        group: m.label,
        items: m.items.filter((it) => it !== '-' && (it.shortcut || it.hint) && visible(it)).map((it) => ({
          label: it.label, shortcut: [it.shortcut || it.hint].concat(it.altShortcuts || []).map(prettyShortcut).join('  /  '),
        })),
      })).filter((g) => g.items.length);
    }

    return { close, shortcutTable, prettyShortcut };
  }

  global.MenuBar = { init, prettyShortcut };
})(window);
