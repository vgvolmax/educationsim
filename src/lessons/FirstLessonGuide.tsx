import type { ReactNode } from 'react';

// The built-in first lesson uses the same live reading and grading as the regular runner.
export function FirstLessonGuide({ flow, passed, nextAction }: { flow: number | null; passed: boolean; nextAction?: ReactNode }) {
  const step = passed ? 3 : flow === null ? 1 : 2;
  return <section className="first-lesson-guide" aria-label="Следующий шаг">
    <span className="first-lesson-step">{step} из 3</span>
    <div>
      <strong>{step === 1 ? 'Запустите расчёт' : step === 2 ? 'Проследите путь воды' : 'Контур найден'}</strong>
      <p>{step === 1 ? 'Нажмите «Рассчитать один тик», чтобы увидеть первый замер.' :
        step === 2 ? 'Отметьте подачу, петлю и обратку. Выбранный участок подсветится на схеме.' :
          'Можно открыть свободную копию схемы и менять её, не затрагивая урок.'}</p>
    </div>
    <p className="first-lesson-reading" role="status">{flow === null ? 'Расход ещё не измерен' :
      'Расход в петле 1: ' + (flow * 60_000).toFixed(2).replace('.', ',') + ' л/мин'}</p>
    {nextAction && <div className="first-lesson-next-action">{nextAction}</div>}
  </section>;
}
