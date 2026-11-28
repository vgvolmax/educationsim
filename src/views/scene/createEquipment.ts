import * as T from 'three';

import { cube, cyl, electronicsDetail, inlineDetail, mat, paint, pressureDetail } from './equipment-details';
import { floorDetail } from './floor-details';

type Equipment = { id: string; position: { x: number; y: number; z: number }; family: string; variant: string; outlets?: number; quarterTurns?: number };

export function createEquipment(equipment: Equipment) {
  const { family, variant } = equipment;
  const group = new T.Group();
  const add = (mesh: T.Mesh, x = 0, y = 0, z = 0, turn = 0) => {
    mesh.position.set(x, y, z); mesh.rotation.z = turn; group.add(mesh);
  };
  const pipe = (r = .055, width = .32) => add(cyl(r, width, paint.copper), 0, .075, 0, Math.PI / 2);
  const face = () => add(cube(.21, .145, .025, paint.dark), 0, .25, .13);
  const plates = () => {
    for (let i = 0; i < 8; i++) add(cube(.28, .34, .013, i % 2 ? paint.steel : paint.body), 0, .2, (i - 3.5) * .019);
    for (const x of [-.095, .095]) for (const y of [.09, .31]) {
      const port = cyl(.024, .095, y > .2 ? paint.copper : paint.steel);
      port.rotation.x = Math.PI / 2; add(port, x, y, .065);
    }
  };
  const pump = (x = 0) => {
    add(cyl(.138, .15, paint.body), x, .18);
    add(cyl(.095, .06, paint.dark), x, .28);
  };
  const hex = (r: number, width: number, color = paint.brass) =>
    new T.Mesh(new T.CylinderGeometry(r, r, width, 6), mat(color));
  if (family === 'source') {
    if (variant === 'external-source') plates();
    else if (variant === 'heat-pump') {
      add(cube(.62, .43, .3, paint.steel), 0, .22);
      const fan = cyl(.163, .028, paint.dark); fan.rotation.x = Math.PI / 2; add(fan, 0, .23, .16);
      for (let i = 0; i < 5; i++) add(cube(.24, .015, .02, paint.body), 0, .23, .179, i * Math.PI / 5);
      add(cube(.54, .045, .34, paint.dark), 0, .05);
    } else {
      const electric = variant === 'electric-boiler';
      add(cube(electric ? .26 : .48, electric ? .53 : .56, .26, paint.light), 0, .34);
      face();
      add(cyl(.042, .15, paint.copper), electric ? -.075 : -.15, .07);
      add(cyl(.042, .15, paint.steel), electric ? .075 : .15, .07);
      if (!electric) add(cyl(.072, .12, paint.steel), 0, .66);
      if (electric) add(cube(.12, .03, .028, paint.copper), 0, .42, .14);
    }
  } else if (family === 'manifolds') {
    const outlets = Math.max(1, Math.min(12, equipment.outlets || 1));
    const sides = variant === 'supply-manifold' ? [1] : variant === 'return-manifold' ? [-1] : [-1, 1];
    for (const side of sides) {
      add(cyl(.05, .14 + outlets * .105, side === 1 ? paint.copper : paint.steel), 0, .17, side * .098, Math.PI / 2);
      for (let i = 0; i < outlets; i++) {
        const x = (i - (outlets - 1) / 2) * .105;
        add(cyl(.023, .13, paint.brass), x, .1, side * .098);
        if (side === 1 && variant === 'pair-flowmeters') {
          add(cyl(.017, .09, paint.light), x, .246, side * .098);
          add(cyl(.021, .032, paint.dark), x, .296, side * .098);
        } else if (side < 0 && sides.length === 2) add(cyl(.026, .053, paint.body), x, .218, side * .098);
      }
    }
    if (variant === 'dynamic-manifold') add(cyl(.05, .12, paint.body), -.12, .247, .098);
  } else if (family === 'circulation' || family === 'mixing') {
    pipe(.06, .56);
    if (family === 'circulation') {
      pump();
      if (variant === 'direct-pump-group') {
        add(cube(.59, .29, .065, paint.dark), 0, .164, -.09);
        add(cyl(.041, .17, paint.steel), -.225, .17);
      }
    } else {
      const groupType = variant.endsWith('-group');
      add(hex(.09, .13), groupType ? -.09 : 0, .095, 0, Math.PI / 2);
      add(cyl(.05, .135, paint.body), groupType ? -.09 : 0, .2);
      if (variant !== 'two-way-mix') add(cyl(.045, .16, paint.brass), groupType ? -.09 : 0, .16, .087, -.46);
      if (groupType) add(cube(.57, .22, .055, paint.dark), 0, .144, -.09);
      if (variant === 'pump-mixing-group') pump(.14);
      else if (variant === 'passive-mixing-group') add(cyl(.035, .15, paint.steel), .19, .16);
    }
  } else if (family === 'conveyance') {
    if (variant === 'riser') {
      add(cyl(.045, .78, paint.copper), 0, .41);
      for (const y of [.13, .66]) add(cyl(.064, .055, paint.steel), 0, y);
    } else if (variant === 'pipe-insulation') {
      pipe(.042, .43); add(cyl(.077, .28, paint.foam), 0, .077, 0, Math.PI / 2);
    } else pipe(variant === 'loop-pipe' ? .033 : .053, variant === 'loop-pipe' ? .39 : .58);
  } else if (family === 'fittings') {
    if (variant === 'elbow') {
      add(cyl(.055, .20, paint.brass), -.09, .073, 0, Math.PI / 2);
      add(cyl(.055, .19, paint.brass), 0, .164);
      add(new T.Mesh(new T.SphereGeometry(.056, 12, 8), mat(paint.brass)), 0, .073);
    } else if (variant === 'tee') {
      pipe(.048, .32); add(cyl(.051, .19, paint.brass), 0, .155);
    } else if (variant === 'cap') {
      add(hex(.071, .13), 0, .077, 0, Math.PI / 2);
      add(cyl(.073, .023, paint.dark), .07, .077, 0, Math.PI / 2);
    } else if (variant === 'adapter' || variant === 'eurocone') {
      const taper = new T.Mesh(new T.CylinderGeometry(.045, .071, .18, 14), mat(paint.brass));
      add(taper, 0, .078, 0, Math.PI / 2);
      if (variant === 'eurocone') add(hex(.083, .075, paint.steel), .093, .078, 0, Math.PI / 2);
      else add(cyl(.042, .095, paint.copper), -.115, .078, 0, Math.PI / 2);
    } else {
      pipe(.047, .28);
      add(hex(variant === 'union' ? .085 : .066, variant === 'union' ? .105 : .19), 0, .075, 0, Math.PI / 2);
      if (variant === 'union') add(cyl(.055, .038, paint.steel), .075, .075, 0, Math.PI / 2);
    }
  } else if (family === 'pressure') {
    if (variant === 'expansion-vessel') {
      const mesh = new T.Mesh(new T.SphereGeometry(.14, 20, 12), mat(paint.copper));
      mesh.scale.y = 1.4;
      add(mesh, 0, .24);
      add(cyl(.035, .15, paint.brass), 0, .07);
    } else {
      pressureDetail(add, variant);
    }
  } else if (family === 'storage') {
    if (variant === 'plate-exchanger') {
      plates();
    } else if (variant === 'separator-manifold') {
      const outlets = Math.max(1, Math.min(12, equipment.outlets || 3));
      const length = .24 + outlets * .12;
      add(cube(length, .19, .14, paint.steel), 0, .25);
      add(cyl(.086, .43, paint.dark), -length / 2 + .06, .27);
      for (let i = 0; i < outlets; i++) {
        const x = -length / 2 + .23 + i * .12;
        add(cyl(.03, .13, paint.copper), x, .39, -.042);
        add(cyl(.03, .13, paint.steel), x, .10, .042);
      }
    } else {
      const buffer = variant === 'buffer';
      add(cyl(buffer ? .18 : .12, buffer ? .56 : .43, paint.steel), 0, buffer ? .29 : .23);
      for (const x of [-1, 1]) for (const y of [.12, buffer ? .45 : .36])
        add(cyl(.033, .13, paint.copper), x * (buffer ? .21 : .15), y, 0, Math.PI / 2);
      if (buffer) add(cyl(.158, .052, paint.body), 0, .06);
    }
  } else if (family === 'measurement-radiators' && variant === 'radiator') {
    for (let i = 0; i < 9; i++) add(cube(.054, .4, .1, paint.light), (i - 4) * .058, .21);
    pipe(.032, .54);
  } else if (variant === 'radiator-angle-valve' || variant === 'radiator-straight-valve') {
    const angle = variant === 'radiator-angle-valve';
    add(cyl(.059, angle ? .2 : .4, paint.dark), angle ? -.083 : 0, .125, 0, Math.PI / 2);
    add(hex(.077, .062, paint.steel), -.192, .125, 0, Math.PI / 2);
    if (angle) {
      add(cyl(.059, .15, paint.dark), 0, .088);
      add(hex(.076, .044, paint.steel), 0, .035);
    } else add(hex(.077, .062, paint.steel), .192, .125, 0, Math.PI / 2);
    add(cyl(.08, .045, paint.steel), 0, .19);
    add(cyl(.039, .075, paint.brass), 0, .23);
  } else if (['balancing', 'isolation', 'directional', 'filtration', 'service', 'measurement-radiators'].includes(family)) {
    pipe();
    inlineDetail(add, variant);
  } else if (['actuation', 'zone-sensing', 'safety-controls'].includes(family)) {
    electronicsDetail(add, variant);
  } else if (family === 'mounting') {
    if (variant === 'bracket') {
      for (const x of [-.13, .13]) {
        add(cube(.033, .32, .045, paint.steel), x, .177);
        add(cube(.068, .045, .122, paint.dark), x, .103, .047);
      }
      add(cube(.30, .04, .05, paint.steel), 0, .24);
    } else {
      add(cube(.42, .36, .09, paint.steel), 0, .18);
      add(cube(.025, .14, .02, paint.dark), .15, .20, .058);
    }
  } else if (family === 'floor-installation' || family === 'floor-build-up') {
    floorDetail(add, variant);
  } else pipe();
  group.rotation.y = (equipment.quarterTurns ?? 0) * Math.PI / 2;
  group.position.set(equipment.position.x, equipment.position.y, equipment.position.z);
  group.traverse((obj) => { obj.userData.componentId = equipment.id; });
  return group;
}
