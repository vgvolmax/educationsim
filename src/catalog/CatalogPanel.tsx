import { FilePicker } from '../ui/FilePicker';
import { lazy, Suspense, useMemo, useState } from 'react';
import type { CatalogContext, CatalogKit, CatalogOffer, CatalogPackage } from './catalog';
import { offerKey, teachingAnalogue } from './catalog';
import { CompatibilityPreview } from './CompatibilityPreview';
import { useCatalog } from './useCatalog';
import type { Placement } from '../editor/placement';
import { catalogVisual } from './model-preview';
import type { ProjectController } from '../editor/useProject';
import type { ComponentInstance, ProjectDocument } from '../project/types';
import './catalog.css';

const CatalogModel = lazy(() => import('./CatalogModel').then((module) => ({ default: module.CatalogModel })));

const contexts: Record<CatalogContext, string> = { floor: 'Петля тёплого пола', heating: 'Обвязка отопления',
  radiator: 'Радиаторная ветвь', service: 'Сервисный узел' };
const decision: Record<CatalogOffer['scope'], string> = { ...contexts, excluded: 'Не входит в область применения', hold: 'Неоднозначная карточка',
  unreviewed: 'Не проверено' };
const evidence: Record<string, string> = { manufacturer: 'Публичные сведения производителя о назначении',
  manufacturer_and_trade: 'Производитель и профильный продавец', store_card: 'Карточка магазина', incomplete_card: 'Неполная карточка',
  conflicting_card: 'Противоречивая карточка' };
const lower = (text: string) => text.normalize('NFKC').toLocaleLowerCase('ru').replaceAll('ё', 'е');
type Props = { project: ProjectDocument; selected?: ComponentInstance; ctl: ProjectController; onPlaced(id: string): void; onPlace(placement: Placement): void };

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
function OfferModel({ offer, kit, offers, onSelect }: {
  offer: CatalogOffer; kit?: CatalogKit; offers: CatalogPackage['offers']; onSelect(key: string): void;
}) {
  const [partKey, setPartKey] = useState('');
  const parts = kit?.parts.flatMap((part) => {
    const key = offerKey(part.channel, part.offerId);
    const card = offers.find((item) => offerKey(item.channel, item.offerId) === key);
    const model = part.included && card && catalogVisual(card);
    return model ? [{ key, part, model }] : [];
  }) ?? [];
  const part = parts.find(({ key }) => key === partKey) ?? parts.find(({ model }) => model.typeId.startsWith('training-manifold-')) ?? parts[0];
  const model = part?.model ?? catalogVisual(offer);
  return <>
    {part && <label className="catalog-preview-part">Деталь из комплекта
      <select value={part.key} onChange={(event) => setPartKey(event.target.value)}>
        {parts.map(({ key, part, model }) => <option key={key} value={key}>
          {model.name} · {part.article || part.offerId} · {part.quantity} {part.unit}
        </option>)}
      </select>
    </label>}
    {model ? <Suspense fallback={<p>Готовим модель…</p>}>
      <CatalogModel key={model.typeId + ':' + model.variant + ':' + model.outlets} {...model} />
    </Suspense> : <p className="catalog-assistance">Для этой позиции пока нет учебной 3D-модели.</p>}
    {part && <button type="button" onClick={() => onSelect(part.key)}>Открыть артикул детали</button>}
  </>;
}
export function CatalogPanel({ project, selected, ctl, onPlaced, onPlace }: Props) {
  const catalog = useCatalog();
  const current = catalog.active;
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState('');
  const [context, setContext] = useState<CatalogContext | 'all'>('all');
  const [limit, setLimit] = useState(30);
  const [csvId, setCsvId] = useState('');
  const matches = useMemo(() => {
    const q = lower(query.trim()), terms = q.split(/\s+/).filter(Boolean);
    return current.offers.filter((o) => (context === 'all' || o.allowedContexts.includes(context)) &&
      terms.every((word) => lower(o.title + ' ' + o.article + ' ' + o.offerId + ' ' + o.brand + ' ' + (o.review?.role ?? '')).includes(word)));
  }, [current, query, context]);
  const offer = current.offers.find((o) => offerKey(o.channel, o.offerId) === selection);
  const kit = current.kits.find((k) => offerKey(k.channel, k.offerId) === selection);
  const profile = current.products.find((p) => p.id === offer?.productId);
  const analogue = offer && teachingAnalogue(offer);
  const visual = offer && !kit && catalogVisual(offer);
  const generic = !analogue && visual && !visual.variant && visual.outlets === undefined ? visual : null;
  const activeContext = context === 'all' ? offer?.allowedContexts[0] ?? 'floor' : context;
  return <section className="catalog-panel" data-testid="catalog-panel" data-active-release={current.releaseId} aria-label="Каталог ВОЛМАКС">
    <h2>Каталог ВОЛМАКС</h2><p className="catalog-release"><span>Версия: {current.releaseId}</span> · {current.publishedOn} · {catalog.loading ? 'Читаем локальный профиль…' : catalog.source === 'embedded' ? 'Встроенный выпуск' : 'Локальный импорт'}</p>
    <div className="catalog-tools">
      <label>Поиск по артикулу, ID или названию<input type="search" value={query} onChange={(e) => {
        setQuery(e.target.value); setSelection(''); setLimit(30);
      }} /></label>
      <label>Контекст каталога<select value={context} onChange={(e) => {
        setContext(e.target.value as CatalogContext | 'all'); setSelection(''); setLimit(30);
      }}>
        <option value="all">Все разделы</option>
        {Object.entries(contexts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    <div className="catalog-columns">
      <div className="catalog-index"><p>Карточек найдено: {matches.length}</p>
        {matches.slice(0, limit).map((o) => {
          const key = offerKey(o.channel, o.offerId);
          return <button key={key} data-testid={'offer-' + o.offerId} aria-pressed={key === selection} onClick={() => setSelection(key)}>
            <strong>{o.article || 'Карточка ' + o.offerId}</strong><span>{o.title}</span></button>;
        })}
        {matches.length > limit && <button onClick={() => setLimit((n) => n + 30)}>Загрузить ещё 30</button>}
      </div>
      <article className="catalog-detail">
        {!offer ? <p>{matches.length ? 'Выберите артикул, чтобы посмотреть модель и применение.' : 'По этому запросу в разделе ничего не найдено.'}</p> : <>
          <div className="catalog-identity"><span>{offer.article || 'Артикул не указан'}</span><span>{offer.brand || 'Марка не указана'}</span></div>
          <h3>{offer.title}</h3>
          <OfferModel key={selection + ':' + current.releaseId} offer={offer} kit={kit} offers={current.offers} onSelect={setSelection} />
          {catalog.source === 'embedded' ? (generic && offer.allowedContexts.includes(activeContext) ?
            <div className="catalog-fit">
              <button className="action-primary" type="button" disabled={project.components.length >= 220}
                onClick={() => onPlace({ typeId: generic.typeId, quarterTurns: 0 })}>Взять типовую деталь</button>
              <p className="catalog-assistance">В проект добавится «{generic.name}» из палитры, без привязки к артикулу.</p>
            </div> : <CompatibilityPreview key={selection + ':' + current.releaseId + ':' + context + ':' + (selected?.id ?? '')}
              offer={offer} context={activeContext} project={project} selected={selected} releaseId={current.releaseId} ctl={ctl} onPlaced={onPlaced} onPlace={onPlace} />) :
            <p className="catalog-assistance">Карточка локального выпуска. Для проекта выберите деталь из палитры «Детали».</p>}
          <section className="catalog-facts">
            <h4>Назначение</h4>
            <p><strong>{offer.review?.role ?? decision[offer.scope]}</strong>{offer.review && ' · ' + decision[offer.scope]}</p>
            {offer.review && <p>{offer.review.evidence}</p>}
          </section>
          {kit && <KitDetails kit={kit} project={project} onSelect={setSelection} />}
          {(offer.review || offer.clearance || profile) && <section className="catalog-facts">
            <h4>Что проверить перед подбором</h4>
            {offer.review && <p>{offer.review.next}</p>}
            {offer.clearance && <p>В исходной карточке отмечена ликвидация. Уточните наличие.</p>}
            {profile && <p>Профиль из файла: {profile.modelId}. Напор {profile.ratings.headPa} Па, расход {profile.ratings.flowM3s} м³/с.</p>}
          </section>}
          <details className="catalog-card-source">
            <summary>Источники и ограничения</summary>
            <p>Учебная карточка. Не используйте её как рекомендацию к покупке.</p>
            {offer.review && <p>{evidence[offer.review.basis] ?? offer.review.basis}</p>}
            {offer.url.startsWith('https://volmax.ru/catalog/') && <a href={offer.url} target="_blank" rel="noreferrer">Исходная карточка на volmax.ru</a>}
            {offer.review?.sources.slice(1).map((s) => <p className="catalog-reference" key={s}>{s}</p>)}
          </details>
        </>}
      </article>
    </div>
    <details className="editor-section"><summary>Локальное обновление</summary>
      <div className="catalog-tools">
        <label>Имя выпуска для CSV<input value={csvId} onChange={(e) => setCsvId(e.target.value)} placeholder="local-2026-11" /></label>
        <FilePicker label="Файл обновления каталога" accept=".json,.csv" disabled={catalog.writing}
          onChoose={(file) => { void catalog.preview(file, csvId, new Date().toISOString().slice(0, 10)); }} />
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
