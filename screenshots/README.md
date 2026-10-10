# screenshots

> **Türkçe özet:** `README.md`'de kullanılan ekran görüntüleri. Kod değil; arayüz değişince yenilenebilir.

| File | Shows |
|---|---|
| `01-photo-portrait.png` | photo window: detailed portrait silhouette (**older UI**) |
| `02-dark-room-shadow.png` | Karanlık Oda: lamp on the wall and its shadow |
| `03-print-bed.png` | Yazıcı Tablası: print layout with dimensions |
| `04-silhouette-editor.png` | Siluet Editörü: tools, footprint overlay, edit operations |

Referenced from the root `README.md`. `02`–`04` show the current UI (menu bar, Inspector on the right) with the bundled sample `electron/samples/zoro.json`, captured at 1600×1000. `01` still shows the older UI (top-bar buttons, settings on the left); for the current layout read `renderer/index.html`. When the UI changes noticeably, retake them with the Electron capture harness (`docs/DESIGN_RULES.md` §9) and a throwaway `userData` folder, not with personal data in view.
