import { describe, expect, it } from 'vitest';
import { calcCoerencia, calcPeso, calcularPlacar, concord, forca, forcaDoCampo, pautasDoBolso, scoreBolso, scoreCamisa, veredito } from '../src/lib/motor';
import type { Candidato, Cargo, Dataset, Lado, Tema } from '../src/lib/tipos';

const temas: Tema[] = [
  { id: 'ir', s: 'IR', t: 'x', impacto: { renda_1: 'F', empresa: 'C' }, votacoes: [] },
  { id: 'arma', s: 'Armas', t: 'x', impacto: {}, votacoes: [] },
  { id: 'sus', s: 'SUS', t: 'x', impacto: { sus: 'F' }, votacoes: [] }
];
function cand(id: string, partido: string, cargo: Candidato['cargo'], lados: Record<string, Lado>): Candidato {
  const posicoes: Candidato['posicoes'] = {};
  for (const t of temas) posicoes[t.id] = { lado: lados[t.id] ?? 'D', fonte: 'estimativa_partido' };
  return { id, nome: id, partido, cargo, uf: 'RS', posicoes, nominais: 0 };
}
const cargoDef = (id: Cargo['id'], casa: Cargo['casa'], porCampo: boolean, peso: number, cands: Candidato[]): Cargo =>
  ({ id, nome: id, curto: id, casa, porCampo, pesoNoPlacar: peso, abrangencia: 'UF', meta: '', candidatos: cands });

const A = cand('a', 'PT', 'presidente', { ir: 'F', arma: 'C', sus: 'F' });
const B = cand('b', 'PL', 'governador', { ir: 'C', arma: 'F', sus: 'C' });
const C = cand('c', 'MDB', 'senador', { ir: 'D', arma: 'D', sus: 'D' });
const D = cand('d', 'PT', 'federal', { ir: 'F', arma: 'C', sus: 'F' });
const E = cand('e', 'PT', 'estadual', { ir: 'F', arma: 'C', sus: 'F' });

const ds: Dataset = {
  uf: 'RS', nomeUf: 'Rio Grande do Sul', casaEstadual: 'ALRS', geradoEm: '', dataTse: '', temas, ordemTemas: temas.map(t => t.id),
  cargos: [cargoDef('presidente', 'camara', true, .25, [A]), cargoDef('governador', 'assembleia', true, .15, [B]), cargoDef('senador', 'senado', false, .2, [C]), cargoDef('federal', 'camara', false, .3, [D]), cargoDef('estadual', 'assembleia', false, .1, [E])],
  bancadas: { camara: { PT: 64, PL: 98, MDB: 38 }, senado: { PT: 9, PL: 16, MDB: 9 }, assembleia: { PT: 8, PL: 8, MDB: 8 } },
  quorum: { camara: 257, senado: 41, assembleia: 28 }, cadeiras: { camara: 513, senado: 81, assembleia: 55 },
  partidos: { PT: { nome: 'PT', campo: 'esq', estimativa: [] }, PL: { nome: 'PL', campo: 'dir', estimativa: [] }, MDB: { nome: 'MDB', campo: 'centro', estimativa: [] } },
  fontes: [], cobertura: [], stats: { candidatos: 5, federais: 1, estaduais: 1, comMandato: 0 }
};

describe('concord', () => {
  it('igual = 1, dividido = .5, oposto = 0, tanto faz = null', () => {
    expect(concord('F', 'F')).toBe(1); expect(concord('F', 'D')).toBe(.5); expect(concord('F', 'C')).toBe(0);
    expect(concord('N', 'F')).toBeNull(); expect(concord(undefined, 'F')).toBeNull();
  });
});

describe('eixo camisa', () => {
  it('pesa decisiva 3x e ignora tanto faz', () => {
    // ir igual (1), arma oposto (0), sus tanto faz (fora). Sem decisiva: 1/2 = 50
    expect(scoreCamisa(A, { ir: 'F', arma: 'F', sus: 'N' }, new Set(), temas)).toBe(50);
    // ir decisiva: (3*1 + 0)/(3+1) = 75
    expect(scoreCamisa(A, { ir: 'F', arma: 'F', sus: 'N' }, new Set(['ir']), temas)).toBe(75);
  });
  it('retorna null sem respostas', () => { expect(scoreCamisa(A, {}, new Set(), temas)).toBeNull(); });
});

describe('eixo bolso', () => {
  it('ativa só as pautas que o perfil toca e declara conflito', () => {
    const { ativas, conflitos } = pautasDoBolso({ renda: 'renda_1', saude: 'sus' }, temas);
    expect(ativas.map(a => a.tema.id)).toEqual(['ir', 'sus']);
    expect(conflitos).toHaveLength(0);
    const c2 = pautasDoBolso({ renda: 'renda_1', trabalho: 'empresa' }, temas);
    expect(c2.ativas).toHaveLength(0); expect(c2.conflitos[0].tema.id).toBe('ir');
  });
  it('conta acerto cheio e meio acerto pra dividido', () => {
    const { ativas } = pautasDoBolso({ renda: 'renda_1', saude: 'sus' }, temas);
    expect(scoreBolso(A, ativas)).toEqual({ score: 100, defende: 2, total: 2 });
    expect(scoreBolso(C, ativas)).toEqual({ score: 50, defende: 1, total: 2 });
    expect(scoreBolso(B, ativas)!.score).toBe(0);
    expect(scoreBolso(A, [])).toBeNull();
  });
});

describe('coerência e gol contra', () => {
  const esc = [A, B, C, D, E].map((c, i) => ({ cargo: ds.cargos[i], candidato: c }));
  it('conta gols contra só nos pares opostos e restringe às decisivas', () => {
    const r = calcCoerencia(esc, temas, new Set(['ir']));
    // pares com B (PL) contra A, D, E em ir → 3 gols; C dividido não é gol
    expect(r.gols).toHaveLength(3);
    expect(r.gols.every(g => g.tema.id === 'ir')).toBe(true);
  });
  it('coerência 100 sem oposição', () => {
    const r = calcCoerencia([esc[0], esc[3], esc[4]], temas, new Set());
    expect(r.coerencia).toBe(100); expect(r.gols).toHaveLength(0);
  });
});

describe('peso', () => {
  it('soma o campo ideológico inteiro', () => {
    expect(forcaDoCampo(ds.bancadas.camara, ds.partidos)).toEqual({ esq: 64, centro: 38, dir: 98 });
  });
  it('usa campo pra presidente/governador e bancada própria pros demais', () => {
    const esc = [A, B, C, D, E].map((c, i) => ({ cargo: ds.cargos[i], candidato: c }));
    const { peso, detalhe } = calcPeso(esc, ds);
    const d = Object.fromEntries(detalhe.map(x => [x.cargo, x]));
    expect(d.presidente.cadeiras).toBe(64);   // campo esq na Câmara
    expect(d.governador.cadeiras).toBe(8);    // campo dir na ALRS
    expect(d.senador.cadeiras).toBe(9);       // MDB no Senado
    expect(d.federal.v).toBe(Math.round(64 / 257 * 100));
    expect(peso).toBe(Math.round(d.presidente.v * .25 + d.governador.v * .15 + d.senador.v * .2 + d.federal.v * .3 + d.estadual.v * .1));
  });
  it('partido desconhecido pesa zero, não quebra', () => {
    const X = cand('x', 'PXX', 'federal', {});
    const { detalhe } = calcPeso([{ cargo: ds.cargos[3], candidato: X }], ds);
    expect(detalhe[0].v).toBe(0);
  });
});

describe('veredito e força', () => {
  it('2x2 com corte em 55', () => {
    expect(veredito(60, 60).chave).toBe('campeao'); expect(veredito(60, 50).chave).toBe('torcida');
    expect(veredito(50, 60).chave).toBe('rachado'); expect(veredito(50, 50).chave).toBe('rebaixado');
  });
  it('média harmônica derruba quem é bom só num eixo', () => {
    expect(forca(100, 10)).toBe(18); expect(forca(0, 100)).toBe(0); expect(forca(80, 80)).toBe(80);
  });
});

describe('placar completo', () => {
  it('retorna null com time incompleto e calcula com time cheio', () => {
    expect(calcularPlacar({ perfil: {}, respostas: {}, decisivas: [], time: { presidente: 'a' } }, ds)).toBeNull();
    const p = calcularPlacar({ perfil: { renda: 'renda_1' }, respostas: { ir: 'F', arma: 'C', sus: 'F' }, decisivas: ['ir'], time: { presidente: 'a', governador: 'b', senador: 'c', federal: 'd', estadual: 'e' } }, ds)!;
    expect(p.gols).toHaveLength(3);
    expect(p.linhas).toHaveLength(5);
    expect(p.linhas[0].camisa).toBe(100);
    expect(p.forca).toBe(forca(p.coerencia, p.peso));
  });
});
