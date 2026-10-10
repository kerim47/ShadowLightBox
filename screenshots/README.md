# screenshots

> **Türkçe özet:** `README.md`'de kullanılan ekran görüntüleri. Kod değil; arayüz değişince yenilenebilir.

| File | Shows |
|---|---|
| `01-photo-portrait.png` | photo window: detailed portrait silhouette (**older UI**) |
| `02-dark-room-shadow.png` | Karanlık Oda, "Ön" camera: the shadow on the wall |
| `03-print-bed.png` | Yazıcı Tablası: lamp body on the bed with dimensions |
| `04-silhouette-editor.png` | Siluet Editörü: tools, footprint overlay, edit operations |
| `05-open-lamp.png` | Karanlık Oda, "İzometrik" camera: open front, LED inside |

Referenced from the root `README.md`. `02`–`05` show the current UI with the bundled sample `electron/samples/zoro.json` and default settings, captured at 1600×1000. `01` still shows the older UI (top-bar buttons, settings on the left); for the current layout read `renderer/index.html`. When the UI changes noticeably, retake them with the Electron capture harness (`docs/DESIGN_RULES.md` §9) and a throwaway `userData` folder, not with personal data in view.
