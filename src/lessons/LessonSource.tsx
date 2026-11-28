import catalog from '../../content/catalog/public-v1.json';
import type { Lesson } from './authoring';

export function LessonSource({ card }: { card: NonNullable<Lesson['sourceCard']> }) {
  const kit = catalog.kits.find((kit) => kit.offerId === card.offerId && kit.article === card.article);
  return <details className="lesson-source">
    <summary>Карточка комплекта · {card.article}</summary>
    {kit && <>
      <p>Опубликованный состав</p>
      <ul>{kit.parts.map((part) => <li key={part.offerId}>{part.title} · {part.quantity} {part.unit}</li>)}</ul>
      {kit.ambiguity && <p>В описании категории указано, что адаптеров в комплекте нет.</p>}
    </>}
    <a href={card.url} target="_blank" rel="noreferrer">Открыть карточку на volmax.ru · {card.article}</a>
  </details>;
}
