/**
 * Génère public/models/airplane.glb : un avion de ligne "low poly" (~600 triangles).
 *
 * Le modèle est créé de toutes pièces par ce script : aucune question de licence.
 * Conventions glTF : +X = nez de l'avion, +Y = haut, Z = axe des ailes.
 * (Cesium convertit Y-up en Z-up : +X reste l'avant de l'appareil.)
 * Dimensions proches d'un A320 : ~38 m de long, ~35 m d'envergure.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models', 'airplane.glb');

// --- Petite bibliothèque de géométrie -------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const avg = (pts) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);

/** Maillage à facettes (normales plates) pour un matériau donné. */
class Mesh {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.indices = [];
  }

  /** Ajoute un polygone convexe orienté vers l'extérieur de `center`. */
  face(points, center) {
    let n = norm(cross(sub(points[1], points[0]), sub(points[2], points[0])));
    let pts = points;
    if (dot(n, sub(avg(points), center)) < 0) {
      pts = [...points].reverse();
      n = n.map((v) => -v);
    }
    const start = this.positions.length / 3;
    for (const p of pts) {
      this.positions.push(...p);
      this.normals.push(...n);
    }
    for (let i = 1; i < pts.length - 1; i += 1) this.indices.push(start, start + i, start + i + 1);
  }

  /** Hexaèdre défini par 4 points "bas" et 4 points "haut" (dans le même ordre). */
  hexahedron(bottom, top) {
    const c = avg([...bottom, ...top]);
    this.face(bottom, c);
    this.face(top, c);
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      this.face([bottom[i], bottom[j], top[j], top[i]], c);
    }
  }

  /** Corps de révolution à N côtés le long de X : sections [x, rayon, décalage vertical]. */
  loft(sections, sides = 10, squashY = 1) {
    const ring = ([x, r, y0]) => Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2;
      return [x, y0 + Math.sin(a) * r * squashY, Math.cos(a) * r];
    });
    const rings = sections.map(ring);
    for (let s = 0; s < rings.length - 1; s += 1) {
      const center = [(sections[s][0] + sections[s + 1][0]) / 2, (sections[s][2] + sections[s + 1][2]) / 2, 0];
      for (let k = 0; k < sides; k += 1) {
        const k2 = (k + 1) % sides;
        this.face([rings[s][k], rings[s][k2], rings[s + 1][k2], rings[s + 1][k]], center);
      }
    }
    // Fermeture des extrémités.
    this.face(rings[0], [sections[0][0] - 1, sections[0][2], 0]);
    this.face(rings.at(-1), [sections.at(-1)[0] + 1, sections.at(-1)[2], 0]);
  }
}

/** Aile (ou empennage) symétrique : profil emplanture → saumon. */
function wingPair(mesh, { rootX, rootChord, rootZ, rootY, rootT, tipX, tipChord, tipZ, tipY, tipT }) {
  for (const side of [1, -1]) {
    const rz = rootZ * side;
    const tz = tipZ * side;
    const bottom = [[rootX, rootY - rootT, rz], [rootX - rootChord, rootY - rootT, rz], [tipX - tipChord, tipY - tipT, tz], [tipX, tipY - tipT, tz]];
    const top = [[rootX, rootY + rootT, rz], [rootX - rootChord, rootY + rootT, rz], [tipX - tipChord, tipY + tipT, tz], [tipX, tipY + tipT, tz]];
    mesh.hexahedron(bottom, top);
  }
}

// --- Construction de l'avion -----------------------------------------------
const body = new Mesh(); // fuselage + ailes (blanc)
const accent = new Mesh(); // dérive + moteurs (cyan)
const glass = new Mesh(); // cockpit (sombre)

body.loft([
  [19.2, 0.15, -0.2],
  [18.2, 0.9, -0.15],
  [16.5, 1.6, 0],
  [14, 1.95, 0],
  [-9, 1.95, 0],
  [-14, 1.5, 0.35],
  [-18, 0.7, 0.9],
  [-19.2, 0.25, 1.2],
], 12);

wingPair(body, { rootX: 3.5, rootChord: 7, rootZ: 1.6, rootY: -0.9, rootT: 0.35, tipX: -5.5, tipChord: 2, tipZ: 17.5, tipY: 0.4, tipT: 0.12 });
wingPair(body, { rootX: -13, rootChord: 4.2, rootZ: 0.8, rootY: 0.6, rootT: 0.18, tipX: -16.6, tipChord: 1.8, tipZ: 6.4, tipY: 0.9, tipT: 0.08 });

// Dérive verticale.
accent.hexahedron(
  [[-11, 1.6, 0.2], [-18.6, 1.6, 0.2], [-18.6, 1.6, -0.2], [-11, 1.6, -0.2]],
  [[-16.4, 8.6, 0.08], [-19.2, 8.6, 0.08], [-19.2, 8.6, -0.08], [-16.4, 8.6, -0.08]],
);

// Réacteurs sous les ailes.
for (const z of [5.8, -5.8]) {
  const engine = new Mesh();
  engine.loft([[3.6, 0.9, -1.9], [3.2, 1.15, -1.9], [0, 1.1, -1.9], [-1, 0.6, -1.9]], 10);
  // On décale le réacteur latéralement.
  for (let i = 2; i < engine.positions.length; i += 3) engine.positions[i] += z;
  const offset = accent.positions.length / 3;
  accent.positions.push(...engine.positions);
  accent.normals.push(...engine.normals);
  accent.indices.push(...engine.indices.map((i) => i + offset));
}

// Pare-brise.
glass.hexahedron(
  [[17.3, 0.55, 1.05], [15.6, 0.95, 1.5], [15.6, 0.95, -1.5], [17.3, 0.55, -1.05]],
  [[17.0, 0.95, 0.8], [15.4, 1.45, 1.2], [15.4, 1.45, -1.2], [17.0, 0.95, -0.8]],
);

// --- Écriture du fichier GLB (glTF 2.0 binaire) ------------------------------
const meshes = [
  { mesh: body, color: [0.93, 0.95, 0.98, 1], metallic: 0.2, roughness: 0.45 },
  { mesh: accent, color: [0.13, 0.83, 0.93, 1], metallic: 0.3, roughness: 0.4 },
  { mesh: glass, color: [0.05, 0.08, 0.14, 1], metallic: 0.6, roughness: 0.15 },
];

const chunks = [];
const bufferViews = [];
const accessors = [];
const primitives = [];
let byteOffset = 0;

function pushView(typed, target) {
  const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const padding = (4 - (bytes.length % 4)) % 4;
  chunks.push(bytes, Buffer.alloc(padding));
  bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
  byteOffset += bytes.length + padding;
  return bufferViews.length - 1;
}

meshes.forEach(({ mesh }, materialIndex) => {
  const positions = new Float32Array(mesh.positions);
  const normals = new Float32Array(mesh.normals);
  const indices = new Uint16Array(mesh.indices);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  const count = positions.length / 3;
  accessors.push({ bufferView: pushView(positions, 34962), componentType: 5126, count, type: 'VEC3', min, max });
  accessors.push({ bufferView: pushView(normals, 34962), componentType: 5126, count, type: 'VEC3' });
  accessors.push({ bufferView: pushView(indices, 34963), componentType: 5123, count: indices.length, type: 'SCALAR' });
  const a = accessors.length;
  primitives.push({ attributes: { POSITION: a - 3, NORMAL: a - 2 }, indices: a - 1, material: materialIndex });
});

const gltf = {
  asset: { version: '2.0', generator: 'Flight Explorer 3D — scripts/generate-airplane-model.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Airplane' }],
  meshes: [{ primitives, name: 'Airplane' }],
  materials: meshes.map(({ color, metallic, roughness }, i) => ({
    name: ['Body', 'Accent', 'Glass'][i],
    pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: metallic, roughnessFactor: roughness },
    doubleSided: true,
  })),
  accessors,
  bufferViews,
  buffers: [{ byteLength: byteOffset }],
};

const bin = Buffer.concat(chunks);
let json = Buffer.from(JSON.stringify(gltf));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);

const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // "glTF"
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(bin.length, 0);
binHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.concat([header, jsonHeader, json, binHeader, bin]));
const triangles = primitives.reduce((s, p) => s + accessors[p.indices].count / 3, 0);
console.log(`[model] ${out} écrit (${triangles} triangles, ${(12 + 16 + json.length + bin.length) / 1024 | 0} Ko).`);

