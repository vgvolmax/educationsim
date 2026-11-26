import type { ProjectDocument } from '../../project/types';
import type { SessionView } from '../../simulation/session';

export function hasLiveFrame(view: SessionView | null): view is SessionView {
  return !!view && view.snapshot.tick > 0 && view.mode !== 'stopped' && !view.stale && view.snapshot.health !== 'stopped';
}
const average = (a: number[]) => a.length ? a.reduce((sum, value) => sum + value, 0) / a.length : null;

export function sceneHeat(doc: ProjectDocument, view: SessionView | null) {
  const live = view?.snapshot.projectId === doc.projectId && view.snapshot.projectRevision === doc.revision && hasLiveFrame(view);
  return doc.rooms.map(({ id: roomId }) => {
    const sections = doc.loopRoutes.filter((r) => r.roomId === roomId).flatMap((r) => {
      const floor = live ? view.snapshot.building?.floors[r.id] : undefined;
      return floor ? [floor] : [];
    });
    return { roomId, surfaceC: average(sections.map((floor) => floor.surfaceC)), waterC: average(sections.map((floor) => floor.waterC)) };
  });
}
