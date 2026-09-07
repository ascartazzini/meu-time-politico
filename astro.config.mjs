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
  // Sempre inline: os dois CSS eram render-blocking (~880ms simulados no 4G) e juntos não passam
  // de ~23 KB antes do gzip. Uma ida a menos no caminho crítico vale mais que o cache entre páginas.
  build: { inlineStylesheets: 'always' }
});
