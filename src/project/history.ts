import type { ComponentRegistry } from './registry';
import { applyProjectCommand } from './reducer';
import type { ProjectCommand, ProjectDocument, Result } from './types';

const maxEntries = 32;
export type ProjectHistory = {
  readonly current: ProjectDocument;
  readonly past: readonly ProjectDocument[];
  readonly future: readonly ProjectDocument[];
};

function push(versions: readonly ProjectDocument[], project: ProjectDocument): readonly ProjectDocument[] {
  return [...versions.slice(-(maxEntries - 1)), structuredClone(project)];
}

export function createProjectHistory(project: ProjectDocument): ProjectHistory {
  return { current: structuredClone(project), past: [], future: [] };
}

export function editProject(history: ProjectHistory, command: ProjectCommand, registry: ComponentRegistry): Result<ProjectHistory> {
  const result = applyProjectCommand(history.current, command, registry);
  if (!result.ok) return result;
  return { ok: true, value: { current: result.value, past: push(history.past, history.current), future: [] }, diagnostics: result.diagnostics };
}

export function undoProject(history: ProjectHistory): ProjectHistory | null {
  const saved = history.past.at(-1);
  const revision = history.current.revision + 1;
  if (!saved || !Number.isSafeInteger(revision)) return null;
  return {
    current: { ...structuredClone(saved), revision },
    past: history.past.slice(0, -1),
    future: push(history.future, history.current),
  };
}

export function redoProject(history: ProjectHistory): ProjectHistory | null {
  const saved = history.future.at(-1);
  const revision = history.current.revision + 1;
  if (!saved || !Number.isSafeInteger(revision)) return null;
  return {
    current: { ...structuredClone(saved), revision },
    past: push(history.past, history.current),
    future: history.future.slice(0, -1),
  };
}
