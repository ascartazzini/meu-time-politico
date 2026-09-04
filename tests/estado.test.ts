// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { carregar, codificar, decodificar, estadoVazio, idNaVaga, porNaVaga } from '../src/lib/estado';

describe('link compartilhável', () => {
  it('codifica e decodifica o estado sem perda, com as duas vagas de senador na ordem', () => {
    const st = { ...estadoVazio(), uf: 'SP', perfil: { renda: 'renda_1', saude: 'sus' }, respostas: { ir: 'F' as const, arma: 'N' as const }, decisivas: ['ir'], time: { presidente: ['p-lula'], senador: ['sen-1', 'sen-2'], federal: ['cam-74400'] } };
    const s = codificar(st);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodificar(s)).toEqual(st);
  });
  it('preserva vaga vazia no meio e descarta vazia no fim', () => {
    const st = { ...estadoVazio(), time: { senador: ['', 'sen-2'], federal: ['x', ''] } };
    expect(decodificar(codificar(st))?.time).toEqual({ senador: ['', 'sen-2'], federal: ['x'] });
  });
  it('ignora UF inválida no link', () => { expect(decodificar(codificar({ ...estadoVazio(), uf: 'xx' }))?.uf).toBeUndefined(); });
  it('tolera lixo', () => { expect(decodificar('%%%')).not.toBeUndefined(); expect(decodificar('')).toEqual(estadoVazio()); });
});

describe('vagas', () => {
  it('lê e escreve por vaga sem mexer nas outras', () => {
    const st = estadoVazio();
    porNaVaga(st, 'senador', 1, 'b');
    expect(st.time.senador).toEqual(['', 'b']);
    expect(idNaVaga(st, 'senador', 0)).toBeUndefined(); expect(idNaVaga(st, 'senador', 1)).toBe('b');
    porNaVaga(st, 'senador', 0, 'a'); expect(st.time.senador).toEqual(['a', 'b']);
    porNaVaga(st, 'senador', 1, undefined); expect(st.time.senador).toEqual(['a']);
    porNaVaga(st, 'senador', 0, undefined); expect(st.time.senador).toBeUndefined();
  });
  it('migra o estado salvo antes das duas vagas (um id por cargo) pra lista', () => {
    localStorage.setItem('mtp2026:v1', JSON.stringify({ uf: 'RS', perfil: {}, respostas: {}, decisivas: [], time: { presidente: 'p1', senador: ['s1', null], federal: 42 } }));
    expect(carregar()?.time).toEqual({ presidente: ['p1'], senador: ['s1'] });
  });
});
