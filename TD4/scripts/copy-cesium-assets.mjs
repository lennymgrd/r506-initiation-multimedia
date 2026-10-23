/**
 * Copie les ressources statiques de CesiumJS (Workers, ThirdParty, Assets, Widgets)
 * dans public/cesium/. Vite les sert ensuite telles quelles en développement
 * et les recopie dans dist/ lors de la compilation.
 *
 * Lancé automatiquement avant "npm run dev" et "npm run build".
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'cesium', 'Build', 'Cesium');
const target = join(root, 'public', 'cesium');
const folders = ['Workers', 'ThirdParty', 'Assets', 'Widgets'];

if (!existsSync(source)) {
  console.error('[copy-cesium] node_modules/cesium introuvable. Lancez "npm install".');
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(root, 'node_modules', 'cesium', 'package.json'), 'utf8')).version;
const stamp = join(target, '.version');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === version) {
  console.log(`[copy-cesium] Ressources Cesium ${version} déjà présentes.`);
  process.exit(0);
}

mkdirSync(target, { recursive: true });
for (const folder of folders) {
  cpSync(join(source, folder), join(target, folder), { recursive: true });
}
writeFileSync(stamp, version);
console.log(`[copy-cesium] Ressources Cesium ${version} copiées dans public/cesium/.`);

