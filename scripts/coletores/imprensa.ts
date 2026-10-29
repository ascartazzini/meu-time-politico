/* Coletor de imprensa: RSS de política dos grandes veículos aprovados na Fase 0 (docs/fase0/README.md).
   Guarda título, link, data e a linha fina do próprio feed; nunca o texto da matéria.
   Liga ao político pelo nome (citacoes.ts). Os feeds cobrem 1 a 2 dias, então roda de hora em hora.
   Depois de gravar, refaz as ligações por nome da última semana com a regra atual (uma regra
   melhor corrige o passado) e junta a mesma notícia de veículos diferentes num grupo (agrupar.ts).
   Uso: npm run coletar:imprensa */
import { UA } from '../util';
import { gravar, hash, politicos, emLotes, pedir, type ItemNovo } from './banco';
import { agrupar } from './agrupar';
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

let idx: ReturnType<typeof indiceDeNomes>;

async function main() {
  console.log('▶ Imprensa');
  idx = indiceDeNomes(await politicos());
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

/** Remove ligação por nome que a regra atual não confirma mais (só das notícias dos últimos 7 dias). */
async function revisarLigacoes() {
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const ns = await pedir<{ id: string; titulo: string; resumo: string | null; item_politico: { politico_id: string; metodo: string }[] }[]>(
    `itens?tipo=eq.noticia&quando=gte.${desde}&select=id,titulo,resumo,item_politico(politico_id,metodo)&limit=5000`);
  let removidas = 0;
  for (const n of ns) {
    const valem = new Set(citados(`${n.titulo}. ${n.resumo ?? ''}`, idx).map(c => c.id));
    const sobrando = n.item_politico.filter(ip => ip.metodo === 'nome' && !valem.has(ip.politico_id)).map(ip => ip.politico_id);
    if (!sobrando.length) continue;
    await pedir(`item_politico?item_id=eq.${n.id}&politico_id=in.(${sobrando.join(',')})`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    removidas += sobrando.length;
  }
  console.log(`  ✓ ligações revistas: ${removidas} removidas`);
}

/** Reagrupa as notícias dos últimos 4 dias e grava só o que mudou. Quem já tinha grupo mantém. */
async function reagrupar() {
  const desde = new Date(Date.now() - 4 * 864e5).toISOString();
  const linhas = await pedir<{ chave: string; fonte_id: string; titulo: string; quando: string; grupo: string | null; item_politico: { politicos: { slug: string } }[] }[]>(
    `itens?tipo=eq.noticia&quando=gte.${desde}&select=chave,fonte_id,titulo,quando,grupo,item_politico(politicos(slug))&order=quando&limit=5000`);
  const grupos = agrupar(linhas.map(l => ({
    chave: l.chave, fonte: l.fonte_id, titulo: l.titulo, quando: l.quando, grupo: l.grupo,
    politicos: l.item_politico.map(ip => ip.politicos.slug),
  })));
  const mudou = new Map<string, string[]>();
  for (const l of linhas) {
    const g = grupos.get(l.chave)!;
    if (g !== l.grupo) mudou.set(g, [...(mudou.get(g) ?? []), l.chave]);
  }
  for (const [grupo, chaves] of mudou) {
    for (let i = 0; i < chaves.length; i += 50) {
      await pedir(`itens?chave=in.(${chaves.slice(i, i + 50).map(c => `"${c}"`).join(',')})`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ grupo }),
      });
    }
  }
  const cards = new Set(grupos.values()).size;
  console.log(`  ✓ grupos: ${linhas.length} notícias em ${cards} cards (${[...mudou.values()].flat().length} atualizadas)`);
}

main().then(revisarLigacoes).then(reagrupar).catch(e => { console.error('✗ coletor de imprensa falhou:', e.message); process.exit(1); });
