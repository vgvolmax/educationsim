import * as T from 'three';

export const paint = { copper: 0xb16b46, body: 0x315a5b, dark: 0x253b3f, brass: 0xc29652,
  steel: 0xc1c7c5, light: 0xeeece4, foam: 0x82a19b };
export const mat = (color: number) => new T.MeshStandardMaterial({ color, roughness: .67, metalness: .16 });
export const cube = (x: number, y: number, z: number, color: number) => new T.Mesh(new T.BoxGeometry(x, y, z), mat(color));
export const cyl = (radius: number, length: number, color: number) =>
  new T.Mesh(new T.CylinderGeometry(radius, radius, length, 14), mat(color));
type Add = (mesh: T.Mesh, x?: number, y?: number, z?: number, turn?: number) => void;

function dial(add: Add, x: number, y: number, z: number, radius: number) {
  const bezel = cyl(radius, .031, paint.dark); bezel.rotation.x = Math.PI / 2; add(bezel, x, y, z);
  const face = cyl(radius * .8, .011, paint.light); face.rotation.x = Math.PI / 2; add(face, x, y, z + .017);
  add(cube(radius * .88, .01, .012, paint.copper), x + radius * .21, y + radius * .22, z + .025, .75);
}

export function inlineDetail(add: Add, variant: string) {
  const handle = (w = .18, y = .21) => add(cube(w, .035, .05, paint.copper), .035, y);
  const stem = (r = .057, h = .14, color = paint.brass) => add(cyl(r, h, color), 0, .06 + h / 2);
  const casing = (r: number, width: number, x = 0, y = .078) => add(cyl(r, width, paint.brass), x, y, 0, Math.PI / 2);
  const bonnet = () => { stem(.064, .115); add(cyl(.071, .04, paint.body), 0, .19); };
  switch (variant) {
    case 'loop-balance': bonnet(); add(cyl(.048, .045, paint.copper), 0, .228); break;
    case 'branch-balance':
      bonnet(); for (const x of [-.088, .088]) add(cyl(.022, .082, paint.steel), x, .135);
      break;
    case 'flowmeter': stem(.032, .24, paint.light); add(cyl(.044, .057, paint.dark), 0, .19); break;
    case 'ball-valve': stem(.065, .12); handle(.22); break;
    case 'loop-valve': bonnet(); add(cyl(.053, .062, paint.light), 0, .227); break;
    case 'motor-zone-valve':
      stem(); add(cube(.19, .135, .15, paint.body), 0, .235); add(cube(.07, .02, .03, paint.light), .035, .306);
      break;
    case 'check':
      casing(.076, .17); add(cube(.084, .021, .024, paint.dark), 0, .153); break;
    case 'bypass':
      stem(.072, .168); add(cyl(.08, .04, paint.dark), 0, .252); add(cyl(.046, .12, paint.brass), .095, .095, .04, -.78); break;
    case 'jumper':
      add(cyl(.041, .15, paint.copper), -.121, .151); add(cyl(.041, .15, paint.copper), .121, .151);
      add(cyl(.041, .242, paint.copper), 0, .224, 0, Math.PI / 2); break;
    case 'rtl':
      stem(.061, .114); add(cyl(.09, .13, paint.light), 0, .241); add(cyl(.092, .027, paint.dark), 0, .313); break;
    case 'air-vent':
      stem(.061, .23); add(cyl(.035, .047, paint.dark), 0, .308); break;
    case 'air-separator':
      stem(.088, .24); casing(.072, .11); add(cyl(.031, .079, paint.steel), 0, .327); break;
    case 'end-block':
      casing(.081, .18); add(cyl(.044, .126, paint.steel), 0, .188); add(cyl(.038, .109, paint.brass), 0, .067, .12, Math.PI / 2); break;
    case 'drain-cock':
      stem(.052, .11); handle(.125); add(cyl(.038, .135, paint.brass), .10, .085, .042, -1.03); break;
    case 'fill-cock':
      stem(.055, .127); add(cube(.12, .03, .071, paint.body), 0, .214); add(casingTip(), .16, .075, 0, Math.PI / 2); break;
    case 'protected-makeup':
      casing(.077, .13, -.085); casing(.085, .125, .09);
      add(cyl(.038, .115, paint.body), .055, .182); break;
    case 'strainer':
      add(cyl(.069, .22, paint.brass), .04, .125, 0, -.53); add(cyl(.075, .038, paint.steel), .095, .22, 0, -.53); break;
    case 'dirt-separator':
      stem(.086, .185); add(cyl(.058, .047, paint.dark), 0, .254); break;
    case 'sludge-trap':
      stem(.095, .17); add(cube(.128, .022, .12, paint.steel), 0, .235); add(cyl(.031, .077, paint.brass), .09, .105, 0, Math.PI / 2); break;
    case 'magnetic-separator':
      stem(.09, .20, paint.body); add(cyl(.039, .22, paint.dark), 0, .239, .075); add(cyl(.055, .035, paint.copper), 0, .355, .075); break;
    case 'thermometer':
      stem(.022, .154); dial(add, 0, .235, .053, .071); break;
    case 'heat-meter':
      stem(.046, .105); add(cube(.17, .1, .128, paint.dark), 0, .213); add(cube(.09, .03, .014, paint.light), 0, .222, .069); break;
    default: stem();
  }
  function casingTip() { return cyl(.041, .092, paint.steel); }
}

export function electronicsDetail(add: Add, variant: string) {
  const display = (w: number, h: number, d: number, y: number) => {
    add(cube(w, h, d, paint.light), 0, y);
    add(cube(w * .47, h * .37, .026, paint.body), 0, y + h * .10, d / 2);
  };
  switch (variant) {
    case 'remote-head':
      add(cyl(.079, .155, paint.light), 0, .132); add(cyl(.08, .029, paint.body), 0, .207);
      add(cyl(.014, .20, paint.dark), .154, .061, .08, Math.PI / 2); add(cyl(.023, .079, paint.steel), .258, .063, .08, Math.PI / 2); break;
    case 'mix-actuator': display(.186, .148, .161, .147); add(cyl(.04, .12, paint.steel), 0, .073); break;
    case 'thermal-actuator':
      add(cyl(.063, .188, paint.light), 0, .132); add(cyl(.067, .032, paint.body), 0, .045); break;
    case 'air-thermostat': display(.23, .23, .058, .137); add(cube(.084, .017, .027, paint.dark), 0, .082, .033); break;
    case 'floor-sensor':
      add(cyl(.025, .205, paint.steel), .034, .03, 0, Math.PI / 2); add(cyl(.012, .23, paint.dark), -.16, .03, 0, Math.PI / 2); break;
    case 'supply-sensor':
      add(cyl(.034, .17, paint.brass), 0, .108); add(cube(.10, .075, .085, paint.body), 0, .225); break;
    case 'outdoor-sensor':
      add(cube(.135, .19, .095, paint.light), 0, .117);
      for (let i = 0; i < 3; i++) add(cube(.09, .013, .026, paint.dark), 0, .09 + i * .025, .05);
      break;
    case 'zone-controller':
      display(.29, .16, .10, .112);
      for (let i = 0; i < 5; i++) add(cube(.019, .025, .038, paint.steel), (i - 2) * .036, .047, .062);
      break;
    case 'weather-controller':
      display(.20, .24, .095, .14);
      add(cyl(.032, .047, paint.dark), .053, .095, .065, Math.PI / 2); break;
    case 'high-limiter': display(.14, .16, .09, .104); add(cyl(.025, .037, paint.copper), 0, .18, .023); break;
    case 'emergency-relay':
      add(cube(.089, .18, .11, paint.light), 0, .117);
      add(cube(.044, .055, .02, paint.copper), 0, .14, .059); break;
    default: display(.22, .17, .17, .11);
  }
}

export function pressureDetail(add: Add, variant: string) {
  add(cyl(.036, .15, paint.steel), 0, .075);
  if (variant === 'pressure-gauge') dial(add, 0, .204, .029, .105);
  else if (variant === 'safety-group') {
    add(cyl(.058, .30, paint.brass), 0, .144, 0, Math.PI / 2);
    add(cyl(.042, .135, paint.brass), -.098, .218);
    add(cyl(.050, .113, paint.copper), .098, .206);
    dial(add, 0, .222, .071, .075);
  } else {
    add(cyl(.061, .15, paint.brass), 0, .148);
    add(cyl(.072, .049, paint.copper), 0, .241);
    add(cyl(.039, .112, paint.steel), .085, .137, 0, Math.PI / 2);
  }
}
