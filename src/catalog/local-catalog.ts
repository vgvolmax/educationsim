import { validateCatalog } from './catalog';
import type { CatalogPackage } from './catalog';

const store = 'releases', meta = 'state', database = 'educationsim-catalog';
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(database, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(store, { keyPath: 'releaseId' });
      db.createObjectStore(meta);
    };
    request.onerror = () => reject(request.error ?? new Error('Не удалось открыть каталог Windows.'));
    request.onblocked = () => reject(new Error('Закройте другое окно каталога и повторите.'));
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

export async function readActiveCatalog(factory: IDBFactory): Promise<CatalogPackage | null> {
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([store, meta], 'readonly');
      let current: CatalogPackage | null = null, corrupt = false;
      const active = tx.objectStore(meta).get('active');
      active.onsuccess = () => {
        if (typeof active.result !== 'string') return;
        const req = tx.objectStore(store).get(active.result);
        req.onsuccess = () => {
          const parsed = validateCatalog(req.result);
          if (parsed.ok) current = parsed.value;
          else corrupt = true;
        };
      };
      tx.oncomplete = () => corrupt ? reject(new Error('Локальный выпуск не прошёл проверку.')) : resolve(current);
      tx.onabort = () => reject(tx.error ?? new Error('Не удалось прочитать активный выпуск.'));
      tx.onerror = () => reject(tx.error ?? new Error('Не удалось прочитать активный выпуск.'));
    });
  } finally { db.close(); }
}

export async function activateLocalCatalog(factory: IDBFactory, packageInput: CatalogPackage, bundledId: string): Promise<void> {
  const val = validateCatalog(packageInput);
  if (!val.ok) throw new Error(val.diagnostics[0].message);
  const pkg = val.value;
  if (pkg.releaseId === bundledId) throw new Error('Этот номер уже принадлежит встроенному выпуску.');
  const db = await openDatabase(factory);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([store, meta], 'readwrite');
      const releases = tx.objectStore(store);
      let duplicate = false;
      releases.add(pkg).onerror = (event) => { duplicate = (event.target as IDBRequest).error?.name === 'ConstraintError'; };
      tx.objectStore(meta).put(pkg.releaseId, 'active');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error(duplicate ? 'Выпуск с этим номером уже сохранён.' : 'Не удалось активировать выпуск. Предыдущий каталог не изменён.'));
      tx.onerror = () => { /* abort handler reports the rolled-back transaction */ };
    });
  } finally { db.close(); }
}

export async function listLocalCatalogs(factory: IDBFactory): Promise<string[]> {
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAllKeys();
      tx.oncomplete = () => resolve(req.result.filter((key): key is string => typeof key === 'string'));
      tx.onabort = () => reject(tx.error ?? new Error('Не удалось прочитать архив выпусков.'));
    });
  } finally { db.close(); }
}

export async function selectCatalogRelease(factory: IDBFactory, id: string | null): Promise<CatalogPackage | null> {
  const db = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([store, meta], 'readwrite');
      const state = tx.objectStore(meta);
      let selected: CatalogPackage | null = null, incompatible = false;
      if (id === null) state.delete('active');
      else {
        const req = tx.objectStore(store).get(id);
        req.onsuccess = () => {
          const parsed = validateCatalog(req.result);
          if (!parsed.ok || parsed.value.releaseId !== id) { incompatible = true; tx.abort(); return; }
          selected = parsed.value;
          state.put(id, 'active');
        };
      }
      tx.oncomplete = () => resolve(selected);
      tx.onabort = () => reject(new Error(incompatible ?
        'Сохранённый выпуск отсутствует или несовместим. Активный каталог не изменён.' :
        'Не удалось переключить выпуск. Активный каталог не изменён.'));
    });
  } finally { db.close(); }
}
