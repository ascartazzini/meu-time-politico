/* Timeline (home e página do político): posts do feed, like/odiei e comentários.
   Sem login dá pra ler tudo; pra reagir e comentar precisa entrar e seguir alguém ligado ao post. */
import { rpc } from './supabase';
import { papelEmTexto, quandoEmTexto, ROTULO_NATUREZA, type ItemFeed } from './feed';
import { cargoEmTexto, type EleitoLeve } from './eleitos';
import {
  usuario, entrar, seguir, interacoes, reagir, comentariosDoItem, comentar, apagarComentario, denunciar, mensagemDeErro,
  type Interacao, type Reacao,
} from './conta';
import { toast } from './toast';
import { evento } from './analytics';

export type Item = ItemFeed & { n_politicos: number };

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
const dominio = (u: string) => { try { return new URL(u).hostname.replace(/^www\d*\./, ''); } catch { return ''; } };

function fonte(i: Item): string {
  const nat = i.tipo === 'agenda' ? `<span class="nat nat-${esc(i.agenda_natureza ?? 'sem')}">${esc(i.agenda_natureza ? ROTULO_NATUREZA[i.agenda_natureza] : 'sem classificação')}</span>` : '';
  const resumo = i.resumo && i.tipo !== 'presenca' ? `<span class="resumo">${esc(i.resumo)}</span>` : '';
  return `<a class="fonte" href="${esc(i.url)}" target="_blank" rel="noopener"><b>${esc(i.titulo)}</b>${resumo}
    <small><span class="selo ${esc(i.natureza)}">${i.natureza === 'oficial' ? 'oficial' : 'imprensa'}</span> · ${esc(i.fonte_nome)} · ${esc(dominio(i.url))}${nat ? ` ${nat}` : ''}</small></a>`;
}

/** Card de um item. Com uma pessoa só, o post é dela; com muitas (sessão, votação), é da casa, com as pessoas em fichas. */
export function post(i: Item, gente: Map<string, EleitoLeve>, umaPessoa?: string): string {
  const ps = i.politicos ?? [];
  const quando = `<time class="quando" datetime="${esc(i.quando)}" title="${esc(new Date(i.quando).toLocaleString('pt-BR'))}">${esc(quandoEmTexto(i.quando))}</time>`;
  const slugs = ps.map(p => p.slug).slice(0, 12).join(',');
  const rodape = `<div class="reacoes">
      <button type="button" class="gostei" data-r="gostei" aria-pressed="false" aria-label="Gostei">👍 <span>0</span></button>
      <button type="button" class="odiei" data-r="odiei" aria-pressed="false" aria-label="Odiei">👎 <span>0</span></button>
      <button type="button" class="comentar" aria-label="Comentários">💬 <span>0</span></button></div>`;
  const solo = umaPessoa ? ps.find(p => p.slug === umaPessoa) : (i.n_politicos === 1 || ps.length === 1) ? ps[0] : undefined;
  if (solo) {
    const e = gente.get(solo.slug);
    const papel = papelEmTexto(i.tipo, solo.papel, i.dados.casa);
    const verbo = i.tipo === 'noticia' ? `apareceu no <b>${esc(i.fonte_nome)}</b>${solo.metodo === 'nome' ? ' <span class="pista">· ligado pelo nome</span>' : ''}`
      : `<span class="${papel.tom}">${esc(papel.texto)}</span>`;
    return `<article class="post" data-id="${esc(i.id)}" data-slugs="${esc(slugs)}"><div class="post-cab">${avatar(e, solo.slug)}
      <div class="quem"><b><a href="/politico/${esc(solo.slug)}/">${esc(e?.nome ?? solo.slug)}</a></b><small>${e ? sobre(e) : ''}</small></div>${quando}</div>
      <p class="acao">${verbo}</p>${fonte(i)}${rodape}</article>`;
  }
  const casa = i.dados.casa === 'senado' ? 'Senado Federal' : i.dados.casa === 'executivo' ? 'Planalto' : 'Câmara dos Deputados';
  const oficial = i.natureza === 'oficial';
  const resumo = i.tipo === 'presenca' ? `${(i.dados.presentes as number) ?? i.n_politicos} deputados presentes`
    : i.tipo === 'voto' ? `votação nominal · ${i.n_politicos} parlamentares` : `${i.n_politicos} políticos citados`;
  const fichas = ps.slice(0, 8).map(p => {
    const e = gente.get(p.slug), papel = papelEmTexto(i.tipo, p.papel, i.dados.casa);
    return `<a class="${papel.tom === 'ruim' ? 'ruim' : ''}" href="/politico/${esc(p.slug)}/">${esc(e?.nome ?? p.slug)}: ${esc(papel.texto)}</a>`;
  }).join('') + (i.n_politicos > 8 ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">+ ${i.n_politicos - 8} na fonte</a>` : '');
  return `<article class="post" data-id="${esc(i.id)}" data-slugs="${esc(slugs)}"><div class="post-cab"><span class="ava ${oficial ? 'casa' : 'jornal'}" aria-hidden="true">${oficial ? '🏛' : '📰'}</span>
    <div class="quem"><b>${esc(oficial ? casa : i.fonte_nome)}</b><small>${resumo}</small></div>${quando}</div>
    ${fonte(i)}<div class="gente">${fichas}</div>${rodape}</article>`;
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
    for (const r of ['gostei', 'odiei'] as const) {
      const b = el.querySelector<HTMLButtonElement>(`[data-r="${r}"]`)!;
      b.setAttribute('aria-pressed', String(x.minha === r));
      b.querySelector('span')!.textContent = String(x[r]);
    }
    el.querySelector('.comentar span')!.textContent = String(x.comentarios);
  }

  /** Antes de reagir/comentar: tem conta? segue alguém do post? Se não, oferece o atalho. */
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
    avisar(el, 'Entre com o Google pra reagir e comentar. <button type="button" data-entrar>Entrar</button>');
  }
  async function pedirSeguir(el: HTMLElement) {
    const gente = await eleitos();
    const slug = el.dataset.slugs?.split(',')[0];
    const nome = slug ? gente.get(slug)?.nome ?? slug : 'alguém deste post';
    avisar(el, `Só quem segue ${esc(nome)} reage e comenta aqui. ${slug ? `<button type="button" data-seguir="${esc(slug)}">Seguir ${esc(nome)}</button>` : ''}`);
  }

  async function abrirConversa(el: HTMLElement) {
    const aberta = el.querySelector('.conversa');
    if (aberta) { aberta.remove(); return; }
    const id = el.dataset.id!;
    el.insertAdjacentHTML('beforeend', '<div class="conversa"><p class="pista">Carregando…</p></div>');
    const caixa = el.querySelector<HTMLElement>('.conversa')!;
    try {
      const cs = await comentariosDoItem(id);
      const logado = !!(await usuario()), pode = estado.get(id)?.pode;
      caixa.innerHTML = (cs.length ? cs.map(c => `<div class="coment" data-c="${esc(c.id)}"><b>${esc(c.autor)}</b><time>${esc(quandoEmTexto(c.criado_em))}</time>
          <span class="acoes-c">${c.meu ? '<button type="button" data-apagar>apagar</button>' : (logado ? '<button type="button" data-denunciar>denunciar</button>' : '')}</span>
          <p>${esc(c.texto)}</p></div>`).join('') : '<p class="pista">Ninguém comentou ainda.</p>')
        + (pode ? `<form class="escrever"><textarea name="t" rows="1" maxlength="500" placeholder="Comente com respeito" required></textarea><button type="submit">Enviar</button></form>
          <p class="regras">Sem palavrão nem ofensa. Com 3 denúncias o comentário some. <a href="/metodo/#regras">Regras</a></p>` : '');
      if (!pode) logado ? pedirSeguir(el) : pedirEntrada(el);
      evento('comentarios_abrir', { local: o.local });
    } catch { caixa.innerHTML = '<p class="pista">Não deu pra carregar os comentários.</p>'; }
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
    if (alvo.closest('.comentar')) return abrirConversa(el);

    const s = alvo.closest<HTMLButtonElement>('[data-seguir]');
    if (s) {
      s.disabled = true;
      try {
        await seguir([s.dataset.seguir!], true);
        el.querySelector('.aviso-post')?.remove();
        toast('Seguindo. Agora dá pra reagir e comentar.');
        evento('seguir', { local: `${o.local}:post` });
        await pintarInteracoes(itens.map(i => i.id));
        if (el.querySelector('.conversa')) { el.querySelector('.conversa')!.remove(); abrirConversa(el); }
      } catch (err) { toast(mensagemDeErro(err)); s.disabled = false; }
      return;
    }

    const c = alvo.closest<HTMLElement>('.coment');
    if (c && alvo.closest('[data-apagar]')) {
      try { await apagarComentario(c.dataset.c!); c.remove(); const x = estado.get(id); if (x) { x.comentarios--; pintar(id); } }
      catch (err) { toast(mensagemDeErro(err)); }
      return;
    }
    if (c && alvo.closest('[data-denunciar]')) {
      if (!confirm('Denunciar este comentário? Com 3 denúncias ele some até ser revisado.')) return;
      try { await denunciar(c.dataset.c!); toast('Denúncia registrada. Obrigado.'); alvo.closest('[data-denunciar]')!.remove(); }
      catch (err) { toast(mensagemDeErro(err)); }
    }
  });

  o.raiz.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target as HTMLFormElement, el = form.closest<HTMLElement>('.post')!, id = el.dataset.id!;
    const t = form.elements.namedItem('t') as HTMLTextAreaElement, b = form.querySelector('button')!;
    if (!t.value.trim()) return;
    b.disabled = true;
    try {
      await comentar(id, t.value);
      evento('comentar', { local: o.local });
      const x = estado.get(id); if (x) { x.comentarios++; pintar(id); }
      el.querySelector('.conversa')!.remove();
      await abrirConversa(el);
    } catch (err) { toast(mensagemDeErro(err)); b.disabled = false; }
  });
  o.raiz.addEventListener('input', e => {
    const t = e.target as HTMLTextAreaElement;
    if (t.tagName === 'TEXTAREA') { t.style.height = 'auto'; t.style.height = `${t.scrollHeight}px`; }
  });

  mais.addEventListener('click', () => carregar(true));
  addEventListener('mtp:seguidos', () => { if (itens.length) pintarInteracoes(itens.map(i => i.id)); });
  carregar();
  return { recarregar: () => carregar() };
}
