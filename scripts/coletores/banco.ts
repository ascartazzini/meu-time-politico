/* Parte comum dos coletores: escrever no Supabase pelo PostgREST e achar o político pelo id da fonte.
   Precisa de SUPABASE_SECRET_KEY (no .env local ou no secret do GitHub Actions); ela ignora RLS. */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ } from '../util';

if (existsSync(resolve(RAIZ, '.env'))) process.loadEnvFile(resolve(RAIZ, '.env'));
const URL_BASE = process.env.SUPABASE_URL ?? 'https://zclxjwbpfgompypncvol.supabase.co';
const CHAVE = process.env.SUPABASE_SECRET_KEY;
if (!CHAVE) { console.error('✗ falta SUPABASE_SECRET_KEY (no .env ou no secret do GitHub Actions)'); process.exit(1); }

// chave nova (sb_secret_…) vai só no apikey; a legada (JWT service_role) vai também no Authorization
const cabecalhos = {
  apikey: CHAVE, 'Content-Type': 'application/json',
  ...(CHAVE.startsWith('eyJ') ? { Authorization: `Bearer ${CHAVE}` } : {}),
};

export type Tipo = 'agenda' | 'presenca' | 'voto' | 'discurso' | 'proposicao' | 'despesa' | 'ato' | 'emenda' | 'noticia' | 'post';
export type Metodo = 'id-oficial' | 'nome' | 'ia';

export interface ItemNovo {
  fonte: string;
  chave: string;                 // estável na origem: o mesmo item coletado de novo atualiza, não duplica
  tipo: Tipo;
  titulo: string;
  resumo?: string | null;
  url: string;
  ocorreuEm?: string | null;
  publicadoEm?: string | null;
  local?: string | null;
  agendaNatureza?: 'publica' | 'privada' | 'partidaria' | 'pessoal' | null;
  dados?: Record<string, unknown>;
  politicos: { id: string; papel: string; metodo: Metodo; confianca?: number }[];
}

export const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 20);

export async function pedir<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, { ...init, headers: { ...cabecalhos, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${caminho.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  const txt = await r.text();
  return (txt ? JSON.parse(txt) : null) as T;
}

/** GET de todas as linhas: o PostgREST do Supabase devolve no máximo 1.000 por pedido. */
async function todas<T>(caminho: string, ordem = 'id'): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const parte = await pedir<T[]>(`${caminho}&order=${ordem}&offset=${de}&limit=1000`);
    out.push(...parte);
    if (parte.length < 1000) return out;
  }
}

/** valor do id na fonte (camara, senado, tse-2026…) → politico_id */
export async function idsPorFonte(fonte: string): Promise<Map<string, string>> {
  const linhas = await todas<{ valor: string; politico_id: string }>(`ids_externos?fonte=eq.${fonte}&select=valor,politico_id`, 'valor');
  return new Map(linhas.map(l => [l.valor, l.politico_id]));
}

export interface PoliticoBase { id: string; slug: string; nome: string; nome_urna: string | null; uf: string | null; cargos: string[] }
export async function politicos(): Promise<PoliticoBase[]> {
  const ps = await todas<{ id: string; slug: string; nome: string; nome_urna: string | null; uf: string | null; mandatos: { cargo: string }[] }>(
    'politicos?select=id,slug,nome,nome_urna,uf,mandatos(cargo)');
  return ps.map(p => ({ id: p.id, slug: p.slug, nome: p.nome, nome_urna: p.nome_urna, uf: p.uf, cargos: p.mandatos.map(m => m.cargo) }));
}

/** Grava itens e as ligações com políticos. Item sem político ligado não entra (o feed é por político). */
export async function gravar(itens: ItemNovo[]): Promise<{ itens: number; ligacoes: number }> {
  const comGente = itens.filter(i => i.politicos.length);
  let ligacoes = 0;
  for (let k = 0; k < comGente.length; k += 200) {
    const lote = comGente.slice(k, k + 200);
    const salvos = await pedir<{ id: string; chave: string }[]>('itens?on_conflict=chave&select=id,chave', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(lote.map(i => ({
        fonte_id: i.fonte, chave: i.chave, tipo: i.tipo, titulo: i.titulo.slice(0, 500), resumo: i.resumo?.slice(0, 1000) ?? null,
        url: i.url, ocorreu_em: i.ocorreuEm ?? null, publicado_em: i.publicadoEm ?? null, local: i.local ?? null,
        agenda_natureza: i.agendaNatureza ?? null, dados: i.dados ?? {},
      }))),
    });
    const idPorChave = new Map(salvos.map(s => [s.chave, s.id]));
    const linhas = lote.flatMap(i => {
      const unicos = new Map(i.politicos.map(p => [p.id, p]));
      return [...unicos.values()].map(p => ({ item_id: idPorChave.get(i.chave), politico_id: p.id, papel: p.papel, metodo: p.metodo, confianca: p.confianca ?? 1 }));
    });
    for (let j = 0; j < linhas.length; j += 1000) {
      await pedir('item_politico?on_conflict=item_id,politico_id', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas.slice(j, j + 1000)),
      });
    }
    ligacoes += linhas.length;
  }
  return { itens: comGente.length, ligacoes };
}

/** Datas da Câmara e do Senado vêm sem fuso (Brasília). */
export function br(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = d.trim().replace(' ', 'T');
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T12:00:00-03:00`;
  return `${s}-03:00`;
}

/** Últimos `dias` dias, em AAAA-MM-DD. */
export function janela(dias: number): { inicio: string; fim: string } {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 864e5);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { inicio: f(inicio), fim: f(fim) };
}

export async function emLotes<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k]); }
  }));
  return out;
}

export const diasDoArgumento = (padrao: number) => {
  const n = Number(process.argv.find(a => /^--dias=\d+$/.test(a))?.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};
