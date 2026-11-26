import { describe, it, expect } from 'vitest';
import { causasDe, resumoPorGrupo, ladoDoVoto, votoEmTexto, urlVotacao, type Fontes } from '../src/lib/causas';

const f: Fontes = {
  temas: [
    { id: 'ir', s: 'Imposto de renda', t: 'Isentar o IR até R$ 5 mil', impacto: { renda_1: 'F', clt: 'F', empresa: 'C' },
      votacoes: [{ casa: 'camara', id: '100-1', ladoSim: 'F', rotulo: 'PL 1/2025' }] },
    { id: 'escala', s: 'Jornada', t: 'Acabar com a 6x1', impacto: { clt: 'F', empresa: 'C' },
      votacoes: [{ casa: 'camara', id: '200-1', ladoSim: 'F', rotulo: '1º turno' }, { casa: 'camara', id: '200-2', ladoSim: 'C', rotulo: '2º turno' }] },
    { id: 'arma', s: 'Segurança', t: 'Facilitar o porte', impacto: {},
      votacoes: [{ casa: 'camara', id: '300-1', ladoSim: 'F', rotulo: 'PL 3' }, { casa: 'senado', codigoSessaoVotacao: 9, sigla: 'PL', numero: 3, ano: 2019, ladoSim: 'F', rotulo: 'PL 3 Senado' }] },
    { id: 'sus', s: 'Saúde', t: 'Mais SUS', impacto: { renda_1: 'F' }, votacoes: [] },
    { id: 'juros', s: 'Juros', t: 'Teto de juros', impacto: { renda_1: 'F' }, votacoes: [] },
  ],
  camara: {
    '100-1': { data: '2025-10-01', totais: { Sim: 493 }, votos: { 7: 'Sim', 8: 'Não' } },
    '200-1': { data: '2026-05-27', totais: { Sim: 472, Não: 22 }, votos: { 7: 'Sim', 8: 'Sim' } },
    '200-2': { data: '2026-05-28', totais: { Sim: 461, Não: 19 }, votos: { 7: 'Sim', 8: 'Não' } },
    '300-1': { data: '2019-11-05', totais: { Sim: 283, Não: 140 }, votos: { 7: 'Abstenção' } },
  },
  senado: { 9: { data: '2020-01-01', totais: { Sim: 40, Não: 30 }, votos: { 55: 'MIS' } } },
  partidos: { 'UNIÃO': { estimativa: ['F', 'F', 'C', 'F', 'D'] } },
  ordemTemas: ['ir', 'escala', 'arma', 'sus', 'juros'],
  aliases: { 'UNIÃO BRASIL': 'UNIÃO' },
  rotulos: { renda_1: 'renda até 2 salários', clt: 'ser CLT', empresa: 'ter empresa' },
};
const por = (cs: ReturnType<typeof causasDe>) => Object.fromEntries(cs.map(c => [c.tema.id, c]));

describe('causasDe', () => {
  it('voto nominal vira lado da pauta; ladoSim inverte o Não/Sim', () => {
    const c = por(causasDe({ partido: 'PT', ids: { camara: 7 } }, f));
    expect(c.ir.lado).toBe('F');
    expect(c.ir.origem).toBe('voto');
    expect(c.ir.protege).toEqual(['renda até 2 salários', 'ser CLT']);
    expect(c.ir.pesaContra).toEqual(['ter empresa']);
    // Sim no 1º turno (F) e Sim no 2º, que nesta votação é C: votou dos dois lados
    expect(c.escala.lado).toBe('D');
    expect(c.escala.votos.map(v => v.rotulo)).toEqual(['2º turno', '1º turno']);
    expect(c.escala.protege).toEqual([]);
  });
  it('abstenção registra o voto sem tomar lado; pauta sem impacto mapeado fica sem leitura', () => {
    const c = por(causasDe({ partido: 'PT', ids: { camara: 7 } }, f));
    expect(c.arma.lado).toBeNull();
    expect(c.arma.votos[0].voto).toBe('Abstenção');
    expect(c.arma.protege).toEqual([]);
  });
  it('sem voto: estimativa do partido (com alias), e nada onde o partido não tem estimativa', () => {
    const c = por(causasDe({ partido: 'União Brasil', ids: {} }, f));
    expect(Object.keys(c)).toEqual(['ir', 'escala', 'arma', 'sus', 'juros']);
    expect(c.sus).toMatchObject({ origem: 'partido', lado: 'F', protege: ['renda até 2 salários'] });
    expect(c.juros.lado).toBe('D');
    expect(causasDe({ partido: 'XYZ', ids: {} }, f)).toEqual([]);
  });
  it('não inventa ausência: quem não está na lista da votação não ganha registro', () => {
    const c = por(causasDe({ partido: 'XYZ', ids: { camara: 999 } }, f));
    expect(c).toEqual({});
  });
  it('ausência no Senado vem com o motivo', () => {
    const c = por(causasDe({ partido: 'XYZ', ids: { senado: 55 } }, f));
    expect(c.arma.votos[0]).toMatchObject({ voto: 'ausente (missão oficial)', lado: null, casa: 'senado' });
  });
});

describe('resumoPorGrupo', () => {
  it('conta em quantas pautas votadas o lado protegeu cada grupo; estimativa não entra', () => {
    const r = resumoPorGrupo(causasDe({ partido: 'UNIÃO', ids: { camara: 8 } }, f), 1);
    // deputado 8: Não no IR (C: protege empresa); na escala, Sim no 1º turno e Não no 2º (ladoSim C) = F (protege CLT)
    expect(r).toEqual([
      { grupo: 'ser CLT', aFavor: 1, pautas: 2 },
      { grupo: 'ter empresa', aFavor: 1, pautas: 2 },
      { grupo: 'renda até 2 salários', aFavor: 0, pautas: 1 },
    ]);
    expect(resumoPorGrupo(causasDe({ partido: 'UNIÃO', ids: { camara: 8 } }, f)).map(x => x.grupo)).toEqual(['ser CLT', 'ter empresa']);
  });
});

describe('miúdos', () => {
  it('lado do voto, texto do voto e link', () => {
    expect(ladoDoVoto('Não', 'F')).toBe('C');
    expect(ladoDoVoto('Obstrução', 'F')).toBeNull();
    expect(votoEmTexto('camara', 'Artigo 17')).toBe('presidia a sessão');
    expect(urlVotacao({ casa: 'camara', id: '2487436-169', ladoSim: 'F', rotulo: '' })).toBe('https://www.camara.leg.br/propostas-legislativas/2487436');
  });
});
