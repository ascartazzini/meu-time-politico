/* Camada de DOM de /time/: escolher UF, seguir, marcar titular e mostrar o feed do time. */
import { carregarTime, salvarTime, seguir, deixarDeSeguir, alternarTitular, porCargo, segue, ehTitular, CARGOS, TITULARES_POR_CARGO, type MeuTime, type Escalado } from './time';
import { cargoEmTexto, type EleitoLeve } from './eleitos';
import { montarFeed } from './feed-ui';
import { evento } from './analytics';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function montarEscalacao() {
  let time: MeuTime = carregarTime();
  let eleitos: EleitoLeve[] = [];
  const passoUf = $('passoUf'), painel = $('painel'), escolha = $('escolha');

  const feed = montarFeed({
    raiz: $('feed'), local: 'time',
    slugs: () => time.escalados.filter(e => !$<HTMLInputElement>('soTitulares').checked || e.titular).map(e => e.slug),
    nome: slug => time.escalados.find(e => e.slug === slug)?.nome ?? slug,
    vazio: 'Ainda não tem nada do seu time por aqui. Os coletores rodam de hora em hora; volte mais tarde ou siga mais gente.',
  });

  function gravar(t: MeuTime) { time = t; salvarTime(t); }

  function mostrar(qual: 'uf' | 'painel' | 'escolha') {
    passoUf.hidden = qual !== 'uf';
    painel.hidden = qual !== 'painel';
    escolha.hidden = qual !== 'escolha';
    if (qual === 'painel') { desenharEscalacao(); feed.recarregar(); }
    window.scrollTo({ top: 0 });
  }

  function desenharEscalacao() {
    const grupos = porCargo(time);
    $('escalacao').innerHTML = CARGOS.filter(c => grupos[c].length).map(c => `
      <div class="pos"><div class="pos-k">${esc(cargoEmTexto(c, time.uf ?? null, grupos[c].length > 1))}</div>
        <ul>${grupos[c].map(e => `<li class="${e.titular ? 'titular' : ''}">
          <a href="/politico/${esc(e.slug)}/">${esc(e.nome)}</a> <span class="partido">${esc(e.partido)}${e.uf && c !== 'presidente' && e.uf !== time.uf ? `-${esc(e.uf)}` : ''}</span>
          ${e.titular ? '<span class="estrela" title="titular">★</span>' : ''}</li>`).join('')}</ul></div>`).join('')
      || '<p class="feed-vazio">Seu time está vazio. Siga alguém pra começar.</p>';
    const n = time.escalados.length, t = time.escalados.filter(e => e.titular).length;
    $('subtitulo').innerHTML = n
      ? `Você segue <b>${n}</b> ${n === 1 ? 'político' : 'políticos'}${t ? `, <b>${t}</b> ${t === 1 ? 'titular' : 'titulares'}` : ''}. Tudo com fonte; o selo diz se é registro oficial ou imprensa.`
      : 'Escolha seu estado e siga quem você quer acompanhar.';
  }

  async function carregarUf(uf: string) {
    $('ufAtual').textContent = uf;
    $('listaEleitos').innerHTML = '<p class="feed-vazio">Carregando os eleitos…</p>';
    try {
      const r = await fetch(`/eleitos/${uf}.json`);
      eleitos = (await r.json()).eleitos;
      desenharLista();
    } catch { $('listaEleitos').innerHTML = '<p class="feed-vazio">Não deu pra carregar a lista. Tenta de novo.</p>'; }
  }

  function desenharLista() {
    const q = semAcento($<HTMLInputElement>('busca').value.trim());
    const filtro = (e: EleitoLeve) => !q || semAcento(`${e.nome} ${e.partido}`).includes(q);
    $('listaEleitos').innerHTML = CARGOS.map(c => {
      const doCargo = eleitos.filter(e => e.cargo === c && filtro(e));
      if (!doCargo.length) return '';
      const max = TITULARES_POR_CARGO[c];
      return `<div class="cargo"><h3>${esc(cargoEmTexto(c, time.uf ?? null, true))} <small>${doCargo.length} · até ${max} titular${max > 1 ? 'es' : ''}</small></h3>
        <ul class="eleitos">${doCargo.map(e => {
          const s = segue(time, e.slug), t = ehTitular(time, e.slug);
          return `<li data-slug="${esc(e.slug)}" class="${s ? 'seguindo' : ''}">
            <a class="e-nome" href="/politico/${esc(e.slug)}/">${esc(e.nome)}</a>
            <span class="partido">${esc(e.partido)}${e.suplente ? ' · suplente em exercício' : ''}</span>
            <span class="e-acoes">
              <button type="button" class="b-seguir" aria-pressed="${s}">${s ? 'Seguindo' : 'Seguir'}</button>
              <button type="button" class="b-titular" aria-pressed="${t}" title="Marcar como titular (em quem você votou)">★</button>
            </span></li>`;
        }).join('')}</ul></div>`;
    }).join('') || '<p class="feed-vazio">Ninguém com esse nome ou partido.</p>';
  }

  $('listaEleitos').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button');
    const li = b?.closest<HTMLElement>('li[data-slug]');
    if (!b || !li) return;
    const el = eleitos.find(x => x.slug === li.dataset.slug);
    if (!el) return;
    const p: Omit<Escalado, 'titular'> = { slug: el.slug, nome: el.nome, partido: el.partido, uf: el.uf, cargo: el.cargo };
    if (b.classList.contains('b-titular')) {
      gravar(alternarTitular(time, p));
      evento('time_titular', { cargo: el.cargo, ligado: ehTitular(time, el.slug) });
    } else {
      gravar(segue(time, el.slug) ? deixarDeSeguir(time, el.slug) : seguir(time, p));
      evento('time_seguir', { cargo: el.cargo, ligado: segue(time, el.slug) });
    }
    desenharLista();
  });

  $('busca').addEventListener('input', desenharLista);
  passoUf.addEventListener('click', e => {
    const uf = (e.target as HTMLElement).closest<HTMLElement>('[data-uf]')?.dataset.uf;
    if (!uf) return;
    gravar({ ...time, uf });
    evento('time_uf', { uf });
    carregarUf(uf);
    mostrar('escolha');
  });
  $('trocarUf').addEventListener('click', () => mostrar('uf'));
  $('abrirEscolha').addEventListener('click', () => { if (time.uf) { carregarUf(time.uf); mostrar('escolha'); } else mostrar('uf'); });
  $('fecharEscolha').addEventListener('click', () => mostrar('painel'));
  $('soTitulares').addEventListener('change', () => feed.recarregar());

  if (!time.uf && !time.escalados.length) mostrar('uf');
  else mostrar('painel');
}
