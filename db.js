// ===== Snack Stand – IndexedDB storage =====

const DB_NAME = 'snack-stand';
const DB_VERSION = 2; // v2 added the "ingredients" store; existing data is kept as-is
let dbPromise = null;

export function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) {
          db.createObjectStore('items', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('sales')) {
          db.createObjectStore('sales', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('ingredients')) {
          db.createObjectStore('ingredients', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Could not open the database'));
      req.onblocked = () => reject(new Error('Database is blocked by another open tab'));
    });
  }
  return dbPromise;
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run `fn(store | [stores])` inside one transaction; resolves when the transaction completes. */
async function withStore(names, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Database error'));
    tx.onabort = () => reject(tx.error || new Error('Database transaction aborted'));
    const stores = Array.isArray(names) ? names.map((n) => tx.objectStore(n)) : tx.objectStore(names);
    Promise.resolve()
      .then(() => fn(stores))
      .then((r) => { result = r; })
      .catch((err) => { try { tx.abort(); } catch (_) { /* ignore */ } reject(err); });
  });
}

// ----- Menu items -----
export const getAllItems = () => withStore('items', 'readonly', (s) => promisify(s.getAll()));
export const putItem = (item) => withStore('items', 'readwrite', (s) => promisify(s.put(item)));
export const putItems = (items) => withStore('items', 'readwrite', (s) => { for (const it of items) s.put(it); });

// ----- Ingredients -----
export const getAllIngredients = () => withStore('ingredients', 'readonly', (s) => promisify(s.getAll()));
export const putIngredient = (ing) => withStore('ingredients', 'readwrite', (s) => promisify(s.put(ing)));
export const putIngredients = (list) => withStore('ingredients', 'readwrite', (s) => { for (const g of list) s.put(g); });
export const deleteIngredient = (id) => withStore('ingredients', 'readwrite', (s) => promisify(s.delete(id)));

// ----- Sales -----
export const getAllSales = () => withStore('sales', 'readonly', (s) => promisify(s.getAll()));
export const getSalesBetween = (startMs, endMs) =>
  withStore('sales', 'readonly', (s) => promisify(s.index('timestamp').getAll(IDBKeyRange.bound(startMs, endMs, false, true))));
export const putSale = (sale) => withStore('sales', 'readwrite', (s) => promisify(s.put(sale)));
export const deleteSale = (id) => withStore('sales', 'readwrite', (s) => promisify(s.delete(id)));

// ----- Meta (small key/value flags) -----
export const getMeta = async (key) => (await withStore('meta', 'readonly', (s) => promisify(s.get(key))))?.value;
export const setMeta = (key, value) => withStore('meta', 'readwrite', (s) => promisify(s.put({ key, value })));

// ----- Restore from backup: wipe and refill the stores in one transaction -----
export const replaceAll = ({ items, sales, ingredients = [] }) =>
  withStore(['items', 'sales', 'ingredients'], 'readwrite', ([itemStore, saleStore, ingStore]) => {
    itemStore.clear();
    saleStore.clear();
    ingStore.clear();
    for (const it of items) itemStore.put(it);
    for (const s of sales) saleStore.put(s);
    for (const g of ingredients) ingStore.put(g);
  });
