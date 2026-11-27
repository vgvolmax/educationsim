import { FilePicker } from '../ui/FilePicker';
import { useState } from 'react';
import { prepareLesson } from './authoring';
import type { PreparedLesson } from './authoring';
import { lessonLibrary } from './lesson-library';
import './lesson.css';

export function LessonLauncher({ launch }: { launch(lesson: PreparedLesson): void }) {
  const [draft, setDraft] = useState<PreparedLesson | null>(null);
  const [error, setError] = useState('');
  async function inspect(file: File | undefined) {
    setDraft(null); setError('');
    if (!file) return;
    if (file.size > 256 * 1024) { setError('Файл урока больше 256 КиБ.'); return; }
    try {
      const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())) as unknown;
      const checked = prepareLesson(raw);
      if (checked.ok) setDraft(checked.value);
      else setError(checked.diagnostics.map((d) => d.path + ': ' + d.message).join(' '));
    } catch { setError('Урок не удалось прочитать как JSON в UTF-8.'); }
  }
  function useBundled(raw: typeof lessonLibrary[number]) {
    const result = prepareLesson(raw);
    if (result.ok) { setError(''); launch(result.value); }
    else setError(result.diagnostics.map((item) => item.message).join(' '));
  }
  return <section id="lessons" aria-label="Учебные задания" className="template-section lesson-library">
    <div className="home-section-heading"><div><p className="eyebrow">Практика</p><h2>Учебные задания</h2></div>
      <p>Проходите задания в своём темпе и проверяйте выводы в расчёте.</p></div>
    <div className="template-list">{lessonLibrary.map((lesson) => <button key={lesson.id} onClick={() => useBundled(lesson)}>
      {lesson.id} · {lesson.title} · {lesson.minutes} мин</button>)}</div>
    <details className="lesson-author"><summary>Предпросмотр авторского урока</summary>
      <p>Файл проверяется и открывается локально как отдельная попытка. Он не заменяет встроенный урок.</p>
      <FilePicker label="Файл урока JSON" accept=".json,application/json" onChoose={(file) => { void inspect(file); }} />
      {error && <p role="alert" className="lesson-warning">{error}</p>}
      {draft && <button onClick={() => launch(draft)}>Открыть предпросмотр: {draft.definition.title}</button>}
    </details>
  </section>;
}
