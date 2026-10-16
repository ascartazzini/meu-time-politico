/* Fase 0: prova de fontes. Cada arquivo em scripts/prova/ (menos base.ts e rodar.ts)
   exporta `default` um array de Prova. O runner descobre os arquivos sozinho.
   Uma prova mede o que a fonte entrega HOJE, a partir desta máquina, sem login,
   sem chave paga e sem contornar bloqueio. Não guarda nada além da amostra. */
import { UA } from '../util';

export type Grupo = 'oficial' | 'executivo' | 'imprensa' | 'rede-aberta' | 'rede-fechada' | 'estado';
export type Status = 'ok' | 'parcial' | 'bloqueado' | 'falhou';

export interface Amostra { data: string; titulo: string; url: string }

export interface Medida {
  status: Status;
  /** quantos itens a fonte deu na janela medida (null = não se aplica / não deu pra contar) */
  itens: number | null;
  /** ex.: "7 dias", "últimos 20 posts" */
  janela: string;
  /** horas entre agora e o item mais recente (proxy de atraso de publicação) */
  atrasoHoras: number | null;
  formato: 'json' | 'xml' | 'rss' | 'html' | 'csv' | 'zip' | '—';
  /** o item já vem ligado a um id oficial de político (sem precisar de IA)? */
  idPolitico: boolean;
  amostra: Amostra[];
  notas: string[];
}

export interface Prova {
  id: string;
  nome: string;
  grupo: Grupo;
  /** endpoint ou página principal */
  url: string;
  /** custo pra usar em produção, mesmo se zero (ex.: "0 — API aberta", "0 — exige chave gratuita por e-mail") */
  custo: string;
  /** risco jurídico/termos/estabilidade, em uma frase */
  risco: string;
  /** veredito escrito à mão depois de rodar; se ausente, o runner deriva do status */
  veredito?: (m: Medida) => string;
  rodar(): Promise<Medida>;
}

const BLOQUEIO_DISFARCADO = [/Conex[ãa]o Temporariamente Restrita/i];

export interface Resposta { status: number; ok: boolean; corpo: string; ms: number; url: string; erro?: string; tipo: string }

/** GET que nunca lança: devolve status, corpo e tempo. User-agent identificado, timeout de 30 s. */
export async function pegar(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Resposta> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', ...opts.headers }, signal: ctl.signal, redirect: 'follow' });
    // respeita o charset declarado (Folha e UOL servem ISO-8859-1; r.text() forçaria UTF-8)
    const charset = (r.headers.get('content-type') ?? '').match(/charset=([\w-]+)/i)?.[1] ?? 'utf-8';
    const bytes = await r.arrayBuffer();
    let corpo: string;
    try { corpo = new TextDecoder(charset).decode(bytes); } catch { corpo = new TextDecoder('utf-8').decode(bytes); }
    // gov.br limita por volume devolvendo HTTP 200 com uma página de aviso, não 403/429
    const barrado = BLOQUEIO_DISFARCADO.some(rx => rx.test(corpo.slice(0, 20_000)));
    return {
      status: r.status, ok: r.ok && !barrado, corpo, ms: Date.now() - t0, url: r.url, tipo: r.headers.get('content-type') ?? '',
      ...(barrado ? { erro: 'bloqueio disfarçado de 200 (limite de volume)' } : {}),
    };
  } catch (e) {
    return { status: 0, ok: false, corpo: '', ms: Date.now() - t0, url, erro: (e as Error).message, tipo: '' };
  } finally { clearTimeout(timer); }
}

export async function pegarJson<T = unknown>(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ r: Resposta; dados: T | null }> {
  const r = await pegar(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  if (!r.ok) return { r, dados: null };
  try { return { r, dados: JSON.parse(r.corpo) as T }; } catch { return { r, dados: null }; }
}

/** Itens de um RSS/Atom, por regex (sem dependência). */
export function itensRss(xml: string): Amostra[] {
  const blocos = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  const tag = (b: string, n: string) => {
    const m = b.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`));
    return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim() : '';
  };
  return blocos.map(b => ({
    titulo: decodificar(tag(b, 'title')),
    data: tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'),
    url: tag(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? ''),
  }));
}

export function decodificar(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** Horas desde a data mais recente da lista (datas inválidas são ignoradas). */
export function atraso(datas: (string | Date | undefined | null)[]): number | null {
  let max = -Infinity; // reduce em vez de Math.max(...ts): listas de 100 mil datas estouram a pilha
  for (const d of datas) { const t = d ? new Date(d).getTime() : NaN; if (t > max) max = t; }
  if (max === -Infinity) return null;
  return Math.round(((Date.now() - max) / 36e5) * 10) / 10;
}

/** Datas no formato AAAA-MM-DD, de `dias` atrás até hoje. */
export function janelaDias(dias: number): { inicio: string; fim: string } {
  const fim = new Date();
  const inicio = new Date(fim.getTime() - dias * 864e5);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { inicio: f(inicio), fim: f(fim) };
}

/** Medida de falha, pra quando a fonte nem respondeu. */
export function falha(r: Resposta, formato: Medida['formato'], nota?: string): Medida {
  const bloqueio = r.status === 401 || r.status === 403 || r.status === 429 || r.status === 451 || /bloqueio/.test(r.erro ?? '');
  return {
    status: bloqueio ? 'bloqueado' : 'falhou', itens: null, janela: '—', atrasoHoras: null, formato, idPolitico: false, amostra: [],
    notas: [`HTTP ${r.status || 'sem resposta'}${r.erro ? ` (${r.erro})` : ''} em ${r.url.slice(0, 120)}`, ...(nota ? [nota] : [])],
  };
}

export const amostra = (lista: Amostra[], n = 3) => lista.slice(0, n).map(a => ({ ...a, titulo: a.titulo.slice(0, 140) }));
