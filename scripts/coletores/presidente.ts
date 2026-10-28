/* Coletor da agenda do Presidente da República (site do Planalto, uma página por dia).
   Liga ao presidente por construção: a página é dele. A URL leva o nome do presidente e muda quando
   muda o titular; se o eleito não for quem está na URL, o coletor para em vez de ligar à pessoa errada.
   Ritmo baixo (2 s entre dias): o gov.br barra volume devolvendo 200 com página de aviso.
   Uso: npm run coletar:presidente [-- --dias=3] */
import { UA } from '../util';
import { gravar, politicos, hash, diasDoArgumento, type ItemNovo } from './banco';
import { lerAgendaPlanalto, classificarAgenda } from './agenda';

const TITULAR = { slug: 'lula-br', url: 'https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/agenda-do-presidente-da-republica-lula/agenda-do-presidente-da-republica' };
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
const BLOQUEIO = /Temporariamente (Restrita|Interrompido)/i;

/** Dias (AAAA-MM-DD, Brasília): os `atras` últimos, hoje e os próximos 2 (agenda publicada antes). */
function dias(atras: number): string[] {
  const hoje = new Date(Date.now() - 3 * 36e5);
  return Array.from({ length: atras + 3 }, (_, i) => new Date(hoje.getTime() + (i - atras) * 864e5).toISOString().slice(0, 10));
}

async function main() {
  const ps = await politicos();
  const presidente = ps.find(p => p.cargos.includes('presidente'));
  if (presidente?.slug !== TITULAR.slug) {
    console.warn(`⚠ o presidente do cadastro (${presidente?.slug ?? 'nenhum'}) não é o da página do Planalto (${TITULAR.slug}); atualize TITULAR em presidente.ts`);
    return;
  }
  console.log('▶ Agenda do presidente');
  const itens: ItemNovo[] = [];
  let semAgenda = 0, barrados = 0;
  for (const d of dias(diasDoArgumento(3))) {
    const r = await fetch(`${TITULAR.url}/${d}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } }).catch(() => null);
    const html = r ? await r.text() : '';
    if (r?.status === 404) semAgenda++;
    else if (!r?.ok || BLOQUEIO.test(html.slice(0, 20_000))) barrados++;
    else for (const c of lerAgendaPlanalto(html, d)) {
      itens.push({
        fonte: 'planalto-agenda', chave: `planalto-${d}-${hash(`${c.quando}|${c.titulo}`)}`, tipo: 'agenda',
        titulo: c.titulo, url: `${TITULAR.url}/${d}`, ocorreuEm: c.quando, local: c.local,
        agendaNatureza: classificarAgenda(c.titulo),
        dados: { casa: 'executivo' },
        politicos: [{ id: presidente.id, papel: 'agenda', metodo: 'id-oficial' }],
      });
    }
    await dormir(2000);
  }
  const g = await gravar(itens);
  console.log(`  ✓ agenda: ${g.itens} compromissos · ${semAgenda} dias sem agenda publicada${barrados ? ` · ${barrados} dias barrados pelo gov.br` : ''}`);
}

main().catch(e => { console.error('✗ coletor da agenda do presidente falhou:', e.message); process.exit(1); });
