/* Carrega o dataset de uma UF (public/dados/<UF>.json) e hidrata as posições:
   voto nominal quando existe, estimativa do partido no resto. Assim o JSON viaja leve
   e o motor (motor.ts) sempre vê `posicoes` completas. */
import type { Candidato, CandidatoBruto, Dataset, DatasetBruto, Posicao } from './tipos';

export function hidratarCandidato(c: CandidatoBruto, ds: Pick<DatasetBruto, 'temas' | 'ordemTemas' | 'partidos'>): Candidato {
  const p = ds.partidos[c.partido];
  const posicoes: Record<string, Posicao> = {};
  for (const t of ds.temas) {
    const v = c.votos?.[t.id];
    if (v) posicoes[t.id] = { lado: v.lado, fonte: 'voto_nominal', detalhe: v.detalhe };
    else if (p && !p.semOrientacao) posicoes[t.id] = { lado: p.estimativa[ds.ordemTemas.indexOf(t.id)] ?? 'D', fonte: 'estimativa_partido', detalhe: `estimativa pela orientação pública do ${p.nome}` };
    else posicoes[t.id] = { lado: 'D', fonte: 'estimativa_partido', detalhe: p ? `${p.nome}: partido sem orientação pública consolidada` : `partido ${c.partido} sem cadastro` };
  }
  return { ...c, posicoes, nominais: Object.values(posicoes).filter(x => x.fonte === 'voto_nominal').length };
}

export function hidratar(bruto: DatasetBruto): Dataset {
  return { ...bruto, cargos: bruto.cargos.map(c => ({ ...c, candidatos: c.candidatos.map(x => hidratarCandidato(x, bruto)) })) };
}

const cache = new Map<string, Promise<Dataset>>();
export function carregarDataset(uf: string, base = '/dados'): Promise<Dataset> {
  const k = uf.toUpperCase();
  if (!cache.has(k)) cache.set(k, fetch(`${base}/${k}.json`).then(r => { if (!r.ok) throw new Error(`dataset ${k}: HTTP ${r.status}`); return r.json() as Promise<DatasetBruto>; }).then(hidratar));
  return cache.get(k)!;
}

/** "LUIZ INÁCIO LULA DA SILVA" → "Luiz Inácio Lula da Silva" (nomes do TSE vêm em caixa alta) */
const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'del', 'van', 'von', 'na', 'no', 'nas', 'nos']);
export function capitalizarNome(s: string): string {
  return s.toLowerCase().split(/\s+/).map((w, i) => {
    if (i > 0 && MINUSCULAS.has(w)) return w;
    return w.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
  }).join(' ');
}
