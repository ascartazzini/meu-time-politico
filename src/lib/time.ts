/* O time pós-eleição: quem a pessoa segue (vários por cargo) e quem é titular (normalmente em quem votou).
   Fica no aparelho, sem login. Puro, exceto carregar/salvar; coberto por tests/time.test.ts. */

export type Cargo = 'presidente' | 'governador' | 'senador' | 'deputado-federal' | 'deputado-estadual';
export const CARGOS: Cargo[] = ['presidente', 'governador', 'senador', 'deputado-federal', 'deputado-estadual'];

/** Quantos titulares cabem por cargo: um voto por cargo, e no Senado as três cadeiras da UF
 *  (duas eleitas em 2026, uma em 2022). Marcar mais um tira o titular mais antigo do cargo. */
export const TITULARES_POR_CARGO: Record<Cargo, number> = {
  presidente: 1, governador: 1, senador: 3, 'deputado-federal': 1, 'deputado-estadual': 1,
};

export interface Escalado { slug: string; nome: string; partido: string; uf: string | null; cargo: Cargo; titular: boolean }
export interface MeuTime { uf?: string; escalados: Escalado[] }

export const timeVazio = (): MeuTime => ({ escalados: [] });
export const segue = (t: MeuTime, slug: string) => t.escalados.some(e => e.slug === slug);
export const ehTitular = (t: MeuTime, slug: string) => t.escalados.some(e => e.slug === slug && e.titular);

export function seguir(t: MeuTime, p: Omit<Escalado, 'titular'>): MeuTime {
  if (segue(t, p.slug)) return t;
  return { ...t, escalados: [...t.escalados, { ...p, titular: false }] };
}

export function deixarDeSeguir(t: MeuTime, slug: string): MeuTime {
  return { ...t, escalados: t.escalados.filter(e => e.slug !== slug) };
}

/** Liga/desliga titular. Quem vira titular passa a ser seguido; o excedente do cargo volta pro banco. */
export function alternarTitular(t: MeuTime, p: Omit<Escalado, 'titular'>): MeuTime {
  if (ehTitular(t, p.slug)) return { ...t, escalados: t.escalados.map(e => e.slug === p.slug ? { ...e, titular: false } : e) };
  const base = seguir(t, p);
  // ordem do array = ordem em que viraram titulares (o novo vai pro fim)
  const resto = base.escalados.filter(e => e.slug !== p.slug);
  const eu = { ...base.escalados.find(e => e.slug === p.slug)!, titular: true };
  const doCargo = resto.filter(e => e.titular && e.cargo === p.cargo);
  const sobra = doCargo.length + 1 - TITULARES_POR_CARGO[p.cargo];
  const rebaixar = new Set(sobra > 0 ? doCargo.slice(0, sobra).map(e => e.slug) : []);
  return { ...base, escalados: [...resto.map(e => rebaixar.has(e.slug) ? { ...e, titular: false } : e), eu] };
}

export function porCargo(t: MeuTime): Record<Cargo, Escalado[]> {
  const out = Object.fromEntries(CARGOS.map(c => [c, [] as Escalado[]])) as Record<Cargo, Escalado[]>;
  for (const e of t.escalados) out[e.cargo]?.push(e);
  for (const c of CARGOS) out[c].sort((a, b) => Number(b.titular) - Number(a.titular) || a.nome.localeCompare(b.nome, 'pt-BR'));
  return out;
}

export function normalizarTime(x: unknown): MeuTime {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<MeuTime>;
  const escalados = Array.isArray(o.escalados) ? o.escalados.filter((e): e is Escalado =>
    !!e && typeof e.slug === 'string' && typeof e.nome === 'string' && CARGOS.includes(e.cargo)).map(e => ({ ...e, titular: !!e.titular })) : [];
  const vistos = new Set<string>();
  return {
    uf: typeof o.uf === 'string' && /^[A-Z]{2}$/.test(o.uf) ? o.uf : undefined,
    escalados: escalados.filter(e => !vistos.has(e.slug) && vistos.add(e.slug)),
  };
}

const CHAVE = 'mtp:time:v1';
export function carregarTime(): MeuTime {
  try { const raw = localStorage.getItem(CHAVE); return raw ? normalizarTime(JSON.parse(raw)) : timeVazio(); } catch { return timeVazio(); }
}
export function salvarTime(t: MeuTime): void {
  try { localStorage.setItem(CHAVE, JSON.stringify(t)); } catch { /* modo privado: o time vale só nesta aba */ }
}
