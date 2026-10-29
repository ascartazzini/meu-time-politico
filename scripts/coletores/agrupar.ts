/* Agrupa a mesma notícia publicada por veículos diferentes: vira um card com várias fontes.
   Puro, coberto por tests/agrupar.test.ts. Duas notícias são a mesma quando:
   - saíram com até 36 h de diferença,
   - citam ao menos um político em comum,
   - e os títulos são parecidos pelo cosseno TF-IDF. O IDF é calculado sobre as notícias da janela,
     então palavra que está em todo título do dia ("Lula", "Flávio", "fuga") pesa pouco e o que
     identifica o fato ("PGR", "Valdemar", "paradeiro") pesa muito,
   - e dividem pelo menos 2 palavras raras no dia (que aparecem em até 10% dos títulos): "aliados" + "Flávio"
     sozinhos não fazem duas notícias virarem uma,
   - e vêm de veículos diferentes: duas matérias do mesmo jornal são duas matérias (um grupo tem no máximo
     uma de cada veículo).
   O grupo leva a chave da notícia mais antiga, que não muda quando outra fonte entra depois. */
import { normalizarNome } from '../../src/lib/nomes';

export interface NoticiaParaAgrupar { chave: string; fonte: string; titulo: string; quando: string; politicos: string[]; grupo?: string | null }

export const LIMIAR = 0.26;   // calibrado em 129 notícias reais de 27–28/10/2026 (tests/agrupar.test.ts)
const RARAS_EM_COMUM = 2;
const JANELA_MS = 36 * 36e5;

const VAZIAS = new Set(`a o e é de da do das dos em no na nos nas um uma uns umas por para pra pro com sem sob sobre que se ao aos
  à às ou mas mais menos como após apos ate até ser foi são sao diz dizem disse afirma afirmou fala vai pode deve
  seu sua seus suas ele ela eles elas isso este esta esse essa já ja não nao sim tem têm ter há ha entre veja
  entenda saiba leia quem qual quais onde quando porque após depois antes durante contra desde também tambem`.split(/\s+/).filter(Boolean));
const NUMEROS: Record<string, string> = { um: '1', dois: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', sete: '7', oito: '8', nove: '9', dez: '10' };

/** Palavras com conteúdo, sem acento, número por extenso vira algarismo, e radical curto (6 letras) pra plural e flexão. */
export function termos(titulo: string): string[] {
  return normalizarNome(titulo).split(' ')
    .map(w => NUMEROS[w] ?? w)
    .filter(w => w && !VAZIAS.has(w) && (w.length > 2 || /\d/.test(w)))
    .map(w => (/\d/.test(w) ? w : w.slice(0, 6)));
}

type Vetor = Map<string, number>;
function frequencia(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  return df;
}
function vetores(docs: string[][], df: Map<string, number>): Vetor[] {
  const n = docs.length;
  return docs.map(d => {
    const v: Vetor = new Map();
    for (const t of d) v.set(t, (v.get(t) ?? 0) + 1);
    let norma = 0;
    for (const [t, tf] of v) { const w = tf * Math.log((n + 1) / ((df.get(t) ?? 0) + 0.5)); v.set(t, w); norma += w * w; }
    norma = Math.sqrt(norma) || 1;
    for (const [t, w] of v) v.set(t, w / norma);
    return v;
  });
}
const cosseno = (a: Vetor, b: Vetor) => { let s = 0; for (const [t, w] of a) s += w * (b.get(t) ?? 0); return s; };

/** chave → grupo (chave da notícia mais antiga do grupo). Em ordem de tempo, cada notícia entra no grupo
 *  com quem ela mais parece, se a média do cosseno com as notícias do grupo passar do limiar. Média, e não
 *  "parece com alguma": evita a corrente A ≈ B ≈ C que junta assuntos diferentes. Quem já tinha grupo mantém. */
export function agrupar(noticias: NoticiaParaAgrupar[], limiar = LIMIAR): Map<string, string> {
  const ns = [...noticias].sort((a, b) => a.quando.localeCompare(b.quando) || a.chave.localeCompare(b.chave));
  const docs = ns.map(n => termos(n.titulo));
  const df = frequencia(docs), vs = vetores(docs, df);
  const tetoRara = Math.max(3, Math.ceil(ns.length * 0.1));
  const raras = docs.map(d => new Set(d.filter(x => (df.get(x) ?? 0) <= tetoRara)));
  const emComum = (a: number, b: number) => { let k = 0; for (const x of raras[a]) if (raras[b].has(x)) k++; return k; };
  const t = ns.map(n => new Date(n.quando).getTime());
  const grupos: { chave: string; membros: number[] }[] = [];
  const porChave = new Map<string, (typeof grupos)[number]>();
  const out = new Map<string, string>();
  ns.forEach((n, i) => {
    if (n.grupo && porChave.has(n.grupo)) { porChave.get(n.grupo)!.membros.push(i); out.set(n.chave, n.grupo); return; }
    let melhor: (typeof grupos)[number] | null = null, nota = limiar;
    for (const g of grupos) {
      if (t[i] - t[g.membros[0]] > JANELA_MS) continue;
      if (g.membros.some(m => ns[m].fonte === n.fonte)) continue;
      if (!g.membros.some(m => ns[m].politicos.some(p => n.politicos.includes(p)))) continue;
      if (!g.membros.some(m => emComum(i, m) >= RARAS_EM_COMUM)) continue;
      const media = g.membros.reduce((s, m) => s + cosseno(vs[i], vs[m]), 0) / g.membros.length;
      if (media >= nota) { nota = media; melhor = g; }
    }
    if (melhor && !n.grupo) { melhor.membros.push(i); out.set(n.chave, melhor.chave); return; }
    const novo = { chave: n.grupo ?? n.chave, membros: [i] };
    grupos.push(novo); porChave.set(novo.chave, novo); out.set(n.chave, novo.chave);
  });
  return out;
}
