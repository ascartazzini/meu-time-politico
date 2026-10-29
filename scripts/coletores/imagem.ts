/* Imagem de compartilhamento de uma matéria (og:image). Puro, coberto por tests/pecas.test.ts. */

const GENERICA = /imagem-padrao|default|placeholder|logo|share[-_]?padrao|og-image-site|fallback/i;
const entidade = (s: string) => s.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');

/** og:image (ou twitter:image) da matéria; ignora a imagem genérica do site e endereço sem https. */
export function imagemDoHtml(html: string): string | null {
  for (const nome of ['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const url = tag?.match(/content=["']([^"']+)["']/i)?.[1];
    if (url && /^https:\/\//.test(entidade(url)) && !GENERICA.test(url)) return entidade(url);
  }
  return null;
}
