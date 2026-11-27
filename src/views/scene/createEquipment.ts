import * as T from 'three';

const paint = { copper: 0xb16b46, body: 0x315a5b, dark: 0x253b3f, brass: 0xc29652, steel: 0xc1c7c5, light: 0xeeece4, foam: 0x82a19b };
const mat = (color: number) => new T.MeshStandardMaterial({ color, roughness: .67, metalness: .16 });
const cube = (x: number, y: number, z: number, color: number) => new T.Mesh(new T.BoxGeometry(x, y, z), mat(color));
const cyl = (r: number, length: number, color: number) => new T.Mesh(new T.CylinderGeometry(r, r, length, 14), mat(color));
type Equipment = { id: string; position: { x: number; y: number; z: number }; family: string; variant: string; outlets?: number };

export function createEquipment(equipment: Equipment) {
  const { family, variant } = equipment;
  const group = new T.Group();
  const add = (mesh: T.Mesh, x = 0, y = 0, z = 0, turn = 0) => {
    mesh.position.set(x, y, z); mesh.rotation.z = turn; group.add(mesh);
  };
  const pipe = (r = .055, width = .32) => add(cyl(r, width, paint.copper), 0, .075, 0, Math.PI / 2);
  const face = () => add(cube(.21, .145, .025, paint.dark), 0, .25, .13);
  if (family === 'source') {
    add(cube(.48, .56, .26, paint.light), 0, .34); face();
    add(cyl(.042, .15, paint.copper), -.15, .07); add(cyl(.042, .15, paint.steel), .15, .07);
  } else if (family === 'manifolds') {
    const outlets = Math.max(1, Math.min(12, equipment.outlets || 1));
    const sides = variant === 'supply-manifold' ? [1] : variant === 'return-manifold' ? [-1] : [-1, 1];
    for (const side of sides) {
      add(cyl(.05, .14 + outlets * .105, side === 1 ? paint.copper : paint.steel), 0, .17, side * .098, Math.PI / 2);
      for (let i = 0; i < outlets; i++) add(cyl(.023, .13, paint.brass), (i - (outlets - 1) / 2) * .105, .1, side * .098);
    }
  } else if (family === 'circulation' || family === 'mixing') {
    pipe(.06, .56);
    add(cyl(.138, .15, paint.body), 0, .18);
    add(cyl(.095, .06, paint.dark), 0, .28);
    if (family === 'mixing') add(cyl(.045, .18, paint.brass), .16, .14, .07);
  } else if (family === 'pressure') {
    if (variant === 'expansion-vessel') {
      const mesh = new T.Mesh(new T.SphereGeometry(.14, 20, 12), mat(paint.copper));
      mesh.scale.y = 1.4;
      add(mesh, 0, .24);
      add(cyl(.035, .15, paint.brass), 0, .07);
    } else {
      add(cyl(.09, .12, variant.includes('gauge') ? paint.light : paint.brass), 0, .15);
      add(cyl(.04, .18, paint.steel), 0, .07);
    }
  } else if (family === 'storage') {
    if (variant === 'plate-exchanger') {
      for (let i = 0; i < 8; i++) add(cube(.28, .34, .013, i % 2 ? paint.steel : paint.body), 0, .2, (i - 3.5) * .019);
    } else {
      add(cyl(.12, .43, paint.steel), 0, .23);
      for (const x of [-.15, .15]) for (const y of [.12, .36]) add(cyl(.033, .13, paint.copper), x, y, 0, Math.PI / 2);
    }
  } else if (family === 'measurement-radiators' && variant === 'radiator') {
    for (let i = 0; i < 9; i++) add(cube(.054, .4, .1, paint.light), (i - 4) * .058, .21);
    pipe(.032, .54);
  } else if (['balancing', 'isolation', 'directional', 'filtration', 'service', 'measurement-radiators'].includes(family)) {
    pipe();
    add(cyl(.072, family === 'filtration' ? .2 : .11, paint.brass), 0, .12, 0, family === 'filtration' ? -.45 : 0);
    add(cube(.18, .035, .05, paint.copper), .04, .19);
  } else if (['actuation', 'zone-sensing', 'safety-controls'].includes(family)) {
    add(cube(.22, .17, .17, paint.light), 0, .11);
    add(cube(.1, .063, .026, paint.body), 0, .12, .09);
  } else if (family === 'mounting') {
    add(cube(.42, .36, .09, paint.steel), 0, .18);
    add(cube(.025, .14, .02, paint.dark), .15, .20, .058);
  } else if (family === 'floor-installation' || family === 'floor-build-up') {
    for (const [i, color] of [paint.steel, paint.foam, paint.copper, paint.light].entries()) add(cube(.26, .018, .19, color), 0, .021 + .022 * i);
  } else {
    pipe();
    if (family === 'fittings') add(cyl(.042, .19, paint.brass), 0, .15);
  }
  group.position.set(equipment.position.x, equipment.position.y, equipment.position.z);
  group.traverse((obj) => { obj.userData.componentId = equipment.id; });
  return group;
}
