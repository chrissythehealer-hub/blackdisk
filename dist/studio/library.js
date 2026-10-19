// "My Projects": stored in this browser only (IndexedDB). Nothing is uploaded to BLVCKDISK.
// Clearing site data, private browsing or a different device means a different (empty) library.
const DB = 'blvckdisk-studio';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('This browser can’t store projects.'));
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(...[].concat(stores).map(s => t.objectStore(s)))).then(r => { result = r; });
    t.oncomplete = () => { db.close(); resolve(result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error || new Error('Storage failed')); };
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export async function listProjects() {
  const all = await tx('projects', 'readonly', s => req(s.getAll()));
  return all.sort((a, b) => b.updated - a.updated);
}
export async function getProject(id) {
  return tx('projects', 'readonly', s => req(s.get(id)));
}
export async function saveProject(p) {
  const record = { ...p, updated: Date.now() };
  await tx('projects', 'readwrite', s => req(s.put(record)));
  return record;
}
export async function saveVideo(projectId, blob) {
  await tx('videos', 'readwrite', s => req(s.put(blob, projectId)));
}
export async function getVideo(projectId) {
  return tx('videos', 'readonly', s => req(s.get(projectId)));
}
export async function deleteProject(id) {
  await tx(['projects', 'videos'], 'readwrite', (p, v) => Promise.all([req(p.delete(id)), req(v.delete(id))]));
}

/** Asks the browser not to clear this site's storage under pressure. Returns true if granted. */
export async function requestPersistence() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
export async function usage() {
  try { return await navigator.storage?.estimate?.(); } catch { return null; }
}
