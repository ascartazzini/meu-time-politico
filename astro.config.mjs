// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Atualizar quando um domínio próprio for configurado no Vercel.
export default defineConfig({
  site: 'https://meu-time-politico.vercel.app',
  integrations: [sitemap()],
  build: { inlineStylesheets: 'auto' }
});
