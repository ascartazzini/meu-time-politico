/* Imagem de compartilhamento de cada eleito: uma foto (1200x630) da abertura da própria página, como ela
   aparece no site, sem a barra do topo, os botões e o "role pra ver". Abre a página num Chrome local
   (puppeteer-core, sem baixar navegador), tira a foto em JPEG e sobe pro bucket público `og` do Supabase.
   Grava src/data/generated/og.json (slug → versão); a página só usa a imagem de quem está lá, e o ?v=
   muda quando muda o que aparece na abertura (WhatsApp guarda a imagem pelo endereço).
   Só refaz quem mudou. Uso: npm run og [-- --base=http://localhost:4321] [-- --todos] [-- --so=slug,slug] */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer, { type Browser } from 'puppeteer-core';
import { GERADO, lerJsonSeExistir, escreverJson } from './util';
import { eleitos } from '../src/data/cadastro';
import { cargoPrincipal } from '../src/lib/eleitos';
import { emLotes } from './coletores/banco';

const VERSAO = 1;   // muda quando muda o desenho da imagem: refaz todas
const ARQ = resolve(GERADO, 'og.json');
const URL_BASE = process.env.SUPABASE_URL ?? 'https://zclxjwbpfgompypncvol.supabase.co';
const CHAVE = process.env.SUPABASE_SECRET_KEY!;
const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const BASE = (arg('base') ?? 'https://www.meutimepolitico.com').replace(/\/$/, '');
const CHROME = process.env.CHROME ?? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find(c => existsSync(c));

// Só a abertura, do tamanho da imagem; o domínio entra no lugar dos botões.
const CSS = `
  .topo, .lp-barra, .lp-rolar, .lp-acoes { display: none !important }
  main:has(.lp-hero) { padding-top: 0 !important }
  .lp-hero .lp-in { min-height: 630px !important; padding-top: 48px !important; padding-bottom: 48px !important }
  .lp-og { margin-top: 28px; font: 700 22px/1 Barlow, sans-serif; letter-spacing: .04em; color: #FFD100 }`;

const versao = (e: (typeof eleitos)[number]) => createHash('sha1')
  .update(JSON.stringify([VERSAO, e.nomeUrna, e.nome, e.partido, e.uf, e.fotoUrl, cargoPrincipal(e)])).digest('hex').slice(0, 10);

async function foto(browser: Browser, slug: string): Promise<Buffer> {
  const p = await browser.newPage();
  try {
    await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await p.goto(`${BASE}/politico/${slug}/`, { waitUntil: 'networkidle2', timeout: 45_000 });
    await p.addStyleTag({ content: CSS });
    await p.evaluate(async () => {
      document.querySelector('.lp-hero .lp-sub')?.insertAdjacentHTML('afterend', '<p class="lp-og">meutimepolitico.com</p>');
      const img = document.querySelector<HTMLImageElement>('.lp-foto img');
      if (img && !img.complete) await new Promise(r => { img.onload = img.onerror = r; setTimeout(r, 8000); });
      await document.fonts.ready;
      // nome comprido quebra em quatro linhas e passa de 630px: diminui a letra até a abertura caber
      const nome = document.querySelector<HTMLElement>('.lp-nome'), hero = document.querySelector<HTMLElement>('.lp-hero .lp-in');
      for (let px = parseFloat(getComputedStyle(nome!).fontSize); hero!.offsetHeight > 630 && px > 48; px -= 6) nome!.style.fontSize = `${px - 6}px`;
      window.scrollTo(0, 0);
    });
    const caixa = await (await p.$('.lp-hero'))!.boundingBox();
    return Buffer.from(await p.screenshot({ type: 'jpeg', quality: 84, clip: { x: 0, y: caixa!.y, width: 1200, height: 630 } }));
  } finally { await p.close(); }
}

async function subir(slug: string, jpg: Buffer) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/og/${slug}.jpg`, {
    method: 'POST', body: jpg,
    headers: { apikey: CHAVE, ...(CHAVE.startsWith('eyJ') ? { Authorization: `Bearer ${CHAVE}` } : {}),
      'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'Cache-Control': 'max-age=604800' },
  });
  if (!r.ok) throw new Error(`upload ${slug}: HTTP ${r.status} ${await r.text()}`);
}

async function main() {
  if (!CHROME) throw new Error('Chrome não encontrado; aponte com CHROME=/caminho/do/chrome');
  const antes = lerJsonSeExistir<{ imagens: Record<string, string> }>(ARQ)?.imagens ?? {};
  const so = arg('so');
  const alvo = eleitos.filter(e => (so ? so.split(',').includes(e.slug) : process.argv.includes('--todos') || antes[e.slug] !== versao(e)));
  console.log(`▶ Imagens de compartilhamento: ${alvo.length} de ${eleitos.length} (${BASE})`);
  const imagens = { ...antes };
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  let feitas = 0, falhas = 0;
  try {
    await emLotes(alvo, 4, async e => {
      try {
        await subir(e.slug, await foto(browser, e.slug));
        imagens[e.slug] = versao(e);
        if (++feitas % 50 === 0) {
          console.log(`  … ${feitas}/${alvo.length}`);
          escreverJson(ARQ, { imagens: ordenar(imagens) });   // guarda o andamento: se cair, recomeça de onde parou
        }
      } catch (err) { falhas++; console.warn(`  ✗ ${e.slug}: ${(err as Error).message}`); }
    });
  } finally { await browser.close(); }
  // quem saiu do cadastro sai do manifesto
  const slugs = new Set(eleitos.map(e => e.slug));
  for (const s of Object.keys(imagens)) if (!slugs.has(s)) delete imagens[s];
  escreverJson(ARQ, { imagens: ordenar(imagens) });
  console.log(`  ✓ ${feitas} feitas${falhas ? ` · ${falhas} falharam (rode de novo)` : ''} · ${Object.keys(imagens).length} no total`);
}
const ordenar = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

main().catch(e => { console.error('✗ og falhou:', e.message); process.exit(1); });
