const STATE_KEY = 'nri-connect-static-prototype.v1';
const SESSION_KEY = `${STATE_KEY}.session`;
const REMEMBER_KEY = `${STATE_KEY}.remember`;
const clone = value => value === undefined ? undefined : structuredClone(value);
let storageProblem = '';

export function storageStatus() { return storageProblem; }
export function readSession() {
  try {
    const current = sessionStorage.getItem(SESSION_KEY);
    if (current) return current;
    const remembered = JSON.parse(localStorage.getItem(REMEMBER_KEY) || 'null');
    if (remembered && remembered.expiresAt > Date.now()) return remembered.token;
    localStorage.removeItem(REMEMBER_KEY);
  } catch { /* memory session still works */ }
  return null;
}
export function saveSession(token, maxAge) {
  try {
    token ? sessionStorage.setItem(SESSION_KEY, token) : sessionStorage.removeItem(SESSION_KEY);
    if (token && maxAge) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ token, expiresAt: Date.now() + maxAge }));
    else localStorage.removeItem(REMEMBER_KEY);
  } catch { /* memory session still works */ }
}
export class BrowserStore {
  constructor() {
    this.data = {};
    this.lock = Promise.resolve();
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (saved?.version === 1 && saved.collections && Array.isArray(saved.collections.users)) this.data = saved.collections;
    } catch { storageProblem = 'Browser storage is unavailable; changes last for this visit only.'; }
  }
  persist() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({ version: 1, collections: this.data }));
      storageProblem = '';
    } catch {
      storageProblem = 'Browser storage is full or unavailable; recent changes last for this visit only.';
    }
    globalThis.dispatchEvent?.(new Event('nri-demo-change'));
  }
  async all(collection) { return clone(this.data[collection] || []); }
  async find(collection, predicate) { return (await this.all(collection)).filter(predicate); }
  async get(collection, id) { return clone((this.data[collection] || []).find(item => item.id === id)); }
  async insert(collection, document) { return this.transaction(tx => tx.insert(collection, document)); }
  async update(collection, id, patch) { return this.transaction(tx => tx.update(collection, id, patch)); }
  async remove(collection, id) { return this.transaction(tx => tx.remove(collection, id)); }
  transaction(callback) {
    const run = async () => {
      const working = clone(this.data);
      const tx = {
        all: async collection => clone(working[collection] || []),
        find: async (collection, predicate) => clone((working[collection] || []).filter(predicate)),
        get: async (collection, id) => clone((working[collection] || []).find(item => item.id === id)),
        insert: async (collection, document) => {
          const rows = working[collection] ||= [];
          if (rows.some(item => item.id === document.id)) throw new Error('Duplicate demo record.');
          rows.push(clone(document)); return clone(document);
        },
        update: async (collection, id, patch) => {
          const rows = working[collection] || [];
          const position = rows.findIndex(item => item.id === id);
          if (position < 0) throw new Error('Demo record was not found.');
          rows[position] = { ...rows[position], ...clone(patch) };
          return clone(rows[position]);
        },
        remove: async (collection, id) => {
          const rows = working[collection] || [];
          const position = rows.findIndex(item => item.id === id);
          if (position < 0) return false;
          rows.splice(position, 1); return true;
        },
      };
      tx.transaction = callback => callback(tx);
      const result = await callback(tx);
      this.data = working;
      this.persist();
      return result;
    };
    const next = this.lock.then(run, run);
    this.lock = next.catch(() => {});
    return next;
  }
  async reset() {
    await this.lock;
    this.data = {};
    this.persist();
    saveSession(null);
  }
}

const memoryFiles = new Map();
const objectUrls = new Map();
let connection;
async function database() {
  if (!globalThis.indexedDB) return null;
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('nri-connect-static-prototype-files-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
  return connection;
}
export async function fileOperation(action, key, value) {
  const db = await database();
  if (!db) {
    if (action !== 'get') storageProblem = 'Files last for this visit because browser file storage is unavailable.';
    if (action === 'put') memoryFiles.set(key, value);
    if (action === 'delete') memoryFiles.delete(key);
    if (action === 'clear') memoryFiles.clear();
    return action === 'get' ? memoryFiles.get(key) : undefined;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', action === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('files');
    const request = action === 'put' ? store.put(value, key) : action === 'clear' ? store.clear() : store[action](key);
    let result;
    request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Browser file storage transaction failed.'));
  });
}
export async function localFileUrl(key) {
  if (objectUrls.has(key)) return objectUrls.get(key);
  const blob = await fileOperation('get', key);
  if (!blob) return '';
  const url = URL.createObjectURL(blob);
  objectUrls.set(key, url);
  return url;
}
export function revokeFileUrl(key) {
  if (objectUrls.has(key)) URL.revokeObjectURL(objectUrls.get(key));
  objectUrls.delete(key);
}
export function revokeAllFileUrls() { for (const key of objectUrls.keys()) revokeFileUrl(key); }
