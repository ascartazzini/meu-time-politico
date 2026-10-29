import { describe, it, expect } from 'vitest';
import { montarEdicao, htmlEmail, segundaDaSemana, type NoticiaEntrada, type PautaEntrada } from '../src/lib/edicao';

const agora = new Date('2026-10-30T15:00:00Z');   // sexta
const not = (grupo: string, fonte: string, quando: string, reacoes = 0, politicos = ['lula-br']): NoticiaEntrada =>
  ({ grupo, titulo: `${grupo} ${fonte}`, url: `https://${fonte}.com/${grupo}`, fonte, quando, politicos, reacoes });

describe('segundaDaSemana', () => {
  it('sexta e domingo caem na segunda anterior (horário de Brasília)', () => {
    expect(segundaDaSemana(agora)).toBe('2026-10-26');
    expect(segundaDaSemana(new Date('2026-11-02T02:00:00Z'))).toBe('2026-10-26');   // domingo 23h em Brasília
  });
});

describe('montarEdicao', () => {
  const ed = montarEdicao({
    agora,
    noticias: [
      not('a', 'G1', '2026-10-28T12:00:00Z'), not('a', 'Folha', '2026-10-28T13:00:00Z'), not('a', 'O Globo', '2026-10-28T14:00:00Z'),
      not('b', 'G1', '2026-10-29T12:00:00Z', 50),
      not('c', 'Folha', '2026-10-29T12:00:00Z', 2), not('c', 'Estadão', '2026-10-29T13:00:00Z'),
      not('velha', 'G1', '2026-10-10T12:00:00Z', 999), not('velha', 'Folha', '2026-10-10T12:00:00Z'), not('velha', 'O Globo', '2026-10-10T12:00:00Z'),
    ],
    pauta: [
      { casa: 'camara', quando: '2026-11-03T17:00:00Z', sessao: 'x', materia: 'PL 1/2026', ementa: 'Um', url: 'u1' },
      { casa: 'camara', quando: '2026-11-03T18:00:00Z', sessao: 'x', materia: 'PL 1/2026', ementa: 'Um', url: 'u1' },
      { casa: 'senado', quando: '2026-11-04T17:00:00Z', sessao: 'x', materia: 'PEC 2/2026', ementa: null, url: 'u2' },
      { casa: 'senado', quando: '2026-10-29T17:00:00Z', sessao: 'x', materia: 'PL 9/2026', ementa: null, url: 'u3' },
    ] satisfies PautaEntrada[],
    marcos: [
      { data: '2026-12-22', titulo: 'Fim da sessão', detalhe: 'd', fonte: 'CF' },
      { data: '2027-02-01', titulo: 'Posse', detalhe: 'd', fonte: 'CF' },
    ],
    nomes: new Map([['lula-br', 'Lula']]),
  });

  it('notícias: só da semana, uma por grupo, mais veículos primeiro e reação desempata', () => {
    expect(ed.noticias.map(n => n.titulo)).toEqual(['a G1', 'c Folha', 'b G1']);
    expect(ed.noticias[0].outras.map(o => o.fonte)).toEqual(['Folha', 'O Globo']);
    expect(ed.noticias[0].politicos).toEqual([{ slug: 'lula-br', nome: 'Lula' }]);
  });
  it('pauta: só daqui pra frente, por dia e casa, sem repetir matéria', () => {
    expect(ed.pauta).toEqual([
      { dia: '2026-11-03', casa: 'camara', itens: [{ materia: 'PL 1/2026', ementa: 'Um', url: 'u1' }] },
      { dia: '2026-11-04', casa: 'senado', itens: [{ materia: 'PEC 2/2026', ementa: null, url: 'u2' }] },
    ]);
  });
  it('marcos: só os próximos 60 dias, com quantos faltam', () => {
    expect(ed.marcos.map(m => [m.titulo, m.faltam])).toEqual([['Fim da sessão', 53]]);
  });
  it('e-mail: tem os quatro blocos, escapa HTML e deixa o descadastro pra quem envia', () => {
    const h = htmlEmail({ ...ed, noticias: [{ ...ed.noticias[0], titulo: '<b>x</b>' }] }, 'https://www.meutimepolitico.com');
    for (const t of ['As notícias da semana', 'Votações pela frente', 'Marcos que vêm aí', 'Cobre quem você elegeu', '{{descadastro}}']) expect(h).toContain(t);
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).toContain('https://www.meutimepolitico.com/politico/lula-br/');
  });
  it('sem pauta publicada, o e-mail avisa em vez de ficar vazio', () => {
    expect(htmlEmail({ ...ed, pauta: [] }, 'https://x')).toContain('ainda não publicaram a pauta');
  });
});
