import { describe, it, expect } from 'vitest';
import { linhasDoPlacar, desdeEmTexto, type PlacarMandato } from '../src/lib/mandato';

const zero: PlacarMandato = {
  desde: null, plenario_esteve: 0, plenario_faltou: 0, comissoes: 0, votos: 0, votos_faltou: 0, votos_justificado: 0,
  projetos_autor: 0, projetos_coautor: 0, discursos: 0, imprensa: 0, agenda: { publica: 0, privada: 0, partidaria: 0, pessoal: 0, sem: 0 },
};

describe('linhasDoPlacar', () => {
  it('sem dado, sem linha (nada de zero inventado)', () => { expect(linhasDoPlacar(zero)).toEqual([]); });
  it('presença com porcentagem e tom ruim acima de 20% de falta', () => {
    const [l] = linhasDoPlacar({ ...zero, plenario_esteve: 7, plenario_faltou: 3 });
    expect(l.valor).toBe('7 de 10 · 70%');
    expect(l.tom).toBe('ruim');
    expect(linhasDoPlacar({ ...zero, plenario_esteve: 9, plenario_faltou: 1 })[0].tom).toBe('bom');
  });
  it('licença não entra no denominador das votações', () => {
    const [l] = linhasDoPlacar({ ...zero, votos: 8, votos_faltou: 2, votos_justificado: 3 });
    expect(l.valor).toBe('votou em 8 de 10');
    expect(l.nota).toContain('3 com ausência justificada');
  });
  it('agenda lista só as naturezas que existem', () => {
    const [l] = linhasDoPlacar({ ...zero, agenda: { publica: 4, privada: 1, partidaria: 0, pessoal: 0, sem: 2 } });
    expect(l.nota).toBe('4 pública · 1 setor privado / sociedade · 2 sem classificação');
  });
  it('avisa desde quando conta', () => {
    expect(desdeEmTexto(null)).toBe('Ainda não há nada coletado.');
    expect(desdeEmTexto('2026-10-16T12:00:00Z')).toContain('16 de outubro de 2026');
  });
});

import { destaquesDoPlacar } from '../src/lib/mandato';
describe('destaquesDoPlacar', () => {
  it('presença vira porcentagem com tom; sem dado, sem bloco', () => {
    expect(destaquesDoPlacar(zero)).toEqual([]);
    const [d] = destaquesDoPlacar({ ...zero, plenario_esteve: 3, plenario_faltou: 1 });
    expect(d).toMatchObject({ numero: 75, sufixo: '%', tom: 'ruim' });
  });
  it('singular e plural', () => {
    expect(destaquesDoPlacar({ ...zero, projetos_autor: 1 })[0].rotulo).toBe('projeto apresentado');
    expect(destaquesDoPlacar({ ...zero, imprensa: 5 })[0].rotulo).toBe('notícias nos grandes veículos');
  });
});
