/* Conta da pessoa: login com Google (Supabase Auth, fluxo PKCE), quem ela segue e as chamadas que precisam dela.
   O cliente só é criado no navegador. Sem login dá pra ver e filtrar tudo; seguir e reagir pedem conta. */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA } from './supabase';
import { carregarTime } from './time';

let _c: SupabaseClient | null = null;
export function cliente(): SupabaseClient {
  _c ??= createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true } });
  return _c;
}

export async function usuario(): Promise<User | null> {
  const { data } = await cliente().auth.getSession();
  return data.session?.user ?? null;
}

/** Vai pro Google e volta pra mesma página (ou pra `volta`). */
export async function entrar(volta = location.pathname + location.search): Promise<void> {
  await cliente().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${volta}` } });
}
export async function sair(): Promise<void> {
  await cliente().auth.signOut();
  seguidosCache = null;
  location.reload();
}

/** Erro das funções do banco vira frase pra pessoa (as mensagens já vêm em português do SQL). */
export function mensagemDeErro(e: unknown): string {
  const m = (e as { message?: string })?.message ?? '';
  return m && !/fetch|network|JWT/i.test(m) ? m.charAt(0).toUpperCase() + m.slice(1) + '.' : 'Não deu agora. Tenta de novo daqui a pouco.';
}

async function chamar<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await cliente().rpc(fn, args);
  if (error) throw error;
  return data as T;
}

let seguidosCache: Set<string> | null = null;
export async function seguidos(): Promise<Set<string>> {
  if (seguidosCache) return seguidosCache;
  if (!(await usuario())) return new Set();
  seguidosCache = new Set(await chamar<string[]>('meus_seguidos', {}));
  return seguidosCache;
}
export async function seguir(slugs: string[], ligado: boolean): Promise<void> {
  await chamar('seguir', { p_slugs: slugs, p_ligado: ligado });
  const s = await seguidos();
  for (const x of slugs) ligado ? s.add(x) : s.delete(x);
  dispatchEvent(new CustomEvent('mtp:seguidos'));
}

/** Primeira entrada: quem montou o time antigo (salvo no aparelho) leva esse time pra conta. */
export async function trazerTimeDoAparelho(): Promise<number> {
  const s = await seguidos();
  const antigos = carregarTime().escalados.map(e => e.slug).filter(x => !s.has(x));
  if (!s.size && antigos.length) { await seguir(antigos, true); return antigos.length; }
  return 0;
}

/** As quatro reações, na ordem em que aparecem no post. Uma por pessoa por post. */
export const REACOES = [
  { tipo: 'amei', emoji: '❤️', rotulo: 'Amei' },
  { tipo: 'gostei', emoji: '👍', rotulo: 'Gostei' },
  { tipo: 'odiei', emoji: '👎', rotulo: 'Odiei' },
  { tipo: 'odiei_muito', emoji: '🤬', rotulo: 'Odiei muito' },
] as const;
export type Reacao = (typeof REACOES)[number]['tipo'];
export type Interacao = { item_id: string; minha: Reacao | null; pode: boolean } & Record<Reacao, number>;

export const interacoes = (itens: string[]) => chamar<Interacao[]>('interacoes', { p_itens: itens });
export const reagir = (item: string, tipo: Reacao | null) => chamar<void>('reagir', { p_item: item, p_tipo: tipo });
