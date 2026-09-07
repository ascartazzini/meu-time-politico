/* ==========================================================================
   Baixa as fontes do Google pro nosso próprio domínio.
   Motivo: servidas pelo Google, elas custavam ~1,4s de render-blocking no 4G
   (dois handshakes: fonts.googleapis.com + fonts.gstatic.com) e o swap tardio
   jogava o CLS pra 0,36. Local + preload = sem handshake externo e sem salto.
   Roda de novo só quando a lista de fontes mudar:  npm run fetch:fontes
   ========================================================================== */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CSS = 'https://fonts.googleapis.com/css2?family=Anton&family=Chivo+Mono:wght@400;700&family=Barlow:wght@400;500;600;700&display=swap';
// UA de Chrome moderno: sem isso o Google devolve os formatos antigos em vez de woff2
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SUBSETS = ['latin', 'latin-ext'];          // pt-BR não precisa de vietnamese
const DEST_FONTES = resolve('public/fontes');
const DEST_CSS = resolve('src/styles/fontes.css');

interface Face { subset: string; familia: string; peso: string; url: string; range: string; }

/* Cada regra vem precedida do comentário com o nome do subset: `/* latin *\/ @font-face{…}`.
   O par tem que ser lido junto, senão o subset sai trocado com o da regra seguinte. */
function parsear(css: string): Face[] {
  const faces: Face[] = [];
  const par = /\/\*\s*([a-z-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g;
  for (const [, subset, corpo] of css.matchAll(par)) {
    if (!SUBSETS.includes(subset)) continue;
    const familia = corpo.match(/font-family:\s*'([^']+)'/)?.[1];
    const peso = corpo.match(/font-weight:\s*(\d+)/)?.[1];
    const url = corpo.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const range = corpo.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (familia && peso && url && range) faces.push({ subset, familia, peso, url, range });
  }
  return faces;
}

const arquivoDe = (f: Face) => `${f.familia.toLowerCase().replace(/\s+/g, '-')}-${f.peso}-${f.subset}.woff2`;

async function main() {
  const css = await fetch(CSS, { headers: { 'User-Agent': UA } }).then(r => r.text());
  const faces = parsear(css);
  if (!faces.length) throw new Error('não achei nenhuma @font-face — o formato do CSS do Google mudou?');
  await mkdir(DEST_FONTES, { recursive: true });

  const regras: string[] = [
    '/* Gerado por scripts/fetch-fontes.ts — não editar à mão. */',
    '/* Fontes do Google (Anton, Barlow, Chivo Mono — todas OFL) servidas do nosso domínio. */'
  ];
  for (const f of faces) {
    const nome = arquivoDe(f);
    const buf = (await fetch(f.url, { headers: { 'User-Agent': UA } }).then(r => r.arrayBuffer())) as ArrayBuffer;
    const bin = new Uint8Array(buf);
    await writeFile(resolve(DEST_FONTES, nome), bin);
    regras.push(`@font-face{font-family:'${f.familia}';font-style:normal;font-weight:${f.peso};font-display:swap;src:url('/fontes/${nome}') format('woff2');unicode-range:${f.range}}`);
    console.log(`  ${nome.padEnd(34)} ${(bin.byteLength / 1024).toFixed(1)} KB`);
  }
  await writeFile(DEST_CSS, regras.join('\n') + '\n');
  console.log(`✓ ${faces.length} arquivos em public/fontes/ e as regras em src/styles/fontes.css`);
}
void main();
