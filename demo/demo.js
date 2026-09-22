/* Co-presence demonstrator.
 *
 * The paper's claim is that the spatial observations it evaluates are the native
 * output of a shared virtual environment rather than hand-authored text. This
 * page exists to make that checkable: the panel on the right emits the SAME
 * structure state_machine.py produces, and its `gaze` field is computed from
 * where the camera is actually pointing this frame.
 *
 * The experiment runs the relationship the other way round — the addressee is
 * authored and gaze is derived from it. Here gaze is measured and the addressee
 * is unknown, which is why Turn gained an optional measured_gaze field.
 */
const V = THREE.Vector3;

// ---- scene ---------------------------------------------------------------
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
/* A living room rather than an empty hall. The claim is about agents in shared
 * social spaces, and a bare grid invited the reading that the effect is a lab
 * artefact. Everything is built from primitives and canvas textures, so the
 * folder still opens offline with nothing to fetch.
 *
 * The furniture keeps to the walls. The middle of the room - where the robot
 * and the two people stand - stays clear, so nothing ever sits between a
 * speaker and whoever they are looking at. */
const ROOM = {halfX: 5.0, halfZ: 4.75, h: 2.9};
scene.background = new THREE.Color(0xd8d1c3);

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 120);
const HEAD_H = 1.65;
camera.position.set(2.0, HEAD_H, 3.2);

// Warm evening light: a soft fill from above plus the two lamps in the room.
scene.add(new THREE.HemisphereLight(0xfff3e2, 0x5b4b3c, 1.6));
const key = new THREE.DirectionalLight(0xfff6ea, 1.1);
key.position.set(3, 6, 4); scene.add(key);

const mat = (color, o = {}) =>
  new THREE.MeshStandardMaterial({color, roughness: 0.85, ...o});
function box(w, h, d, m, x, y, z, parent = scene) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z); parent.add(b); return b;
}
function cyl(rTop, rBot, h, m, x, y, z, parent = scene, open = false) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 24, 1, open), m);
  c.position.set(x, y, z); parent.add(c); return c;
}
function canvasTexture(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
// Seeded, so every visitor - and every figure - sees the same room.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---- floor, walls, ceiling --------------------------------------------------
const planks = canvasTexture(512, 512, (g, w, h) => {
  const rows = 8, rh = h / rows;               // one tile = 1.6 m, planks 20 cm
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * w * 0.6;
    while (x < w) {
      const len = w * (0.45 + rnd() * 0.5), l = 118 + rnd() * 26;
      g.fillStyle = `rgb(${l + 40 | 0},${l + 8 | 0},${l - 38 | 0})`;
      g.fillRect(x, r * rh, len, rh);
      g.strokeStyle = "rgba(60,38,20,0.10)";
      for (let k = 0; k < 5; k++) {
        const yy = r * rh + rnd() * rh;
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x + len, yy + (rnd() - 0.5) * 3); g.stroke();
      }
      g.fillStyle = "rgba(50,32,18,0.55)"; g.fillRect(x, r * rh, 2, rh);
      x += len;
    }
    g.fillStyle = "rgba(50,32,18,0.55)"; g.fillRect(0, r * rh, w, 2);
  }
}, ROOM.halfX * 2 / 1.6, ROOM.halfZ * 2 / 1.6);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfX * 2, ROOM.halfZ * 2),
  new THREE.MeshStandardMaterial({map: planks, roughness: 0.7}));
floor.rotation.x = -Math.PI / 2; scene.add(floor);

const wallMat = mat(0xd8d1c3, {roughness: 0.95, side: THREE.DoubleSide});
const trimMat = mat(0xefeae0, {roughness: 0.6});
for (const [x, z, ry, len] of [
    [0, -ROOM.halfZ, 0, ROOM.halfX * 2], [0, ROOM.halfZ, Math.PI, ROOM.halfX * 2],
    [-ROOM.halfX, 0, Math.PI / 2, ROOM.halfZ * 2], [ROOM.halfX, 0, -Math.PI / 2, ROOM.halfZ * 2]]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(len, ROOM.h), wallMat);
  w.position.set(x, ROOM.h / 2, z); w.rotation.y = ry; scene.add(w);
  const skirting = new THREE.Mesh(new THREE.BoxGeometry(len, 0.10, 0.02), trimMat);
  skirting.position.set(x, 0.05, z); skirting.rotation.y = ry; skirting.translateZ(0.01);
  scene.add(skirting);
}
const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.halfX * 2, ROOM.halfZ * 2),
  // It faces straight down into the hemisphere light's ground colour and came out
  // brown; a little self-illumination brings it back to painted plaster.
  mat(0xf1eee8, {roughness: 1, emissive: 0xf1eee8, emissiveIntensity: 0.35}));
ceiling.rotation.x = Math.PI / 2; ceiling.position.y = ROOM.h; scene.add(ceiling);
cyl(0.32, 0.32, 0.03, mat(0xfff8ea, {emissive: 0xfff1d6, emissiveIntensity: 0.9}),
    0, ROOM.h - 0.015, -0.6);

// ---- rug under the robot ----------------------------------------------------
const rugTex = canvasTexture(512, 384, (g, w, h) => {
  g.fillStyle = "#2c3a52"; g.fillRect(0, 0, w, h);
  g.save(); g.beginPath(); g.rect(60, 60, w - 120, h - 120); g.clip();
  g.strokeStyle = "rgba(216,204,176,0.18)"; g.lineWidth = 3;
  for (let i = -h; i < w + h; i += 48) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
    g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke();
  }
  g.restore();
  g.strokeStyle = "#d8ccb0"; g.lineWidth = 14; g.strokeRect(22, 22, w - 44, h - 44);
  g.lineWidth = 4; g.strokeRect(46, 46, w - 92, h - 92);
});
const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.3),
  new THREE.MeshStandardMaterial({map: rugTex, roughness: 1}));
rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.006, -1.2); scene.add(rug);

// ---- furniture (each built facing +z, then turned into place) ----------------
const wood = mat(0x5b3c28, {roughness: 0.55});
const darkWood = mat(0x4a3322, {roughness: 0.6});
const leg = mat(0x2a211a, {roughness: 0.6});
const shadeMat = new THREE.MeshStandardMaterial({color: 0xf3e8d2, emissive: 0xffd9a8,
  emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 0.9});
function place(g, x, z, ry = 0) { g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g); return g; }

function sofa() {
  const g = new THREE.Group(), W = 2.5, D = 0.95;
  const fabric = mat(0x454b54, {roughness: 0.95}), cushion = mat(0x505762, {roughness: 0.95});
  box(W, 0.42, D, fabric, 0, 0.27, 0, g);
  box(W, 0.55, 0.22, fabric, 0, 0.62, -D / 2 + 0.11, g);
  for (const s of [-1, 1]) box(0.2, 0.62, D, fabric, s * (W / 2 - 0.1), 0.37, 0, g);
  const cw = (W - 0.44) / 3;
  for (let i = -1; i <= 1; i++) {
    box(cw - 0.03, 0.14, D - 0.28, cushion, i * cw, 0.55, 0.08, g);
    box(cw - 0.04, 0.42, 0.16, cushion, i * cw, 0.82, -0.175, g).rotation.x = -0.12;
  }
  box(0.38, 0.34, 0.12, mat(0xc98d3c), -0.78, 0.80, -0.03, g).rotation.set(-0.2, 0.25, 0.08);
  box(0.38, 0.34, 0.12, mat(0xa3503e), 0.80, 0.80, -0.03, g).rotation.set(-0.2, -0.3, -0.06);
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    box(0.06, 0.06, 0.06, leg, sx * (W / 2 - 0.08), 0.03, sz * (D / 2 - 0.08), g);
  return g;
}
function coffeeTable() {
  const g = new THREE.Group();
  box(1.2, 0.05, 0.62, wood, 0, 0.42, 0, g);
  box(1.08, 0.03, 0.5, wood, 0, 0.14, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, 0.42, 0.05, wood, sx * 0.54, 0.21, sz * 0.25, g);
  box(0.26, 0.04, 0.2, mat(0xe8dfcc), -0.25, 0.465, 0.05, g);
  box(0.24, 0.03, 0.18, mat(0x2f4a63), -0.24, 0.50, 0.04, g).rotation.y = 0.2;
  cyl(0.045, 0.04, 0.1, mat(0xf2efe6, {roughness: 0.4}), 0.3, 0.495, -0.05, g);
  return g;
}
function armchair() {
  const g = new THREE.Group(), leather = mat(0x8a5a3c, {roughness: 0.6});
  box(0.9, 0.40, 0.85, leather, 0, 0.26, 0, g);
  box(0.9, 0.55, 0.18, leather, 0, 0.66, -0.34, g);
  for (const s of [-1, 1]) box(0.14, 0.58, 0.85, leather, s * 0.38, 0.35, 0, g);
  box(0.62, 0.12, 0.62, mat(0x96654a, {roughness: 0.6}), 0, 0.52, 0.07, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.05, 0.06, 0.05, leg, sx * 0.38, 0.03, sz * 0.36, g);
  return g;
}
function floorLamp() {
  const g = new THREE.Group(), metal = mat(0x2b2b2b, {roughness: 0.4, metalness: 0.6});
  cyl(0.16, 0.18, 0.03, metal, 0, 0.015, 0, g);
  cyl(0.015, 0.015, 1.45, metal, 0, 0.75, 0, g);
  cyl(0.17, 0.24, 0.30, shadeMat, 0, 1.55, 0, g, true);
  const bulb = new THREE.PointLight(0xffd4a0, 4.5, 0, 2); bulb.position.y = 1.5; g.add(bulb);
  return g;
}
function sideTableWithLamp() {
  const g = new THREE.Group();
  cyl(0.26, 0.26, 0.04, wood, 0, 0.56, 0, g);
  cyl(0.03, 0.03, 0.54, wood, 0, 0.28, 0, g);
  cyl(0.18, 0.18, 0.03, wood, 0, 0.015, 0, g);
  cyl(0.07, 0.09, 0.22, mat(0xd9cdb6, {roughness: 0.5}), 0, 0.69, 0, g);
  cyl(0.12, 0.17, 0.20, shadeMat, 0, 0.90, 0, g, true);
  const bulb = new THREE.PointLight(0xffd4a0, 2.2, 0, 2); bulb.position.y = 0.88; g.add(bulb);
  return g;
}
function plant() {
  const g = new THREE.Group(), leaf = mat(0x3f6b3a, {roughness: 0.8});
  cyl(0.22, 0.17, 0.42, mat(0xe4ddd0, {roughness: 0.6}), 0, 0.21, 0, g);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + rnd() * 0.4, r = 0.1 + rnd() * 0.16;
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.16 + rnd() * 0.08, 10, 8), leaf);
    s.scale.set(1, 1.6, 1); s.position.set(Math.cos(a) * r, 0.75 + rnd() * 0.7, Math.sin(a) * r);
    g.add(s);
  }
  return g;
}
function bookshelf() {
  const g = new THREE.Group(), W = 1.5, H = 2.0, D = 0.34, shelves = 5;
  box(W, H, 0.02, darkWood, 0, H / 2, -D / 2 + 0.01, g);
  for (const s of [-1, 1]) box(0.04, H, D, darkWood, s * (W / 2 - 0.02), H / 2, 0, g);
  for (let i = 0; i <= shelves; i++) box(W, 0.035, D, darkWood, 0, 0.04 + i * (H - 0.08) / shelves, 0, g);
  const spines = [0x7d3b34, 0x2f4a63, 0xc9a557, 0x4d6b4a, 0xd8cdb8, 0x5a4c6e, 0x9a5b3a, 0x2c2c2c];
  for (let i = 0; i < shelves; i++) {
    const y0 = 0.04 + i * (H - 0.08) / shelves + 0.02;
    let bx = -W / 2 + 0.06;
    while (bx < W / 2 - 0.12) {
      if (rnd() < 0.12) { bx += 0.12 + rnd() * 0.1; continue; }
      const bw = 0.03 + rnd() * 0.035, bh = 0.2 + rnd() * 0.12;
      box(bw, bh, 0.22, mat(spines[Math.floor(rnd() * spines.length)], {roughness: 0.8}),
          bx + bw / 2, y0 + bh / 2, 0.02, g);
      bx += bw + 0.005;
    }
  }
  return g;
}
function mediaWall() {
  const g = new THREE.Group();
  box(1.8, 0.5, 0.42, wood, 0, 0.30, 0, g);
  for (const sx of [-1, 1]) box(0.05, 0.05, 0.05, leg, sx * 0.84, 0.025, 0, g);
  box(1.4, 0.80, 0.05, mat(0x151515, {roughness: 0.4}), 0, 1.35, -0.15, g);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.74),
    mat(0x1c2530, {roughness: 0.2, emissive: 0x0e1620, emissiveIntensity: 0.6}));
  screen.position.set(0, 1.35, -0.12); g.add(screen);
  cyl(0.06, 0.06, 0.18, mat(0xe4ddd0, {roughness: 0.6}), 0.6, 0.64, 0.02, g);
  return g;
}
function windowWithCurtains(w, h) {
  const g = new THREE.Group(), frame = mat(0xf3efe7, {roughness: 0.5}), t = 0.06;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial(
    {color: 0xbcd4e6, emissive: 0x8fb3cf, emissiveIntensity: 0.6, roughness: 0.2}));
  g.add(glass);
  box(w + 2 * t, t, 0.06, frame, 0, h / 2 + t / 2, 0.02, g);
  box(w + 2 * t, t, 0.06, frame, 0, -h / 2 - t / 2, 0.02, g);
  box(t, h, 0.06, frame, -w / 2 - t / 2, 0, 0.02, g);
  box(t, h, 0.06, frame, w / 2 + t / 2, 0, 0.02, g);
  box(0.035, h, 0.04, frame, 0, 0, 0.02, g);
  box(w, 0.035, 0.04, frame, 0, h * 0.1, 0.02, g);
  box(w + 0.3, 0.04, 0.16, frame, 0, -h / 2 - 0.08, 0.08, g);
  const cloth = mat(0xb9a98e, {roughness: 1});
  for (const s of [-1, 1]) box(0.34, h + 0.5, 0.06, cloth, s * (w / 2 + 0.24), 0.1, 0.10, g);
  return g;
}
function wallArt(w, h) {
  const g = new THREE.Group();
  const art = canvasTexture(300, 180, (c, cw, ch) => {
    c.fillStyle = "#efe8da"; c.fillRect(0, 0, cw, ch);
    c.fillStyle = "#c98d3c"; c.beginPath(); c.arc(cw * 0.32, ch * 0.55, ch * 0.28, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#2c3a52"; c.fillRect(cw * 0.52, ch * 0.2, cw * 0.3, ch * 0.6);
    c.fillStyle = "#a3503e"; c.fillRect(cw * 0.12, ch * 0.78, cw * 0.76, ch * 0.06);
  });
  box(w + 0.08, h + 0.08, 0.04, darkWood, 0, 0, 0.02, g);
  const canvasPlane = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({map: art, roughness: 0.9}));
  canvasPlane.position.z = 0.045; g.add(canvasPlane);
  return g;
}

// back wall: sofa under a picture, lamp, window, plant in the corner
place(sofa(), 0, -ROOM.halfZ + 0.55);
{ const a = wallArt(1.4, 0.84); a.position.set(0, 1.75, -ROOM.halfZ + 0.01); scene.add(a); }
place(coffeeTable(), 0, -2.55);
place(floorLamp(), 1.75, -ROOM.halfZ + 0.45);
{ const win = windowWithCurtains(1.3, 1.5); win.position.set(3.1, 1.55, -ROOM.halfZ + 0.01); scene.add(win); }
place(plant(), 4.5, -ROOM.halfZ + 0.45);
// left wall: reading corner and books
place(armchair(), -3.6, -2.4, Math.atan2(3.6, 0.9));
place(sideTableWithLamp(), -4.4, -3.6);
place(bookshelf(), -ROOM.halfX + 0.17, -1.2, Math.PI / 2);
// right wall: the television
place(mediaWall(), ROOM.halfX - 0.21, -0.6, -Math.PI / 2);
// front wall: a door and a console table, so the view back toward the room's
// entrance is not a blank plane
function door() {
  const g = new THREE.Group(), paint = mat(0xe9e4da, {roughness: 0.6});
  box(0.92, 2.05, 0.04, paint, 0, 1.025, 0.02, g);
  for (const [w, h, y] of [[0.62, 0.78, 1.52], [0.62, 0.78, 0.58]])
    box(w, h, 0.012, mat(0xdfd9cc, {roughness: 0.6}), 0, y, 0.046, g);
  box(0.08, 2.13, 0.06, trimMat, -0.50, 1.065, 0.03, g);
  box(0.08, 2.13, 0.06, trimMat, 0.50, 1.065, 0.03, g);
  box(1.08, 0.08, 0.06, trimMat, 0, 2.09, 0.03, g);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10),
    mat(0xb89a5a, {roughness: 0.3, metalness: 0.8}));
  knob.position.set(0.36, 1.0, 0.07); g.add(knob);
  return g;
}
function consoleTable() {
  const g = new THREE.Group();
  box(1.2, 0.04, 0.36, wood, 0, 0.80, 0, g);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.035, 0.78, 0.035, wood, sx * 0.56, 0.39, sz * 0.14, g);
  cyl(0.07, 0.05, 0.28, mat(0x4d6b4a, {roughness: 0.4}), -0.38, 0.96, 0, g);
  box(0.22, 0.05, 0.16, mat(0x7d3b34), 0.30, 0.845, 0.02, g);
  box(0.20, 0.04, 0.15, mat(0xd8cdb8), 0.30, 0.89, 0.02, g).rotation.y = 0.15;
  return g;
}
place(door(), -1.8, ROOM.halfZ - 0.02, Math.PI);
place(consoleTable(), 2.6, ROOM.halfZ - 0.22, Math.PI);
{ const a = wallArt(0.9, 0.6); a.position.set(2.6, 1.65, ROOM.halfZ - 0.01); a.rotation.y = Math.PI; scene.add(a); }

/* A name that floats over the head and always faces the camera.
 *
 * Drawn to a canvas rather than loaded as a font file: the demonstrator has to
 * survive being unzipped and opened offline for anonymous review, so it cannot
 * fetch anything.
 */
function makeNameTag(text, color) {
  const pad = 24, fs = 52;
  const c = document.createElement("canvas");
  const x = c.getContext("2d");
  x.font = `600 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`;
  c.width  = Math.ceil(x.measureText(text).width) + pad * 2;
  c.height = fs + pad * 2;
  const g = c.getContext("2d");
  g.font = `600 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.textBaseline = "middle";
  const r = 18;                                   // rounded plate behind the text
  g.fillStyle = "rgba(18,19,15,0.82)";
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, r); g.fill();
  g.strokeStyle = "#" + new THREE.Color(color).getHexString();
  g.lineWidth = 4; g.beginPath();
  g.roundRect(2, 2, c.width - 4, c.height - 4, r); g.stroke();
  g.fillStyle = "#f2efe6";
  g.fillText(text, pad, c.height / 2 + 2);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false }));
  spr.renderOrder = 10;
  spr.scale.set(c.width / c.height * 0.34, 0.34, 1);
  return spr;
}

/* A jointed humanoid, built from primitives so the folder stays self-contained.
 *
 * Two builds that differ in PROPORTION, not only colour: one tall and narrow,
 * one shorter and broad. A paper figure may be printed greyscale and read by
 * someone colour-blind, so the silhouettes have to carry the distinction on
 * their own.
 *
 * The nose is kept as a deliberate marker of facing direction - with a live
 * head pose driving the avatar, a viewer has to be able to tell at a glance
 * which way someone is turned.
 */
// Real proportions matter here: the camera sits at eye height (HEAD_H), so an
// avatar built too small makes you tower over the person you are meant to be
// talking to, and "looking at them" stops meaning anything.
const BUILDS = {
  tall:   {scale:1.00, shoulder:0.200, chest:0.155, waist:0.135, headR:0.112,
           legLen:0.85, armLen:0.58, limb:0.050, headSquare:false},
  stocky: {scale:0.95, shoulder:0.245, chest:0.190, waist:0.175, headR:0.120,
           legLen:0.80, armLen:0.52, limb:0.062, headSquare:true},
};

function makeAvatar(color, name, build = "tall") {
  const b = BUILDS[build] || BUILDS.tall;
  const g = new THREE.Group();
  const skin  = new THREE.MeshStandardMaterial({color, roughness:0.62, metalness:0.02});
  const dark  = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.62), roughness:0.7});
  const add = (geo, mat, x, y, z, rot) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0]||0, rot[1]||0, rot[2]||0);
    g.add(m); return m;
  };

  const S = b.scale;
  const hipY   = b.legLen * S + 0.10 * S;
  const chestY = hipY + 0.30 * S;
  const neckY  = chestY + 0.20 * S;
  const headY  = neckY + b.headR * S + 0.045 * S;

  // legs — two segments so the figure reads as jointed rather than a blob
  for (const side of [-1, 1]) {
    const hx = side * b.waist * 0.55 * S;
    add(new THREE.CapsuleGeometry(b.limb*S*1.05, b.legLen*0.40*S, 4, 10), dark,
        hx, hipY - b.legLen*0.26*S, 0);
    add(new THREE.CapsuleGeometry(b.limb*S*0.90, b.legLen*0.42*S, 4, 10), dark,
        hx, hipY - b.legLen*0.72*S, 0);
    add(new THREE.BoxGeometry(b.limb*2.1*S, 0.06*S, 0.22*S), dark,
        hx, 0.035*S, -0.045*S);
  }

  // torso: hips, tapered chest, shoulder yoke
  add(new THREE.CapsuleGeometry(b.waist*S, 0.10*S, 4, 12), skin, 0, hipY, 0);
  const chest = add(new THREE.CylinderGeometry(b.shoulder*S, b.waist*S, 0.34*S, 16),
                    skin, 0, chestY, 0);
  chest.scale.z = 0.72;
  const yoke = add(new THREE.CapsuleGeometry(b.limb*1.5*S, b.shoulder*1.55*S, 4, 12),
                   skin, 0, chestY + 0.15*S, 0, [0, 0, Math.PI/2]);
  yoke.scale.z = 0.9;

  // arms, angled slightly out so they clear the body
  for (const side of [-1, 1]) {
    const sx = side * (b.shoulder*1.02*S);
    const tilt = side * 0.10;
    add(new THREE.CapsuleGeometry(b.limb*S*0.90, b.armLen*0.42*S, 4, 10), skin,
        sx + side*0.015*S, chestY + 0.055*S - b.armLen*0.20*S, 0, [0, 0, -tilt]);
    add(new THREE.CapsuleGeometry(b.limb*S*0.78, b.armLen*0.40*S, 4, 10), skin,
        sx + side*0.055*S, chestY + 0.055*S - b.armLen*0.64*S, 0, [0, 0, -tilt]);
  }

  add(new THREE.CylinderGeometry(b.limb*1.15*S, b.limb*1.15*S, 0.075*S, 10), skin,
      0, neckY - 0.02*S, 0);

  const headGeo = b.headSquare
    ? new THREE.BoxGeometry(b.headR*1.85*S, b.headR*1.95*S, b.headR*1.75*S)
    : new THREE.SphereGeometry(b.headR*S, 22, 16);
  const head = add(headGeo, skin, 0, headY, 0);
  if (!b.headSquare) head.scale.set(1, 1.06, 0.95);

  // brow band, so the front of the head is obvious from a distance
  const brow = add(new THREE.BoxGeometry(b.headR*1.5*S, b.headR*0.34*S, b.headR*0.5*S),
                   dark, 0, headY + b.headR*0.22*S, -b.headR*0.80*S);
  brow.rotation.x = 0.08;

  const nose = add(new THREE.ConeGeometry(0.030*S, 0.085*S, 10),
    new THREE.MeshStandardMaterial({color:0xf2efe6, roughness:0.5}),
    0, headY - b.headR*0.10*S, -b.headR*1.02*S, [-Math.PI/2, 0, 0]);
  nose.name = "nose";

  const tag = makeNameTag(name, color);
  tag.position.y = headY + b.headR*S + 0.30;
  g.add(tag);

  g.userData = {name, head, tag, headY, color, build};
  return g;
}

// The agent: deliberately a machine, so "looking at the assistant" is never
// ambiguous. No legs, hovering over a plinth — even in a small greyscale figure
// nobody will mistake it for one of the two people.
const robot = new THREE.Group();
const ROBOT_HEAD_Y = 1.50;
{
  const shell = new THREE.MeshStandardMaterial({color:0x7fc4a0, roughness:0.32, metalness:0.30});
  const trim  = new THREE.MeshStandardMaterial({color:0x2c3a33, roughness:0.5, metalness:0.35});
  const glow  = new THREE.MeshStandardMaterial({color:0xdff3e6,
    emissive:0x7fc4a0, emissiveIntensity:0.9, roughness:0.25});
  const add = (geo, mat, x, y, z, rot) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0]||0, rot[1]||0, rot[2]||0);
    robot.add(m); return m;
  };

  add(new THREE.CylinderGeometry(0.40, 0.46, 0.10, 24), trim,  0, 0.05, 0);
  add(new THREE.CylinderGeometry(0.17, 0.31, 0.44, 20), shell, 0, 0.31, 0);

  add(new THREE.BoxGeometry(0.52, 0.60, 0.38), shell, 0, 0.86, 0);
  // a lit chest panel: visibly powered, and it marks the front unambiguously
  add(new THREE.BoxGeometry(0.26, 0.16, 0.04), glow, 0, 0.94, -0.20);
  add(new THREE.BoxGeometry(0.56, 0.07, 0.42), trim, 0, 1.14, 0);

  for (const side of [-1, 1]) {
    add(new THREE.SphereGeometry(0.075, 12, 10), trim, side*0.30, 1.05, 0);
    add(new THREE.CapsuleGeometry(0.052, 0.20, 4, 10), shell,
        side*0.335, 0.90, 0, [0, 0, -side*0.10]);
    add(new THREE.BoxGeometry(0.10, 0.12, 0.10), trim, side*0.365, 0.72, 0);
  }

  add(new THREE.BoxGeometry(0.44, 0.34, 0.36), shell, 0, ROBOT_HEAD_Y, 0);
  // A dark face screen with two lit eyes. The eyes are what make "looking at the
  // assistant" feel like looking AT something; the box head, antenna and plinth
  // still keep it from being mistaken for one of the two people.
  const screen = new THREE.MeshStandardMaterial({color:0x151c19, roughness:0.25, metalness:0.2});
  const pupil  = new THREE.MeshStandardMaterial({color:0x0c1210, roughness:0.4});
  add(new THREE.BoxGeometry(0.36, 0.24, 0.02), screen, 0, ROBOT_HEAD_Y + 0.01, -0.185);
  for (const side of [-1, 1]) {
    const ex = side * 0.085, ey = ROBOT_HEAD_Y + 0.035;
    add(new THREE.CylinderGeometry(0.050, 0.050, 0.012, 28), glow, ex, ey, -0.198, [Math.PI/2, 0, 0]);
    add(new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20), pupil, ex, ey - 0.004, -0.205, [Math.PI/2, 0, 0]);
    add(new THREE.SphereGeometry(0.008, 8, 6), glow, ex + 0.012, ey + 0.012, -0.209);
  }
  add(new THREE.BoxGeometry(0.09, 0.014, 0.008), glow, 0, ROBOT_HEAD_Y - 0.065, -0.198);
  add(new THREE.BoxGeometry(0.46, 0.05, 0.38), trim, 0, ROBOT_HEAD_Y + 0.18, 0);
  for (const side of [-1, 1])
    add(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12), trim,
        side*0.24, ROBOT_HEAD_Y, 0, [0, 0, Math.PI/2]);

  add(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), trim, 0, ROBOT_HEAD_Y + 0.30, 0);
  add(new THREE.SphereGeometry(0.045, 14, 12), glow, 0, ROBOT_HEAD_Y + 0.43, 0);

  robot.userData = {name:"agent", headY: ROBOT_HEAD_Y};
}
scene.add(robot);

/* The robot turns to whoever spoke last - the person the agent is told it is
 * attending to - so both browsers see it facing the same way. It used to face
 * each viewer, which in a figure about gaze read as the robot choosing whom to
 * look at. Before anyone speaks it faces the space between the two people. */
let lastSpeaker = null;              // "me" | "peer" | null
let robotYaw = 0;
function lerpAngle(a, b, t) {
  const d = ((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return a + d * t;
}

/* The peer lives inside a container that never gets replaced, so the position
 * and rotation the relay writes each tick always land on the same object. The
 * body inside it IS replaced when we learn who they are — role A and role B have
 * different builds, and you cannot repaint a silhouette. */
const ROLE_COLOR = {A: 0x8fa6d8, B: 0xd08a6a};
let peerName = "Robin", peerRole = "B";
const other = new THREE.Group();
other.position.set(-2.6, 0, 1.4); scene.add(other);
let otherBody = null;

/* Clothed people from two CC0 characters (vendor/avatars.js), once they load.
 *
 * The block figures above stay as the fallback: if the models are missing or
 * fail to parse, the room still works. Each model is parsed once and reused - a
 * browser only ever draws the OTHER person, so one instance per role is enough
 * and the skinned mesh never has to be cloned. */
// Different heights keep the two people apart in a greyscale figure.
const AVATAR_HEIGHT = {A: 1.78, B: 1.68};
const avatarModels = {};                 // role -> {group, mixer, idle, walk, head, height, tag}

function b64ToBuffer(b64) {
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function loadAvatarModels() {
  if (!THREE.GLTFLoader || !window.AVATAR_GLB) return;
  const loader = new THREE.GLTFLoader();
  for (const role of ["A", "B"]) {
    if (!window.AVATAR_GLB[role]) continue;
    loader.parse(b64ToBuffer(window.AVATAR_GLB[role]), "", gltf => {
      const model = gltf.scene;
      // glTF characters face +z; everything in this room faces -z, the way a
      // camera looks, so the peer's reported yaw applies to them unchanged.
      model.rotation.y = Math.PI;
      // Measure the rest pose from the geometry itself. Box3.setFromObject on a
      // skinned mesh that has never been posed returns a box about a third of the
      // real size, which scaled the first attempt to over five metres tall.
      model.updateMatrixWorld(true);
      const box = new THREE.Box3();
      model.traverse(o => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      const s = AVATAR_HEIGHT[role] / (box.max.y - box.min.y);
      model.scale.setScalar(s);
      model.position.y = -box.min.y * s;
      let head = null;
      model.traverse(o => {
        if (o.isMesh) o.frustumCulled = false;       // skinned bounds lag the pose
        if (!head && o.isBone && o.name === "Head") head = o;
      });
      // The Head bone sits at the neck joint, around chin height. Gaze should be
      // measured to the eyes, so hang a point at eye level off that bone: it
      // then follows the head through the idle sway like the bone does.
      let eyes = null;
      if (head) {
        model.updateMatrixWorld(true);
        const eyeY = AVATAR_HEIGHT[role] * 0.93;
        const at = head.getWorldPosition(new V()).setY(eyeY);
        eyes = new THREE.Object3D();
        eyes.position.copy(head.worldToLocal(at));
        head.add(eyes);
      }
      const group = new THREE.Group();
      group.add(model);
      const mixer = new THREE.AnimationMixer(model);
      const clip = n => gltf.animations.find(a => a.name === n);
      const idle = clip("Idle") && mixer.clipAction(clip("Idle"));
      const walk = clip("Walk") && mixer.clipAction(clip("Walk"));
      if (idle) idle.play();
      if (walk) { walk.play(); walk.setEffectiveWeight(0); }
      avatarModels[role] = {group, mixer, idle, walk, head: eyes || head,
                            height: AVATAR_HEIGHT[role], tag: null};
      if (peerRole === role) buildPeer(peerName, peerRole);   // swap in now
    }, err => console.warn("avatar model failed to load; keeping block figures", err));
  }
}

function modelBody(role, name) {
  const m = avatarModels[role];
  if (m.tag) {
    m.group.remove(m.tag);
    m.tag.material.map.dispose(); m.tag.material.dispose();
  }
  m.tag = makeNameTag(name, ROLE_COLOR[role] ?? 0xd08a6a);
  m.tag.position.y = m.height + 0.28;
  m.group.add(m.tag);
  // `head` is the skeleton's head bone, so gaze is measured to where the head
  // actually is as the idle animation sways, not to a fixed point.
  m.group.userData = {name, head: m.head, tag: m.tag, headY: m.height * 0.93,
                      color: ROLE_COLOR[role], model: m, cached: true};
  return m.group;
}

function buildPeer(name, role) {
  if (otherBody) {
    other.remove(otherBody);
    // A loaded model is kept for reuse; only block figures are thrown away.
    if (!otherBody.userData.cached) otherBody.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
  otherBody = avatarModels[role] ? modelBody(role, name)
    : makeAvatar(ROLE_COLOR[role] ?? 0xd08a6a, name, role === "A" ? "tall" : "stocky");
  other.add(otherBody);
  other.userData = Object.assign({}, otherBody.userData);
  return otherBody;
}

// The peer's identity depends on which slot YOU joined. If you are Robin, the
// person across the room is Maya - so name and colour them accordingly rather
// than always drawing "Robin".
buildPeer("Robin", "B");     // stand-in until the relay says who is here
loadAvatarModels();

function setPeerName(name, role) {
  peerName = name;
  if (role) peerRole = role;
  buildPeer(name, peerRole);
  const ref = document.getElementById("peerRef");
  if (ref) ref.textContent = name;
}

// ---- gaze, measured from head orientation --------------------------------
// THE CORE OF THE DEMONSTRATION. No authored addressee anywhere: we take the
// camera's forward vector and find which entity lies closest to it, inside a
// cone. Turning your head changes the observation immediately.
const GAZE_CONE = THREE.MathUtils.degToRad(22);
function gazeFrom(pos, quat, targets) {
  const fwd = new V(0,0,-1).applyQuaternion(quat);
  let best = null, bestAngle = GAZE_CONE;
  for (const t of targets) {
    const eye = t.obj.userData.head
      ? t.obj.userData.head.getWorldPosition(new V())
      : t.obj.position.clone().setY(1.5);
    const to = eye.sub(pos).normalize();
    const a = fwd.angleTo(to);
    if (a < bestAngle) { bestAngle = a; best = t.id; }
  }
  return best;
}

// ---- controls ------------------------------------------------------------
const keys = {};
// Spawn facing the robot at the origin. Math.PI pointed the camera at +z, which
// is away from it: the room opened on an empty wall and "look at the robot and
// speak" failed until the visitor turned around.
let yaw = Math.atan2(camera.position.x, camera.position.z);
let pitch = 0, locked = false;
addEventListener("keydown", e => {
  if (document.activeElement === say) return;
  keys[e.code] = true;
});
addEventListener("keyup", e => keys[e.code] = false);
const veil = document.getElementById("veil");

/* Typing vs looking.
 *
 * Pointer lock captures the mouse, so while you are looking around you cannot
 * click the text box. Releasing the lock with Escape used to bring the veil
 * back over the whole screen - including the text box - and clicking the veil
 * re-locked the pointer. There was no path to the keyboard at all.
 *
 * So Enter is the way in: it drops the lock, focuses the box, and keeps the
 * veil down. Clicking the scene goes back to looking around.
 */
let typing = false;

/* requestPointerLock rejects when the browser refuses - an embedded frame, a
 * denied permission, too soon after a previous exit. It is not fatal: the page
 * stays usable with the mouse free, so swallow it rather than throwing. */
/* Pointer lock is refused outright in an embedded frame (the page reports
 * WrongDocumentError) and can be denied by the user anywhere else. When that
 * happens `lockBlocked` is set and looking around falls back to click-and-drag,
 * so the room is still explorable - just with the mouse visible. Retrying a
 * lock that has already been refused only produces more console errors. */
let lockBlocked = false, lockFails = 0;

function grabMouse() {
  if (lockBlocked) return;
  // One failure is not proof the browser refuses: Chrome rejects a re-lock that
  // comes too soon after the last exit, which is exactly what happens when you
  // send a very short message. Latching on that would drop mouse-look for the
  // rest of the session over a timing hiccup, so only give up on a repeat.
  const failed = () => { if (++lockFails >= 2) lockBlocked = true; };
  try {
    const r = canvas.requestPointerLock();
    if (r && typeof r.catch === "function") r.catch(failed);
  } catch (e) { failed(); }
}
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) lockFails = 0;   // it works; reset
});

/* `entered` is set once the player has committed to joining. The opening screen
 * must not depend on pointer lock succeeding: it is refused in embedded frames
 * and can be denied outright, and gating on `locked` alone left the overlay up
 * for good in exactly those cases - clicking again just failed again. Mouse-look
 * is the part that degrades; the room itself stays usable without it. */
let entered = false;

function showVeil() {
  veil.style.display = (locked || typing || entered) ? "none" : "flex";
}

function startTyping() {
  typing = true;
  if (locked) document.exitPointerLock();
  say.focus();
  showVeil();
}

function stopTyping(relock) {
  typing = false;
  say.blur();
  if (relock) grabMouse(); else showVeil();
}

const nameIn = document.getElementById("nameIn");
const enterBtn = document.getElementById("enterBtn");

function enterRoom() {
  if (typeof roomFull !== "undefined" && roomFull) return;   // the card says why
  entered = true;
  const chosen = (nameIn.value || "").trim();
  if (chosen && typeof netSetName === "function") netSetName(chosen);
  else if (chosen) myName = chosen;
  typing = false;
  grabMouse();
  showVeil();          // stays down even if the browser refused the lock
}
enterBtn.addEventListener("click", e => { e.stopPropagation(); enterRoom(); });
nameIn.addEventListener("keydown", e => {
  e.stopPropagation();                       // never reaches movement or Enter-to-type
  if (e.key === "Enter") { e.preventDefault(); enterRoom(); }
});
nameIn.addEventListener("click", e => e.stopPropagation());

// Clicking the backdrop still enters, but clicking the name field must not.
veil.onclick = e => {
  if (e.target.closest("#namebox")) return;
  enterRoom();
};
canvas.addEventListener("click", () => {
  if (!typing && !locked && !lockBlocked) grabMouse();
});

document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === canvas;
  showVeil();
});

// Enter from anywhere puts the cursor in the box; Escape gives the mouse back.
addEventListener("keydown", e => {
  if (document.activeElement === say) return;
  if (e.code === "Enter" || e.code === "NumpadEnter") { e.preventDefault(); startTyping(); }
});
// Drag-to-look, used whenever the mouse is not captured.
let dragging = false;
canvas.addEventListener("mousedown", e => {
  if (locked || typing || e.button !== 0) return;
  dragging = true;
  canvas.style.cursor = "grabbing";
});
addEventListener("mouseup", () => {
  dragging = false;
  canvas.style.cursor = "";
});

addEventListener("mousemove", e => {
  if (!locked && !dragging) return;
  yaw -= e.movementX * 0.0022;
  pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0022));
});

// ---- observation ---------------------------------------------------------
// Field-for-field what state_machine.Session.observation() produces. Anything
// the live scene cannot know (tier, expected, content_type) is null rather than
// invented — the agent has to infer the addressee, which is the whole point.
let turnNo = 0;
function observation(utterance) {
  const me = camera.position, ro = robot.position, ot = other.position;
  const dist = (a,b) => Math.round(Math.hypot(a.x-b.x, a.z-b.z)*100)/100;
  const iAm = (typeof myRole !== "undefined") ? myRole : "A";
  const you = iAm === "A" ? "B" : "A";
  const myGaze = gazeFrom(me, camera.quaternion,
    [{id:"agent", obj:robot}, {id:you, obj:other}]) || "none";
  // The peer's gaze is measured from the head pose the relay reports, the same
  // way the beam in the scene is drawn - not assumed to be pointing at you.
  // Alone, there is no peer reporting anything, so the stand-in faces you.
  const live = (typeof netReady !== "undefined") && netReady;
  const peerGaze = !live ? iAm
    : peerGazeTarget === "self" ? iAm
    : peerGazeTarget === "agent" ? "agent"
    : "none";
  return {
    pair_id: "LIVE", scenario: "Shared room", turn: turnNo,
    speaker: iAm, addressee: null, utterance: utterance ?? null,
    tier: null, expected: null, content_type: null,
    referent: null, attribute_targeted: null, reference_style: null,
    gaze_congruent: null,
    positions: {
      agent: [0,0,0],
      [iAm]: [Math.round(me.x*100)/100, 0, Math.round(me.z*100)/100],
      [you]: [Math.round(ot.x*100)/100, 0, Math.round(ot.z*100)/100],
    },
    gaze: {[iAm]: myGaze, [you]: peerGaze, agent: iAm},
    distances: {[iAm]: dist(me, ro), [you]: dist(ot, ro)},
  };
}
const obsBody = document.getElementById("obsBody");
function paintObs(o) {
  obsBody.innerHTML = JSON.stringify(o, null, 1)
    .replace(/"(\w+)":/g, '<span class="k">"$1"</span>:');
}

// ---- chat ----------------------------------------------------------------
const log = document.getElementById("log"), say = document.getElementById("say");
function post(who, text, cls="") {
  const d = document.createElement("div");
  d.className = "msg " + cls;
  d.innerHTML = who ? `<b>${who}</b> ${text}` : text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
}
const convo = [];
/* One way in for an utterance, whatever produced it - the Enter key, the Send
 * button, or speech. Everything downstream reads the same path. */
async function sendUtterance(text) {
  text = (text || "").trim();
  if (!text) return;
  say.value = "";
  turnNo += 1;
  const obs = observation(text);
  paintObs(obs);
  const me = (typeof myName !== "undefined" && myName) ? myName : "Maya";
  convo.push({speaker: me, text});
  post(me, text);
  lastSpeaker = "me";
  // In multi-user mode the server runs the agent with the experiment's own code,
  // so both browsers see one decision. Alone, the in-page agent handles it.
  if (typeof netSay === "function" && netSay(text)) return;
  await agentTurn(obs, text);
}

say.addEventListener("keydown", e => {
  if (e.key === "Escape") { stopTyping(true); return; }   // back to looking around
  if (e.key !== "Enter") return;
  e.preventDefault();
  // Stop it here. This handler blurs the box on the way out, so if the event
  // reached the window listener below it would see "not in the text box", treat
  // the same keystroke as a fresh request to type, and reopen the box you just
  // left - cancelling the hand-back entirely.
  e.stopPropagation();
  sendUtterance(say.value);
  // Enter means the keyboard flow: send, then hand the mouse straight back so
  // you can turn and look. Staying in the text box after sending left you stuck
  // with a dead mouse until you thought to press Escape.
  stopTyping(true);
});
document.getElementById("send").addEventListener("click", () => {
  // Clicking Send is the mouse flow, and the cursor is already visible; keep
  // the box focused so a second message does not need another trip to Enter.
  sendUtterance(say.value);
  say.focus();
});

// ---- who is looking at whom, drawn in the scene ---------------------------
// A short beam out of the peer's head toward whatever they are facing, plus a
// ring under the thing being looked at. Both are derived from the same measured
// pose the agent is given - nothing here is authored.
const gazeBeam = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 1, 6),
  new THREE.MeshBasicMaterial({color:0xf2efe6, transparent:true, opacity:0.32}));
gazeBeam.visible = false; scene.add(gazeBeam);

const gazeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.34, 0.42, 32),
  new THREE.MeshBasicMaterial({color:0xf2efe6, transparent:true, opacity:0.3,
                               side:THREE.DoubleSide}));
gazeRing.rotation.x = -Math.PI/2; gazeRing.position.y = 0.02;
gazeRing.visible = false; scene.add(gazeRing);

/* Where YOU are looking. A first-person view cannot show its own head, so the
 * status pill was the only evidence of the gaze target - a reader of a still
 * frame had to take it on trust. The ring marks the entity under your gaze and
 * the reticle marks the centre of view, so a screenshot shows what the cone
 * selected. Both are drawn from the same measurement the agent receives. */
const myGazeRing = new THREE.Mesh(
  new THREE.RingGeometry(0.52, 0.62, 40),
  new THREE.MeshBasicMaterial({color:0xffd27f, transparent:true, opacity:0.55,
                               side:THREE.DoubleSide}));
myGazeRing.rotation.x = -Math.PI/2; myGazeRing.position.y = 0.02;
myGazeRing.visible = false; scene.add(myGazeRing);
const reticle = document.getElementById("reticle");

let peerGazeTarget = null;      // what the peer is actually looking at, measured

function drawPeerGaze() {
  // the peer's own facing comes from the server; work out what it lands on
  const fwd = new V(0, 0, -1).applyQuaternion(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, other.rotation.y, 0)));
  const eye = other.position.clone().setY(other.userData.headY);
  const targets = [{obj: robot, y: 1.5}, {obj: camera, y: HEAD_H}];
  let best = null, bestAngle = GAZE_CONE;
  for (const t of targets) {
    const to = (t.obj === camera ? camera.position.clone()
                                 : t.obj.position.clone().setY(t.y)).sub(eye);
    const a = fwd.angleTo(to.clone().normalize());
    if (a < bestAngle) { bestAngle = a; best = t; }
  }
  peerGazeTarget = best ? (best.obj === camera ? "self" : "agent") : null;
  if (!best) { gazeBeam.visible = gazeRing.visible = false; return; }

  const hit = (best.obj === camera ? camera.position.clone()
                                   : best.obj.position.clone().setY(best.y));
  const mid = eye.clone().add(hit).multiplyScalar(0.5);
  const len = eye.distanceTo(hit);
  gazeBeam.position.copy(mid);
  gazeBeam.scale.set(1, len, 1);
  gazeBeam.quaternion.setFromUnitVectors(new V(0,1,0),
    hit.clone().sub(eye).normalize());
  gazeRing.position.set(hit.x, 0.02, hit.z);
  gazeBeam.visible = gazeRing.visible = true;
}

// ---- loop ----------------------------------------------------------------
const pGaze = document.getElementById("pGaze");
// Blend idle into walk by how fast the peer is moving. Their position arrives
// from the relay in steps, so the speed is smoothed rather than read per frame.
const peerLastPos = new V();
let peerSpeed = 0;
function animatePeer(dt) {
  const m = otherBody && otherBody.userData.model;
  if (!m) return;
  let moved = other.position.distanceTo(peerLastPos);
  peerLastPos.copy(other.position);
  // Nobody walks a metre in one frame: that is a join or a respawn, and reading
  // it as speed set the figure striding in place for a second on arrival.
  if (moved > 1.0) { moved = 0; peerSpeed = 0; }
  peerSpeed = peerSpeed * 0.85 + (moved / Math.max(dt, 1e-3)) * 0.15;
  const w = Math.min(1, Math.max(0, (peerSpeed - 0.2) / 0.6));
  if (m.walk) m.walk.setEffectiveWeight(w);
  if (m.idle) m.idle.setEffectiveWeight(1 - w);
  m.mixer.update(dt);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now-last)/1000, 0.05); last = now;
  const e = new THREE.Euler(pitch, yaw, 0, "YXZ");
  camera.quaternion.setFromEuler(e);
  const spd = 3.2*dt;
  const fwd = new V(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new V(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.KeyW) camera.position.addScaledVector(fwd, -spd);
  if (keys.KeyS) camera.position.addScaledVector(fwd, spd);
  if (keys.KeyA) camera.position.addScaledVector(right, -spd);
  if (keys.KeyD) camera.position.addScaledVector(right, spd);
  camera.position.x = Math.max(-ROOM.halfX + 0.4, Math.min(ROOM.halfX - 0.4, camera.position.x));
  camera.position.z = Math.max(-ROOM.halfZ + 0.4, Math.min(ROOM.halfZ - 0.4, camera.position.z));
  camera.position.y = HEAD_H;

  // Alone, the stand-in peer simply faces you. In a shared room the server
  // reports their real head direction every tick, and overwriting it here would
  // discard the one signal this demonstration is about - you would always see
  // them looking straight at you no matter where they were actually looking.
  // Object3D.lookAt points an object's +z at the target, but both figures are
  // built facing -z, the way a camera looks - so without the half turn they
  // showed you the back of their heads.
  if (!(typeof netReady !== "undefined" && netReady)) {
    other.lookAt(camera.position.x, other.userData.headY, camera.position.z);
    other.rotateY(Math.PI);
  }
  const facing = lastSpeaker === "me" ? camera.position
    : lastSpeaker === "peer" ? other.position
    : new V().addVectors(camera.position, other.position).multiplyScalar(0.5);
  // rotation.y = atan2(dx, dz) + PI points the robot's -z face at the target
  const want = Math.atan2(facing.x - robot.position.x, facing.z - robot.position.z) + Math.PI;
  robotYaw = lerpAngle(robotYaw, want, 1 - Math.exp(-dt * 6));
  robot.rotation.set(0, robotYaw, 0);

  const g = gazeFrom(camera.position, camera.quaternion,
    [{id:"agent", obj:robot}, {id:"B", obj:other}]);
  pGaze.textContent = "looking at: " + (g === "agent" ? "the assistant"
    : g === "B" ? peerName : "—");
  pGaze.className = "pill" + (g ? " on" : "");
  const lookedAt = g === "agent" ? robot : g === "B" ? other : null;
  myGazeRing.visible = !!lookedAt;
  if (lookedAt) myGazeRing.position.set(lookedAt.position.x, 0.02, lookedAt.position.z);
  if (reticle) reticle.classList.toggle("on", !!lookedAt);

  // Draw where the OTHER person is looking. The paper's whole claim is that
  // this line changes who gets answered, so it should be visible in a still.
  drawPeerGaze();
  if (!say.value) paintObs(observation(null));

  animatePeer(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize() {
  camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener("resize", resize); resize();
requestAnimationFrame(frame);
