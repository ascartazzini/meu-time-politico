/* Camada de DOM do feed: abas de leitura, cards, placar de presença e "carregar mais".
   Usada em /time/ (o time inteiro) e em /politico/<slug>/ (um político). */
import { buscarFeed, LEITURAS, papelEmTexto, quandoEmTexto, placarPresenca, placarAgenda, ROTULO_TIPO, ROTULO_NATUREZA, type ItemFeed, type Leitura } from './feed';
import { evento } from './analytics';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const SELO: Record<string, string> = { oficial: 'oficial', imprensa: 'imprensa', rede: 'o próprio disse' };

export interface OpcoesFeed {
  raiz: HTMLElement;
  slugs: () => string[];                  // quem entra no feed agora (muda com o filtro de titulares)
  nome: (slug: string) => string;
  local: 'time' | 'politico';
  vazio: string;                          // texto quando não há nada ainda
}

function card(i: ItemFeed, nome: OpcoesFeed['nome'], local: OpcoesFeed['local']): string {
  const quem = (i.politicos ?? []).map(l => {
    const p = papelEmTexto(i.tipo, l.papel, i.dados.casa);
    const pessoa = local === 'politico' ? '' : `<a href="/politico/${esc(l.slug)}/">${esc(nome(l.slug))}</a> `;
    const pista = l.metodo === 'nome' ? ' <span class="pista" title="A notícia não traz id oficial: ligamos pelo nome.">pelo nome</span>' : '';
    return `<li class="tom-${p.tom}">${pessoa}${esc(p.texto)}${pista}</li>`;
  }).join('');
  const resumo = i.resumo ? `<p class="card-resumo">${esc(i.resumo)}</p>` : '';
  const local_ = i.local ? ` · ${esc(i.local)}` : '';
  return `<article class="card n-${esc(i.natureza)}">
    <div class="card-top"><span class="selo s-${esc(i.natureza)}">${esc(SELO[i.natureza] ?? i.natureza)}</span>
      <span class="card-tipo">${esc(ROTULO_TIPO[i.tipo] ?? i.tipo)}</span>${i.tipo === 'agenda' ? `<span class="nat nat-${esc(i.agenda_natureza ?? 'sem')}">${esc(i.agenda_natureza ? ROTULO_NATUREZA[i.agenda_natureza] : 'sem classificação')}</span>` : ''}
      <time datetime="${esc(i.quando)}" title="${esc(new Date(i.quando).toLocaleString('pt-BR'))}">${esc(quandoEmTexto(i.quando))}</time></div>
    <h3 class="card-t"><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.titulo)}</a></h3>
    ${resumo}
    <ul class="card-quem">${quem}</ul>
    <div class="card-fonte">fonte: <a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.fonte_nome)}</a>${local_}</div>
  </article>`;
}

function placar(itens: ItemFeed[], nome: OpcoesFeed['nome'], local: OpcoesFeed['local']): string {
  const p = placarPresenca(itens);
  if (!p.size) return '';
  const linhas = [...p.entries()].sort((a, b) => b[1].faltou - a[1].faltou).map(([slug, x]) => {
    const total = x.esteve + x.faltou;
    const base = x.base === 'plenario' ? 'sessões deliberativas do plenário' : 'votações nominais';
    return `<li><b>${local === 'politico' ? 'Esteve em' : `${esc(nome(slug))}:`}</b> ${x.esteve} de ${total} ${base}${x.faltou ? ` · <span class="tom-ruim">${x.faltou} falta${x.faltou > 1 ? 's' : ''}</span>` : ''}</li>`;
  }).join('');
  return `<div class="placar-presenca"><div class="pp-k">Placar de presença nestes cards</div><ul>${linhas}</ul>
    <p class="pp-nota">Câmara: conta só sessão deliberativa do plenário, onde todos os 513 são esperados (comissão não entra).
    Senado: não existe registro de presença fora das votações nominais; licença e missão oficial não contam como falta.</p></div>`;
}

function resumoAgenda(itens: ItemFeed[]): string {
  const p = placarAgenda(itens);
  const total = Object.values(p).reduce((a, b) => a + b, 0);
  if (!total) return '';
  const partes = (Object.keys(ROTULO_NATUREZA) as (keyof typeof ROTULO_NATUREZA)[]).filter(k => p[k])
    .map(k => `<li><span class="nat nat-${k}">${ROTULO_NATUREZA[k]}</span> ${p[k]}</li>`);
  if (p.sem) partes.push(`<li><span class="nat nat-sem">sem classificação</span> ${p.sem}</li>`);
  return `<div class="placar-presenca"><div class="pp-k">${total} compromissos nestes cards</div><ul class="pp-agenda">${partes.join('')}</ul>
    <p class="pp-nota">Classificação pelo texto da agenda: com quem foi a reunião. Na dúvida, fica sem classificação. Critério em <a href="/metodo/#agenda">/metodo</a>.
    Hoje só a agenda do presidente; ministros, governadores e parlamentares entram nas próximas fases.</p></div>`;
}

export function montarFeed(o: OpcoesFeed): { recarregar: () => void } {
  o.raiz.innerHTML = `
    <div class="leituras" role="tablist">${Object.entries(LEITURAS).map(([k, v], i) =>
      `<button type="button" role="tab" class="leitura" data-leitura="${k}" aria-selected="${i === 0}">${v.rotulo}</button>`).join('')}</div>
    <div class="feed-placar"></div>
    <div class="feed-lista" aria-live="polite"></div>
    <button type="button" class="mais" hidden>Carregar mais</button>`;
  const lista = o.raiz.querySelector<HTMLElement>('.feed-lista')!;
  const placarEl = o.raiz.querySelector<HTMLElement>('.feed-placar')!;
  const mais = o.raiz.querySelector<HTMLButtonElement>('.mais')!;
  let leitura: Leitura = 'tudo';
  let itens: ItemFeed[] = [];
  let pedido = 0;

  async function carregar(acrescentar: boolean) {
    const meu = ++pedido;
    const slugs = o.slugs();
    if (!slugs.length) { lista.innerHTML = `<p class="feed-vazio">${o.vazio}</p>`; placarEl.innerHTML = ''; mais.hidden = true; return; }
    if (!acrescentar) { itens = []; lista.innerHTML = '<p class="feed-vazio">Buscando o que o time fez…</p>'; }
    mais.disabled = true;
    try {
      const novos = await buscarFeed(slugs, leitura, acrescentar ? itens.at(-1)?.quando : undefined);
      if (meu !== pedido) return;
      itens = acrescentar ? [...itens, ...novos] : novos;
      lista.innerHTML = itens.length ? itens.map(i => card(i, o.nome, o.local)).join('')
        : `<p class="feed-vazio">${leitura === 'tudo' ? o.vazio : 'Nada nesta leitura por enquanto.'}</p>`;
      placarEl.innerHTML = leitura === 'presenca' ? placar(itens, o.nome, o.local) : leitura === 'agenda' ? resumoAgenda(itens) : '';
      mais.hidden = novos.length < 30;
    } catch {
      if (meu === pedido) lista.innerHTML = '<p class="feed-vazio">Não deu pra buscar o feed agora. Tenta de novo daqui a pouco.</p>';
    } finally { mais.disabled = false; }
  }

  o.raiz.querySelectorAll<HTMLButtonElement>('.leitura').forEach(b => b.addEventListener('click', () => {
    leitura = b.dataset.leitura as Leitura;
    o.raiz.querySelectorAll('.leitura').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    evento('feed_leitura', { leitura, local: o.local });
    carregar(false);
  }));
  mais.addEventListener('click', () => carregar(true));
  lista.addEventListener('click', e => {
    const a = (e.target as HTMLElement).closest('a');
    if (a?.target === '_blank') evento('feed_fonte', { local: o.local, natureza: a.closest('.card')?.className.match(/n-(\w+)/)?.[1] });
  });
  carregar(false);
  return { recarregar: () => carregar(false) };
}
