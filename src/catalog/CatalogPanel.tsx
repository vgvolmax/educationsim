import { useMemo, useState } from 'react';
import type { CatalogContext, CatalogKit, CatalogOffer } from './catalog';
import { offerKey } from './catalog';
import { CompatibilityPreview } from './CompatibilityPreview';
import { useCatalog } from './useCatalog';
import type { ProjectController } from '../editor/useProject';
import type { ComponentInstance, ProjectDocument } from '../project/types';
import './catalog.css';

const contexts: Record<CatalogContext, string> = { floor: 'Петля тёплого пола', heating: 'Обвязка отопления',
  radiator: 'Радиаторная ветвь', service: 'Сервисный узел' };
const decision: Record<CatalogOffer['scope'], string> = { ...contexts, excluded: 'Не входит в область применения', hold: 'Неоднозначная карточка',
  unreviewed: 'Не проверено' };
const evidence: Record<string, string> = { manufacturer: 'Публичные сведения производителя о назначении',
  manufacturer_and_trade: 'Производитель и профильный продавец', store_card: 'Карточка магазина', incomplete_card: 'Неполная карточка',
  conflicting_card: 'Противоречивая карточка' };
const lower = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е');
type Props = { project: ProjectDocument; selected?: ComponentInstance; level: number; ctl: ProjectController; onPlaced(id: string): void };

function KitDetails({ kit, project, onSelect }: { kit: CatalogKit; project: ProjectDocument; onSelect(key: string): void }) {
  const snapshots = new Map(project.appliedCatalogSnapshots.map((s) => [s.id, s]));
  const installed = new Map<string, number>();
  for (const c of project.components) {
    const card = c.catalogSnapshotId ? snapshots.get(c.catalogSnapshotId)?.catalogCard : undefined;
    if (card) installed.set(card.key, (installed.get(card.key) ?? 0) + 1);
  }
  return <section className="catalog-kit" aria-label="Опубликованный состав">
    <h4>Опубликованный состав карточки</h4>
    {kit.ambiguity && <p className="catalog-caution">{kit.ambiguity}</p>}
    <ul>{kit.parts.map((part) => {
      const key = offerKey(part.channel, part.offerId), fitted = installed.get(key) ?? 0;
      return <li key={key}><button onClick={() => onSelect(key)}>{part.article || part.offerId} · {part.title}</button>
        <p>{part.article || part.offerId} · {part.quantity} {part.unit} · {part.included ? 'входит по карточке' : 'отдельная позиция'}.
          {fitted > 0 ? ' В схеме: ' + fitted + '. ' : ' В схеме не отмечено.'}</p></li>;
    })}</ul>
    <p>Трубу и материалы пола проверяйте отдельно: в опубликованном наборе они не перечислены.</p>
  </section>;
}
export function CatalogPanel({ project, selected, level, ctl, onPlaced }: Props) {
  const catalog = useCatalog();
  const current = catalog.active;
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const [context, setContext] = useState<CatalogContext>('floor');
  const [filter, setFilter] = useState(false), [limit, setLimit] = useState(30);
  const [csvId, setCsvId] = useState('');
  const matches = useMemo(() => {
    const q = lower(query.trim()), terms = q.split(/\s+/).filter(Boolean);
    return current.offers.filter((o) => (!filter || o.allowedContexts.includes(context)) &&
      terms.every((word) => lower(o.title + ' ' + o.article + ' ' + o.offerId + ' ' + o.brand + ' ' + (o.review?.role ?? '')).includes(word)));
  }, [current, query, filter, context]);
  const offer = current.offers.find((o) => offerKey(o.channel, o.offerId) === selection);
  const kit = current.kits.find((k) => offerKey(k.channel, k.offerId) === selection);
  const profile = current.products.find((p) => p.id === offer?.productId);
  return <section className="catalog-panel" data-testid="catalog-panel" data-active-release={current.releaseId} aria-label="Каталог ВОЛМАКС">
    <h2>Каталог ВОЛМАКС</h2><p>Справочник для обучения менеджеров. Не подбирает товары к покупке.</p><p>Версия: {current.releaseId}</p>
    <p>{current.publishedOn} · {catalog.loading ? 'Читаем локальный профиль…' : catalog.source === 'embedded' ? 'Встроенный выпуск' : 'Локальный импорт'}</p>
    <div className="catalog-tools">
      <label>Поиск по артикулу, ID или названию<input type="search" value={query} onChange={(e) => {
        setQuery(e.target.value); setSelection(''); setLimit(30);
      }} /></label>
      <label>Контекст каталога<select value={context} onChange={(e) => setContext(e.target.value as CatalogContext)}>
        {Object.entries(contexts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="catalog-filter"><input type="checkbox" checked={filter} onChange={(e) => setFilter(e.target.checked)} /> Только этот контекст</label>
    </div>
    <div className="catalog-columns">
      <div className="catalog-index"><p>Карточек найдено: {matches.length}</p>
        {matches.slice(0, limit).map((o) => {
          const key = offerKey(o.channel, o.offerId);
          return <button key={key} data-testid={'offer-' + o.offerId} aria-pressed={key === selection} onClick={() => setSelection(key)}>
            <strong>{o.article || 'Без артикула'} · {o.offerId}</strong><span>{o.title}</span></button>;
        })}
        {matches.length > limit && <button onClick={() => setLimit((n) => n + 30)}>Загрузить ещё 30</button>}
      </div>
      <article className="catalog-detail">
        {!offer ? <p>Выберите карточку. Исходные данные не означают пригодность к продаже или монтажу.</p> : <>
          <h3>{offer.title}</h3><p>{offer.brand || 'Марка не указана'} · {offer.article || 'Артикул не указан'}</p>
          <p><strong>{decision[offer.scope]}</strong></p>
          <p className="catalog-caution">Учебная карточка. Не используйте её как рекомендацию к покупке.</p>
          {offer.clearance && <p>На исходной карточке отмечена ликвидация. Проверьте остаток и условия отдельно.</p>}
          {offer.review && <><p><strong>{offer.review.role}</strong></p><p>{offer.review.use} · {evidence[offer.review.basis] ?? offer.review.basis}</p>
            <p>{offer.review.evidence}</p><p>Что проверить: {offer.review.next}</p></>}
          {profile && <p>Профиль из файла: {profile.modelId}. Напор {profile.ratings.headPa} Па; расход {profile.ratings.flowM3s} м³/с.
            Эти сведения не подтверждают допуск к продаже в приложении.</p>}
          {offer.url.startsWith('https://volmax.ru/catalog/') && <a href={offer.url} target="_blank" rel="noreferrer">Исходная карточка ↗</a>}
          {offer.review?.sources.slice(1).map((s) => <p className="catalog-reference" key={s}>Ссылка на источник: {s}</p>)}
          {kit && <KitDetails kit={kit} project={project} onSelect={setSelection} />}
          {catalog.source === 'embedded' ? <CompatibilityPreview key={selection + ':' + current.releaseId + ':' + context + ':' + (selected?.id ?? '')} offer={offer}
            context={context} project={project} selected={selected} releaseId={current.releaseId} level={level} ctl={ctl} onPlaced={onPlaced} /> :
            <p>Локальные карточки справочные до подтверждения сопоставления. Учебную модель можно выбрать отдельно в редакторе.</p>}
        </>}
      </article>
    </div>
    <details className="editor-section" open><summary>Локальное обновление</summary>
      <div className="catalog-tools">
        <label>Имя выпуска для CSV<input value={csvId} onChange={(e) => setCsvId(e.target.value)} placeholder="local-2026-11" /></label>
        <label>Файл обновления каталога<input type="file" accept=".json,.csv" disabled={catalog.writing}
          onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void catalog.preview(file, csvId, new Date().toISOString().slice(0, 10)); }} /></label>
      </div>
      {(catalog.archive.length > 0 || catalog.source === 'local') && <form className="catalog-tools"
        key={catalog.source + ':' + current.releaseId} onSubmit={(event) => {
          event.preventDefault();
          const key = new FormData(event.currentTarget).get('release');
          if (key === 'embedded') void catalog.selectSaved(null);
          else if (typeof key === 'string' && key.startsWith('saved:')) void catalog.selectSaved(key.slice(6));
        }}>
        <label>Архив выпусков<select name="release" disabled={catalog.loading || catalog.writing}
          defaultValue={catalog.source === 'embedded' ? 'embedded' : 'saved:' + current.releaseId}>
          <option value="embedded">Встроенный выпуск</option>
          {catalog.archive.map((id) => <option value={'saved:' + id} key={id}>{id}</option>)}
        </select></label>
        <button disabled={catalog.loading || catalog.writing}>Переключить выпуск</button>
      </form>}
      {catalog.error && <div className="catalog-caution" role="alert"><strong>Обновление отклонено.</strong><p>{catalog.error}</p></div>}
      {catalog.pending && <div className="catalog-review">
        <p>Подготовлен выпуск {catalog.pending.releaseId}.</p>
        <p>Карточек: {catalog.pending.offers.length}; дата: {catalog.pending.publishedOn}. Ничего не изменится до подтверждения.</p>
        <button disabled={catalog.writing || catalog.loading} onClick={() => { void catalog.activate(); }}>Активировать выпуск</button>
        <button disabled={catalog.writing} onClick={catalog.dismiss}>Оставить текущий выпуск</button>
      </div>}
    </details>
  </section>;
}
