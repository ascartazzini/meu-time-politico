/* Painel "Na imprensa" no alto da timeline: sai notícia o tempo todo, então ela não entra no meio dos votos,
   presenças e projetos. Fica aqui, juntada por político (quem mais saiu primeiro), uma linha por pessoa;
   tocar abre as manchetes, cada uma com link pro veículo. A aba Imprensa mostra tudo, card por card. */
import { rpc } from './supabase';
import { quandoEmTexto } from './feed';
import { agruparPorPolitico, diaBr, diaEmTexto, type ItemPeca } from './pecas';
import { eleitos, avatar, sobre } from './timeline';
import { evento } from './analytics';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const MOSTRAR = 5, MANCHETES = 6;

const veiculosEmTexto = (vs: string[]) => vs.length <= 2 ? vs.join(' e ') : `${vs.slice(0, 2).join(', ')} e mais ${vs.length - 2}`;

export interface OpcoesImprensa {
  raiz: HTMLElement;
  /** null = todos os políticos; [] = não mostra o painel */
  slugs: () => Promise<string[] | null>;
  rotulo: () => string;
  /** "Ver toda a imprensa" */
  verTudo: () => void;
}

export function montarImprensa(o: OpcoesImprensa): { recarregar: () => void; esconder: () => void } {
  let pedido = 0;
  async function carregar() {
    const meu = ++pedido;
    try {
      const [slugs, gente] = await Promise.all([o.slugs(), eleitos()]);
      if (slugs && !slugs.length) { o.raiz.hidden = true; return; }
      const ns = await rpc<ItemPeca[]>('feed', { p_slugs: slugs, p_tipos: ['noticia'], p_antes: null, p_limite: 100, p_fontes: null });
      if (meu !== pedido) return;
      if (!ns.length) { o.raiz.hidden = true; return; }
      // as últimas 24 horas; se o dia foi parado, o último dia que teve notícia
      const ontem = Date.now() - 864e5;
      const recentes = ns.filter(n => +new Date(n.quando) > ontem);
      const base = recentes.length ? recentes : ns.filter(n => diaBr(n.quando) === diaBr(ns[0].quando));
      const quando = recentes.length ? 'nas últimas 24 horas' : diaEmTexto(diaBr(ns[0].quando));
      const grupos = agruparPorPolitico(base).filter(g => gente.has(g.slug));
      if (!grupos.length) { o.raiz.hidden = true; return; }
      o.raiz.innerHTML = `<div class="imp-cab"><span class="ava jornal" aria-hidden="true">N</span>
          <div class="quem"><b>${esc(o.rotulo())}</b><small>${base.length} ${base.length === 1 ? 'notícia' : 'notícias'} ${esc(quando)} · ${grupos.length} ${grupos.length === 1 ? 'político' : 'políticos'}</small></div></div>
        <ul class="imp-lista">${grupos.slice(0, MOSTRAR).map(g => {
          const e = gente.get(g.slug)!, ult = g.noticias[0];
          return `<li><details data-slug="${esc(g.slug)}"><summary>${avatar(e, g.slug)}
              <div class="quem"><b>${esc(e.nome)}</b><small>${sobre(e)}</small><span class="imp-ult">${esc(ult.titulo)}</span></div>
              <span class="imp-n" title="${esc(veiculosEmTexto(g.veiculos))}">${g.noticias.length}</span></summary>
            <ol class="imp-manchetes">${g.noticias.slice(0, MANCHETES).map(n => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.titulo)}</a>
              <small>${esc(n.fonte_nome)}${n.outras_fontes?.length ? ` e mais ${n.outras_fontes.length}` : ''} · ${esc(quandoEmTexto(n.quando))}</small></li>`).join('')}</ol>
            <a class="imp-perfil" href="/politico/${esc(g.slug)}/">${g.noticias.length > MANCHETES ? `Mais ${g.noticias.length - MANCHETES} notícias e tudo` : 'Tudo'} de ${esc(e.nome)} →</a></details></li>`;
        }).join('')}</ul>
        <button type="button" class="imp-tudo">${grupos.length > MOSTRAR ? `Mais ${grupos.length - MOSTRAR} políticos e ` : ''}toda a imprensa →</button>`;
      o.raiz.hidden = false;
    } catch { if (meu === pedido) o.raiz.hidden = true; }
  }
  o.raiz.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('.imp-tudo')) { evento('imprensa_tudo', {}); o.verTudo(); }
  });
  o.raiz.addEventListener('toggle', e => {
    const d = e.target as HTMLDetailsElement;
    if (d.open) evento('imprensa_abrir', {});
  }, true);
  return { recarregar: carregar, esconder: () => { pedido++; o.raiz.hidden = true; } };
}
