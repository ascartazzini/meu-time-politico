// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { codificar, decodificar, estadoVazio } from '../src/lib/estado';

describe('link compartilhável', () => {
  it('codifica e decodifica o estado sem perda', () => {
    const st = { ...estadoVazio(), uf: 'SP', perfil: { renda: 'renda_1', saude: 'sus' }, respostas: { ir: 'F' as const, arma: 'N' as const }, decisivas: ['ir'], time: { presidente: 'p-lula', federal: 'cam-74400' } };
    const s = codificar(st);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodificar(s)).toEqual(st);
  });
  it('ignora UF inválida no link', () => { expect(decodificar(codificar({ ...estadoVazio(), uf: 'xx' }))?.uf).toBeUndefined(); });
  it('tolera lixo', () => { expect(decodificar('%%%')).not.toBeUndefined(); expect(decodificar('')).toEqual(estadoVazio()); });
});
