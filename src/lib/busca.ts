/* Busca de político pra seguir: nome, partido, estado ou cargo, sem acento e em qualquer ordem
   ("lula", "pt sp", "senador parana", "deputada tabata"). Puro: roda no navegador e nos testes. */
import type { EleitoLeve } from './eleitos';
import type { Cargo } from './time';
import ufs from '../data/ufs.json';

export const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const NOME_UF = new Map(ufs.ufs.map(u => [u.sigla, semAcento(u.nome)]));
/** Peso do cargo no desempate: quem a pessoa mais procura vem antes. */
const PESO: Record<Cargo, number> = { presidente: 5, governador: 4, senador: 3, 'deputado-federal': 2, 'deputado-estadual': 1 };
/** Palavras de cargo que a pessoa digita, no masculino e no feminino. */
const CARGO_DITO: Record<string, Cargo[]> = {
  presidente: ['presidente'], presidenta: ['presidente'],
  governador: ['governador'], governadora: ['governador'],
  senador: ['senador'], senadora: ['senador'],
  deputado: ['deputado-federal', 'deputado-estadual'], deputada: ['deputado-federal', 'deputado-estadual'],
  federal: ['deputado-federal'], estadual: ['deputado-estadual'], distrital: ['deputado-estadual'],
};

export interface OpcoesBusca { uf?: string | null; limite?: number }

/** Cada palavra digitada tem que bater com o começo de uma palavra do nome, com o partido, a UF
 *  (sigla ou nome) ou o cargo. Ordem: nome que começa igual, depois nome, cargo e quem é do estado da pessoa. */
export function buscarPoliticos(gente: Iterable<EleitoLeve>, q: string, o: OpcoesBusca = {}): EleitoLeve[] {
  const termos = semAcento(q).split(/[\s,.\-]+/).filter(Boolean);
  if (!termos.length) return [];
  const inteiro = termos.join(' ');
  const achados: { e: EleitoLeve; nota: number }[] = [];
  for (const e of gente) {
    const nome = semAcento(e.nome), palavras = nome.split(/\s+/);
    const partido = semAcento(e.partido), uf = (e.uf ?? '').toLowerCase(), ufNome = e.uf ? NOME_UF.get(e.uf) ?? '' : '';
    let nota = 0, ok = true;
    for (const t of termos) {
      if (palavras.some(p => p.startsWith(t))) nota += 10;
      else if (t === partido) nota += 8;
      else if (t.length === 2 && t === uf) nota += 6;
      else if (t.length > 2 && ufNome.split(' ').some(p => p.startsWith(t))) nota += 5;
      else if (CARGO_DITO[t]?.includes(e.cargo)) nota += 4;
      else if (t.length > 3 && nome.includes(t)) nota += 2;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (nome.startsWith(inteiro)) nota += 20;
    nota += PESO[e.cargo] + (o.uf && e.uf === o.uf ? 3 : 0) - (e.suplente ? 1 : 0);
    achados.push({ e, nota });
  }
  return achados.sort((a, b) => b.nota - a.nota || a.e.nome.localeCompare(b.e.nome, 'pt-BR'))
    .slice(0, o.limite ?? 30).map(x => x.e);
}

/** Sugestão pra quem ainda não segue ninguém: presidente, governador e senadores do estado. */
export function sugestoes(gente: Iterable<EleitoLeve>, uf: string | null): EleitoLeve[] {
  const alto: Cargo[] = ['presidente', 'governador', 'senador'];
  return [...gente].filter(e => e.cargo === 'presidente' || (uf && e.uf === uf && alto.includes(e.cargo) && !e.suplente))
    .sort((a, b) => PESO[b.cargo] - PESO[a.cargo] || a.nome.localeCompare(b.nome, 'pt-BR'));
}

