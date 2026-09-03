import { describe, expect, it } from 'vitest';
import { capitalizarNome, hidratarCandidato } from '../src/lib/dataset';
import type { CandidatoBruto, PartidoInfo, Tema } from '../src/lib/tipos';

const temas: Tema[] = [
  { id: 'ir', s: 'IR', t: 'x', impacto: {}, votacoes: [] },
  { id: 'arma', s: 'Armas', t: 'x', impacto: {}, votacoes: [] }
];
const partidos: Record<string, PartidoInfo> = {
  PT: { nome: 'PT', campo: 'esq', estimativa: ['F', 'C'] },
  DEMOCRATA: { nome: 'Democrata', campo: null, estimativa: ['D', 'D'], semOrientacao: true }
};
const base = { temas, ordemTemas: ['ir', 'arma'], partidos };

describe('hidratação do candidato', () => {
  it('voto nominal vence a estimativa do partido', () => {
    const c: CandidatoBruto = { id: '1', nome: 'X', partido: 'PT', cargo: 'federal', uf: 'RS', votos: { arma: { lado: 'F', detalhe: 'votou SIM' } } };
    const h = hidratarCandidato(c, base);
    expect(h.posicoes.ir).toMatchObject({ lado: 'F', fonte: 'estimativa_partido' });
    expect(h.posicoes.arma).toMatchObject({ lado: 'F', fonte: 'voto_nominal', detalhe: 'votou SIM' });
    expect(h.nominais).toBe(1);
  });
  it('partido sem orientação ou desconhecido fica dividido', () => {
    expect(hidratarCandidato({ id: '2', nome: 'Y', partido: 'DEMOCRATA', cargo: 'presidente', uf: 'BR' }, base).posicoes.ir.lado).toBe('D');
    expect(hidratarCandidato({ id: '3', nome: 'Z', partido: 'PXX', cargo: 'presidente', uf: 'BR' }, base).posicoes.ir.lado).toBe('D');
  });
});
describe('capitalizarNome', () => {
  it('trata partículas e hífen', () => {
    expect(capitalizarNome('LUIZ INÁCIO LULA DA SILVA')).toBe('Luiz Inácio Lula da Silva');
    expect(capitalizarNome('DE OLHO NA CIDADE')).toBe('De Olho na Cidade');
    expect(capitalizarNome('ANA-MARIA')).toBe('Ana-Maria');
  });
});
