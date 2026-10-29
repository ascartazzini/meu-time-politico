import { describe, it, expect } from 'vitest';
import { separarReferencia, explicarEmenta, escolherTrechos, lerCompromisso, mancheteCurta } from '../src/lib/linguagem';

describe('separarReferencia', () => {
  it('separa o número do projeto da ementa', () => {
    expect(separarReferencia('PLP 186/2026: Altera a Lei Complementar nº 123')).toEqual({ ref: 'PLP 186/2026', texto: 'Altera a Lei Complementar nº 123' });
    expect(separarReferencia('PEC nº 221/2019 - Altera o art. 7º')).toEqual({ ref: 'PEC 221/2019', texto: 'Altera o art. 7º' });
    expect(separarReferencia('CTUR: Reunião Deliberativa')).toEqual({ ref: null, texto: 'CTUR: Reunião Deliberativa' });
  });
});

describe('explicarEmenta', () => {
  it('"Altera a Lei X, para Y" vira só o objetivo', () => {
    expect(explicarEmenta('Altera a Lei Complementar nº 123, de 14 de dezembro de 2006, para atualizar o limite de receita bruta anual do Microempreendedor Individual (MEI).'))
      .toBe('atualizar o limite de receita bruta anual do Microempreendedor Individual');
    expect(explicarEmenta('Altera o art. 7º da Constituição Federal para reduzir a duração máxima semanal do trabalho e prever 2 (dois) dias de repouso semanal remunerado; e dá outras providências.'))
      .toBe('reduzir a duração máxima semanal do trabalho e prever 2 dias de repouso semanal remunerado');
  });
  it('verbo jurídico vira verbo comum, no infinitivo', () => {
    expect(explicarEmenta('Institui feriado nacional no primeiro dia útil após as eleições e dá outras providências.')).toBe('criar feriado nacional no primeiro dia útil após as eleições');
    expect(explicarEmenta('Dispõe sobre a proibição de propaganda em escolas.')).toBe('tratar da proibição de propaganda em escolas');
    expect(explicarEmenta('Susta os efeitos do Decreto nº 12.345, de 2 de maio de 2026.')).toBe('derrubar os efeitos do Decreto 12.345/2026');
    expect(explicarEmenta('Autoriza a concessão de apoio financeiro aos produtores.')).toBe('autorizar a concessão de apoio financeiro aos produtores');
    expect(explicarEmenta('Altera a Lei nº 9.029, de 13 de abril de 1995, para tipificar o crime de assédio eleitoral.')).toBe('criar o crime de assédio eleitoral');
  });
  it('lei com nome próprio aparece pelo nome; detalhe técnico depois de "e altera" sai da manchete', () => {
    expect(explicarEmenta('Revoga a Lei nº 13.105, de 16 de março de 2015 (Código de Processo Civil).')).toBe('revogar o Código de Processo Civil');
    expect(explicarEmenta('Dispõe sobre medidas de proteção à mulher, e altera a Lei nº 11.340, de 7 de agosto de 2006.')).toBe('tratar de medidas de proteção à mulher');
  });
  it('corta manchete longa em vírgula ou palavra, com reticências', () => {
    const m = explicarEmenta(`Institui ${'a política nacional de coisas importantes, '.repeat(8)}e outras.`);
    expect(m.length).toBeLessThanOrEqual(151);
    expect(m.endsWith('…')).toBe(true);
  });
});

describe('escolherTrechos', () => {
  const discurso = `    O SR. FULANO DE TAL (Bloco/PSD - BA. Para discutir.) – Obrigado, Presidente.

    Agradeço a V. Exa. pela oportunidade de falar nesta tarde tão importante para o país e para o trabalhador.

    Eu dava plantão de 24 horas no pronto-socorro e complementava com mais dez horas no ambulatório, com carteira assinada.

    O SR. CICRANO (PL - SP) – Permite um aparte? Eu discordo completamente de tudo o que foi dito aqui hoje nesta tribuna, Senador.

    O SR. FULANO DE TAL (Bloco/PSD - BA) – Nós precisamos aprovar a redução da jornada para que o trabalhador tenha dois dias de descanso por semana. (Palmas.)

    Muito obrigado.`;
  const t = escolherTrechos(discurso);
  it('só frases literais de quem discursou, sem cerimonial nem aparte', () => {
    expect(t).toEqual([
      'Eu dava plantão de 24 horas no pronto-socorro e complementava com mais dez horas no ambulatório, com carteira assinada.',
      'Nós precisamos aprovar a redução da jornada para que o trabalhador tenha dois dias de descanso por semana.',
    ]);
    for (const f of t) expect(discurso.replace(/\s+/g, ' ')).toContain(f);
  });
});

describe('lerCompromisso', () => {
  it('lista de "Cargo, Nome" vira encontro com cada pessoa', () => {
    const c = lerCompromisso('Presidente do Senado Federal, Senador Davi Alcolumbre, e Presidente da Câmara dos Deputados, Deputado Hugo Motta');
    expect(c.modo).toBe('encontro');
    expect(c.participantes).toEqual([
      { cargo: 'Presidente do Senado Federal', nome: 'Davi Alcolumbre' },
      { cargo: 'Presidente da Câmara dos Deputados', nome: 'Hugo Motta' },
    ]);
    expect(c.manchete).toBe('Encontro com o presidente do Senado Federal, Davi Alcolumbre e o presidente da Câmara dos Deputados, Hugo Motta');
    expect(mancheteCurta(c.modo, c.participantes, c.manchete)).toBe('Encontro com o presidente do Senado Federal e o presidente da Câmara dos Deputados');
  });
  it('telefonema, com artigo no feminino', () => {
    const c = lerCompromisso('Telefonema com a Presidenta do México, Claudia Sheinbaum');
    expect(c.modo).toBe('telefonema');
    expect(c.participantes).toEqual([{ cargo: 'Presidenta do México', nome: 'Claudia Sheinbaum' }]);
    expect(c.manchete).toBe('Telefonema com a presidenta do México, Claudia Sheinbaum');
  });
  it('viagem e cerimônia ficam como estão, sem participante inventado', () => {
    expect(lerCompromisso('Partida para Brasília')).toEqual({ modo: 'deslocamento', manchete: 'Partida para Brasília', participantes: [] });
    expect(lerCompromisso('Cerimônia de Promulgação da PEC 6x1').modo).toBe('evento');
  });
});
