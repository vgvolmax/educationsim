import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEquipment } from './createEquipment';
import { particleBudget, particleDistance, pipeFlow } from './flow';
import { hasLiveFrame, sceneHeat } from './heatMap';
import type { sceneInput } from './buildScene';
import type { ProjectDocument } from '../../project/types';
import type { SessionView } from '../../simulation/session';

type Input = ReturnType<typeof sceneInput>;
type Options = { selected: string | null; transparent: boolean; heat: boolean; section: boolean; still: boolean; frame: SessionView | null };
type PipeMesh = { id: string; path: T.CurvePath<T.Vector3>; length: number; diameter: number; dots: number; offset: number; material: T.MeshStandardMaterial };
const brass = new T.Color(0x9b754f), cold = new T.Color(0x458da8), hot = new T.Color(0xc8703f);
export function createSceneRenderer(canvas: HTMLCanvasElement, data: Input, project: ProjectDocument, get: () => Options, onPick: (id: string) => void) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new T.Scene();
  scene.background = new T.Color(0xf2eee1);
  scene.add(new T.HemisphereLight(0xfffbeb, 0x9b9f93, 2.1));
  const key = new T.DirectionalLight(0xffeed6, 2.2); key.position.set(5, 9, -4); scene.add(key);
  const rig = new T.Group(); scene.add(rig);
  const camera = new T.PerspectiveCamera(43, 1, .04, 900);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .12; controls.minDistance = .4; controls.maxDistance = 400;
  controls.maxPolarAngle = Math.PI * .48;
  const grid = new T.GridHelper(20, 40, 0xb5b6a2, 0xdad8cb); grid.position.y = data.floorY - .125; scene.add(grid);
  const walls: T.Mesh<T.BoxGeometry, T.MeshStandardMaterial>[] = [];
  const floorMaterials = new Map<string, T.MeshStandardMaterial>();
  const equipment = new Map<string, T.Group>();
  const section = new T.Group(); rig.add(section);
  const floorBase = new T.Color(0xdad2b6);
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
  const distance = Math.max(4, size.x, size.z) * 1.35;
  function cameraMode(view: 'orbit' | 'top' | 'slice') {
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
    const { selected, transparent, heat, section: showSection, still, frame } = get();
    const live = hasLiveFrame(frame) ? frame : null;
    const elapsed = !still && live?.mode === 'running' ? Math.min(.1, (time - previous) / 1000) : 0;
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
      for (let i = 0; i < pipe.dots; i++) {
        const at = particleDistance(pipe.offset + pipe.length * i / pipe.dots, 0, 0, pipe.length);
        tmp.position.copy(pipe.path.getPoint(at / pipe.length)); tmp.updateMatrix();
        particles.setMatrixAt(drawn++, tmp.matrix);
      }
    }
    particles.count = drawn; particles.instanceMatrix.needsUpdate = true;
    controls.update(); renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }
  frameId = requestAnimationFrame(animate);
  let pointer: { x: number; y: number } | null = null;
  function down(e: PointerEvent) { pointer = { x: e.clientX, y: e.clientY }; }
  function pick(e: PointerEvent) {
    if (!pointer || Math.hypot(pointer.x - e.clientX, pointer.y - e.clientY) > 6) return;
    const r = canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2((e.clientX - r.left) * 2 / r.width - 1, 1 - (e.clientY - r.top) * 2 / r.height), camera);
    const hit = ray.intersectObjects([...equipment.values()], true)[0]?.object.userData.componentId;
    if (typeof hit === 'string') onPick(hit);
  }
  canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', pick);
  return {
    cameraMode,
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
      dead = true; cancelAnimationFrame(frameId); ro.disconnect(); controls.dispose();
      canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', pick);
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
