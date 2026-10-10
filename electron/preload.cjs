const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appAPI', {
  isDesktop: true,
  list:    ()                => ipcRenderer.invoke('designs:list'),
  read:    (name)            => ipcRenderer.invoke('designs:read', name),
  write:   (name, content)   => ipcRenderer.invoke('designs:write', name, content),
  remove:  (name)            => ipcRenderer.invoke('designs:delete', name),
  exists:  (name)            => ipcRenderer.invoke('designs:exists', name),
  dataDir: ()                => ipcRenderer.invoke('designs:dir'),
  reveal:  ()                => ipcRenderer.invoke('designs:reveal'),
  // Dışa aktarma (model biçimleri, SVG, PNG, JSON — izinli uzantılar main.cjs EXPORT_EXT): İndirilenler'e yazar, tam yolu döner.
  saveFile:   (name, data)   => ipcRenderer.invoke('file:save', name, data),
  revealFile: (file)         => ipcRenderer.invoke('file:reveal', file),
  // Uygulama içi dosya seçici (sistem dosya penceresi kullanılmaz).
  places:     ()             => ipcRenderer.invoke('fs:places'),
  listDir:    (dir)          => ipcRenderer.invoke('fs:list', dir),
  readFile:   (file)         => ipcRenderer.invoke('fs:read', file),
  // Kapatma penceresinde "Kaydet ve çık" seçilince çağrılır.
  onSaveAndClose: (fn)       => ipcRenderer.on('app:save-and-close', () => fn()),
  // AI background removal. payload: { model, size, data: Float32Array (1×3×S×S) }.
  // Resolves to the raw S×S prediction (Float32Array). Falls back to the small
  // model automatically when the large one can't be downloaded.
  removeBackground: async (payload, onProgress) => {
    const listener = (_e, msg) => { if (onProgress) onProgress(msg); };
    ipcRenderer.on('bg:progress', listener);
    try {
      let res = await ipcRenderer.invoke('bg:remove', payload);
      if (res && res.fallback) return { fallback: res.fallback };
      return res.mask;
    } finally {
      ipcRenderer.removeListener('bg:progress', listener);
    }
  },
});
