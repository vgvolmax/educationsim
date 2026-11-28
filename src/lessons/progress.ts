import type { SimulationRecord } from '../simulation/replay';
import type { Lesson } from './authoring';
import type { gradeLesson, LessonState } from './lesson';

export type LessonAttempt = {
  id: string;
  lesson: string;
  lessonVersion: number;
  submittedAt: number;
  state: LessonState;
  grade: ReturnType<typeof gradeLesson>;
  records: Record<string, SimulationRecord | null>;
};

export const lessonKey = (lesson: Pick<Lesson, 'id' | 'version'>) => lesson.id + ':' + lesson.version;

const database = 'educationsim-learning';

async function useStore<T>(name: 'passed' | 'attempts', mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('passed');
      const attempts = request.result.createObjectStore('attempts', { keyPath: 'id' });
      attempts.createIndex('lesson', ['lesson', 'lessonVersion']);
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      tx.onabort = () => reject(tx.error ?? new Error('Запись прогресса прервана.'));
      const request = operation(tx.objectStore(name));
      tx.oncomplete = () => resolve(request.result);
    });
  } finally { db.close(); }
}

export async function listPassedLessons() {
  return new Set((await useStore('passed', 'readonly', (store) => store.getAllKeys())).filter((key): key is string => typeof key === 'string'));
}

export function saveLessonPass(lesson: Lesson) {
  return useStore('passed', 'readwrite', (store) => store.put(true, lessonKey(lesson)));
}

export async function listAttempts(lesson: Lesson): Promise<LessonAttempt[]> {
  const attempts = await useStore('attempts', 'readonly', (store) => store.index('lesson').getAll([lesson.id, lesson.version]));
  return (attempts as LessonAttempt[]).sort((a, b) => b.submittedAt - a.submittedAt);
}

export function saveAttempt(attempt: LessonAttempt) {
  return useStore('attempts', 'readwrite', (store) => store.put(attempt));
}
