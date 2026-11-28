import { useEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEquipment } from '../views/scene/createEquipment';
import { equipmentModel } from '../views/scene/buildScene';
import type { CatalogVisual } from './model-preview';

export function CatalogModel({ typeId, name, variant, outlets }: CatalogVisual) {
  const node = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const canvas = node.current;
    if (!canvas) return;
    let renderer: T.WebGLRenderer;
    try { renderer = new T.WebGLRenderer({ canvas, alpha: false, antialias: true }); }
    catch { setUnavailable(true); return; }
    const scene = new T.Scene();
    scene.background = new T.Color('#e9f0ef');
    const base = equipmentModel(typeId, 'preview', { x: 0, y: 0, z: 0 });
    const model = createEquipment({ ...base, variant: variant ?? base.variant, outlets: outlets ?? base.outlets });
    const box = new T.Box3().setFromObject(model), size = box.getBoundingSphere(new T.Sphere());
    model.position.sub(size.center);
    scene.add(model, new T.HemisphereLight(0xffffff, 0x62777b, 2.7));
    const light = new T.DirectionalLight(0xffecd0, 2.1);
    light.position.set(1, 2, 3);
    scene.add(light);
    const camera = new T.PerspectiveCamera(37, 1, .002, 50);
    const distance = Math.max(.2, size.radius) * 3.35;
    camera.position.set(distance * .51, distance * .5, distance * .77);
    const controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.minDistance = distance * .62;
    controls.maxDistance = distance * 1.65;
    controls.update();
    const render = () => renderer.render(scene, camera);
    function resize() {
      if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
      render();
      canvas.dataset.modelReady = typeId;
    }
    controls.addEventListener('change', render);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => {
      observer.disconnect();
      controls.dispose();
      model.traverse((item) => {
        if (!(item instanceof T.Mesh)) return;
        item.geometry.dispose();
        for (const material of Array.isArray(item.material) ? item.material : [item.material]) material.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    };
  }, [typeId, variant, outlets]);
  return <figure className="catalog-model">
    {unavailable ? <p>3D-предпросмотр недоступен в этом окне.</p> :
      <canvas ref={node} role="img" aria-label={'Учебная 3D-модель: ' + name} />}
    <figcaption><span>Типовая 3D-модель · {name}</span>
      {!unavailable && <span>Перетащите для поворота · колесо для масштаба</span>}</figcaption>
  </figure>;
}
