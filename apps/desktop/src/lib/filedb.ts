// Binary document storage. Metadata lives in the app store; bytes live here so large files never bloat localStorage.
const DB = "jhos-files";
const STORE = "blobs";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const putFile = (key: string, blob: Blob) => run("readwrite", (s) => s.put(blob, key));
export const getFile = (key: string) => run<Blob | undefined>("readonly", (s) => s.get(key));
export const deleteFile = (key: string) => run("readwrite", (s) => s.delete(key));
