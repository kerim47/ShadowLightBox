/**
 * Arayüz dili (Türkçe varsayılan, İngilizce seçilebilir).
 *
 * Kaynak dil Türkçedir: kod ve HTML Türkçe metin yazar, sözlük (i18n_en.js)
 * Türkçe metni anahtar olarak kullanır. Böylece çevirisi eksik bir metin
 * Türkçe görünür, hiçbir şey bozulmaz.
 *
 *   I18n.t('Panel {n}: …', { n: 3 })  → seçili dilde metin ({ad} yer tutucuları doldurulur)
 *   I18n.add('en', { 'Türkçe': 'English', 'Parça {0} havada': '{0} part floating' })
 *
 * Sözlük anahtarı {0}, {ad} gibi yer tutucu içerebilir: ekrandaki metin bu
 * kalıba uyuyorsa yakalanan değerler (sayılar, adlar; kendileri de çevrilir)
 * İngilizce kalıba yerleştirilir. Böylece kodda şablonla üretilen mesajlar da
 * çevrilir.
 *
 * Dil İngilizceyse I18n.watch(document) sayfadaki metin düğümlerini ve
 * title / placeholder / aria-label özniteliklerini çevirir ve sonradan
 * eklenen/değişen metinleri de (MutationObserver) izler. DOM dışındaki metinler
 * (tuval etiketleri, pencere başlığı, alert) kodda I18n.t ile çevrilir.
 *
 * Dil localStorage'da tutulur; değişince pencere yeniden yüklenir.
 * DOM'suz: Node testlerinde yüklenmese de çekirdek modüller çalışır.
 */
(function (global) {
  'use strict';

  const KEY = 'shadowlamp.lang';
  const LANGS = [['tr', 'Türkçe'], ['en', 'English']];
  let lang = 'tr';
  try {
    const v = global.localStorage && global.localStorage.getItem(KEY);
    if (LANGS.some(([id]) => id === v)) lang = v;
  } catch (_) { /* depolama kapalı */ }

  const dicts = {};        // lang → Map(tr → çeviri)
  const patterns = {};     // lang → [{ re, keys, out }]

  function fill(s, v) {
    return v ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(v, k) ? v[k] : m)) : s;
  }
  const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

  function add(l, map) {
    const d = dicts[l] || (dicts[l] = new Map());
    const pats = patterns[l] || (patterns[l] = []);
    Object.keys(map).forEach((src) => {
      d.set(src, map[src]);
      if (/\{\w+\}/.test(src)) {
        const keys = [];
        const body = src.split(/(\{\w+\})/).map((part) => {
          const m = /^\{(\w+)\}$/.exec(part);
          // Boşluklar esnek: ekrandaki metin kırpılır, boş kalan yer tutucunun önündeki boşluk düşer.
          if (!m) return esc(part).replace(/[{}]/g, '\\$&').replace(/\s+/g, '\\s*');
          keys.push(m[1]);
          return '([\\s\\S]*?)';
        }).join('');
        // Zayıf kalıp: yer tutucular dışında neredeyse metin yok ("{0} ({1})", "{0} — {1}").
        const weak = src.replace(/\{\w+\}/g, '').replace(/\s+/g, '').length < 4;
        pats.push({ re: new RegExp('^' + body + '$'), keys, out: map[src], len: src.length, weak });
      }
    });
    // Uzun (daha özgül) kalıplar önce denenir.
    pats.sort((a, b) => b.len - a.len);
  }

  /** Kod içi çeviri: anahtar birebir aranır, yer tutucular doldurulur. */
  function t(src, vars) {
    const d = dicts[lang];
    const out = d && d.has(src) ? d.get(src) : src;
    return fill(out, vars);
  }

  /** Ekrandaki hazır metni çevirir (birebir, sonra kalıp). Bulunamazsa null. */
  function translateText(text, depth) {
    if (lang === 'tr') return null;
    const d = dicts[lang];
    if (!d) return null;
    const lead = /^\s*/.exec(text)[0], trail = /\s*$/.exec(text)[0];
    const core = text.slice(lead.length, text.length - trail.length);
    if (!core) return null;
    if (d.has(core)) return lead + d.get(core) + trail;
    if ((depth || 0) > 2) return null;
    const tryPatterns = (weak) => {
      for (const p of patterns[lang] || []) {
        if (p.weak !== weak) continue;
        const m = p.re.exec(core);
        if (!m) continue;
        const vars = {};
        let hit = false;
        p.keys.forEach((k, i) => {
          const v = m[i + 1];
          const tv = v && /[^\d\s.,%×+−\-:/()]/.test(v) ? translateText(v, (depth || 0) + 1) : null;
          if (tv != null) hit = true;
          vars[k] = tv != null ? tv : v;
        });
        if (weak && !hit) continue;      // zayıf kalıp yalnızca bir parçası çevrildiyse sayılır
        return lead + fill(p.out, vars).trim() + trail;
      }
      return null;
    };
    const strong = tryPatterns(false);
    if (strong != null) return strong;
    // Birleştirilmiş metin ("cümle. cümle", "a · b"): parçalar ayrı ayrı çevrilir.
    const parts = core.split(SPLIT);
    if (parts.length > 1) {
      let any = false;
      const out = parts.map((part) => {
        if (!part || SEP.test(part)) return part;
        const tr = translateText(part, (depth || 0) + 1);
        if (tr != null) { any = true; return tr; }
        return part;
      });
      if (any) return lead + out.join('') + trail;
    }
    return tryPatterns(true);
  }
  const SPLIT = /(\s·\s|(?<=[.!?…])\s+)/;
  const SEP = /^(\s·\s|\s+)$/;

  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-help', 'data-help-title'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA']);
  const done = new WeakMap();    // düğüm → son yazdığımız metin (kendi değişikliğimizi tekrar çevirme)

  function translateNode(node) {
    if (node.nodeType === 3) {
      const p = node.parentNode;
      if (!p || SKIP.has(p.nodeName) || (p.closest && p.closest('[data-no-i18n]'))) return;
      const v = node.nodeValue;
      if (done.get(node) === v) return;
      const tr = translateText(v);
      if (tr != null && tr !== v) { node.nodeValue = tr; done.set(node, tr); }
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(node.nodeName) || node.hasAttribute('data-no-i18n')) return;
    ATTRS.forEach((a) => {
      const v = node.getAttribute(a);
      if (!v) return;
      const tr = translateText(v);
      if (tr != null && tr !== v) node.setAttribute(a, tr);
    });
    for (let c = node.firstChild; c; c = c.nextSibling) translateNode(c);
  }

  /** Dil Türkçe değilse root'u çevirir ve sonraki değişiklikleri izler. */
  function watch(root) {
    if (lang === 'tr' || !global.MutationObserver) return;
    translateNode(root);
    const obs = new global.MutationObserver((list) => {
      list.forEach((m) => {
        if (m.type === 'characterData') translateNode(m.target);
        else if (m.type === 'attributes') {
          const v = m.target.getAttribute(m.attributeName);
          const tr = v && translateText(v);
          if (tr != null && tr !== v) m.target.setAttribute(m.attributeName, tr);
        } else m.addedNodes.forEach((n) => translateNode(n));
      });
    });
    obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function setLang(l) {
    if (!LANGS.some(([id]) => id === l)) return;
    try { global.localStorage.setItem(KEY, l); } catch (_) { /* depolama kapalı */ }
  }

  global.I18n = { t, add, translateText, watch, setLang, lang: () => lang, LANGS };
})(typeof window !== 'undefined' ? window : globalThis);
