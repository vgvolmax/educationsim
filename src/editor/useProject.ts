import { useState } from 'react';
import { createProjectHistory, editProject, redoProject, undoProject } from '../project/history';
import { trainingRegistry } from '../project/registry';
import type { ProjectCommand, ProjectDocument } from '../project/types';

export const editorId = (prefix: string) => prefix + '-' + crypto.randomUUID();

export function useProject() {
  const [history, setHistory] = useState<ReturnType<typeof createProjectHistory> | null>(null);
  const [error, setError] = useState<string | null>(null);
  function open(project: ProjectDocument) {
    setHistory(createProjectHistory(project));
    setError(null);
  }
  function apply(command: ProjectCommand): boolean {
    if (!history) return false;
    const result = editProject(history, command, trainingRegistry);
    if (!result.ok) {
      setError(result.diagnostics.map((d) => d.message).join(' '));
      return false;
    }
    setError(null);
    setHistory(result.value);
    return true;
  }
  function changeHistory(direction: 'undo' | 'redo') {
    const edited = history && (direction === 'undo' ? undoProject(history) : redoProject(history));
    if (!edited) return;
    setHistory(edited);
    setError(null);
  }
  return { history, open, apply, changeHistory, error, setError };
}
export type ProjectController = ReturnType<typeof useProject>;
