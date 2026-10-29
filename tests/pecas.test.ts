import { describe, it, expect } from 'vitest';
import { peca, type ItemPeca } from '../src/lib/pecas';
import { imagemDoHtml } from '../scripts/coletores/imagem';
import type { EleitoLeve } from '../src/lib/eleitos';

const gente = new Map<string, EleitoLeve>([
  ['lula-br', { slug: 'lula-br', nome: 'Lula', partido: 'PT', uf: null, cargo: 'presidente', foto: 'https://x/lula.jpg' }],
  ['fulano-sp', { slug: 'fulano-sp', nome: 'Fulano', partido: 'PL', uf: 'SP', cargo: 'deputado-federal' }],
]);
const base = (o: Partial<ItemPeca>): ItemPeca => ({
  id: '1', fonte_id: 'x', fonte_nome: 'Fonte', natureza: 'oficial', tipo: 'noticia', titulo: 'Título', resumo: null, resumo_ia: false,
  url: 'https://fonte/1', quando: '2026-10-28T17:00:00Z', local: null, dados: {}, politicos: [], n_politicos: 1, outras_fontes: null, ...o,
});

describe('peça de notícia', () => {
  it('capa com a foto da matéria e os outros veículos embaixo', () => {
    const h = peca(base({ tipo: 'noticia', natureza: 'imprensa', fonte_nome: 'O Globo', titulo: 'Manchete <b>', dados: { imagem: 'https://img/1.jpg' },
      outras_fontes: [{ fonte: 'Folha', url: 'https://folha/1', titulo: 't' }] }), gente);
    expect(h).toContain('capa com-foto');
    expect(h).toContain('https://img/1.jpg');
    expect(h).toContain('Manchete &lt;b&gt;');
    expect(h).toContain('Também na capa de');
    expect(h).not.toContain('ligado pelo nome');
  });
  it('sem foto vira capa de papel', () => {
    expect(peca(base({ tipo: 'noticia' }), gente)).toContain('capa sem-foto');
  });
});

describe('peça de projeto e votação', () => {
  it('projeto: o que quer em linguagem comum, número e ementa embaixo', () => {
    const h = peca(base({ tipo: 'proposicao', titulo: 'PL 1/2026: Institui o Dia do Teste.', dados: { casa: 'camara', siglaTipo: 'PL', autores: 1 } }), gente,
      { slug: 'fulano-sp', papel: 'autor', metodo: 'id-oficial', confianca: 1 });
    expect(h).toContain('<span class="quer">Quer</span> criar o Dia do Teste');
    expect(h).toContain('<b>PL 1/2026</b>');
    expect(h).toContain('Institui o Dia do Teste.');
  });
  it('votação do Senado: carimbo, placar e o voto da pessoa', () => {
    const h = peca(base({ tipo: 'voto', titulo: 'PEC 2/2026: Altera o art. 7º da Constituição Federal para reduzir a jornada.', dados: { casa: 'senado', resultado: 'A', sim: 61, nao: 10 } }), gente,
      { slug: 'fulano-sp', papel: 'Não', metodo: 'id-oficial', confianca: 1 });
    expect(h).toContain('Aprovado');
    expect(h).toContain('Passou: reduzir a jornada');
    expect(h).toContain('<b>61</b> sim');
    expect(h).toContain('votou NÃO');
  });
});

describe('peça de presença', () => {
  it('plenário: total da sessão e o rosto de quem faltou', () => {
    const h = peca(base({ tipo: 'presenca', dados: { casa: 'camara', plenario: true, presentes: 485, esperados: 512 },
      politicos: [{ slug: 'fulano-sp', papel: 'ausente', metodo: 'id-oficial', confianca: 1 }], n_politicos: 400 }), gente);
    expect(h).toContain('<b>485</b><span>de 512 deputados');
    expect(h).toContain('faltaram');
    expect(h).toContain('href="/politico/fulano-sp/"');
  });
  it('a pessoa que faltou leva o carimbo', () => {
    const h = peca(base({ tipo: 'presenca', dados: { plenario: true, presentes: 485 } }), gente, { slug: 'fulano-sp', papel: 'ausente', metodo: 'id-oficial', confianca: 1 });
    expect(h).toContain('>Faltou<');
    expect(h).toContain('de 513 deputados');
  });
});

describe('peça de discurso e de agenda', () => {
  it('discurso: resumo oficial e um slide por trecho literal', () => {
    const h = peca(base({ tipo: 'discurso', titulo: 'Fulano — Discurso (Sessão)', resumo: 'Defesa da PEC.', dados: { trechos: ['Frase um.', 'Frase dois.'] } }), gente,
      { slug: 'fulano-sp', papel: 'autor', metodo: 'id-oficial', confianca: 1 });
    expect(h.match(/class="slide/g)).toHaveLength(3);
    expect(h).toContain('data-n="2/3"');
    expect(h).toContain('trecho literal do discurso');
    expect(h).toContain('Resumo oficial do Senado');
  });
  it('agenda: rosto do dono e de quem veio, manchete sem repetir o nome', () => {
    const h = peca(base({ tipo: 'agenda', titulo: 'Ministra da Casa Civil, Miriam Belchior', agenda_natureza: 'publica',
      dados: { participantes: [{ cargo: 'Ministra da Casa Civil', nome: 'Miriam Belchior', foto: 'https://w/m.jpg', foto_fonte: 'https://pt.wikipedia.org/wiki/M' }] } }), gente,
      { slug: 'lula-br', papel: 'agenda', metodo: 'id-oficial', confianca: 1 });
    expect(h).toContain('https://x/lula.jpg');
    expect(h).toContain('https://w/m.jpg');
    expect(h).toContain('Encontro com a ministra da Casa Civil</p>');
    expect(h).toContain('compromisso público');
    expect(h).toContain('fotos: Wikipédia');
  });
});

describe('imagemDoHtml', () => {
  it('pega og:image e ignora imagem genérica do site', () => {
    expect(imagemDoHtml('<meta property="og:image" content="https://a.com/f.jpg?x=1&amp;y=2">')).toBe('https://a.com/f.jpg?x=1&y=2');
    expect(imagemDoHtml('<meta content="https://a.com/f.jpg" property="og:image" />')).toBe('https://a.com/f.jpg');
    expect(imagemDoHtml('<meta property="og:image" content="https://camara.leg.br/imagem-padrao.jpg">')).toBeNull();
    expect(imagemDoHtml('<meta property="og:image" content="http://inseguro/f.jpg">')).toBeNull();
  });
});
