/* Estado do eleitor: persistência local + codificação pra link compartilhável.
   Nada sai do navegador a não ser que a pessoa copie o link. */
import type { CargoId, EstadoEleitor, Resposta } from './tipos';

const CHAVE = 'mtp2026:v1';
export function estadoVazio(): EstadoEleitor { return { uf: undefined, perfil: {}, respostas: {}, decisivas: [], time: {} }; }

export function salvar(st: EstadoEleitor): void {
  try { localStorage.setItem(CHAVE, JSON.stringify(st)); } catch { /* modo privado etc. */ }
}
export function carregar(): EstadoEleitor | null {
  try { const raw = localStorage.getItem(CHAVE); return raw ? normalizar(JSON.parse(raw)) : null; } catch { return null; }
}
export function limpar(): void { try { localStorage.removeItem(CHAVE); } catch { /* noop */ } }

function normalizar(x: unknown): EstadoEleitor {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<EstadoEleitor>;
  return {
    uf: typeof o.uf === 'string' && /^[A-Z]{2}$/.test(o.uf) ? o.uf : undefined,
    perfil: { ...(o.perfil ?? {}) },
    respostas: { ...(o.respostas ?? {}) } as Record<string, Resposta>,
    decisivas: Array.isArray(o.decisivas) ? o.decisivas.slice(0, 3) : [],
    time: { ...(o.time ?? {}) }
  };
}

/* ---- link compartilhável: só o que é preciso pra recalcular o placar ----
   formato antes do base64url:  p=<k:v,...>&r=<temaId:F|C|N,...>&d=<temaIds,...>&t=<cargo:candId,...>
   Sem percent-encoding: ids e valores só têm [A-Za-z0-9_-], então ':' ',' '&' '=' são separadores seguros. */
const ORDEM_CARGOS: CargoId[] = ['presidente', 'governador', 'senador', 'federal', 'estadual'];
const limpo = (s: string) => String(s).replace(/[^A-Za-z0-9_-]/g, '');
export function codificar(st: EstadoEleitor): string {
  const p = Object.entries(st.perfil).map(([k, v]) => `${limpo(k)}:${limpo(v)}`).join(',');
  const r = Object.entries(st.respostas).map(([k, v]) => `${limpo(k)}:${v}`).join(',');
  const d = st.decisivas.map(limpo).join(',');
  const t = ORDEM_CARGOS.filter(c => st.time[c]).map(c => `${c}:${limpo(st.time[c]!)}`).join(',');
  return b64url(`u=${limpo(st.uf ?? '')}&p=${p}&r=${r}&d=${d}&t=${t}`);
}
export function decodificar(s: string): EstadoEleitor | null {
  try {
    const q: Record<string, string> = {};
    for (const parte of unb64url(s).split('&')) { const i = parte.indexOf('='); if (i > 0) q[parte.slice(0, i)] = parte.slice(i + 1); }
    const st = estadoVazio();
    if (q.u && /^[A-Z]{2}$/.test(q.u)) st.uf = q.u;
    for (const par of (q.p ?? '').split(',').filter(Boolean)) { const [k, v] = par.split(':'); if (k && v) st.perfil[k] = v; }
    for (const par of (q.r ?? '').split(',').filter(Boolean)) { const [k, v] = par.split(':'); if (k && (v === 'F' || v === 'C' || v === 'N')) st.respostas[k] = v; }
    st.decisivas = (q.d ?? '').split(',').filter(Boolean).slice(0, 3);
    for (const par of (q.t ?? '').split(',').filter(Boolean)) { const [k, v] = par.split(':'); if (ORDEM_CARGOS.includes(k as CargoId) && v) st.time[k as CargoId] = v; }
    return st;
  } catch { return null; }
}
function b64url(s: string): string {
  const bytes = new TextEncoder().encode(s); let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
