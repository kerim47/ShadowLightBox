const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const fsSync = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

let mainWindow = null;

// GNOME/Wayland'da Electron varsayılan olarak GTK 4 dosya pencerelerini kullanır;
// kaydetme penceresinden sonra dosya seçici açılınca süreç SIGTRAP ile çöküyordu.
// GTK 3 bu pencerelerde kararlı. (Uygulama hazır olmadan önce verilmeli.)
if (process.platform === 'linux') app.commandLine.appendSwitch('gtk-version', '3');

const APP_PAGE = path.join(__dirname, '..', 'renderer', 'index.html');
const APP_PAGE_URL = pathToFileURL(APP_PAGE).href;

function designsDir() {
  return path.join(app.getPath('userData'), 'designs');
}

function bundledSamplesDir() {
  return path.join(__dirname, 'samples');
}

async function ensureDesignsDir() {
  await fs.mkdir(designsDir(), { recursive: true });
}

// Copy any bundled samples into the user's designs folder, but only on a
// truly-fresh install (designs folder empty). Avoids re-creating files the
// user deleted on purpose.
async function seedSamplesIfEmpty() {
  await ensureDesignsDir();
  let existing = [];
  try { existing = await fs.readdir(designsDir()); } catch (_) {}
  if (existing.some((n) => n.toLowerCase().endsWith('.json'))) return;

  let samples = [];
  try { samples = await fs.readdir(bundledSamplesDir()); } catch (_) { return; }
  for (const name of samples) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    try {
      const src = path.join(bundledSamplesDir(), name);
      const dst = path.join(designsDir(), name);
      await fs.copyFile(src, dst);
    } catch (_) { /* skip on copy error */ }
  }
}

// Windows'ta dosya adı olarak kullanılamayan aygıt adları.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function safeName(name) {
  const cleaned = String(name).replace(/[^a-zA-Z0-9._ -]/g, '_').trim().slice(0, 120);
  const base = cleaned.replace(/\.json$/i, '');
  if (!base || /^\.+$/.test(base) || RESERVED.test(base)) {
    throw new Error('invalid filename');
  }
  return base + '.json';
}

// ---------- güvenlik: IPC yalnızca uygulamanın kendi sayfasından kabul edilir ----------

function assertTrustedSender(e) {
  const url = e && e.senderFrame ? e.senderFrame.url : '';
  if (!url || url.split(/[?#]/)[0] !== APP_PAGE_URL) {
    throw new Error('untrusted IPC sender');
  }
}

function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    assertTrustedSender(e);
    return fn(e, ...args);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: '#1a1a18',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(APP_PAGE);

  // Kaydedilmemiş değişiklik varken sayfa kapanmayı engeller (beforeunload);
  // Electron bunu sessizce yapar, kullanıcıya burada sorulur.
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'question',
      buttons: ['Kaydet ve çık', 'Kaydetmeden çık', 'İptal'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      title: 'Kaydedilmemiş değişiklikler',
      message: 'Tasarımda kaydedilmemiş değişiklikler var.',
      detail: 'Kaydetmeden çıkarsanız son değişiklikler kaybolur.',
    });
    if (choice === 1) event.preventDefault();                       // engeli yok say, kapat
    else if (choice === 0) mainWindow.webContents.send('app:save-and-close');
  });

  // Electron persists the per-origin zoom factor across launches; reset on each load
  // so the app always starts at 100%.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomLevel(0);
  });

  // Hidden-menu builds lose Chromium's default zoom keybindings. Wire them
  // explicitly so Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0 all work, regardless of
  // keyboard layout.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (!input.control && !input.meta) return;
    const wc = mainWindow.webContents;
    const step = 0.5;
    if (input.key === '=' || input.key === '+') {
      event.preventDefault();
      wc.setZoomLevel(wc.getZoomLevel() + step);
    } else if (input.key === '-' || input.key === '_') {
      event.preventDefault();
      wc.setZoomLevel(wc.getZoomLevel() - step);
    } else if (input.key === '0') {
      event.preventDefault();
      wc.setZoomLevel(0);
    }
  });
}

// ---------- güvenlik: gezinme, yeni pencere, webview ve izinler ----------

app.on('web-contents-created', (_e, contents) => {
  // Uygulama sayfası dışına gezinme yok (ör. sürüklenip bırakılan dosya/bağlantı).
  contents.on('will-navigate', (event, url) => {
    if (url.split(/[?#]/)[0] !== APP_PAGE_URL) event.preventDefault();
  });
  contents.on('will-redirect', (event) => event.preventDefault());
  // Yeni pencere açılmaz; http(s) bağlantıları varsa sistem tarayıcısında açılır.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

app.whenReady().then(async () => {
  // Uygulama kamera, mikrofon, konum, bildirim vb. kullanmaz: hepsi reddedilir.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  await ensureDesignsDir();
  await seedSamplesIfEmpty();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- tasarım dosyaları ----------

const MAX_DESIGN_BYTES = 64 * 1024 * 1024;   // 2048² hedef görüntü dahil rahatça yeter

// ---------- dışa aktarma: İndirilenler klasörüne pencere açmadan yaz ----------

const MAX_EXPORT_BYTES = 512 * 1024 * 1024;
const EXPORT_EXT = /\.(stl|3mf|obj|fbx|ply|glb|svg|png|json)$/i;

handle('file:save', async (_e, name, data) => {
  const base = path.basename(String(name || 'dosya')).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120);
  if (!EXPORT_EXT.test(base)) throw new Error('unsupported export type');
  const buf = Buffer.from(data);
  if (buf.length > MAX_EXPORT_BYTES) throw new Error('export too large');
  const dir = app.getPath('downloads');
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(base), stem = base.slice(0, -ext.length);
  let file = path.join(dir, base);
  for (let i = 2; fsSync.existsSync(file); i++) file = path.join(dir, `${stem} (${i})${ext}`);
  await fs.writeFile(file, buf);
  return file;
});

// ---------- uygulama içi dosya seçici ----------
// Sistem (GTK) dosya penceresi Linux'ta süreci çökertiyordu (GLib "no handler
// with id" → SIGTRAP). Dosyalar ana süreçte listelenir/okunur; pencere renderer'da.

const PICK_EXT = /\.(png|jpe?g|webp|gif|bmp|svg|json|stl|obj|3mf|fbx)$/i;
const MAX_PICK_BYTES = 300 * 1024 * 1024;

handle('fs:places', async () => {
  const get = (k) => { try { return app.getPath(k); } catch (_) { return null; } };
  return [
    ['Ev', get('home')], ['Masaüstü', get('desktop')], ['Belgeler', get('documents')],
    ['Resimler', get('pictures')], ['İndirilenler', get('downloads')],
  ].filter(([, p]) => p && fsSync.existsSync(p)).map(([name, p]) => ({ name, path: p }));
});

handle('fs:list', async (_e, dir) => {
  const d = path.resolve(String(dir || app.getPath('home')));
  const names = await fs.readdir(d, { withFileTypes: true });
  const entries = [];
  for (const ent of names) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(d, ent.name);
    let st;
    try { st = await fs.stat(full); } catch (_) { continue; }
    if (st.isDirectory()) entries.push({ name: ent.name, dir: true, mtimeMs: st.mtimeMs });
    else if (st.isFile() && PICK_EXT.test(ent.name)) entries.push({ name: ent.name, dir: false, size: st.size, mtimeMs: st.mtimeMs });
  }
  const parent = path.dirname(d);
  return { dir: d, parent: parent !== d ? parent : null, sep: path.sep, entries };
});

handle('fs:read', async (_e, file) => {
  const f = path.resolve(String(file || ''));
  if (!PICK_EXT.test(f)) throw new Error('unsupported file type');
  const st = await fs.stat(f);
  if (!st.isFile() || st.size > MAX_PICK_BYTES) throw new Error('file too large');
  const buf = await fs.readFile(f);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

handle('file:reveal', async (_e, file) => {
  const dir = app.getPath('downloads');
  const resolved = path.resolve(String(file || ''));
  if (path.dirname(resolved) !== path.resolve(dir)) throw new Error('outside downloads');
  shell.showItemInFolder(resolved);
});

handle('designs:list', async () => {
  await ensureDesignsDir();
  const entries = await fs.readdir(designsDir());
  const out = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.json')) continue;
    try {
      const stat = await fs.stat(path.join(designsDir(), name));
      if (stat.isFile()) out.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch (_) { /* skip unreadable */ }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
});

handle('designs:read', async (_e, name) => {
  const file = path.join(designsDir(), safeName(name));
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_DESIGN_BYTES) throw new Error('design file too large');
  return await fs.readFile(file, 'utf8');
});

handle('designs:write', async (_e, name, content) => {
  if (typeof content !== 'string') throw new Error('invalid design content');
  if (Buffer.byteLength(content, 'utf8') > MAX_DESIGN_BYTES) throw new Error('design too large');
  JSON.parse(content);   // yalnızca geçerli JSON yazılır
  await ensureDesignsDir();
  const safe = safeName(name);
  await fs.writeFile(path.join(designsDir(), safe), content, 'utf8');
  return { name: safe };
});

handle('designs:delete', async (_e, name) => {
  const file = path.join(designsDir(), safeName(name));
  await fs.unlink(file);
});

handle('designs:exists', async (_e, name) => {
  try {
    await fs.access(path.join(designsDir(), safeName(name)));
    return true;
  } catch (_) {
    return false;
  }
});

handle('designs:dir', () => designsDir());

handle('designs:reveal', async () => {
  await ensureDesignsDir();
  shell.openPath(designsDir());
});

// ---------- AI background removal (onnxruntime-node, models from rembg releases) ----------
//
// Both models are Apache-2.0 (commercial use OK). They are downloaded on first
// use into <userData>/models and cached. The renderer does pre/post-processing
// on a canvas; here we only run the network. Every model file is verified
// against a pinned SHA-256 before it is loaded (download and cached copy).

const MODELS = {
  'isnet-general-use': {
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a',
    bytes: 178648008,
    size: 1024,
  },
  'u2netp': {
    url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',
    bytes: 4574861,
    size: 320,
  },
};
const sessions = new Map();
let ort = null;

function modelsDir() {
  return path.join(app.getPath('userData'), 'models');
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fsSync.createReadStream(file), hash);
  return hash.digest('hex');
}

async function ensureModel(name, sender) {
  const spec = MODELS[name];
  if (!spec) throw new Error(`unknown model ${name}`);
  const file = path.join(modelsDir(), `${name}.onnx`);
  try {
    const st = await fs.stat(file);
    if (st.size === spec.bytes && (await sha256File(file)) === spec.sha256) return file;
    await fs.unlink(file);   // bozuk veya değiştirilmiş önbellek → yeniden indir
  } catch (_) { /* not downloaded yet */ }
  await fs.mkdir(modelsDir(), { recursive: true });
  const res = await fetch(spec.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = +res.headers.get('content-length') || spec.bytes;
  if (total > spec.bytes * 1.05) throw new Error('unexpected model size');
  let received = 0;
  let lastSent = 0;
  const tmp = file + '.part';
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > spec.bytes * 1.05) { cb(new Error('unexpected model size')); return; }
      const now = Date.now();
      if (now - lastSent > 150) {
        lastSent = now;
        sender.send('bg:progress', { phase: 'download', model: name, received, total });
      }
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body), counter, fsSync.createWriteStream(tmp));
    if ((await sha256File(tmp)) !== spec.sha256) throw new Error('model checksum mismatch');
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  sender.send('bg:progress', { phase: 'download', model: name, received, total: received });
  return file;
}

async function getSession(name, sender) {
  if (sessions.has(name)) return sessions.get(name);
  if (!ort) ort = require('onnxruntime-node');
  const file = await ensureModel(name, sender);
  sender.send('bg:progress', { phase: 'load', model: name });
  const s = await ort.InferenceSession.create(file);
  sessions.set(name, s);
  return s;
}

handle('bg:remove', async (e, payload) => {
  const { model, size, data } = payload || {};
  const name = model || 'isnet-general-use';
  const spec = MODELS[name];
  // Girdi doğrulama: bilinen model, modele uygun kare boyut, tam 1×3×S×S float tensör.
  if (!spec) throw new Error('unknown model');
  if (size !== spec.size) throw new Error('invalid input size');
  if (!(data instanceof Float32Array) || data.length !== 3 * size * size) throw new Error('invalid input tensor');
  let s;
  try {
    s = await getSession(name, e.sender);
  } catch (err) {
    if (name === 'u2netp') throw err;
    // Big model unavailable (offline / blocked) → fall back to the small one.
    console.warn('isnet unavailable, falling back to u2netp:', err.message);
    e.sender.send('bg:progress', { phase: 'fallback', model: 'u2netp', reason: err.message });
    return { fallback: 'u2netp' };
  }
  e.sender.send('bg:progress', { phase: 'run', model: name });
  const input = new ort.Tensor('float32', data, [1, 3, size, size]);
  const out = await s.run({ [s.inputNames[0]]: input });
  const pred = out[s.outputNames[0]].data;
  return { mask: Float32Array.from(pred), size };
});
