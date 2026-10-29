/* Links externos de cada eleito (site, redes) → src/data/generated/links-eleitos.json.
   Fontes, nesta ordem de prioridade: sugestões aprovadas (src/data/links-manuais.json), API da Câmara
   (redes e site do deputado), redes declaradas ao TSE em 2026 e, pros senadores de 2022, em 2022.
   Uso: npm run links */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ, RAW, GERADO, UA, lerJson, lerJsonSeExistir, escreverJson, fetchJson, parseCsvTse } from './util';
import { normalizarLink, juntarLinks, type Link } from './links';
import type { Eleito } from './cadastro-eleitos';

const PASTA = resolve(RAW, 'tse-redes');

async function redesTse(ano: number): Promise<Map<string, Link[]>> {
  mkdirSync(PASTA, { recursive: true });
  const zip = resolve(PASTA, `rede_social_candidato_${ano}.zip`);
  const csv = `rede_social_candidato_${ano}_BRASIL.csv`;
  const fresco = existsSync(zip) && Date.now() - statSync(zip).mtimeMs < 24 * 36e5;
  if (!fresco) {
    const r = await fetch(`https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/rede_social_candidato_${ano}.zip`, { headers: { 'User-Agent': UA } }).catch(() => null);
    if (r?.ok) writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    else if (!existsSync(zip)) { console.warn(`  ⚠ TSE ${ano}: CDN respondeu ${r?.status ?? 'nada'} e não há zip local; seguindo sem`); return new Map(); }
  }
  execFileSync('unzip', ['-o', '-q', zip, csv, '-d', PASTA]);
  const out = new Map<string, Link[]>();
  for (const l of parseCsvTse(readFileSync(resolve(PASTA, csv)))) {
    const link = normalizarLink(l.DS_URL ?? '', `tse-${ano}`);
    if (link) out.set(l.SQ_CANDIDATO, [...(out.get(l.SQ_CANDIDATO) ?? []), link]);
  }
  console.log(`  ✓ TSE ${ano}: links de ${out.size} candidatos`);
  return out;
}

async function redesCamara(ids: number[]): Promise<Map<number, Link[]>> {
  const out = new Map<number, Link[]>();
  let i = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const d = await fetchJson<{ dados: { urlWebsite: string | null; redeSocial: string[] } }>(`https://dadosabertos.camara.leg.br/api/v2/deputados/${id}`).catch(() => null);
      if (!d) continue;
      out.set(id, [d.dados.urlWebsite, ...d.dados.redeSocial].filter((x): x is string => !!x).map(x => normalizarLink(x, 'camara')).filter((x): x is Link => !!x));
    }
  }));
  console.log(`  ✓ Câmara: redes de ${out.size} deputados`);
  return out;
}

async function main() {
  console.log('▶ Links externos dos eleitos');
  const { eleitos } = lerJson<{ eleitos: Eleito[] }>(resolve(GERADO, 'eleitos-2027.json'));
  const manuais = lerJsonSeExistir<Record<string, { tipo: Link['tipo']; url: string }[]>>(resolve(RAIZ, 'src/data/links-manuais.json')) ?? {};
  const [tse26, tse22, camara] = await Promise.all([
    redesTse(2026), redesTse(2022),
    redesCamara(eleitos.map(e => e.ids.camara).filter((x): x is number => !!x)),
  ]);
  const links: Record<string, Link[]> = {};
  for (const e of eleitos) {
    const ls = juntarLinks([
      (manuais[e.slug] ?? []).map(m => ({ ...m, fonte: 'sugestao' })),
      e.ids.camara ? camara.get(e.ids.camara) ?? [] : [],
      e.ids.tse2026 ? tse26.get(e.ids.tse2026) ?? [] : [],
      e.ids.tse2022 ? tse22.get(e.ids.tse2022) ?? [] : [],
    ]);
    if (ls.length) links[e.slug] = ls;
  }
  const com = Object.keys(links).length;
  console.log(`  ${com} de ${eleitos.length} eleitos com pelo menos um link`);
  escreverJson(resolve(GERADO, 'links-eleitos.json'), {
    geradoEm: new Date().toISOString(),
    fontes: 'TSE (redes declaradas na candidatura, 2026 e 2022), API da Câmara, sugestões aprovadas',
    links,
  });
}

main().catch(e => { console.error('✗ links-eleitos falhou:', e.message); process.exit(1); });
