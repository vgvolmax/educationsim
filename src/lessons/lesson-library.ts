import type { Lesson } from './authoring';

const bundled = import.meta.glob<Lesson>('../../content/lessons/L*.json', { eager: true, import: 'default' });
// Author verification is exhaustive in pack.test; prepare only the lesson that is opened at runtime.
export const lessonLibrary = Object.entries(bundled).sort(([a], [b]) => a.localeCompare(b)).map(([, raw]) => raw);
