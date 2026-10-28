/* Coletor de imprensa: RSS de política dos grandes veículos aprovados na Fase 0 (docs/fase0/README.md).
   Guarda título, link, data e a linha fina do próprio feed; nunca o texto da matéria.
   Liga ao político pelo nome (citacoes.ts). Os feeds cobrem 1 a 2 dias, então roda de hora em hora.
   Uso: npm run coletar:imprensa */
import { UA } from '../util';
import { gravar, hash, politicos, emLotes, type ItemNovo } from './banco';
import { indiceDeNomes, citados, lerRss, ehOpiniao, urlCanonica } from './citacoes';

const FEEDS: { fonte: string; url: string; secao?: RegExp }[] = [
  { fonte: 'g1', url: 'https://g1.globo.com/rss/g1/politica/' },
  { fonte: 'folha', url: 'https://feeds.folha.uol.com.br/poder/rss091.xml' },
  { fonte: 'oglobo', url: 'https://oglobo.globo.com/rss/oglobo/politica' },
  { fonte: 'estadao', url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/' },
  { fonte: 'poder360', url: 'https://www.poder360.com.br/feed/' },
  { fonte: 'agencia-brasil', url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml' },
  { fonte: 'agencia-camara', url: 'https://www.camara.leg.br/noticias/rss/ultimas-noticias' },
  { fonte: 'agencia-senado', url: 'https://www12.senado.leg.br/noticias/rss' },
];

/** GET que respeita o charset do cabeçalho ou da declaração XML (Folha serve ISO-8859-1). */
async function baixar(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30_000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: ctl.signal });
    if (!r.ok) { console.warn(`  ⚠ ${url}: HTTP ${r.status}`); return null; }
    const buf = new Uint8Array(await r.arrayBuffer());
    const cabeca = new TextDecoder('latin1').decode(buf.slice(0, 200));
    const cs = ((r.headers.get('content-type') ?? '').match(/charset=([\w-]+)/i)?.[1] ?? cabeca.match(/encoding="([\w-]+)"/i)?.[1] ?? 'utf-8').toLowerCase();
    try { return new TextDecoder(cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
  } catch (e) {
    console.warn(`  ⚠ ${url}: ${(e as Error).message}`);
    return null;
  } finally { clearTimeout(timer); }
}

async function main() {
  console.log('▶ Imprensa');
  const idx = indiceDeNomes(await politicos());
  const itens: ItemNovo[] = [];
  const vistos = new Set<string>();
  await emLotes(FEEDS, 4, async f => {
    const xml = await baixar(f.url);
    if (!xml) return;
    let lidos = 0, ligados = 0;
    for (const n of lerRss(xml)) {
      lidos++;
      const url = urlCanonica(n.url);
      if (ehOpiniao(url) || (f.secao && !f.secao.test(url)) || vistos.has(url)) continue;
      vistos.add(url);
      const quem = citados(`${n.titulo}. ${n.resumo}`, idx);
      if (!quem.length) continue;
      ligados++;
      itens.push({
        fonte: f.fonte, chave: `noticia-${hash(url)}`, tipo: 'noticia', titulo: n.titulo, resumo: n.resumo || null, url, publicadoEm: n.data,
        dados: { termos: quem.map(q => q.termo) },
        politicos: quem.map(q => ({ id: q.id, papel: 'citado', metodo: 'nome' as const, confianca: q.confianca })),
      });
    }
    console.log(`  · ${f.fonte}: ${lidos} no feed, ${ligados} citam alguém do cadastro`);
  });
  const r = await gravar(itens);
  console.log(`  ✓ imprensa: ${r.itens} itens, ${r.ligacoes} ligações`);
}

main().catch(e => { console.error('✗ coletor de imprensa falhou:', e.message); process.exit(1); });
