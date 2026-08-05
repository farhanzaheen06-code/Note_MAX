// ===== DATABASE MODULE =====
const DB = (() => {
  const DB_NAME = 'NoteMaxDB';
  const DB_VERSION = 3;
  let db = null;

  const STORES = {
    NOTES: 'notes',
    FOLDERS: 'folders',
    TAGS: 'tags',
    SETTINGS: 'settings'
  };

  async function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const d = e.target.result;

        if (!d.objectStoreNames.contains(STORES.NOTES)) {
          const ns = d.createObjectStore(STORES.NOTES, { keyPath: 'id' });
          ns.createIndex('folderId', 'folderId', { unique: false });
          ns.createIndex('modifiedAt', 'modifiedAt', { unique: false });
          ns.createIndex('pinned', 'pinned', { unique: false });
        }

        if (!d.objectStoreNames.contains(STORES.FOLDERS)) {
          d.createObjectStore(STORES.FOLDERS, { keyPath: 'id' });
        }

        if (!d.objectStoreNames.contains(STORES.TAGS)) {
          d.createObjectStore(STORES.TAGS, { keyPath: 'id' });
        }

        if (!d.objectStoreNames.contains(STORES.SETTINGS)) {
          d.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
        }
      };

      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  function getStore(storeName, mode = 'readonly') {
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName).getAll();
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  function get(storeName, id) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName).get(id);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  function put(storeName, item) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName, 'readwrite').put(item);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  function remove(storeName, id) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName, 'readwrite').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  function clear(storeName) {
    return new Promise((resolve, reject) => {
      const req = getStore(storeName, 'readwrite').clear();
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  async function getSetting(key, defaultValue = null) {
    const item = await get(STORES.SETTINGS, key);
    return item ? item.value : defaultValue;
  }

  async function setSetting(key, value) {
    await put(STORES.SETTINGS, { key, value });
  }

  return { open, getAll, get, put, remove, clear, getSetting, setSetting, STORES };
})();