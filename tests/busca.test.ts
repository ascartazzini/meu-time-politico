import { describe, it, expect } from 'vitest';
import { buscarPoliticos, sugestoes } from '../src/lib/busca';
import type { EleitoLeve } from '../src/lib/eleitos';

const g: EleitoLeve[] = [
  { slug: 'lula', nome: 'Lula', partido: 'PT', uf: null, cargo: 'presidente' },
  { slug: 'luciana', nome: 'Luciana Genro', partido: 'PSOL', uf: 'RS', cargo: 'deputado-estadual' },
  { slug: 'tabata', nome: 'Tabata Amaral', partido: 'PSB', uf: 'SP', cargo: 'deputado-federal' },
  { slug: 'moro', nome: 'Sergio Moro', partido: 'UNIÃO', uf: 'PR', cargo: 'governador' },
  { slug: 'sen-pr', nome: 'Flávio Arns', partido: 'PSB', uf: 'PR', cargo: 'senador' },
  { slug: 'sup-pr', nome: 'Fulano Suplente', partido: 'PL', uf: 'PR', cargo: 'senador', suplente: true },
  { slug: 'gil', nome: 'Gilberto Nascimento', partido: 'PSD', uf: 'SP', cargo: 'deputado-federal' },
  { slug: 'pt-sp', nome: 'Rui Falcão', partido: 'PT', uf: 'SP', cargo: 'deputado-federal' },
];
const slugs = (q: string, uf?: string) => buscarPoliticos(g, q, { uf }).map(e => e.slug);

describe('buscarPoliticos', () => {
  it('sem acento e pelo começo da palavra do nome', () => {
    expect(slugs('flavio')).toEqual(['sen-pr']);
    expect(slugs('ARNS')).toEqual(['sen-pr']);
    expect(slugs('')).toEqual([]);
  });
  it('quem começa igual vem antes; desempate pelo cargo', () => {
    expect(slugs('lu')).toEqual(['lula', 'luciana']);
  });
  it('partido, UF (sigla ou nome) e cargo combinam, em qualquer ordem', () => {
    expect(slugs('pt sp')).toEqual(['pt-sp']);
    expect(slugs('sp pt')).toEqual(['pt-sp']);
    expect(slugs('senador parana')).toEqual(['sen-pr', 'sup-pr']);
    expect(slugs('deputada sao paulo')).toEqual(['gil', 'pt-sp', 'tabata']);
  });
  it('sigla de partido não casa com pedaço de nome ("pt" não traz Gilberto)', () => {
    expect(slugs('pt')).toEqual(['lula', 'pt-sp']);
  });
  it('quem é do estado da pessoa sobe no desempate', () => {
    expect(slugs('psb')).toEqual(['sen-pr', 'tabata']);
    expect(slugs('psb', 'SP')).toEqual(['tabata', 'sen-pr']);
  });
  it('limite', () => {
    expect(buscarPoliticos(g, 'deputado', { limite: 2 })).toHaveLength(2);
  });
});

describe('sugestoes', () => {
  it('presidente, governador e senadores titulares do estado', () => {
    expect(sugestoes(g, 'PR').map(e => e.slug)).toEqual(['lula', 'moro', 'sen-pr']);
    expect(sugestoes(g, null).map(e => e.slug)).toEqual(['lula']);
  });
});
