// Loading Z3 (z3-solver 5.3.1) in the browser, without blocking the page.
//
// Z3's WebAssembly build uses threads, so it needs SharedArrayBuffer, which needs a cross-origin
// isolated page. The dev server sends COOP/COEP headers; on GitHub Pages coi-serviceworker adds them
// (the first visit registers the worker and reloads once).
//
// z3-built.js is an Emscripten loader that must be a classic <script> served by URL (its worker
// threads load it again by URL), so it lives in public/z3/ and is not bundled.

import type { Context } from 'z3-solver';
import { Judge } from '../core/judge.ts';

export type Z3Status =
  | { state: 'waiting' } // waiting for cross-origin isolation (service worker)
  | { state: 'loading'; loaded?: number; total?: number }
  | { state: 'ready' }
  | { state: 'error'; reason: 'isolation' | 'download' | 'init'; message: string };

const ISOLATION_WAIT_MS = 8000;
const asset = (name: string) => new URL(`z3/${name}`, document.baseURI).href;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((globalThis as { initZ3?: unknown }).initZ3) return resolve();
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(el);
  });
}

async function waitForIsolation(): Promise<boolean> {
  const start = performance.now();
  while (!globalThis.crossOriginIsolated) {
    if (performance.now() - start > ISOLATION_WAIT_MS) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
  return true;
}

/** Fetch the gzipped wasm with progress, then gunzip it (unless the server already decoded it). */
async function fetchWasm(onProgress: (loaded: number, total?: number) => void): Promise<Uint8Array | undefined> {
  if (typeof DecompressionStream === 'undefined') return undefined; // let Emscripten fetch the plain .wasm
  const res = await fetch(asset('z3-built.wasm.gz'));
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for z3-built.wasm.gz`);
  const total = Number(res.headers.get('content-length')) || undefined;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  let bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  const isWasm = bytes[0] === 0x00 && bytes[1] === 0x61 && bytes[2] === 0x73 && bytes[3] === 0x6d;
  if (!isWasm) throw new Error('z3-built.wasm.gz is not WebAssembly');
  return bytes;
}

let pending: Promise<Judge> | null = null;

export function loadJudge(onStatus: (s: Z3Status) => void): Promise<Judge> {
  if (pending) return pending;
  pending = (async () => {
    if (!globalThis.crossOriginIsolated) {
      onStatus({ state: 'waiting' });
      if (!(await waitForIsolation())) {
        const e = { state: 'error', reason: 'isolation', message: 'crossOriginIsolated is false' } as const;
        onStatus(e);
        throw new Error(e.message);
      }
    }
    onStatus({ state: 'loading' });
    let wasmBinary: Uint8Array | undefined;
    try {
      // z3-solver's browser entry looks for Emscripten's global through Node's `global`.
      (globalThis as { global?: unknown }).global ??= globalThis;
      const [, bin] = await Promise.all([loadScript(asset('z3-built.js')), fetchWasm((loaded, total) => onStatus({ state: 'loading', loaded, total }))]);
      wasmBinary = bin;
    } catch (err) {
      onStatus({ state: 'error', reason: 'download', message: String(err) });
      throw err;
    }
    try {
      const { init } = await import('z3-solver');
      const api = await init({
        locateFile: (file: string) => asset(file),
        mainScriptUrlOrBlob: asset('z3-built.js'),
        ...(wasmBinary ? { wasmBinary } : {}),
      });
      const ctx = api.Context('main') as Context<'main'>;
      const judge = new Judge(ctx);
      onStatus({ state: 'ready' });
      return judge;
    } catch (err) {
      onStatus({ state: 'error', reason: 'init', message: String(err) });
      throw err;
    }
  })();
  pending.catch(() => {
    pending = null;
  });
  return pending;
}
