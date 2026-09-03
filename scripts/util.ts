import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const RAIZ = resolve(import.meta.dirname, '..');
export const GERADO = resolve(RAIZ, 'src/data/generated');
export const RAW = resolve(RAIZ, 'data/raw');
export const UA = 'MeuTimePolitico2026/0.1 (tech cívica; +https://github.com/ascartazzini)';

export function lerJson<T = unknown>(caminho: string): T {
  return JSON.parse(readFileSync(caminho, 'utf8')) as T;
}
export function lerJsonSeExistir<T = unknown>(caminho: string): T | null {
  return existsSync(caminho) ? lerJson<T>(caminho) : null;
}
export function escreverJson(caminho: string, dados: unknown): void {
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, JSON.stringify(dados, null, 1) + '\n', 'utf8');
  console.log(`  ✓ ${caminho.replace(RAIZ + '/', '')}`);
}

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

/** GET JSON com timeout, retry exponencial e user-agent identificado. */
export async function fetchJson<T = unknown>(url: string, opts: { tentativas?: number; timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const { tentativas = 4, timeoutMs = 60_000, headers = {} } = opts;
  let erro: unknown;
  for (let i = 0; i < tentativas; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA, ...headers }, signal: ctl.signal });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} em ${url}`), { fatal: true });
      return (await r.json()) as T;
    } catch (e) {
      erro = e;
      if ((e as { fatal?: boolean }).fatal) break;
      const espera = 1500 * 2 ** i;
      console.warn(`  … ${url.slice(0, 90)} falhou (${(e as Error).message}); tentando de novo em ${espera / 1000}s`);
      await dormir(espera);
    } finally { clearTimeout(timer); }
  }
  throw erro;
}

export function agoraIso(): string { return new Date().toISOString(); }
