import { describe, it, expect } from 'vitest';
import { agrupar, termos, type NoticiaParaAgrupar } from '../scripts/coletores/agrupar';

let k = 0;
const n = (fonte: string, titulo: string, hora: number, politicos = ['jair-bolsonaro-sc']): NoticiaParaAgrupar =>
  ({ chave: `n${++k}`, fonte, titulo, quando: new Date(Date.UTC(2026, 9, 28, hora)).toISOString(), politicos });

// Títulos reais de 27–28/10/2026 (G1, O Globo, Folha), mais ruído do mesmo dia pra o IDF ficar realista.
const ruido = [
  'Lula deve remanejar ministros e terá desafio de abrigar aliados', 'O que se sabe sobre a fuga de Flávio Bolsonaro após derrota',
  'Aliados de Flávio dizem que ele já foi para os EUA', 'Imprensa internacional repercute fuga de Flávio Bolsonaro do Brasil',
  'Flávio Bolsonaro pode perder o cargo de senador após fuga para os EUA', 'Trump diz que aprovaria visto de Flávio Bolsonaro',
  'Kassab libera PSD para integrar governo Lula 4', 'Governo Lula prioriza Orçamento e PEC da Segurança no Congresso',
  'Lula comemora 81 anos e diz que fuga de Flávio é vergonhosa', 'Partidos defendem resultado das urnas que deu vitória a Lula',
].map((t, i) => n(i % 2 ? 'folha' : 'oglobo', t, i, ['lula-br', 'jair-bolsonaro-sc']));

describe('agrupar', () => {
  const pgrA = n('g1', 'Nunes Marques dá 10 dias para PGR se manifestar sobre nova revisão da condenação de Bolsonaro', 15);
  const pgrB = n('oglobo', 'Nunes Marques dá dez dias para PGR se manifestar sobre pedido de revisão da condenação de Bolsonaro', 15);
  const pedeA = n('g1', 'Jair Bolsonaro pede a Moraes para receber visita de Valdemar Costa Neto em prisão domiciliar', 12);
  const pedeB = n('oglobo', 'Bolsonaro pede a Moraes para receber Valdemar após fuga de Flávio para os EUA', 12);
  const autorizaA = n('g1', 'Alexandre de Moraes autoriza que Valdemar Costa Neto visite Bolsonaro em prisão domiciliar', 18);
  const autorizaB = n('oglobo', 'Em meio à crise provocada por fuga de Flávio, Moraes autoriza visita de Valdemar Costa Neto a Bolsonaro', 18);
  const g = agrupar([...ruido, pgrA, pgrB, pedeA, pedeB, autorizaA, autorizaB]);

  it('a mesma notícia em dois veículos vira um grupo, com a chave da mais antiga', () => {
    expect(g.get(pgrA.chave)).toBe(g.get(pgrB.chave));
    expect(g.get(pedeB.chave)).toBe(g.get(pedeA.chave));
  });
  it('fatos diferentes do mesmo assunto ficam separados (pedido × autorização)', () => {
    expect(g.get(pedeA.chave)).not.toBe(g.get(autorizaA.chave));
    expect(g.get(autorizaA.chave)).toBe(g.get(autorizaB.chave));
  });
  it('palavra que está em tudo no dia (Lula, Flávio, fuga) não junta notícia', () => {
    const grupos = new Set(ruido.map(r => g.get(r.chave)));
    expect(grupos.size).toBe(ruido.length);
  });
  it('duas matérias do mesmo veículo nunca se juntam', () => {
    const a = n('g1', 'Nunes Marques dá 10 dias para PGR sobre revisão da condenação de Bolsonaro', 15);
    const b = n('g1', 'Nunes Marques dá dez dias para PGR sobre revisão da condenação de Bolsonaro', 16);
    const r = agrupar([...ruido, a, b]);
    expect(r.get(a.chave)).not.toBe(r.get(b.chave));
  });
  it('sem político em comum, ou com mais de 36 h, não junta', () => {
    const a = n('g1', 'Nunes Marques dá 10 dias para PGR sobre revisão da condenação', 1, ['x']);
    const b = n('oglobo', 'Nunes Marques dá dez dias para PGR sobre revisão da condenação', 2, ['y']);
    const c = n('folha', 'Nunes Marques dá dez dias para PGR sobre revisão da condenação', 60, ['x']);
    const r = agrupar([...ruido, a, b, c]);
    expect(new Set([r.get(a.chave), r.get(b.chave), r.get(c.chave)]).size).toBe(3);
  });
  it('quem já tinha grupo mantém o grupo (chave estável entre coletas)', () => {
    const antigo = { ...pgrA, grupo: 'grupo-antigo' };
    const r = agrupar([...ruido, antigo, pgrB]);
    expect(r.get(antigo.chave)).toBe('grupo-antigo');
    expect(r.get(pgrB.chave)).toBe('grupo-antigo');
  });
});

describe('termos', () => {
  it('tira palavra vazia, acento e flexão; número por extenso vira algarismo', () => {
    expect(termos('Nunes Marques dá dez dias para a PGR')).toEqual(['nunes', 'marque', '10', 'dias', 'pgr']);
  });
});
