import { describe, it, expect } from 'vitest';
import { indiceDeNomes, citados, lerRss, ehOpiniao, urlCanonica, dataRss, type Citavel } from '../scripts/coletores/citacoes';

const pessoas: Citavel[] = [
  { id: 'lula', nome: 'LUIZ INÁCIO LULA DA SILVA', nome_urna: 'LULA', cargos: ['presidente'] },
  { id: 'motta', nome: 'HUGO MOTTA WANDERLEY DA NOBREGA', nome_urna: 'MOTTA', cargos: ['deputado-federal'] },
  { id: 'marina-dep', nome: 'MARINA SOUZA', nome_urna: 'MARINA', cargos: ['senador'] },
  { id: 'zeze-sp', nome: 'JOSE ZEZE SP', nome_urna: 'PROFESSOR ZEZÉ', cargos: ['deputado-estadual'] },
  { id: 'zeze-mg', nome: 'JOSE ZEZE MG', nome_urna: 'PROFESSOR ZEZÉ', cargos: ['deputado-estadual'] },
  { id: 'tiao', nome: 'SEBASTIÃO ALVES PEREIRA', nome_urna: 'TIÃO', cargos: ['deputado-federal'] },
];
const idx = indiceDeNomes(pessoas);

describe('citados', () => {
  it('acha nome de urna com duas palavras, com e sem acento e caixa', () => {
    expect(citados('Hugo Motta pauta reforma', idx).map(c => c.id)).toEqual(['motta']);
    expect(citados('HUGO MOTTA diz que...', idx).map(c => c.id)).toEqual(['motta']);
  });
  it('nome de urna de uma palavra só vale pra cargo de destaque e fora dos prenomes comuns', () => {
    expect(citados('Lula sanciona lei', idx).map(c => c.id)).toEqual(['lula']);
    expect(citados('Marina fala na CPI', idx)).toEqual([]);
    expect(citados('Tião vota contra', idx)).toEqual([]);
  });
  it('não casa pedaço de palavra', () => {
    expect(citados('Lulalivre e Hugo Mottaes', idx)).toEqual([]);
  });
  it('partícula não conta como palavra: "Da Vitória" não casa com "a vitória de Lula"', () => {
    const i = indiceDeNomes([{ id: 'dv', nome: 'JOSE DA VITORIA SILVA SOUZA', nome_urna: 'DA VITÓRIA', cargos: ['deputado-federal'] }]);
    expect(citados('Partidos reafirmam legitimidade da vitória de Lula', i)).toEqual([]);
  });
  it('homônimo entre UFs não liga ninguém', () => {
    expect(citados('Professor Zezé apresenta projeto', idx)).toEqual([]);
  });
  it('nome civil completo liga com confiança alta', () => {
    const [c] = citados('Sebastião Alves Pereira foi multado', idx);
    expect(c.id).toBe('tiao');
    expect(c.confianca).toBeGreaterThan(0.9);
  });
});

describe('rss', () => {
  it('lê item com CDATA, entidade e data em português', () => {
    const xml = `<rss><channel><item><title><![CDATA[Hugo Motta &amp; o PL]]></title><link>https://g1.globo.com/politica/x.ghtml?utm_source=rss</link>
      <description>&lt;p&gt;linha fina&lt;/p&gt;</description><pubDate>Sex, 16 Out 2026 15:21:56 -0300</pubDate></item></channel></rss>`;
    const [n] = lerRss(xml);
    expect(n.titulo).toBe('Hugo Motta & o PL');
    expect(n.resumo).toBe('linha fina');
    expect(n.data).toBe('2026-10-16T18:21:56.000Z');
    expect(urlCanonica(n.url)).toBe('https://g1.globo.com/politica/x.ghtml');
  });
  it('descarta coluna, blog e opinião', () => {
    expect(ehOpiniao('https://www1.folha.uol.com.br/colunas/fulano/2026/10/x.shtml')).toBe(true);
    expect(ehOpiniao('https://oglobo.globo.com/blogs/x/post/2026/10/y.ghtml')).toBe(true);
    expect(ehOpiniao('https://g1.globo.com/politica/noticia/2026/10/28/x.ghtml')).toBe(false);
  });
  it('data inválida vira null', () => { expect(dataRss('ontem')).toBeNull(); });
});

describe('variantes do nome', () => {
  const idx2 = indiceDeNomes([
    { id: 'm', nome: 'MARIA DA SILVA', nome_urna: 'MARIA DO POVO', cargos: ['deputado-estadual'] },
    { id: 'k', nome: 'KIM PATROCA KATAGUIRI', nome_urna: 'KIM KATAGUIRI', cargos: ['deputado-federal'] },
  ]);
  it('prenome + nome de urna de uma palavra ("Hugo Motta", urna MOTTA) casa', () => {
    expect(citados('Hugo Motta pauta', idx).map(c => c.id)).toEqual(['motta']);
    expect(citados('Motta pauta', idx)).toEqual([]);
  });
  it('prenome + sobrenome comum não casa', () => {
    expect(citados('Maria Silva reclama', idx2)).toEqual([]);
  });
});
