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
