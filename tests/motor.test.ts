import { describe, expect, it } from 'vitest';
import { TOLERANCIA_CAMISA, calcCoerencia, calcPeso, calcularPlacar, concord, forca, forcaDoCampo, leituraDaForca, pautasDoBolso, scoreBolso, scoreCamisa, sugerirTrocas, veredito } from '../src/lib/motor';
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
const cargoDef = (id: Cargo['id'], casa: Cargo['casa'], porCampo: boolean, peso: number, cands: Candidato[], vagas = 1): Cargo =>
  ({ id, nome: id, curto: id, casa, porCampo, pesoNoPlacar: peso, abrangencia: 'UF', vagas, meta: '', candidatos: cands });

const A = cand('a', 'PT', 'presidente', { ir: 'F', arma: 'C', sus: 'F' });
const B = cand('b', 'PL', 'governador', { ir: 'C', arma: 'F', sus: 'C' });
const C = cand('c', 'MDB', 'senador', { ir: 'D', arma: 'D', sus: 'D' });
const D = cand('d', 'PT', 'federal', { ir: 'F', arma: 'C', sus: 'F' });
const E = cand('e', 'PT', 'estadual', { ir: 'F', arma: 'C', sus: 'F' });
const F = cand('f', 'PT', 'senador', { ir: 'F', arma: 'C', sus: 'F' });        // segunda vaga de senador (2026 elege dois)

const ds: Dataset = {
  uf: 'RS', nomeUf: 'Rio Grande do Sul', casaEstadual: 'ALRS', geradoEm: '', dataTse: '', temas, ordemTemas: temas.map(t => t.id),
  cargos: [cargoDef('presidente', 'camara', true, .25, [A]), cargoDef('governador', 'assembleia', true, .15, [B]), cargoDef('senador', 'senado', false, .2, [C, F], 2), cargoDef('federal', 'camara', false, .3, [D]), cargoDef('estadual', 'assembleia', false, .1, [E])],
  bancadas: { camara: { PT: 64, PL: 98, MDB: 38 }, senado: { PT: 9, PL: 16, MDB: 9 }, assembleia: { PT: 8, PL: 8, MDB: 8 } },
  quorum: { camara: 257, senado: 41, assembleia: 28 }, cadeiras: { camara: 513, senado: 81, assembleia: 55 },
  partidos: { PT: { nome: 'PT', campo: 'esq', estimativa: [] }, PL: { nome: 'PL', campo: 'dir', estimativa: [] }, MDB: { nome: 'MDB', campo: 'centro', estimativa: [] } },
  fontes: [], cobertura: [], stats: { candidatos: 6, federais: 1, estaduais: 1, comMandato: 0 }
};
/* escalação completa: 6 jogadores pra 5 cargos (F é o segundo senador) */
const TIME = { presidente: ['a'], governador: ['b'], senador: ['c', 'f'], federal: ['d'], estadual: ['e'] };
const escalados = (cs: Candidato[]) => cs.map(c => ({ cargo: ds.cargos.find(k => k.id === c.cargo)!, candidato: c, vaga: c.id === 'f' ? 1 : 0 }));

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
  const esc = escalados([A, B, C, F, D, E]);
  it('conta gols contra só nos pares opostos e restringe às decisivas', () => {
    const r = calcCoerencia(esc, temas, new Set(['ir']));
    // pares com B (PL) contra A, F, D, E em ir → 4 gols; C dividido não é gol
    expect(r.gols).toHaveLength(4);
    expect(r.gols.every(g => g.tema.id === 'ir')).toBe(true);
    expect(r.gols.some(g => g.b.candidato.id === 'f' && g.b.vaga === 1)).toBe(true);
  });
  it('coerência 100 sem oposição', () => {
    const r = calcCoerencia(escalados([A, D, E]), temas, new Set());
    expect(r.coerencia).toBe(100); expect(r.gols).toHaveLength(0);
  });
});

describe('peso', () => {
  it('soma o campo ideológico inteiro', () => {
    expect(forcaDoCampo(ds.bancadas.camara, ds.partidos)).toEqual({ esq: 64, centro: 38, dir: 98 });
  });
  it('usa campo pra presidente/governador e bancada própria pros demais; senador vale metade por vaga', () => {
    const { peso, detalhe } = calcPeso(escalados([A, B, C, F, D, E]), ds);
    const d = (cargo: string, vaga = 0) => detalhe.find(x => x.cargo === cargo && x.vaga === vaga)!;
    expect(d('presidente').cadeiras).toBe(64);   // campo esq na Câmara
    expect(d('governador').cadeiras).toBe(8);    // campo dir na ALRS
    expect(d('senador', 0).cadeiras).toBe(9);    // MDB no Senado
    expect(d('senador', 1)).toMatchObject({ nome: 'f', partido: 'PT', cadeiras: 9, pesoNoPlacar: .1 });
    expect(d('federal').v).toBe(Math.round(64 / 257 * 100));
    expect(detalhe).toHaveLength(6);
    expect(peso).toBe(Math.round(d('presidente').v * .25 + d('governador').v * .15 + d('senador', 0).v * .1 + d('senador', 1).v * .1 + d('federal').v * .3 + d('estadual').v * .1));
  });
  it('partido desconhecido pesa zero, não quebra', () => {
    const X = cand('x', 'PXX', 'federal', {});
    const { detalhe } = calcPeso([{ cargo: ds.cargos[3], candidato: X, vaga: 0 }], ds);
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
  it('retorna null com time incompleto (inclusive só um senador) e calcula com time cheio', () => {
    expect(calcularPlacar({ perfil: {}, respostas: {}, decisivas: [], time: { presidente: ['a'] } }, ds)).toBeNull();
    expect(calcularPlacar({ perfil: {}, respostas: {}, decisivas: [], time: { ...TIME, senador: ['c'] } }, ds)).toBeNull();
    expect(calcularPlacar({ perfil: {}, respostas: {}, decisivas: [], time: { ...TIME, senador: ['', 'f'] } }, ds)).toBeNull();
    const p = calcularPlacar({ perfil: { renda: 'renda_1' }, respostas: { ir: 'F', arma: 'C', sus: 'F' }, decisivas: ['ir'], time: TIME }, ds)!;
    expect(p.gols).toHaveLength(4);
    expect(p.linhas).toHaveLength(6);
    expect(p.escalados.map(e => `${e.cargo.id}${e.vaga}`)).toEqual(['presidente0', 'governador0', 'senador0', 'senador1', 'federal0', 'estadual0']);
    expect(p.linhas[0].camisa).toBe(100);
    expect(p.forca).toBe(forca(p.coerencia, p.peso));
  });
});

describe('leitura da força', () => {
  const esc = escalados([A, B, C, F, D, E]);
  const base = calcularPlacar({ perfil: {}, respostas: { ir: 'F', arma: 'C', sus: 'F' }, decisivas: ['ir'], time: TIME }, ds)!;
  it('aponta o eixo que segura a força e o teto de cada um', () => {
    const l = leituraDaForca({ ...base, coerencia: 80, peso: 20 });
    expect(l.gargalo).toBe('peso');
    expect(l.seCoerencia100).toBe(forca(100, 20)); expect(l.sePeso100).toBe(forca(80, 100));
    expect(leituraDaForca({ ...base, coerencia: 20, peso: 80 }).gargalo).toBe('coerencia');
    expect(leituraDaForca({ ...base, coerencia: 50, peso: 55 }).gargalo).toBeNull();
  });
  it('mede o ganho marginal de +10 em cada eixo sem passar de 100', () => {
    const l = leituraDaForca({ ...base, coerencia: 80, peso: 20 });
    expect(l.ganho10.peso).toBe(forca(80, 30) - forca(80, 20));
    expect(l.ganho10.coerencia).toBe(forca(90, 20) - forca(80, 20));
    expect(leituraDaForca({ ...base, coerencia: 100, peso: 95 }).ganho10.peso).toBe(forca(100, 100) - forca(100, 95));
  });
  it('acha o cargo que mais deixa peso na mesa e quem mais faz gol contra', () => {
    const l = leituraDaForca(base);
    // federal (30% do placar) com PT 64/257 = 25 → perde 75 × .3 ≈ 23 pontos; é o maior vazamento
    expect(l.vazaPeso?.cargo).toBe('federal'); expect(l.vazaPeso?.perdido).toBe(Math.round(75 * .3));
    // B (PL) está nos 4 gols contra; A, F, D, E em 1 cada; C (dividido) em nenhum
    expect(l.golsPorJogador[0]).toMatchObject({ n: 4 }); expect(l.golsPorJogador[0].e.cargo.id).toBe('governador');
    expect(l.golsPorJogador.find(x => x.e.candidato.id === 'f')?.n).toBe(1);
    expect(l.golsPorJogador.some(x => x.e.candidato.id === 'c')).toBe(false);
    expect(leituraDaForca({ ...base, gols: [], detalhePeso: base.detalhePeso.map(d => ({ ...d, v: 100 })), escalados: esc }).vazaPeso).toBeNull();
  });
});

describe('sugestões de troca', () => {
  const B2 = cand('b2', 'PT', 'governador', { ir: 'F', arma: 'C', sus: 'F' });        // governador alinhado com o resto
  const C2 = cand('c2', 'PL', 'senador', { ir: 'C', arma: 'F', sus: 'C' });           // senador que veste a camisa oposta
  const C3 = cand('c3', 'PT', 'senador', { ir: 'F', arma: 'C', sus: 'F' });
  const C4 = { ...cand('c4', 'PT', 'senador', { ir: 'F', arma: 'C', sus: 'F' }), nominais: 2 };  // mesmas posições que C3, com voto real
  const ds2: Dataset = { ...ds, cargos: [ds.cargos[0], { ...ds.cargos[1], candidatos: [B, B2] }, { ...ds.cargos[2], candidatos: [C, C2, C3, C4, F] }, ds.cargos[3], ds.cargos[4]] };
  const st = { perfil: {}, respostas: { ir: 'F' as const, arma: 'C' as const, sus: 'F' as const }, decisivas: ['ir'], time: TIME };
  const atual = calcularPlacar(st, ds2)!;
  const sug = sugerirTrocas(st, ds2, atual);
  it('só sugere troca que sobe a força, uma por vaga, ordenada pelo ganho', () => {
    expect(sug.length).toBeGreaterThan(0);
    expect(new Set(sug.map(s => `${s.cargo.id}:${s.vaga}`)).size).toBe(sug.length);
    for (const s of sug) { expect(s.delta.forca).toBeGreaterThan(0); expect(s.placar.forca).toBe(atual.forca + s.delta.forca); }
    for (let i = 1; i < sug.length; i++) expect(sug[i - 1].delta.forca).toBeGreaterThanOrEqual(sug[i].delta.forca);
    // trocar o governador PL por um PT tira os 4 gols contra
    const gov = sug.find(s => s.cargo.id === 'governador')!;
    expect(gov.para.id).toBe('b2'); expect(gov.delta.gols).toBe(-4); expect(gov.placar.gols).toHaveLength(0);
  });
  it('não sugere quem veste menos a camisa do que o atual', () => {
    for (const s of sug) if (s.camisa.de !== null && s.camisa.para !== null) expect(s.camisa.para).toBeGreaterThanOrEqual(s.camisa.de - TOLERANCIA_CAMISA);
    expect(sug.some(s => s.para.id === 'c2')).toBe(false);
  });
  it('agrupa candidatos com as mesmas posições, representa pelo que tem voto nominal e nunca repete quem já está na outra vaga', () => {
    const sen = sug.find(s => s.cargo.id === 'senador' && s.vaga === 0)!;
    expect(sen.de.id).toBe('c'); expect(sen.para.id).toBe('c4'); expect(sen.iguais).toBe(1);   // F tem as mesmas posições mas já ocupa a 2ª vaga
    expect(sen.placar.escalados.map(e => e.candidato.id)).toEqual(['a', 'b', 'c4', 'f', 'd', 'e']);
    expect(sug.some(s => s.cargo.id === 'senador' && s.vaga === 1)).toBe(false);   // o segundo senador já está alinhado
    expect(sug.some(s => s.para.id === 'f')).toBe(false);
  });
  it('devolve vazio com time incompleto ou já no teto', () => {
    expect(sugerirTrocas({ ...st, time: { presidente: ['a'] } }, ds2, atual)).toEqual([]);
    const topo = { ...st, time: { ...st.time, governador: ['b2'], senador: ['c4', 'f'] } };
    const p2 = calcularPlacar(topo, ds2)!;
    expect(sugerirTrocas(topo, ds2, p2)).toEqual([]);
  });
});
