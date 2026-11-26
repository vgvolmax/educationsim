import { prepareLesson } from './authoring';
import { firstLesson } from './first-lesson';

const checked = prepareLesson(firstLesson);
if (!checked.ok) throw new Error(checked.diagnostics[0].message);
export const lessonLibrary = [checked.value] as const;
