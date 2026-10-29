import { describe, it, expect } from 'vitest';
import { normalizarLink, juntarLinks, principais } from '../scripts/links';

const n = (s: string) => normalizarLink(s, 'tse');

describe('normalizarLink', () => {
  it('URL em caixa alta do TSE vira URL limpa, classificada', () => {
    expect(n('HTTPS://WWW.INSTAGRAM.COM/JANEDELALIBERAOFICIAL/')).toEqual({ tipo: 'instagram', url: 'https://www.instagram.com/janedelaliberaoficial', fonte: 'tse' });
    expect(n('https://twitter.com/aluisiomendesma')?.url).toBe('https://x.com/aluisiomendesma');
    expect(n('WEB.FACEBOOK.COM/fulano?ref=bookmarks')?.url).toBe('https://www.facebook.com/fulano');
    expect(n('youtube.com/@canal')?.tipo).toBe('youtube');
  });
  it('rótulo escrito ("INSTAGRAM: @FULANO") vira perfil', () => {
    expect(n('INSTAGRAM: @BRANCODAPENAL')?.url).toBe('https://www.instagram.com/brancodapenal');
    expect(n('INSTAGRAN:@fulano')?.tipo).toBe('instagram');
    expect(n('TIKTOK: @fulano.oficial')?.url).toBe('https://www.tiktok.com/@fulano.oficial');
  });
  it('erro de digitação comum no domínio do Instagram é corrigido', () => {
    expect(n('https://instagran.com/fulano')?.url).toBe('https://www.instagram.com/fulano');
  });
  it('site próprio fica como site', () => {
    expect(n('fulano.com.br')).toEqual({ tipo: 'site', url: 'https://fulano.com.br', fonte: 'tse' });
  });
  it('WhatsApp, e-mail, agregador e vaquinha ficam de fora', () => {
    expect(n('https://wa.me/5561999999999')).toBeNull();
    expect(n('fulano@gmail.com')).toBeNull();
    expect(n('https://linktr.ee/fulano')).toBeNull();
    expect(n('https://queroapoiar.com.br/fulano')).toBeNull();
  });
  it('só o domínio da rede, ou post e vídeo soltos, não servem', () => {
    expect(n('https://www.instagram.com/')).toBeNull();
    expect(n('https://www.youtube.com/watch?v=abc')).toBeNull();
    expect(n('https://www.instagram.com/p/Cx123/')).toBeNull();
    expect(n('https://x.com/fulano/status/123')).toBeNull();
    expect(n('https://www.facebook.com/fulano/posts/123')).toBeNull();
    expect(n('https://www.youtube.com/@canal')?.tipo).toBe('youtube');
  });
});

describe('juntarLinks', () => {
  it('sem repetir URL e no máximo 3 por tipo, a primeira fonte ganha', () => {
    const r = juntarLinks([
      [{ tipo: 'instagram', url: 'https://www.instagram.com/a', fonte: 'camara' }],
      [{ tipo: 'instagram', url: 'https://www.instagram.com/A', fonte: 'tse' }, { tipo: 'instagram', url: 'https://www.instagram.com/b', fonte: 'tse' },
       { tipo: 'instagram', url: 'https://www.instagram.com/c', fonte: 'tse' }, { tipo: 'instagram', url: 'https://www.instagram.com/d', fonte: 'tse' }],
    ]);
    expect(r.map(l => `${l.fonte}:${l.url}`)).toEqual(['camara:https://www.instagram.com/a', 'tse:https://www.instagram.com/b', 'tse:https://www.instagram.com/c']);
  });
});

describe('principais', () => {
  it('um por rede: nome de urna e "oficial" vencem conta de comitê', () => {
    const r = principais([
      { tipo: 'instagram', url: 'https://www.instagram.com/geracaovida', fonte: 'tse-2026' },
      { tipo: 'instagram', url: 'https://www.instagram.com/lulaoficial', fonte: 'tse-2026' },
      { tipo: 'x', url: 'https://x.com/comitespop', fonte: 'tse-2026' },
    ], 'LULA');
    expect(r.map(l => l.url)).toEqual(['https://www.instagram.com/lulaoficial', 'https://x.com/comitespop']);
  });
  it('fonte oficial (Câmara) vence o que veio do TSE', () => {
    const r = principais([
      { tipo: 'x', url: 'https://x.com/fulano_oficial', fonte: 'tse-2026' },
      { tipo: 'x', url: 'https://x.com/fdm', fonte: 'camara' },
    ], 'FULANO');
    expect(r[0].url).toBe('https://x.com/fdm');
  });
  it('site: domínio próprio com o nome vence hospedagem gratuita', () => {
    const r = principais([
      { tipo: 'site', url: 'https://grupos-fulano-mg.pages.dev', fonte: 'tse-2026' },
      { tipo: 'site', url: 'https://fulanodetal.com.br/candidatos', fonte: 'tse-2026' },
    ], 'FULANO DE TAL');
    expect(r[0].url).toBe('https://fulanodetal.com.br/candidatos');
  });
});
