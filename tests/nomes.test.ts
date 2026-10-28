import { describe, expect, it } from 'vitest';
import { canonizarSigla, normalizarNome, similaridadeNome } from '../src/lib/nomes';

describe('nomes', () => {
  it('normaliza acento, caixa e pontuação', () => { expect(normalizarNome("Manuela D'Ávila")).toBe('manuela d avila'); });
  it('casa nome de urna dentro do nome completo', () => {
    expect(similaridadeNome('Paulo Pimenta', 'Paulo Roberto Severo Pimenta')).toBe(0.8);
    expect(similaridadeNome('Marcel van Hattem', 'Marcel Van Hattem')).toBe(1);
    expect(similaridadeNome('Sanderson', 'Sanderson')).toBe(1);
    expect(similaridadeNome('Zucco', 'Tenente Coronel Zucco')).toBe(0);   // 1 token só não casa por contenção
    expect(similaridadeNome('Maria do Rosário', 'Maria Rosário Nunes')).toBe(0.8);
  });
  it('canoniza siglas', () => {
    const aliases = { 'UNIÃO BRASIL': 'UNIÃO', PODEMOS: 'PODE', 'PC DO B': 'PCdoB' };
    expect(canonizarSigla('União Brasil', aliases)).toBe('UNIÃO');
    expect(canonizarSigla('Podemos', aliases)).toBe('PODE');
    expect(canonizarSigla('pt', aliases)).toBe('PT');
  });
});

import { nomeBonito, cargoPrincipal, daUf, type EleitoBruto } from '../src/lib/eleitos';
describe('eleitos', () => {
  it('nomeBonito', () => {
    expect(nomeBonito('HUGO MOTTA DA NÓBREGA')).toBe('Hugo Motta da Nóbrega');
    expect(nomeBonito('CORONEL CHRISÓSTOMO')).toBe('Coronel Chrisóstomo');
    expect(nomeBonito('JÚLIO CÉSAR O JULIM DO LULA')).toBe('Júlio César o Julim do Lula');
  });
  const moro: EleitoBruto = { slug: 'sergio-moro-pr', nome: 'SERGIO FERNANDO MORO', nomeUrna: 'SERGIO MORO', partido: 'UNIÃO', uf: 'PR', fotoUrl: null, ids: {},
    mandatos: [{ cargo: 'senador', uf: 'PR', inicio: '2023-02-01', fim: '2031-01-31', eleicao: 2022 }, { cargo: 'governador', uf: 'PR', inicio: '2027-01-06', fim: '2031-01-06', eleicao: 2026 }] };
  it('cargo principal é o da eleição mais nova', () => { expect(cargoPrincipal(moro).cargo).toBe('governador'); });
  it('daUf inclui o presidente e só a UF pedida', () => {
    const lula: EleitoBruto = { ...moro, slug: 'lula-br', nomeUrna: 'LULA', uf: null, mandatos: [{ cargo: 'presidente', uf: null, inicio: '2027-01-05', fim: '2031-01-05', eleicao: 2026 }] };
    expect(daUf([moro, lula], 'SP').map(e => e.slug)).toEqual(['lula-br']);
    expect(daUf([moro, lula], 'PR').map(e => e.slug)).toEqual(['lula-br', 'sergio-moro-pr']);
  });
});
