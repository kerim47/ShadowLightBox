/**
 * Açıklamalar: uzun not metinleri yerine yuvarlak "?" ikonu.
 *  - Üzerine gelince kısa ipucu (ilk cümle) görünür.
 *  - Tıklayınca sağdan açılan "Açıklamalar" panelinde tam metin ve aynı
 *    bölümdeki diğer açıklamalar listelenir.
 *
 * HelpTips.compact(root): root içindeki `.field-note` / `.footnote` öğelerini
 * ait oldukları ayarın etiketine "?" olarak taşır. Ayara bağlı olmayan notlar
 * bölüm başlığına taşınır. `data-keep-note` taşıyan notlara dokunulmaz.
 */
(function (global) {
  'use strict';

  let tip = null, drawer = null, tipTimer = null;

  function ensureUI() {
    if (tip) return;
    tip = document.createElement('div');
    tip.className = 'help-tip';
    tip.hidden = true;
    document.body.appendChild(tip);
    drawer = document.createElement('aside');
    drawer.className = 'help-drawer';
    drawer.setAttribute('aria-label', 'Açıklamalar');
    drawer.innerHTML = '<header><strong>Açıklamalar</strong><button class="small close" title="Kapat (Esc)">×</button></header><div class="help-drawer-body"></div>';
    drawer.querySelector('.close').addEventListener('click', close);
    document.body.appendChild(drawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawer.classList.contains('open')) close(); });
  }

  function firstSentence(text) {
    const m = text.match(/^(.{20,160}?[.!?])(\s|$)/);
    return m ? m[1] : (text.length > 160 ? text.slice(0, 157) + '…' : text);
  }

  function showTip(dot) {
    ensureUI();
    clearTimeout(tipTimer);
    tip.textContent = firstSentence(dot.dataset.help);
    if (dot.dataset.help.length > tip.textContent.length) tip.textContent += '  (tıklayın: devamı)';
    tip.hidden = false;
    const r = dot.getBoundingClientRect();
    const tw = Math.min(300, window.innerWidth - 16);
    tip.style.maxWidth = tw + 'px';
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(8, Math.min(window.innerWidth - tw - 8, x));
    tip.style.left = x + 'px';
    const below = r.bottom + 8;
    tip.style.top = below + 'px';
    requestAnimationFrame(() => {
      if (below + tip.offsetHeight > window.innerHeight - 8) tip.style.top = (r.top - tip.offsetHeight - 8) + 'px';
    });
  }
  function hideTip() { tipTimer = setTimeout(() => { if (tip) tip.hidden = true; }, 80); }

  function open(dot) {
    ensureUI();
    if (tip) tip.hidden = true;
    const body = drawer.querySelector('.help-drawer-body');
    body.innerHTML = '';
    const section = dot.closest('.panel, .modal-box, section') || document.body;
    const add = (d, main) => {
      const item = document.createElement('div');
      item.className = 'help-item' + (main ? ' main' : '');
      const h = document.createElement('h4');
      h.textContent = d.dataset.helpTitle || 'Açıklama';
      const p = document.createElement('p');
      p.textContent = d.dataset.help;
      item.append(h, p);
      if (!main) item.addEventListener('click', () => open(d));
      body.appendChild(item);
    };
    add(dot, true);
    const others = Array.from(section.querySelectorAll('.help-dot')).filter((d) => d !== dot && d.offsetParent !== null);
    if (others.length) {
      const sep = document.createElement('div');
      sep.className = 'help-sep';
      sep.textContent = 'Bu bölümdeki diğer açıklamalar';
      body.appendChild(sep);
      others.forEach((d) => add(d, false));
    }
    drawer.classList.add('open');
  }
  function close() { if (drawer) drawer.classList.remove('open'); }

  /** Bir etiketin yanına "?" ikonu ekler. */
  function attach(target, text, title) {
    const dot = document.createElement('span');
    dot.className = 'help-dot';
    dot.setAttribute('role', 'button');
    dot.setAttribute('tabindex', '0');
    dot.setAttribute('aria-label', 'Açıklama');
    dot.textContent = '?';
    dot.dataset.help = text.trim();
    dot.dataset.helpTitle = (title || '').trim();
    dot.addEventListener('mouseenter', () => showTip(dot));
    dot.addEventListener('mouseleave', hideTip);
    dot.addEventListener('focus', () => showTip(dot));
    dot.addEventListener('blur', hideTip);
    const act = (e) => { e.preventDefault(); e.stopPropagation(); open(dot); };
    dot.addEventListener('click', act);
    dot.addEventListener('mousedown', (e) => e.stopPropagation());
    dot.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });
    target.appendChild(dot);
    return dot;
  }

  function labelText(el) {
    const c = el.cloneNode(true);
    c.querySelectorAll('.help-dot, b, small, input').forEach((n) => n.remove());
    return c.textContent.replace(/\s+/g, ' ').trim();
  }

  function compact(root) {
    (root || document).querySelectorAll('.field-note, .footnote').forEach((note) => {
      if (note.hasAttribute('data-keep-note') || note.closest('[data-keep-note]')) return;
      const text = note.textContent.replace(/\s+/g, ' ').trim();
      if (!text) return;
      const field = note.closest('.field, .cv-range');
      let label = field && field.querySelector(':scope > label');
      if (!label && note.previousElementSibling && note.previousElementSibling.matches('label.check, label')) label = note.previousElementSibling;
      if (label) {
        attach(label, text, labelText(label));
      } else {
        const panel = note.closest('.panel');
        const head = panel && panel.querySelector(':scope > .panel-head > span');
        if (!head) return;                 // yer bulunamazsa not görünür kalır
        attach(head, text, head.textContent);
      }
      note.remove();
    });
  }

  global.HelpTips = { compact, attach, open, close };
})(window);
