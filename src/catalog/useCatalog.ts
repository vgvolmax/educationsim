import { useEffect, useRef, useState } from 'react';
import builtin from '../../content/catalog/public-v1.json';
import { parseCatalogJson, validateCatalog } from './catalog';
import type { CatalogPackage } from './catalog';
import { normalizeOfferCsv } from './import';
import { activateLocalCatalog, readActiveCatalog } from './local-catalog';

const parsed = validateCatalog(builtin);
if (!parsed.ok) throw new Error('Некорректный встроенный каталог: ' + parsed.diagnostics[0].message);
const bundled = parsed.value;

export function useCatalog() {
  const [active, setActive] = useState(bundled);
  const [pending, setPending] = useState<CatalogPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState<'embedded' | 'local'>('embedded');
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false;
    void readActiveCatalog(indexedDB).then((saved) => {
      if (disposed || !saved) return;
      setActive(saved); setSource('local');
    }).catch(() => { if (!disposed) setError('Локальный выпуск недоступен. Показан встроенный.'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; generation.current++; };
  }, []);
  async function preview(file: File | undefined, releaseId: string, date: string) {
    const key = ++generation.current;
    setPending(null); setError('');
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { setError('Размер файла превышает 6 МиБ.'); return; }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (key !== generation.current) return;
      const result = file.name.toLowerCase().endsWith('.csv') ?
        normalizeOfferCsv(text, releaseId, date) : parseCatalogJson(text);
      if (!result.ok) { setError(result.diagnostics.map((d) => d.path + ' ' + d.message).join(' ')); return; }
      setPending(result.value);
    } catch { if (key === generation.current) setError('Файл не читается как UTF-8.'); }
  }
  async function activate() {
    if (!pending || loading || writing) return;
    setWriting(true); setError('');
    try {
      await activateLocalCatalog(indexedDB, pending, bundled.releaseId);
      setActive(pending); setSource('local'); setPending(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Сохранение не завершилось.'); }
    finally { setWriting(false); }
  }
  function dismiss() { generation.current++; setPending(null); setError(''); }
  return { active, source, pending, loading, writing, error, preview, activate, dismiss };
}
