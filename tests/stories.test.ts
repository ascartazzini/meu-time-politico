import { describe, expect, it } from 'vitest';
import { calcularPlacar } from '../src/lib/motor';
import { encurtar, montarStories, nomeArquivoStories, quebrar } from '../src/lib/stories';
import type { Candidato, Cargo, Dataset, Lado, Tema } from '../src/lib/tipos';

const temas: Tema[] = [
  { id: 'ir', s: 'IR', t: 'x', impacto: { renda_1: 'F' }, votacoes: [] },
  { id: 'arma', s: 'Armas', t: 'x', impacto: {}, votacoes: [] }
];
function cand(id: string, nome: string, partido: string, cargo: Candidato['cargo'], lados: Record<string, Lado>): Candidato {
  const posicoes: Candidato['posicoes'] = {};
  for (const t of temas) posicoes[t.id] = { lado: lados[t.id] ?? 'D', fonte: 'estimativa_partido' };
  return { id, nome, partido, cargo, uf: 'RS', posicoes, nominais: 0 };
}
const cargoDef = (id: Cargo['id'], nome: string, curto: string, casa: Cargo['casa'], porCampo: boolean, peso: number, c: Candidato): Cargo =>
  ({ id, nome, curto, casa, porCampo, pesoNoPlacar: peso, abrangencia: 'UF', meta: '', candidatos: [c] });

const ds: Dataset = {
  uf: 'RS', nomeUf: 'Rio Grande do Sul', casaEstadual: 'ALRS', geradoEm: '', dataTse: '', temas, ordemTemas: temas.map(t => t.id),
  cargos: [
    cargoDef('presidente', 'Presidente da República', 'presidente', 'camara', true, .25, cand('a', 'Ana Souza', 'PT', 'presidente', { ir: 'F', arma: 'C' })),
    cargoDef('governador', 'Governador do RS', 'governador', 'assembleia', true, .15, cand('b', 'Beto Lima', 'PL', 'governador', { ir: 'C', arma: 'F' })),
    cargoDef('senador', 'Senador pelo RS', 'senador', 'senado', false, .2, cand('c', 'Carla Dias', 'MDB', 'senador', {})),
    cargoDef('federal', 'Deputado federal', 'deputado federal', 'camara', false, .3, cand('d', 'Davi Rocha', 'PT', 'federal', { ir: 'F', arma: 'C' })),
    cargoDef('estadual', 'Deputado estadual', 'deputado estadual', 'assembleia', false, .1, cand('e', 'Eva Nunes', 'PT', 'estadual', { ir: 'F', arma: 'C' }))
  ],
  bancadas: { camara: { PT: 64, PL: 98, MDB: 38 }, senado: { PT: 9, PL: 16, MDB: 9 }, assembleia: { PT: 8, PL: 8, MDB: 8 } },
  quorum: { camara: 257, senado: 41, assembleia: 28 }, cadeiras: { camara: 513, senado: 81, assembleia: 55 },
  partidos: { PT: { nome: 'PT', campo: 'esq', estimativa: [] }, PL: { nome: 'PL', campo: 'dir', estimativa: [] }, MDB: { nome: 'MDB', campo: 'centro', estimativa: [] } },
  fontes: [], cobertura: [], stats: { candidatos: 5, federais: 1, estaduais: 1, comMandato: 0 }
};
const st = { uf: 'RS', perfil: { renda: 'renda_1' }, respostas: { ir: 'F' as const, arma: 'C' as const }, decisivas: ['ir'], time: { presidente: 'a', governador: 'b', senador: 'c', federal: 'd', estadual: 'e' } };

describe('conteúdo da imagem pro stories', () => {
  const p = calcularPlacar(st, ds)!;
  const c = montarStories(p, ds.nomeUf, 'https://meutime.exemplo.br/');

  it('espelha o placar sem inventar nada', () => {
    expect(c.forca).toBe(p.forca); expect(c.coerencia).toBe(p.coerencia); expect(c.peso).toBe(p.peso);
    expect(c.veredito).toBe(p.veredito.t.toUpperCase()); expect(c.classe).toBe(p.veredito.c);
    expect(c.gols).toBe(p.gols.length);
  });
  it('escala os cinco na ordem dos cargos, com cargo curto, nome e partido', () => {
    expect(c.escalacao).toHaveLength(5);
    expect(c.escalacao[0]).toEqual({ cargo: 'PRESIDENTE', nome: 'Ana Souza', partido: 'PT' });
    expect(c.escalacao[3].cargo).toBe('DEPUTADO FEDERAL');
  });
  it('nomeia o estado e o endereço sem protocolo nem barra final', () => {
    expect(c.kicker).toBe('BRASIL · RIO GRANDE DO SUL · 4 DE OUTUBRO');
    expect(c.url).toBe('meutime.exemplo.br/app');
  });
  it('concorda o rótulo dos gols e diz onde foram medidos', () => {
    expect(c.gols).toBe(3); expect(c.golsRotulo).toBe('GOLS CONTRA'); expect(c.golsSub).toBe('na pauta que decide o voto');
    const semGol = montarStories({ ...p, gols: [], decisivas: [] }, ds.nomeUf, 'x.br');
    expect(semGol.golsSub).toBe('ninguém do time joga contra');
    expect(montarStories({ ...p, gols: p.gols.slice(0, 1) }, ds.nomeUf, 'x.br').golsRotulo).toBe('GOL CONTRA');
  });
  it('avisa que a posição pode ser estimativa e muda o título quando o placar é de outra pessoa', () => {
    expect(c.rodape).toMatch(/estimativa do partido/);
    expect(c.tituloEscalacao).toBe('MINHA ESCALAÇÃO');
    expect(montarStories(p, ds.nomeUf, 'x.br', false).tituloEscalacao).toBe('A ESCALAÇÃO');
  });
  it('nomeia o arquivo pela UF', () => {
    expect(nomeArquivoStories('RS')).toBe('meu-time-politico-2026-rs.png');
    expect(nomeArquivoStories()).toBe('meu-time-politico-2026.png');
  });
});

describe('texto que cabe na tela', () => {
  const mede = (s: string) => s.length * 10;   // 10px por caractere
  it('encurta com reticências só quando precisa', () => {
    expect(encurtar(mede, 'Ana Souza', 200)).toBe('Ana Souza');
    const curto = encurtar(mede, 'candidato(a) do Partido dos Trabalhadores', 200);
    expect(curto.endsWith('…')).toBe(true); expect(mede(curto)).toBeLessThanOrEqual(200);
  });
  it('quebra por palavra e respeita o máximo de linhas', () => {
    expect(quebrar(mede, 'ELENCO CARO, TIME RACHADO', 150, 2)).toEqual(['ELENCO CARO,', 'TIME RACHADO']);
    expect(quebrar(mede, 'TIME CAMPEÃO', 400, 2)).toEqual(['TIME CAMPEÃO']);
    const duas = quebrar(mede, 'um dois três quatro cinco seis sete', 100, 2);
    expect(duas).toHaveLength(2); expect(duas[1].endsWith('…')).toBe(true);
  });
});
