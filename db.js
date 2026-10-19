// Tiny IndexedDB wrapper
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open('inkminder', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then(v => out = v);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    all: store => tx(store, 'readonly', s => req(s.getAll())),
    put: (store, obj) => tx(store, 'readwrite', s => { s.put(obj); }),
    del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
    clear: store => tx(store, 'readwrite', s => { s.clear(); }),
  };
})();
