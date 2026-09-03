// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Domínio canônico do site. Mudou? Ajustar também public/robots.txt, public/llms.txt e nginx.conf.
export const SITE = 'https://www.meutimepolitico.com';

// Páginas na raiz valem mais pro buscador; /sobre/ só redireciona (noindex) e não entra no sitemap.
const PRIORIDADE = { '/': 1.0, '/app/': 0.9, '/metodo/': 0.6 };

export default defineConfig({
  site: SITE,
  trailingSlash: 'always',
  integrations: [
    sitemap({
      filter: page => !page.endsWith('/sobre/'),
      serialize(item) {
        const caminho = new URL(item.url).pathname;
        item.lastmod = new Date().toISOString();
        item.changefreq = caminho === '/metodo/' ? 'weekly' : 'daily';
        item.priority = PRIORIDADE[caminho] ?? 0.5;
        return item;
      }
    })
  ],
  build: { inlineStylesheets: 'auto' }
});
