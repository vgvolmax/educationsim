import * as T from 'three';
import { snapToGrid } from '../../editor/placement';
import type { Placement } from '../../editor/placement';
import type { Point2 } from '../../project/types';
import { equipmentModel } from './buildScene';
import { createEquipment } from './createEquipment';

export function scenePlacement(scene: T.Scene, camera: T.Camera, canvas: HTMLCanvasElement, floorY: number, equipment: ReadonlyMap<string, T.Group>) {
  const floor = new T.Plane(new T.Vector3(0, 1, 0), -floorY);
  const ray = new T.Raycaster(), ground = new T.Vector3(), bounds = new T.Box3();
  const installed = [...equipment].map(([id, object]) => ({ id, box: new T.Box3().setFromObject(object) }));
  const materials: T.MeshStandardMaterial[] = [];
  let ghost: T.Group | null = null;
  let typeId: string | undefined;
  const mesh = new T.Mesh(new T.PlaneGeometry(.235, .235),
    new T.MeshBasicMaterial({ color: 0x0a765f, transparent: true, opacity: .55, depthWrite: false }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  scene.add(mesh);
  const layoutGrid = new T.GridHelper(20, 80, 0x629a8e, 0x7b9f95);
  layoutGrid.material.transparent = true;
  layoutGrid.material.opacity = .34;
  layoutGrid.material.depthWrite = false;
  layoutGrid.position.y = floorY + .006;
  layoutGrid.visible = false;
  scene.add(layoutGrid);

  function pointerRay(x: number, y: number) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ray.setFromCamera(new T.Vector2((x - rect.left) * 2 / rect.width - 1, 1 - (y - rect.top) * 2 / rect.height), camera);
    return ray;
  }

  function clear() {
    if (ghost) {
      scene.remove(ghost);
      ghost.traverse((mesh) => { if (mesh instanceof T.Mesh) mesh.geometry.dispose(); });
      materials.forEach((material) => material.dispose());
      materials.length = 0;
      ghost = null;
      typeId = undefined;
    }
    mesh.visible = false;
    layoutGrid.visible = false;
    delete canvas.dataset.placement;
    delete canvas.dataset.placementX;
    delete canvas.dataset.placementZ;
  }

  function preview(placement: Placement | null, pointer: Point2 | null) {
    if (!placement) { if (ghost) clear(); return null; }
    if (!ghost || typeId !== placement.typeId) {
      clear();
      typeId = placement.typeId;
      ghost = createEquipment(equipmentModel(typeId, 'placement-preview', { x: 0, y: floorY, z: 0 }));
      ghost.traverse((mesh) => {
        if (!(mesh instanceof T.Mesh) || !(mesh.material instanceof T.MeshStandardMaterial)) return;
        mesh.material.transparent = true;
        mesh.material.opacity = .57;
        mesh.material.depthWrite = false;
        materials.push(mesh.material);
      });
      scene.add(ghost);
    }
    layoutGrid.visible = true;
    const intersection = pointer && pointerRay(pointer.x, pointer.z)?.ray.intersectPlane(floor, ground);
    if (!intersection || Math.abs(intersection.x) > 10000 || Math.abs(intersection.z) > 10000) {
      ghost.visible = false;
      mesh.visible = false;
      canvas.dataset.placement = 'waiting';
      return null;
    }
    const point = { x: snapToGrid(intersection.x), z: snapToGrid(intersection.z) };
    ghost.visible = true;
    ghost.rotation.y = placement.quarterTurns * Math.PI / 2;
    ghost.position.set(point.x, floorY, point.z);
    bounds.setFromObject(ghost);
    const possible = !installed.some(({ id, box }) => id !== placement.movingId &&
      bounds.min.x < box.max.x + .04 && bounds.max.x > box.min.x - .04 &&
      bounds.min.z < box.max.z + .04 && bounds.max.z > box.min.z - .04);
    mesh.visible = true;
    mesh.position.set(point.x, floorY + .013, point.z);
    mesh.material.color.setHex(possible ? 0x0a765f : 0xbe381f);
    for (const material of materials) material.emissive.setHex(possible ? 0x005243 : 0x9e1306);
    canvas.dataset.placement = possible ? 'ready' : 'occupied';
    canvas.dataset.placementX = String(point.x);
    canvas.dataset.placementZ = String(point.z);
    return possible ? point : null;
  }

  function pick(x: number, y: number) {
    return pointerRay(x, y)?.intersectObjects([...equipment.values()], true)[0]?.object.userData.componentId as string | undefined;
  }

  return { preview, pick, dispose: clear };
}
