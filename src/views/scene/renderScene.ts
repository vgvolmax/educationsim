import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { scenePlacement } from './scenePlacement';
import type { Placement } from '../../editor/placement';
import { createEquipment } from './createEquipment';
import { bindCameraKeys, cameraTravel } from './camera-motion';
import { createSceneQuality } from './quality';
import { particleBudget, particleDistance, pipeFlow } from './flow';
import { hasLiveFrame, sceneHeat } from './heatMap';
import type { sceneInput } from './buildScene';
import type { Point2, ProjectDocument } from '../../project/types';
import type { SessionView } from '../../simulation/session';

type Input = ReturnType<typeof sceneInput>;
type Options = { selected: string | null; transparent: boolean; heat: boolean; section: boolean; still: boolean; frame: SessionView | null; placement: Placement | null };
type PipeMesh = { id: string; path: T.CurvePath<T.Vector3>; length: number; diameter: number; dots: number; offset: number; material: T.MeshStandardMaterial };
const brass = new T.Color(0x9b754f), cold = new T.Color(0x458da8), hot = new T.Color(0xc8703f);
export function createSceneRenderer(canvas: HTMLCanvasElement, data: Input, project: ProjectDocument, get: () => Options, onPick: (id: string) => void, onPlace: (point: Point2, part?: Placement) => void, onDrag: (id: string) => Placement | null) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  const quality = createSceneQuality();
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 1.5) * quality.level.pixelScale;
  renderer.setPixelRatio(pixelRatio());
  const scene = new T.Scene();
  scene.background = new T.Color(0xe8eff0);
  scene.add(new T.HemisphereLight(0xfffbeb, 0x9b9f93, 2.1));
  const key = new T.DirectionalLight(0xffeed6, 2.2); key.position.set(5, 9, -4); scene.add(key);
  const rig = new T.Group(); scene.add(rig);
  const camera = new T.PerspectiveCamera(43, 1, .04, 900);
  const controls = new OrbitControls(camera, canvas);
  const keys = bindCameraKeys(canvas);
  // Keyboard-pan diagnostics measure applied motion, independent of adaptive WebGL raster resolution.
  let keyboardPans = 0;
  canvas.dataset.keyboardPans = '0';
  controls.enableDamping = true; controls.dampingFactor = .12; controls.minDistance = .4; controls.maxDistance = 400;
  controls.maxPolarAngle = Math.PI * .48;
  const grid = new T.GridHelper(20, 40, 0xa4babb, 0xc6d4d5); grid.position.y = data.floorY - .125; scene.add(grid);
  const walls: T.Mesh<T.BoxGeometry, T.MeshStandardMaterial>[] = [];
  const floorMaterials = new Map<string, T.MeshStandardMaterial>();
  const equipment = new Map<string, T.Group>();
  const section = new T.Group(); rig.add(section);
  const floorBase = new T.Color(0xc8d6d0);
  for (const room of data.rooms) {
    const outline = room.outline;
    if (!outline.length) continue;
    const shape = new T.Shape(outline.map(({ x, z }) => new T.Vector2(x, -z)));
    const floor = new T.Mesh(new T.ExtrudeGeometry(shape, { depth: .12, bevelEnabled: false }),
      new T.MeshStandardMaterial({ color: floorBase, roughness: .95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = data.floorY - .13;
    rig.add(floor); floorMaterials.set(room.id, floor.material);
    for (let i = 0; i < outline.length; i++) {
      const first = outline[i]!, second = outline[(i + 1) % outline.length]!;
      const size = Math.hypot(second.x - first.x, second.z - first.z);
      const thickness = .065;
      const wall = new T.Mesh(new T.BoxGeometry(size, room.heightM, thickness),
        new T.MeshStandardMaterial({ color: 0xe2ddd0, roughness: .98, transparent: true, opacity: .24, depthWrite: false }));
      wall.rotation.y = -Math.atan2(second.z - first.z, second.x - first.x);
      wall.position.set((first.x + second.x) / 2, data.floorY + room.heightM / 2, (first.z + second.z) / 2);
      walls.push(wall); rig.add(wall);
      for (const [j, color] of [0x58575a, 0x90a399, 0xd8d0b9, 0xb58768].entries()) {
        const strip = new T.Mesh(new T.BoxGeometry(size, .065, thickness * 2), new T.MeshStandardMaterial({ color }));
        strip.rotation.y = wall.rotation.y;
        strip.position.set(wall.position.x, data.floorY - .24 + j * .069, wall.position.z);
        section.add(strip);
      }
    }
  }
  for (const item of data.equipment) {
    const object = createEquipment(item); equipment.set(item.id, object); rig.add(object);
  }
  const placementLayer = scenePlacement(scene, camera, canvas, data.floorY, equipment);
  let groundPointer: Point2 | null = null;
  let drag: { part: Placement; pointerId: number; moved: boolean } | null = null;
  const flowing: PipeMesh[] = [];
  let remaining = particleBudget;
  for (const pipe of data.pipes) {
    const vectors = pipe.points.map(({ x, y, z }) => new T.Vector3(x, y + .022, z));
    const path = new T.CurvePath<T.Vector3>();
    for (let j = 1; j < vectors.length; j++) {
      const a = vectors[j - 1]!, b = vectors[j]!;
      if (a.distanceToSquared(b) > 1e-10) path.add(new T.LineCurve3(a, b));
    }
    const length = path.getLength();
    if (!Number.isFinite(length) || length <= 0) continue;
    const thickness = Math.max(.018, Math.min(.1, pipe.diameterM * .9));
    const material = new T.MeshStandardMaterial({ color: brass, roughness: .59, metalness: .22,
      transparent: pipe.approximate, opacity: pipe.approximate ? .54 : 1 });
    rig.add(new T.Mesh(new T.TubeGeometry(path, Math.min(220, Math.max(8, path.curves.length * 4)), thickness, 7, false), material));
    const dots = Math.min(remaining, Math.max(2, Math.min(22, Math.ceil(length * .9))));
    remaining -= dots;
    flowing.push({ id: pipe.id, path, length, diameter: pipe.diameterM, dots, offset: 0, material });
  }
  const dotGeometry = new T.SphereGeometry(.032, 6, 5);
  const particles = new T.InstancedMesh(dotGeometry, new T.MeshBasicMaterial({ color: 0xffefd4 }), particleBudget - remaining);
  particles.instanceMatrix.setUsage(T.DynamicDrawUsage); particles.frustumCulled = false; particles.count = 0; scene.add(particles);
  const box = new T.Box3().setFromObject(rig);
  const target = box.isEmpty() ? new T.Vector3(2.5, data.floorY, 2) : box.getCenter(new T.Vector3());
  const size = box.isEmpty() ? new T.Vector3(6, 2, 4) : box.getSize(new T.Vector3());
  target.y = data.floorY + .15;
  const baseDistance = Math.max(4, size.x, size.z) * 1.35;
  function cameraMode(view: 'orbit' | 'top' | 'slice') {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight) || 1;
    const distance = baseDistance * Math.max(1, Math.min(3, 1 / aspect));
    controls.target.copy(target);
    if (view === 'top') camera.position.copy(target).add(new T.Vector3(0, distance * 1.26, .001));
    else if (view === 'slice') camera.position.copy(target).add(new T.Vector3(distance * .13, distance * .44, distance * 1.06));
    else camera.position.copy(target).add(new T.Vector3(distance * .58, distance * .64, distance * .81));
    controls.update();
  }
  cameraMode('orbit');
  const halo = new T.Mesh(new T.TorusGeometry(.23, .017, 8, 36), new T.MeshBasicMaterial({ color: 0xb65330 }));
  halo.rotation.x = Math.PI / 2; scene.add(halo);
  const tmp = new T.Object3D(), tint = new T.Color();
  let previous = performance.now(), frameId = 0, dead = false, lastLive: SessionView | null = null;
  let rooms = new Map<string, number | null>();
  function resize() {
    const { clientWidth, clientHeight } = canvas;
    if (!clientWidth || !clientHeight) return;
    camera.aspect = clientWidth / clientHeight; camera.updateProjectionMatrix();
    renderer.setSize(clientWidth, clientHeight, false);
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
  function animate(time: number) {
    if (dead) return;
    const { selected, transparent, heat, section: showSection, still, frame, placement } = get();
    controls.enableRotate = !placement && !drag;
    const live = hasLiveFrame(frame) ? frame : null;
    const frameMs = time - previous;
    const elapsed = !still && live?.mode === 'running' ? Math.max(0, Math.min(.1, frameMs / 1000)) : 0;
    if (quality.sample(frameMs)) renderer.setPixelRatio(pixelRatio());
    previous = time;
    if (live !== lastLive) {
      rooms = new Map(sceneHeat(project, live).map((room) => [room.roomId, room.surfaceC]));
      lastLive = live;
    }
    section.visible = showSection;
    for (const wall of walls) {
      wall.material.opacity = transparent ? .16 : .96;
    }
    for (const [id, material] of floorMaterials) {
      const c = rooms.get(id);
      material.color.copy(heat && c != null ? tint.copy(cold).lerp(hot, Math.max(0, Math.min(1, (c - 15) / 25))) : floorBase);
    }
    const selectedObject = selected ? equipment.get(selected) : undefined;
    halo.visible = !!selectedObject;
    if (selectedObject) halo.position.copy(selectedObject.position).add(new T.Vector3(0, .058, 0));
    let drawn = 0;
    for (const pipe of flowing) {
      const t = live?.snapshot.fluid.cells[pipe.id]?.temperatureC;
      pipe.material.color.copy(t === undefined ? brass : tint.copy(cold).lerp(hot, Math.max(0, Math.min(1, (t - 18) / 38))));
      const state = pipeFlow(live?.snapshot.hydraulics?.channels[pipe.id]?.flowM3s, pipe.diameter);
      if (!state) continue;
      pipe.offset = particleDistance(pipe.offset, elapsed, state.speedMps, pipe.length);
      for (let i = 0; i < pipe.dots; i += quality.level.particleStride) {
        const at = particleDistance(pipe.offset + pipe.length * i / pipe.dots, 0, 0, pipe.length);
        tmp.position.copy(pipe.path.getPoint(at / pipe.length)); tmp.updateMatrix();
        particles.setMatrixAt(drawn++, tmp.matrix);
      }
    }
    particles.count = drawn; particles.instanceMatrix.needsUpdate = true;
    const movement = keys.movement();
    if (movement.forward || movement.right) {
      const heading = { x: controls.target.x - camera.position.x, z: controls.target.z - camera.position.z };
      const step = cameraTravel(movement, heading, camera.position.distanceTo(controls.target), frameMs / 1000);
      camera.position.x += step.x; camera.position.z += step.z;
      controls.target.x += step.x; controls.target.z += step.z;
      if (step.x || step.z) canvas.dataset.keyboardPans = String(++keyboardPans);
    }
    controls.update(); placementLayer.preview(placement ?? (drag?.moved ? drag.part : null), groundPointer); renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }
  frameId = requestAnimationFrame(animate);
  let pointer: { x: number; y: number } | null = null;
  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    canvas.focus({ preventScroll: true });
    pointer = { x: e.clientX, y: e.clientY };
    const { placement, selected } = get();
    if (!placement && selected && placementLayer.pick(e.clientX, e.clientY) === selected) {
      const part = onDrag(selected);
      if (!part) return;
      drag = { part, pointerId: e.pointerId, moved: false };
      canvas.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
    }
  }
  function move(e: PointerEvent) {
    groundPointer = { x: e.clientX, z: e.clientY };
    if (drag && pointer && Math.hypot(pointer.x - e.clientX, pointer.y - e.clientY) > 6) drag.moved = true;
  }
  function pick(e: PointerEvent) {
    const start = pointer;
    pointer = null;
    if (!start) return;
    if (drag) {
      const current = drag;
      drag = null;
      if (canvas.hasPointerCapture(current.pointerId)) canvas.releasePointerCapture(current.pointerId);
      if (current.moved) {
        move(e);
        const point = placementLayer.preview(current.part, groundPointer);
        if (point) onPlace(point, current.part);
      }
      return;
    }
    if (Math.hypot(start.x - e.clientX, start.y - e.clientY) > 6) return;
    const placement = get().placement;
    if (placement) {
      move(e);
      const point = placementLayer.preview(placement, groundPointer);
      if (point) onPlace(point);
      return;
    }
    const hit = placementLayer.pick(e.clientX, e.clientY);
    if (typeof hit === 'string') onPick(hit);
  }
  const cancelPointer = () => { pointer = null; groundPointer = null; drag = null; };
  const leave = () => { if (!drag) cancelPointer(); };
  canvas.addEventListener('pointerdown', down, true); canvas.addEventListener('pointerup', pick);
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', leave);
  canvas.addEventListener('pointercancel', cancelPointer);
  return {
    cameraMode,
    cameraPose() { return { position: camera.position.clone(), target: controls.target.clone() }; },
    restoreCamera(pose: { position: T.Vector3; target: T.Vector3 }) {
      camera.position.copy(pose.position); controls.target.copy(pose.target); controls.update();
    },
    focus(id: string) {
      const selected = equipment.get(id);
      if (!selected) return;
      const next = selected.position.clone().add(new T.Vector3(0, .2, 0));
      camera.position.copy(next).add(new T.Vector3(1.45, 1.1, 1.65));
      controls.target.copy(next);
      controls.update();
    },
    zoom(factor: number) {
      camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target); controls.update();
    },
    dispose() {
      dead = true; cancelAnimationFrame(frameId); ro.disconnect(); keys.dispose(); controls.dispose();
      canvas.removeEventListener('pointerdown', down, true); canvas.removeEventListener('pointerup', pick);
      canvas.removeEventListener('pointercancel', cancelPointer);
      canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerleave', leave);
      placementLayer.dispose();
      scene.traverse((obj) => {
        if (obj instanceof T.Mesh || obj instanceof T.LineSegments) {
          obj.geometry.dispose();
          const list = Array.isArray(obj.material) ? obj.material : [obj.material];
          list.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
    },
  };
}
