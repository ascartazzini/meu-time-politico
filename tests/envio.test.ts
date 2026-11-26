import { describe, it, expect } from 'vitest';
import { assunto, mensagem, pendentes, linkSair, type Inscrito } from '../src/lib/envio';

const SITE = 'https://www.meutimepolitico.com';
const i = (id: string, email: string): Inscrito => ({ id, email, token: `tok-${id}` });

describe('mensagem', () => {
  const m = mensagem({
    html: '<p>oi</p><a href="{{descadastro}}">Sair</a> <a href="{{descadastro}}">de novo</a>',
    semana: '2026-11-23', inscrito: i('1', 'ana@x.com'), site: SITE, remetente: 'Meu Time <resumo@x.com>',
  });
  it('troca todo {{descadastro}} pelo link com o token da pessoa', () => {
    expect(m.html).not.toContain('{{descadastro}}');
    expect(m.html.split(`${SITE}/sair/?t=tok-1`).length - 1).toBe(2);
  });
  it('põe o cabeçalho List-Unsubscribe e o destinatário certo', () => {
    expect(m.headers['List-Unsubscribe']).toBe(`<${linkSair(SITE, 'tok-1')}>`);
    expect(m.to).toEqual(['ana@x.com']);
  });
  it('assunto com a data da semana', () => {
    expect(assunto('2026-11-23')).toBe('Resumo da semana de 23 de novembro — Meu Time Político');
  });
});

describe('pendentes', () => {
  const lista = [i('1', 'a@x.com'), i('2', 'b@x.com'), i('3', 'A@x.com'), i('4', 'c@x.com')];
  it('pula quem já recebeu e e-mail repetido', () => {
    expect(pendentes(lista, new Set(['2']), 100).map(p => p.id)).toEqual(['1', '4']);
  });
  it('respeita o limite do dia', () => {
    expect(pendentes(lista, new Set(), 2).map(p => p.id)).toEqual(['1', '2']);
    expect(pendentes(lista, new Set(), 0)).toEqual([]);
  });
});
