import { IDBFactory } from 'fake-indexeddb';
import { expect, test } from 'vitest';
import { activateLocalCatalog, listLocalCatalogs, readActiveCatalog, selectCatalogRelease } from '../../src/catalog/local-catalog';
import type { CatalogPackage } from '../../src/catalog/catalog';

const fake = (releaseId: string): CatalogPackage => ({ version: 1, releaseId, publishedOn: '2026-11-26', offers: [], products: [], kits: [] });

test('failed archived selection is atomic and fallback never deletes the original catalog package', async () => {
  const factory = new IDBFactory();
  const first = fake('older'), latest = fake('newer');
  await activateLocalCatalog(factory, first, 'embedded');
  await activateLocalCatalog(factory, latest, 'embedded');
  await expect(selectCatalogRelease(factory, 'absent')).rejects.toThrow('Активный каталог не изменён');
  await expect(readActiveCatalog(factory)).resolves.toEqual(latest);
  await expect(selectCatalogRelease(factory, null)).resolves.toBeNull();
  await expect(readActiveCatalog(factory)).resolves.toBeNull();
  await expect(listLocalCatalogs(factory)).resolves.toEqual(['newer', 'older']);
  await expect(selectCatalogRelease(factory, 'older')).resolves.toEqual(first);
  await expect(readActiveCatalog(factory)).resolves.toEqual(first);
});
