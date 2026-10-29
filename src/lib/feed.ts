/* Feed do time: busca no Supabase e traduz cada ligação (papel) em texto de card.
   As funções de texto e o placar de presença são puros, cobertos por tests/feed.test.ts. */
import { rpc } from './supabase';

export interface Ligacao { slug: string; papel: string; metodo: 'id-oficial' | 'nome' | 'ia'; confianca: number }
export interface ItemFeed {
  id: string; fonte_id: string; fonte_nome: string; natureza: 'oficial' | 'imprensa' | 'rede';
  tipo: string; titulo: string; resumo: string | null; resumo_ia: boolean; url: string; quando: string;
  local: string | null; agenda_natureza?: NaturezaAgenda | null; dados: Record<string, unknown>; politicos: Ligacao[];
}

export type NaturezaAgenda = 'publica' | 'privada' | 'partidaria' | 'pessoal';
export const ROTULO_NATUREZA: Record<NaturezaAgenda, string> = { publica: 'pública', privada: 'setor privado / sociedade', partidaria: 'partidária', pessoal: 'pessoal' };

/** As leituras do feed que já têm dado. O impacto (do mandato e do time titular) fica na página do político e na fase 4. */
export const LEITURAS = {
  tudo: { rotulo: 'Tudo', tipos: null },
  presenca: { rotulo: 'Presença', tipos: ['presenca', 'voto'] },
  agenda: { rotulo: 'Agenda', tipos: ['agenda'] },
  oficial: { rotulo: 'Oficial', tipos: ['presenca', 'voto', 'discurso', 'proposicao', 'agenda', 'despesa', 'ato', 'emenda'] },
  imprensa: { rotulo: 'Imprensa', tipos: ['noticia'] },
} as const;
export type Leitura = keyof typeof LEITURAS;

export async function buscarFeed(slugs: string[], leitura: Leitura, antes?: string, limite = 30): Promise<ItemFeed[]> {
  if (!slugs.length) return [];
  return rpc<ItemFeed[]>('feed', { p_slugs: slugs, p_tipos: LEITURAS[leitura].tipos, p_antes: antes ?? null, p_limite: limite });
}

export type Tom = 'bom' | 'ruim' | 'neutro';

/* Siglas oficiais de voto e ausência do Senado (votação nominal). */
const SENADO: Record<string, [string, Tom]> = {
  'Sim': ['votou SIM', 'neutro'], 'Não': ['votou NÃO', 'neutro'], 'Abstenção': ['se absteve', 'neutro'],
  'Votou': ['votou (votação secreta)', 'neutro'], 'P-NRV': ['presente, não votou', 'neutro'], 'Presidente (art. 51 RISF)': ['presidiu a sessão', 'neutro'],
  'NCom': ['não compareceu', 'ruim'], 'AP': ['ausente em atividade parlamentar', 'neutro'], 'LS': ['de licença médica', 'neutro'],
  'LP': ['de licença particular', 'ruim'], 'MIS': ['em missão oficial', 'neutro'], 'REP': ['em representação da casa', 'neutro'],
};
/* Câmara: tipoVoto vem por extenso. */
const CAMARA: Record<string, [string, Tom]> = {
  'Sim': ['votou SIM', 'neutro'], 'Não': ['votou NÃO', 'neutro'], 'Abstenção': ['se absteve', 'neutro'],
  'Obstrução': ['obstruiu', 'neutro'], 'Artigo 17': ['presidiu a sessão', 'neutro'],
};

/** O que a pessoa fez naquele item, em poucas palavras. */
export function papelEmTexto(tipo: string, papel: string, casa?: unknown): { texto: string; tom: Tom } {
  if (tipo === 'presenca') return papel === 'ausente' ? { texto: 'faltou', tom: 'ruim' } : { texto: 'esteve presente', tom: 'bom' };
  if (tipo === 'voto') {
    const t = (casa === 'senado' ? SENADO : CAMARA)[papel];
    return t ? { texto: t[0], tom: t[1] } : { texto: papel, tom: 'neutro' };
  }
  if (tipo === 'proposicao') return { texto: papel === 'autor' ? 'apresentou um projeto' : 'assinou um projeto junto', tom: 'neutro' };
  if (tipo === 'discurso') return { texto: 'discursou', tom: 'neutro' };
  if (tipo === 'noticia') return { texto: 'citado na imprensa', tom: 'neutro' };
  if (tipo === 'agenda') return { texto: 'na agenda oficial', tom: 'neutro' };
  return { texto: papel, tom: 'neutro' };
}

export const ROTULO_TIPO: Record<string, string> = {
  presenca: 'Presença', voto: 'Votação', proposicao: 'Projeto', discurso: 'Discurso', noticia: 'Notícia',
  agenda: 'Agenda', despesa: 'Gasto', ato: 'Diário Oficial', emenda: 'Emenda', post: 'Rede social',
};

/** "agora", "há 5 min", "há 3 h", "ontem", "12/out" (e o ano, se não for o corrente). */
export function quandoEmTexto(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  const min = Math.round((agora.getTime() - d.getTime()) / 6e4);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60 && d.getDate() === agora.getDate()) return `há ${Math.round(min / 60)} h`;
  const ontem = new Date(agora); ontem.setDate(agora.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return 'ontem';
  const mes = d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', '/');
  return d.getFullYear() === agora.getFullYear() ? mes : `${mes}/${d.getFullYear()}`;
}

export interface Placar { esteve: number; faltou: number; base: 'plenario' | 'votacao' }

/** Presença por político nos itens carregados. Câmara: sessões deliberativas do plenário (onde todos são esperados).
 *  Senado: votações nominais (não existe registro de presença fora delas). Justificada (licença, missão) não conta como falta. */
export function placarPresenca(itens: ItemFeed[]): Map<string, Placar> {
  const out = new Map<string, Placar>();
  const somar = (slug: string, base: Placar['base'], campo: 'esteve' | 'faltou') => {
    const p = out.get(slug) ?? { esteve: 0, faltou: 0, base };
    p[campo]++;
    out.set(slug, p);
  };
  for (const i of itens) {
    for (const l of i.politicos ?? []) {
      if (i.tipo === 'presenca' && i.dados.plenario) somar(l.slug, 'plenario', l.papel === 'ausente' ? 'faltou' : 'esteve');
      if (i.tipo === 'voto' && i.dados.casa === 'senado') {
        const tom = SENADO[l.papel]?.[1];
        if (tom === 'ruim') somar(l.slug, 'votacao', 'faltou');
        else if (['Sim', 'Não', 'Abstenção', 'Votou', 'P-NRV', 'Presidente (art. 51 RISF)'].includes(l.papel)) somar(l.slug, 'votacao', 'esteve');
      }
    }
  }
  return out;
}

/** Quantos compromissos de agenda de cada natureza nos itens carregados (null = sem critério que bata). */
export function placarAgenda(itens: ItemFeed[]): Record<NaturezaAgenda | 'sem', number> {
  const out = { publica: 0, privada: 0, partidaria: 0, pessoal: 0, sem: 0 };
  for (const i of itens) if (i.tipo === 'agenda') out[i.agenda_natureza ?? 'sem']++;
  return out;
}
