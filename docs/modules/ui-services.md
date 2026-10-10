# Small UI and service modules

> **Türkçe özet:** Menü çubuğu, Inspector (sağ sütun), "?" yardım ikonları, uygulama içi dosya seçici, tasarım depolama ve karşılaştırma modeli okuyucu.

## `menubar.js` — `MenuBar`

```js
const menu = MenuBar.init(hostEl, MENUS, { isBlocked: () => bool, onAction?(item) });
menu.close(); menu.shortcutTable(); MenuBar.prettyShortcut('Ctrl+Shift+E');
```

- `MENUS = [{ label, items: [item | '-'] }]`; `item = { label, shortcut?, altShortcuts?, hint?, action, enabled?(), checked?(), visible?(), radio?, submenu?: () => item[] }`.
- One definition drives the menu row and the keyboard shortcut. Letters/digits match by physical key code; symbols by character (Turkish layouts). Shortcuts are ignored while `isBlocked()` (a modal is open). In text inputs, editing shortcuts (`Ctrl+Z/Y/A/X/C/V`) and unmodified keys stay with the input.
- `visible` scopes an item and its shortcut to a workspace; the same key can mean different things in different workspaces. Submenu items have no shortcuts.

## `inspector.js` — `Inspector`

```js
const inspector = Inspector.init({ listDesigns, currentName, isDirty, openDesign, deleteDesign, newDesign, revealFolder?, exports, revealExport });
inspector.attach(sideEl, { title, reset?(ids) });  // once per workspace side column
inspector.sync(); inspector.refreshFiles(); inspector.toggleFiles(); inspector.filesShown(); inspector.focusSearch();
```

Wraps each workspace's settings column (Lamba `.sidebar`, converter `.cv-side`, editor `.ed-side`) with **Özellikler | Dosyalar** tabs, a Turkish-tolerant search (folds ı/ğ/ş/ç/ö/ü, ignores the last letter of long words), and ↺ reset-to-default buttons (per field, per section, "Tümü"). Defaults come from `data-default` on inputs.

## `helptips.js` — `HelpTips`

`HelpTips.compact(root)` moves every `.field-note` / `.footnote` into a "?" icon next to its label (or section header); hover shows the first sentence, click opens the **Açıklamalar** drawer with all notes of that section. `data-keep-note` opts out. `attach(target, text, title)`, `open(dot)`, `close()`.

## `filepicker.js` — `FilePicker`

Desktop only (`appAPI.listDir` present). Intercepts clicks on every `<input type="file">`, shows an in-app picker (places, list, filter, preview), reads the chosen file through `appAPI.readFile`, sets it on the input and fires `change`. Existing upload code works unchanged. Remembers the last folder in `localStorage['shadowlamp.pickdir']`. Reason: GTK file dialogs crash Electron on Linux. Never call a native dialog instead.

## `storage.js` — `DesignStorage`

Same async API on desktop (IPC `designs:*`) and in a browser (`localStorage` keys `shadowbox.design.<name>` + `.meta`): `list()`, `read(name)`, `write(name, json)`, `remove(name)`, `exists(name)`, `dataDir()`, `reveal()`, `isDesktop`.

## `model_import.js` — `ModelImport`

`await ModelImport.load(file)` → `{ object: THREE.Group (world transforms baked, normals recomputed), triangles, format, defaults: { units, up } }` for STL / OBJ / 3MF / FBX (three.js loaders loaded in `index.html`). Used only by the **Model Karşılaştırma** panel, never for silhouettes. Defaults: STL/3MF → mm, Z up; OBJ → mm, Y up; FBX → cm, Y up (the user can change them).
