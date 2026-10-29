/* Timeline (home e página do político): posts do feed e as quatro reações (amei, gostei, odiei, odiei muito).
   Sem login dá pra ler tudo; pra reagir precisa entrar e seguir alguém ligado ao post. */
import { rpc } from './supabase';
import { papelEmTexto, quandoEmTexto, ROTULO_TIPO } from './feed';
import { peca, type ItemPeca } from './pecas';
import { cargoEmTexto, type EleitoLeve } from './eleitos';
import {
  usuario, seguir, interacoes, reagir, mensagemDeErro, REACOES, type Interacao, type Reacao,
} from './conta';
import { toast } from './toast';
import { evento } from './analytics';

export type Item = ItemPeca;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const POR_PAGINA = 25;

let _eleitos: Promise<Map<string, EleitoLeve>> | null = null;
export function eleitos(): Promise<Map<string, EleitoLeve>> {
  _eleitos ??= fetch('/eleitos/todos.json').then(r => r.json()).then(d => new Map((d.eleitos as EleitoLeve[]).map(e => [e.slug, e])));
  return _eleitos;
}

const iniciais = (n: string) => n.split(' ').filter(w => w.length > 2).slice(0, 2).map(w => w[0]).join('') || n[0] || '?';
export function avatar(e: EleitoLeve | undefined, slug: string): string {
  const dentro = e?.foto ? `<img src="${esc(e.foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : esc(iniciais(e?.nome ?? slug));
  return `<a class="ava" href="/politico/${esc(slug)}/" aria-hidden="true" tabindex="-1">${dentro}</a>`;
}
export const sobre = (e: EleitoLeve) => `${esc(e.partido)}${e.uf && e.cargo !== 'presidente' ? `-${esc(e.uf)}` : ''} · ${esc(cargoEmTexto(e.cargo, e.uf).toLowerCase())}`;

const etiqueta = (i: Item) => `<span class="tipo t-${esc(i.tipo)}">${esc(ROTULO_TIPO[i.tipo] ?? i.tipo)}</span>`;
const CASA_NOME: Record<string, string> = { senado: 'Senado Federal', executivo: 'Planalto', camara: 'Câmara dos Deputados' };

/** Um post: cabeçalho (de quem é), a peça visual do tipo (pecas.ts), reações e a fonte.
 *  Com uma pessoa só, o post é dela; notícia é do veículo; sessão e votação com muita gente são da casa. */
export function post(i: Item, gente: Map<string, EleitoLeve>, umaPessoa?: string): string {
  const ps = i.politicos ?? [];
  const quando = `<time class="quando" datetime="${esc(i.quando)}" title="${esc(new Date(i.quando).toLocaleString('pt-BR'))}">${esc(quandoEmTexto(i.quando))}</time>`;
  const slugs = ps.map(p => p.slug).slice(0, 12).join(',');
  const solo = umaPessoa ? ps.find(p => p.slug === umaPessoa) : (i.n_politicos === 1 || ps.length === 1) ? ps[0] : undefined;
  let cab: string;
  if (i.tipo === 'noticia') {
    const nomes = ps.slice(0, 3).map(p => `<a href="/politico/${esc(p.slug)}/">${esc(gente.get(p.slug)?.nome ?? p.slug)}</a>`);
    cab = `<span class="ava jornal" aria-hidden="true">${esc(i.fonte_nome.replace(/^(O|A)\s+/, '')[0] ?? '')}</span>
      <div class="quem"><b>${esc(i.fonte_nome)}</b><small>sobre ${nomes.join(', ')}${i.n_politicos > 3 ? ` e mais ${i.n_politicos - 3}` : ''}</small></div>`;
  } else if (solo) {
    const e = gente.get(solo.slug);
    cab = `${avatar(e, solo.slug)}<div class="quem"><b><a href="/politico/${esc(solo.slug)}/">${esc(e?.nome ?? solo.slug)}</a></b><small>${e ? sobre(e) : ''}</small></div>`;
  } else {
    const casa = CASA_NOME[String(i.dados.casa)] ?? 'Câmara dos Deputados';
    cab = `<span class="ava casa" aria-hidden="true">🏛</span><div class="quem"><b>${esc(casa)}</b><small>${i.n_politicos} eleitos que acompanhamos</small></div>`;
  }
  // votação com muita gente: quem do cadastro votou o quê, em fichas
  const fichas = !solo && i.tipo === 'voto' ? `<div class="gente">${ps.slice(0, 8).map(p => {
    const e = gente.get(p.slug), papel = papelEmTexto(i.tipo, p.papel, i.dados.casa);
    return `<a class="${papel.tom === 'ruim' ? 'ruim' : ''}" href="/politico/${esc(p.slug)}/">${esc(e?.nome ?? p.slug)}: ${esc(papel.texto)}</a>`;
  }).join('')}${i.n_politicos > 8 ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">+ ${i.n_politicos - 8} na fonte</a>` : ''}</div>` : '';
  const fonte = i.tipo === 'agenda' || i.tipo === 'presenca' ? `<a class="fonte-link" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(i.fonte_nome)}">fonte ↗</a>` : '';
  const rodape = `<div class="post-pe"><div class="reacoes">${REACOES.map(r =>
    `<button type="button" class="r-${r.tipo}" data-r="${r.tipo}" aria-pressed="false" aria-label="${r.rotulo}" title="${r.rotulo}">${r.emoji} <span>0</span></button>`).join('')}</div>${fonte}</div>`;
  return `<article class="post t-${esc(i.tipo)}" data-id="${esc(i.id)}" data-slugs="${esc(slugs)}">
    <div class="post-cab">${cab}<div class="canto">${etiqueta(i)}${quando}</div></div>
    ${peca(i, gente, solo)}${fichas}${rodape}</article>`;
}

export interface OpcoesTimeline {
  raiz: HTMLElement;
  /** null = todos os políticos */
  slugs: () => Promise<string[] | null>;
  tipos: () => string[] | null;
  fontes?: () => string[] | null;
  vazio: () => string;
  local: string;
  umaPessoa?: string;
}

export function montarTimeline(o: OpcoesTimeline): { recarregar: () => void } {
  o.raiz.innerHTML = '<div class="lista"></div><button class="mais" type="button" hidden>Ver mais</button>';
  const lista = o.raiz.querySelector<HTMLElement>('.lista')!, mais = o.raiz.querySelector<HTMLButtonElement>('.mais')!;
  let itens: Item[] = [];
  let pedido = 0;
  const estado = new Map<string, Interacao>();

  async function carregar(acrescentar = false) {
    const meu = ++pedido;
    if (!acrescentar) lista.innerHTML = '<p class="vazio">Carregando…</p>';
    try {
      const [slugs, gente] = await Promise.all([o.slugs(), eleitos()]);
      if (slugs && !slugs.length) { lista.innerHTML = `<p class="vazio">${o.vazio()}</p>`; mais.hidden = true; return; }
      const novos = await rpc<Item[]>('feed', { p_slugs: slugs, p_tipos: o.tipos(), p_antes: acrescentar ? itens.at(-1)?.quando ?? null : null, p_limite: POR_PAGINA, p_fontes: o.fontes?.() ?? null });
      if (meu !== pedido) return;
      itens = acrescentar ? [...itens, ...novos] : novos;
      const html = novos.map(i => post(i, gente, o.umaPessoa)).join('');
      if (acrescentar) lista.insertAdjacentHTML('beforeend', html);
      else lista.innerHTML = html || `<p class="vazio">${o.vazio()}</p>`;
      mais.hidden = novos.length < POR_PAGINA;
      if (novos.length) pintarInteracoes(novos.map(i => i.id));
    } catch {
      if (meu === pedido) lista.innerHTML = '<p class="vazio">Não deu pra carregar agora. Tenta de novo daqui a pouco.</p>';
    }
  }

  async function pintarInteracoes(ids: string[]) {
    try {
      for (const x of await interacoes(ids)) { estado.set(x.item_id, x); pintar(x.item_id); }
    } catch { /* sem contagem não quebra a leitura */ }
  }
  function pintar(id: string) {
    const x = estado.get(id), el = lista.querySelector<HTMLElement>(`.post[data-id="${CSS.escape(id)}"]`);
    if (!x || !el) return;
    for (const { tipo } of REACOES) {
      const b = el.querySelector<HTMLButtonElement>(`[data-r="${tipo}"]`)!;
      b.setAttribute('aria-pressed', String(x.minha === tipo));
      b.querySelector('span')!.textContent = String(x[tipo]);
    }
  }

  /** Antes de reagir: tem conta? segue alguém do post? Se não, oferece o atalho. */
  async function liberado(el: HTMLElement): Promise<boolean> {
    if (!(await usuario())) { pedirEntrada(el); return false; }
    if (estado.get(el.dataset.id!)?.pode) return true;
    pedirSeguir(el);
    return false;
  }
  function avisar(el: HTMLElement, html: string) {
    el.querySelector('.aviso-post')?.remove();
    el.querySelector('.reacoes')!.insertAdjacentHTML('afterend', `<div class="aviso-post">${html}</div>`);
  }
  function pedirEntrada(el: HTMLElement) {
    avisar(el, 'Entre com o Google pra reagir. <button type="button" data-entrar>Entrar</button>');
  }
  async function pedirSeguir(el: HTMLElement) {
    const gente = await eleitos();
    const slug = el.dataset.slugs?.split(',')[0];
    const nome = slug ? gente.get(slug)?.nome ?? slug : 'alguém deste post';
    avisar(el, `Só quem segue ${esc(nome)} reage aqui. ${slug ? `<button type="button" data-seguir="${esc(slug)}">Seguir ${esc(nome)}</button>` : ''}`);
  }

  o.raiz.addEventListener('click', async e => {
    const alvo = e.target as HTMLElement;
    const el = alvo.closest<HTMLElement>('.post');
    if (!el) return;
    const id = el.dataset.id!;

    const r = alvo.closest<HTMLButtonElement>('[data-r]');
    if (r) {
      if (!(await liberado(el))) return;
      const x = estado.get(id)!, tipo = r.dataset.r as Reacao, nova = x.minha === tipo ? null : tipo;
      const antes = { ...x };
      if (x.minha) x[x.minha]--;
      if (nova) x[nova]++;
      x.minha = nova;
      pintar(id);
      try { await reagir(id, nova); evento('reacao', { tipo: nova ?? 'nenhuma', local: o.local }); }
      catch (err) { estado.set(id, antes); pintar(id); toast(mensagemDeErro(err)); }
      return;
    }

    const s = alvo.closest<HTMLButtonElement>('[data-seguir]');
    if (s) {
      s.disabled = true;
      try {
        await seguir([s.dataset.seguir!], true);
        el.querySelector('.aviso-post')?.remove();
        toast('Seguindo. Agora dá pra reagir.');
        evento('seguir', { local: `${o.local}:post` });
        await pintarInteracoes(itens.map(i => i.id));
      } catch (err) { toast(mensagemDeErro(err)); s.disabled = false; }
    }
  });

  // carrossel de discurso: o ponto aceso acompanha o slide (scroll não sobe, por isso a captura)
  o.raiz.addEventListener('scroll', e => {
    const c = e.target as HTMLElement;
    if (!c.classList?.contains('carrossel')) return;
    const k = Math.round(c.scrollLeft / c.clientWidth);
    c.parentElement?.querySelectorAll('.pontos i').forEach((p, j) => p.classList.toggle('on', j === k));
  }, true);

  mais.addEventListener('click', () => carregar(true));
  addEventListener('mtp:seguidos', () => { if (itens.length) pintarInteracoes(itens.map(i => i.id)); });
  carregar();
  return { recarregar: () => carregar() };
}
