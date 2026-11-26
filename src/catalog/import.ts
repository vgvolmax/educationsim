import { validateCatalog } from './catalog.ts';
import type { CatalogPackage } from './catalog.ts';
import type { Result } from '../project/types';

export type CsvRow = Readonly<Record<string, string>>;
const maxBytes = 3 * 1024 * 1024, maxRows = 10_000, maxColumns = 80, maxField = 16_384;

/** Parse untrusted UTF-8 CSV text transactionally. Values stay text, including leading zeroes and empty articles. */
export function parseCatalogCsv(raw: string): Result<CsvRow[]> {
  const fail = (code: string, line: number, message: string): Result<CsvRow[]> =>
    ({ ok: false, diagnostics: [{ code, path: 'csv.' + line, severity: 'error', message }] });
  if (raw.length > maxBytes || new TextEncoder().encode(raw).length > maxBytes) return fail('csv_size', 1, 'Файл CSV слишком большой.');
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (text.includes('\0')) return fail('csv_encoding', 1, 'Файл должен быть обычным текстом UTF-8.');
  let state: 'plain' | 'quoted' | 'closed' = 'plain';
  let line = 1, rowStart = 1, field = '', row: string[] = [];
  let header: string[] | undefined;
  const rows: CsvRow[] = [];

  for (let i = 0; i <= text.length; i++) {
    if (i === text.length && state === 'quoted') return fail('csv_quote', rowStart, 'Незакрытые кавычки в ячейке CSV.');
    const ch = i === text.length ? '\n' : text[i]!;
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else { field += ch; if (ch === '\n') line++; }
    } else if (ch === ',' || ch === '\n') {
      row.push(field); field = ''; state = 'plain';
      if (row.length > maxColumns) return fail('csv_columns', rowStart, 'Слишком много столбцов CSV.');
      if (ch === '\n') {
        if (row.length !== 1 || row[0] !== '') {
          if (!header) {
            header = row.map((name) => name.trim());
            if (new Set(header).size !== header.length || header.some((name) => !/^[a-z][a-z0-9_]{0,79}$/i.test(name) ||
                name === 'constructor' || name === 'prototype')) return fail('csv_header', rowStart, 'Проверьте имена и повторы столбцов CSV.');
          } else {
            if (row.length !== header.length) return fail('csv_row_width', rowStart, 'Число ячеек в строке не совпадает с заголовком.');
            if (rows.length >= maxRows) return fail('csv_rows', rowStart, 'Слишком много строк CSV.');
            rows.push(Object.fromEntries(header.map((name, column) => [name, row[column]!])));
          }
        }
        row = []; rowStart = ++line;
      }
    } else if (ch === '"' && state === 'plain' && !field.length) {
      state = 'quoted';
    } else if (state === 'closed' || ch === '"') {
      return fail('csv_quote', line, 'Кавычки должны обрамлять всю ячейку CSV.');
    } else field += ch;
    if (field.length > maxField) return fail('csv_field_size', line, 'Слишком длинная ячейка CSV.');
  }
  return header ? { ok: true, diagnostics: [], value: rows } : fail('csv_header', 1, 'В файле нет заголовка CSV.');
}

/** A plain offers CSV is catalogue evidence only; it never carries sign-off, curves, or product identities. */
export function normalizeOfferCsv(text: string, releaseId: string, publishedOn: string): Result<CatalogPackage> {
  const parsed = parseCatalogCsv(text);
  if (!parsed.ok) return parsed;
  const offers = [];
  for (const [offset, row] of parsed.value.entries()) {
    const channel = row.channel?.trim(), offerId = row.offer_id?.trim(), title = row.name?.trim(), url = row.url?.trim();
    if (!channel || !offerId || !title || !url) {
      return { ok: false, diagnostics: [{
        code: 'csv_offer_fields', path: 'csv.record.' + (offset + 1), severity: 'error',
        message: 'Для каждой карточки задайте channel, offer_id, name и url.',
      }] };
    }
    offers.push({ channel, offerId, title, url, article: row.article?.trim() ?? '', brand: row.brand?.trim() ?? '',
      scope: 'unreviewed', salesGate: 'no_review', clearance: false, allowedContexts: [] });
  }
  return validateCatalog({ version: 1, releaseId, publishedOn, offers, products: [], kits: [] });
}
