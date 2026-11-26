import { describe, it, expect } from 'vitest';
import { Acumulador, leitura, mediana, valorTse, reaisCurto, type Campanha } from '../src/lib/campanha';

const desp = (o: Partial<Record<string, string>>) => ({
  TP_PRESTACAO_CONTAS: 'Final', DT_PRESTACAO_CONTAS: '03/11/2026', DS_ORIGEM_DESPESA: 'Combustíveis e lubrificantes',
  CD_TIPO_FORNECEDOR: '1', NR_CPF_CNPJ_FORNECEDOR: '11111111000111', NM_FORNECEDOR: 'POSTO X', NM_FORNECEDOR_RFB: 'POSTO X LTDA',
  VR_DESPESA_CONTRATADA: '100,00', ...o,
}) as Record<string, string>;
const rec = (o: Partial<Record<string, string>>) => ({
  TP_PRESTACAO_CONTAS: 'FINAL', DT_PRESTACAO_CONTAS: '03/11/2026', DS_FONTE_RECEITA: 'FUNDO ESPECIAL',
  DS_ORIGEM_RECEITA: 'Recursos de partido político', DS_NATUREZA_RECEITA: 'FINANCEIRO', VR_RECEITA: '1000,00', ...o,
}) as Record<string, string>;

describe('valorTse', () => {
  it('lê vírgula decimal e milhar com ponto', () => {
    expect(valorTse('3000,00')).toBe(3000);
    expect(valorTse('1.234,56')).toBe(1234.56);
    expect(valorTse('#NULO')).toBe(0);
  });
});

describe('Acumulador', () => {
  it('soma itens do mesmo documento e agrupa empresa pelo CNPJ, com o nome da Receita', () => {
    const a = new Acumulador();
    a.despesaContratada(desp({ VR_DESPESA_CONTRATADA: '3946,80' }));
    a.despesaContratada(desp({ VR_DESPESA_CONTRATADA: '3159,25', NM_FORNECEDOR: 'posto x' }));
    const c = a.resumo();
    expect(c.despesas.total).toBe(7106.05);
    expect(c.despesas.empresas).toEqual([['POSTO X LTDA', 7106.05, '11111111000111']]);
  });

  it('matriz e filial (mesma raiz do CNPJ) somam como uma empresa', () => {
    const a = new Acumulador();
    a.despesaContratada(desp({ NR_CPF_CNPJ_FORNECEDOR: '55474736000193', VR_DESPESA_CONTRATADA: '400,00' }));
    a.despesaContratada(desp({ NR_CPF_CNPJ_FORNECEDOR: '55474736000274', VR_DESPESA_CONTRATADA: '200,00' }));
    expect(a.resumo().despesas.empresas).toEqual([['POSTO X LTDA', 600, '55474736000193']]);
  });

  it('pessoa física entra só somada: sem nome, conta pessoas distintas pelo CPF', () => {
    const a = new Acumulador();
    a.despesaContratada(desp({ CD_TIPO_FORNECEDOR: '0', NR_CPF_CNPJ_FORNECEDOR: '123', NM_FORNECEDOR: 'FULANO', DS_ORIGEM_DESPESA: 'Atividades de militância e mobilização de rua', VR_DESPESA_CONTRATADA: '2500,00' }));
    a.despesaContratada(desp({ CD_TIPO_FORNECEDOR: '0', NR_CPF_CNPJ_FORNECEDOR: '123', NM_FORNECEDOR: 'FULANO', DS_ORIGEM_DESPESA: 'Atividades de militância e mobilização de rua', VR_DESPESA_CONTRATADA: '500,00' }));
    a.despesaContratada(desp({ CD_TIPO_FORNECEDOR: '0', NR_CPF_CNPJ_FORNECEDOR: '456', NM_FORNECEDOR: 'BELTRANO', DS_ORIGEM_DESPESA: 'Atividades de militância e mobilização de rua', VR_DESPESA_CONTRATADA: '1000,00' }));
    const c = a.resumo();
    expect(c.despesas.pessoas).toEqual({ valor: 4000, quantas: 2 });
    expect(c.despesas.empresas).toEqual([]);
    expect(JSON.stringify(c)).not.toMatch(/FULANO|BELTRANO|123/);
  });

  it('linha zerada (declaração sem movimento) não conta, mas registra a prestação', () => {
    const a = new Acumulador();
    a.despesaContratada(desp({ VR_DESPESA_CONTRATADA: '0,00', DS_ORIGEM_DESPESA: '#NULO', CD_TIPO_FORNECEDOR: '-1' }));
    const c = a.resumo();
    expect(c.despesas.total).toBe(0);
    expect(c.despesas.porTipo).toEqual([]);
    expect(c.prestacao).toBe('Final');
    expect(c.entregueEm).toBe('2026-11-03');
  });

  it('tipos pequenos viram "Outros"', () => {
    const a = new Acumulador();
    ['A', 'B', 'C'].forEach((t, i) => a.despesaContratada(desp({ DS_ORIGEM_DESPESA: t, VR_DESPESA_CONTRATADA: String(30 - i * 10) })));
    expect(a.resumo(2).despesas.porTipo).toEqual([['A', 30], ['B', 20], ['Outros', 10]]);
  });

  it('receita: separa fundo eleitoral, partidário e outros; marca o estimável', () => {
    const a = new Acumulador();
    a.receitaLinha(rec({}));
    a.receitaLinha(rec({ DS_FONTE_RECEITA: 'FUNDO PARTIDARIO', VR_RECEITA: '500,00' }));
    a.receitaLinha(rec({ DS_FONTE_RECEITA: 'OUTROS RECURSOS', DS_ORIGEM_RECEITA: 'Recursos de pessoas físicas', DS_NATUREZA_RECEITA: 'ESTIMÁVEL', VR_RECEITA: '7000,00' }));
    const c = a.resumo();
    expect(c.receitas.total).toBe(8500);
    expect(c.receitas.porFonte).toEqual({ fundoEleitoral: 1000, fundoPartidario: 500, outros: 7000 });
    expect(c.receitas.porOrigem).toEqual([['Recursos de pessoas físicas', 7000], ['Recursos de partido político', 1500]]);
    expect(c.receitas.estimavel).toBe(7000);
  });

  it('fica com a prestação mais completa (final vence parcial e relatório)', () => {
    const a = new Acumulador();
    a.receitaLinha(rec({ TP_PRESTACAO_CONTAS: 'FINAL', DT_PRESTACAO_CONTAS: '01/11/2026' }));
    a.receitaLinha(rec({ TP_PRESTACAO_CONTAS: 'RELATÓRIO FINANCEIRO', DT_PRESTACAO_CONTAS: '20/11/2026' }));
    expect(a.resumo().prestacao).toBe('Final');
    expect(a.resumo().entregueEm).toBe('2026-11-01');
  });
});

describe('leitura', () => {
  const camp = (gasto: number, fundo = 0, outros = 0): Campanha => ({
    prestacao: 'Final', entregueEm: '2026-11-03',
    despesas: { total: gasto, porTipo: [], empresas: [], pessoas: { valor: 0, quantas: 0 } },
    receitas: { total: fundo + outros, porFonte: { fundoEleitoral: fundo, fundoPartidario: 0, outros }, porOrigem: [], estimavel: 0 },
  });
  const cs = { a: camp(100, 75, 25), b: camp(300), c: camp(200), d: camp(900), x: camp(5000) };
  const pares = [
    { sq: 'a', cargo: 'deputado-federal', uf: 'AC' }, { sq: 'b', cargo: 'deputado-federal', uf: 'AC' },
    { sq: 'c', cargo: 'deputado-federal', uf: 'AC' }, { sq: 'd', cargo: 'deputado-federal', uf: 'AC' },
    { sq: 'x', cargo: 'deputado-federal', uf: 'SP' }, { sq: 'sem', cargo: 'deputado-federal', uf: 'AC' },
  ];

  it('compara com os eleitos do mesmo cargo e UF (quem não prestou contas fica fora da conta)', () => {
    const l = leitura(pares[0], pares, cs)!;
    expect(l.comparacao).toEqual({ mediana: 250, posicao: 4, de: 4 });
    expect(l.publicoPct).toBe(75);
  });
  it('sem pares suficientes, sem comparação', () => {
    expect(leitura(pares[4], pares, cs)!.comparacao).toBeNull();
  });
  it('sem prestação, null (a página diz que não achou, não inventa zero)', () => {
    expect(leitura(pares[5], pares, cs)).toBeNull();
  });
  it('mediana', () => {
    expect(mediana([3, 1, 2])).toBe(2);
    expect(mediana([4, 1, 2, 3])).toBe(2.5);
  });
});

describe('reaisCurto', () => {
  it('formata em mil e milhão', () => {
    expect(reaisCurto(930)).toBe('R$ 930');
    expect(reaisCurto(85_300)).toBe('R$ 85 mil');
    expect(reaisCurto(1_234_000)).toBe('R$ 1,23 mi');
    expect(reaisCurto(25_400_000)).toBe('R$ 25,4 mi');
  });
});
