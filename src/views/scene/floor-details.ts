import type * as T from 'three';
import { cube, cyl, paint } from './equipment-details';

type Add = (mesh: T.Mesh, x?: number, y?: number, z?: number, turn?: number) => void;

export function floorDetail(add: Add, variant: string) {
  const flat = (thickness: number, color: number, y = thickness / 2) => add(cube(.32, thickness, .234, color), 0, y);
  switch (variant) {
    case 'floor-insulation': flat(.082, paint.foam); break;
    case 'stud-mat':
      flat(.029, paint.dark);
      for (const x of [-.107, 0, .107]) for (const z of [-.071, 0, .071]) add(cyl(.026, .049, paint.body), x, .044, z);
      break;
    case 'film': {
      flat(.006, paint.body);
      const roll = cyl(.024, .234, paint.dark); roll.rotation.x = Math.PI / 2;
      add(roll, .137, .025); break;
    }
    case 'underlay':
      flat(.019, paint.foam);
      for (const z of [-.058, .058]) add(cube(.316, .009, .014, paint.steel), 0, .021, z);
      break;
    case 'mesh':
      for (const x of [-.139, -.07, 0, .07, .139]) add(cube(.010, .010, .238, paint.steel), x, .016);
      for (const z of [-.105, -.035, .035, .105]) add(cube(.322, .01, .01, paint.dark), 0, .022, z);
      break;
    case 'rail':
      add(cube(.342, .027, .058, paint.dark), 0, .022);
      for (const x of [-.11, 0, .11]) for (const z of [-.026, .026]) add(cube(.031, .045, .017, paint.body), x, .051, z);
      break;
    case 'clips':
      for (const x of [-.075, .076]) {
        add(cube(.069, .031, .046, paint.body), x, .059);
        for (const z of [-.028, .028]) add(cube(.046, .065, .017, paint.dark), x, .035, z);
      }
      break;
    case 'edge-tape':
      add(cube(.32, .108, .023, paint.foam), 0, .055, .072);
      add(cube(.322, .017, .128, paint.light), 0, .014, .008); break;
    case 'joint':
      for (const x of [-.091, .091]) add(cube(.15, .041, .236, paint.steel), x, .027);
      add(cube(.031, .058, .236, paint.dark), 0, .035); break;
    case 'sleeve':
      add(cyl(.065, .34, paint.body), 0, .074, 0, Math.PI / 2);
      for (const x of [-.12, -.06, 0, .06, .12]) add(cyl(.071, .019, paint.dark), x, .074, 0, Math.PI / 2);
      break;
    case 'screed': flat(.068, paint.steel); add(cube(.27, .022, .042, paint.copper), 0, .052, .104); break;
    case 'dry-plate':
      flat(.022, paint.steel);
      for (const z of [-.066, .066]) add(cube(.312, .018, .073, paint.light), 0, .026, z);
      add(cyl(.021, .32, paint.copper), 0, .024, 0, Math.PI / 2); break;
    case 'deck':
      for (const z of [-.083, 0, .083]) add(cube(.333, .033, .074, paint.copper), 0, .042, z);
      for (const x of [-.113, .113]) add(cube(.048, .037, .246, paint.dark), x, .019);
      break;
    case 'floor-finish':
      for (const x of [-.081, .081]) for (const z of [-.061, .061]) add(cube(.153, .015, .113, paint.light), x, .018, z);
      break;
    default: flat(.035, paint.foam);
  }
}
