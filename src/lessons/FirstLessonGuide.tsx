import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

const segments = [
  {
    action: 'supply', link: 'supply', name: 'Подача', button: 'Показать подачу',
    instruction: 'Проследите путь от котла до коллектора.',
    explanation: 'По подаче нагретая вода идёт от котла к коллектору.',
    path: 'M136 106 H275', arrow: 'M172 106 H208', labelX: '28.5%', labelY: '25%',
  },
  {
    action: 'loop', link: 'pipe-a', name: 'Петля пола', button: 'Показать петлю пола',
    instruction: 'Посмотрите, куда коллектор направляет воду.',
    explanation: 'В петле вода проходит по трубе в полу и отдаёт тепло.',
    path: 'M328 106 H608 Q631 106 631 128 V136 Q631 158 608 158 H416 Q393 158 393 180 V190 Q393 212 416 212 H328',
    arrow: 'M486 106 H530', labelX: '74%', labelY: '25%',
  },
  {
    action: 'return', link: 'return', name: 'Обратка', button: 'Показать обратку',
    instruction: 'Найдите путь от коллектора обратно к котлу.',
    explanation: 'По обратке остывшая вода возвращается из коллектора в котёл.',
    path: 'M275 212 H136', arrow: 'M237 212 H201', labelX: '28.5%', labelY: '81%',
  },
] as const;

type Progress = { flow: number | null; visited: ReadonlySet<string>; selected: string | null; passed: boolean };
type GuideProps = Progress & {
  canStart: boolean; pending: boolean; blocked: boolean; onStart(): void; onInspect(link: string): void; nextAction: ReactNode;
};

export function FirstLessonGuide({ flow, visited, selected, passed, canStart, pending, blocked, onStart, onInspect, nextAction }: GuideProps) {
  const marker = useId();
  const focusedGuide = useRef(false);
  const actionArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (passed && focusedGuide.current) actionArea.current?.querySelector('button')?.focus();
  }, [passed]);
  const started = flow !== null;
  const next = started && segments.find((segment) => !visited.has(segment.action));
  const current = segments.find((segment) => segment.link === selected);
  const ready = started && !blocked;
  return <>
    <section className="first-lesson-guide" aria-label="Следующий шаг">
      <div className="first-lesson-prompt" aria-live="polite">
        <p className="eyebrow">{passed ? 'Готово' : !started ? 'Шаг 1 · Запуск' : 'Шаг 2 · Путь воды'}</p>
        <h2>{passed ? 'Урок пройден.' : !started ? 'Запустите воду' : next && next.instruction}</h2>
        <p>{passed ? 'Вода проходит замкнутый путь от котла через пол и возвращается к котлу.' :
          !started ? 'Схема покажет направление потока и расход в первой петле.' :
            next && 'Нажмите «' + next.button + '» или подпись «' + next.name + '» на схеме.'}</p>
      </div>
      <div className="first-lesson-next-action" ref={actionArea}>
        {passed ? nextAction : <button type="button" className="action-primary"
          aria-disabled={(!started && !canStart) || blocked || undefined}
          onClick={() => {
            if (blocked) return;
            if (!started && canStart) onStart();
            else if (next) {
              focusedGuide.current = document.activeElement === actionArea.current?.firstElementChild;
              onInspect(next.link);
            }
          }}>
          {!started ? (pending ? 'Запускаем воду…' : !canStart ? 'Готовим схему…' : 'Запустить воду') : next && next.button}
        </button>}
      </div>
    </section>
    <section className="first-lesson-diagram" aria-label="Схема пути воды">
      <div className="first-lesson-picture">
        <svg viewBox="0 0 720 286" aria-hidden="true">
          <defs>
            <marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse"
              markerWidth="14" markerHeight="14" orient="auto"><path fill="context-stroke" d="M0 0 10 5 0 10z" /></marker>
          </defs>
          <rect className="first-lesson-floor" x="354" y="27" width="338" height="233" rx="20" />
          <rect className="first-lesson-device" x="22" y="74" width="114" height="161" rx="16" />
          <text className="first-lesson-equipment-label" x="79" y="116">Котёл</text>
          <path className="first-lesson-heater" d="M47 151 H111 V166 H47 V181 H111 V196 H47" />
          <rect className="first-lesson-device first-lesson-collector" x="272" y="78" width="60" height="157" rx="16" />
          <text className="first-lesson-equipment-label" x="302" y="60">Коллектор</text>
          <path className="first-lesson-header-pipe" d="M275 106 H328 M275 212 H328" />
          {segments.map((segment) => <g key={segment.link} data-segment={segment.link}>
            <path data-link={segment.link} d={segment.path}
              className={'first-lesson-pipe' + (selected === segment.link ? ' lesson-identified' : '')} />
            {started && <path className="first-lesson-arrow" d={segment.arrow} markerEnd={'url(#' + marker + ')'} />}
            {ready && <path className="first-lesson-hit" d={segment.path} onClick={() => { focusedGuide.current = false; onInspect(segment.link); }} />}
          </g>)}
        </svg>
        {segments.map((segment) => <button type="button" key={segment.link} className="first-lesson-diagram-button"
          style={{ left: segment.labelX, top: segment.labelY }} data-segment={segment.link}
          disabled={!ready} onFocus={() => { focusedGuide.current = false; }} aria-pressed={selected === segment.link}
          aria-label={segment.name + ' на схеме'} onClick={() => onInspect(segment.link)}>
          {segment.name}
        </button>)}
      </div>
      <p className="first-lesson-caption" role="status">{current ? current.explanation : 'На учебной схеме показана первая из двух петель.'}</p>
    </section>
  </>;
}

export function FirstLessonProgress({ flow, visited }: Pick<Progress, 'flow' | 'visited'>) {
  const count = segments.filter((segment) => visited.has(segment.action)).length;
  return <>
    <h2>Путь воды</h2>
    <p className="first-lesson-reading" role="status">{flow === null ? 'Расход ещё не измерен' :
      'Расход в петле 1: ' + (flow * 60_000).toFixed(2).replace('.', ',') + ' л/мин'}</p>
    <p role="status">Найдено участков: <strong>{count} из {segments.length}</strong></p>
    <ol className="first-lesson-checklist">{segments.map((segment) => <li key={segment.link} data-segment={segment.link}>
      {segment.name}<span>{visited.has(segment.action) ? 'Найдена' : 'Предстоит'}</span>
    </li>)}</ol>
  </>;
}
