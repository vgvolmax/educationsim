import type { Lesson, LessonAction } from './authoring';
import type { LessonState } from './lesson';

type Answer = Extract<LessonAction, { type: 'answer' }>;
type Quantity = Extract<LessonAction, { type: 'quantity' }>;

export function answerGroups(actions: LessonAction[]) {
  const groups = new Map<Answer['field'], Answer[]>();
  for (const action of actions) {
    if (action.type !== 'answer') continue;
    const alternatives = groups.get(action.field) ?? [];
    alternatives.push(action);
    groups.set(action.field, alternatives);
  }
  return groups;
}

export function LessonQuestions({ lesson, groups, state, onAction, disabled }: {
  lesson: Lesson; groups: ReturnType<typeof answerGroups>; state: LessonState; onAction(id: string): void; disabled: boolean;
}) {
  if (!groups.size) return null;
  return <section className="lesson-questions" aria-label="Вопросы">
    <h2>Вопросы</h2>
    {[...groups].map(([field, options], i) => <fieldset key={field} disabled={disabled}>
      <legend>{i + 1}. {lesson.questions?.[field] ?? 'Выберите ответ'}</legend>
      {options.map((option) => <label key={option.id}>
        <input type="radio" name={'lesson-answer-' + field} checked={state.answers[field] === option.value}
          onChange={() => onAction(option.id)} />
        <span>{option.label}</span>
      </label>)}
    </fieldset>)}
  </section>;
}

export function LessonResponses({ lesson, state }: { lesson: Lesson; state: LessonState }) {
  const groups = answerGroups(lesson.actions);
  const items = Object.entries(state.basket).filter(([, count]) => count > 0);
  if (!groups.size && !items.length) return null;
  return <details className="lesson-responses">
    <summary>Что было сдано</summary>
    {groups.size > 0 && <dl>{[...groups].map(([field, choices], index) => <div key={field}>
      <dt>{lesson.questions?.[field] ?? 'Ответ ' + (index + 1)}</dt>
      <dd>{choices.find((option) => option.value === state.answers[field])?.label ?? 'Ответ не выбран'}</dd>
    </div>)}</dl>}
    {items.length > 0 && <ul>{items.map(([item, count]) => {
      const option = lesson.actions.find((action): action is Quantity => action.type === 'quantity' && action.item === item && action.delta === 1);
      return <li key={item}>{option?.itemLabel ?? option?.label ?? item} · {count} шт.</li>;
    })}</ul>}
  </details>;
}

export function LessonBasket({ actions, basket, onAction, disabled }: {
  actions: LessonAction[]; basket: LessonState['basket']; onAction(id: string): void; disabled: boolean;
}) {
  const quantities = actions.filter((a): a is Quantity => a.type === 'quantity');
  const items = new Map<string, Quantity[]>();
  for (const action of quantities) {
    const options = items.get(action.item) ?? [];
    options.push(action);
    items.set(action.item, options);
  }
  if (!items.size) return null;
  return <section className="lesson-basket" aria-label="Состав заказа">
    <h2>Состав заказа</h2>
    {[...items].map(([item, options]) => {
      const remove = options.find((action) => action.delta === -1);
      const add = options.find((action) => action.delta === 1);
      const count = basket[item] ?? 0;
      const label = options.find((action) => action.itemLabel)?.itemLabel ?? add?.label ?? remove?.label ?? item;
      return <div className="basket-row" key={item}>
        <span>{label}</span>
        <div>
          {remove && <button type="button" onClick={() => onAction(remove.id)} disabled={disabled || count === 0} aria-label={remove.label}>−</button>}
          <output aria-label={label}>{count}</output>
          {add && <button type="button" onClick={() => onAction(add.id)} disabled={disabled || count === 100} aria-label={add.label}>+</button>}
        </div>
      </div>;
    })}
  </section>;
}
