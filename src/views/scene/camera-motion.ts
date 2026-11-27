const keys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
type Movement = { forward: number; right: number };
type Horizontal = { x: number; z: number };

export function cameraMovement(pressed: ReadonlySet<string>): Movement {
  const f = Number(pressed.has('KeyW') || pressed.has('ArrowUp')) - Number(pressed.has('KeyS') || pressed.has('ArrowDown'));
  const r = Number(pressed.has('KeyD') || pressed.has('ArrowRight')) - Number(pressed.has('KeyA') || pressed.has('ArrowLeft'));
  const n = Math.hypot(f, r) || 1;
  return { forward: f / n, right: r / n };
}

export function cameraTravel(direction: Movement, heading: Horizontal, distance: number, dt: number): Horizontal {
  const length = Math.hypot(heading.x, heading.z);
  const x = length > 1e-7 ? heading.x / length : 0, z = length > 1e-7 ? heading.z / length : -1;
  const speed = Math.min(15, Math.max(.6, distance * .75));
  const step = speed * Math.max(0, Math.min(.05, dt));
  return { x: (direction.forward * x - direction.right * z) * step,
    z: (direction.forward * z + direction.right * x) * step };
}

export function bindCameraKeys(canvas: HTMLCanvasElement) {
  const pressed = new Set<string>();
  function down(event: KeyboardEvent) {
    if (!keys.has(event.code) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    pressed.add(event.code);
  }
  function up(event: KeyboardEvent) { pressed.delete(event.code); }
  const reset = () => pressed.clear();
  canvas.addEventListener('keydown', down); canvas.addEventListener('keyup', up);
  canvas.addEventListener('blur', reset); window.addEventListener('blur', reset);
  return {
    movement: () => cameraMovement(pressed),
    dispose() {
      reset();
      canvas.removeEventListener('keydown', down); canvas.removeEventListener('keyup', up);
      canvas.removeEventListener('blur', reset); window.removeEventListener('blur', reset);
    },
  };
}
