// Copies the runtime assets that must be served as plain files (not bundled) into public/:
//  - Z3's Emscripten loader and wasm: its thread workers re-load z3-built.js by URL.
//    The wasm is also stored gzipped (35 MB -> 8 MB) and decompressed in the browser.
//  - coi-serviceworker, which makes the page cross-origin isolated on GitHub Pages.
//  - Pretendard (SIL OFL 1.1), the official unmodified variable-weight woff2 subsets split by unicode-range,
//    so a browser downloads only the pieces for the characters on screen. Its license goes next to it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..');
const z3Build = dirname(require.resolve('z3-solver/build/z3-built.js'));
const z3Version = require('z3-solver/package.json').version;
const coiVersion = require('coi-serviceworker/package.json').version;
const fontVersion = require('pretendard/package.json').version;
if (z3Version !== '5.3.1') throw new Error(`z3-solver must be 5.3.1, found ${z3Version}`);
if (coiVersion !== '0.1.7') throw new Error(`coi-serviceworker must be 0.1.7, found ${coiVersion}`);
if (fontVersion !== '1.3.9') throw new Error(`pretendard must be 1.3.9, found ${fontVersion}`);

const out = join(root, 'public', 'z3');
mkdirSync(out, { recursive: true });
copyFileSync(join(z3Build, 'z3-built.js'), join(out, 'z3-built.js'));
copyFileSync(join(z3Build, 'z3-built.wasm'), join(out, 'z3-built.wasm'));

const gz = join(out, 'z3-built.wasm.gz');
const wasmPath = join(z3Build, 'z3-built.wasm');
if (!existsSync(gz) || statSync(gz).mtimeMs < statSync(wasmPath).mtimeMs) {
  writeFileSync(gz, gzipSync(readFileSync(wasmPath), { level: 9 }));
}
writeFileSync(join(out, 'VERSION'), `z3-solver ${z3Version}\n`);
copyFileSync(require.resolve('coi-serviceworker/coi-serviceworker.js'), join(root, 'public', 'coi-serviceworker.js'));
const fontSrc = join(dirname(require.resolve('pretendard/package.json')), 'dist');
const fontOut = join(root, 'public', 'fonts');
const subsetDir = join(fontSrc, 'web', 'variable', 'woff2-dynamic-subset');
mkdirSync(join(fontOut, 'woff2-dynamic-subset'), { recursive: true });
let fontFiles = 0;
for (const f of readdirSync(subsetDir)) {
  if (!f.endsWith('.woff2')) continue;
  copyFileSync(join(subsetDir, f), join(fontOut, 'woff2-dynamic-subset', f));
  fontFiles++;
}
copyFileSync(join(fontSrc, 'web', 'variable', 'pretendardvariable-dynamic-subset.css'), join(fontOut, 'pretendard.css'));
copyFileSync(join(fontSrc, 'LICENSE.txt'), join(fontOut, 'LICENSE.txt'));

console.log(`assets: z3-solver ${z3Version} (wasm.gz ${(statSync(gz).size / 1e6).toFixed(1)} MB), coi-serviceworker ${coiVersion}, Pretendard ${fontVersion} (${fontFiles} subsets)`);
