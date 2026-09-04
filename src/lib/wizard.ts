/* ==========================================================================
   WIZARD + RESULTADO — camada de DOM. Toda a conta fica em motor.ts.
   O dataset da UF é carregado sob demanda de /dados/<UF>.json (src/lib/dataset.ts).
   ========================================================================== */
import perfilJson from '../data/perfil.json';
import ufsJson from '../data/ufs.json';
import temasJson from '../data/temas.json';
import type { Candidato, Cargo, CargoId, Dataset, EstadoEleitor, Resposta, Tema } from './tipos';
import { MAX_SUGESTOES_VAGA, TOLERANCIA_CAMISA, calcularPlacar, leituraDaForca, sugerirParaVaga, sugerirTrocas, type Placar } from './motor';
import { carregarDataset } from './dataset';
import { carregar, codificar, decodificar, estadoVazio, idNaVaga, limpar, porNaVaga, salvar } from './estado';
import { esc } from './formato';
import { gerarPngStories, montarStories, nomeArquivoStories } from './stories';
import { normalizarNome } from './nomes';

const PERFIL = perfilJson.grupos;
const ROTULO_PERFIL = perfilJson.rotulos as Record<string, string>;
const UFS = ufsJson.ufs;
const TEMAS = temasJson.temas as Tema[];       // as pautas são as mesmas em todo o país
const LIMIAR_PICKER = 16;                       // acima disso, lista com busca em vez de select

let ds: Dataset | null = null;                  // dataset da UF escolhida
let st: EstadoEleitor = estadoVazio();
let passoAtual = 0;
let alheio = false;                             // placar aberto por link de outra pessoa
let placarAtual: Placar | null = null;
let trocas: { cargo: CargoId; vaga: number; de: string; para: string; forcaAntes: number }[] = [];   // trocas de teste feitas a partir das sugestões
const pickers = new Map<string, { escolher(c: Candidato): void; buscar(q: string): void }>();   // `${cargo}:${vaga}` → controles do picker montado na tela

type Passo =
  | { fase: string; tipo: 'uf'; h: string; d: string }
  | { fase: string; tipo: 'perfil'; h: string; d: string; itens: typeof PERFIL }
  | { fase: string; tipo: 'pautas'; h: string; d: string; itens: Tema[] }
  | { fase: string; tipo: 'decisivas'; h: string; d: string }
  | { fase: string; tipo: 'escala'; h: string; d: string; cargos: CargoId[] };

const PASSOS: Passo[] = [
  { fase: 'Onde você vota', tipo: 'uf', h: 'Qual é o seu estado?', d: 'Governador, senador e deputados são do seu estado. Presidente é o mesmo pra todo mundo.' },
  { fase: 'Sua vida', tipo: 'perfil', h: 'Quem é você', d: 'Isso define o eixo <b>BOLSO</b>: quais pautas batem direto na sua rotina. Nada sai do seu navegador.', itens: PERFIL.slice(0, 3) },
  { fase: 'Sua vida', tipo: 'perfil', h: 'Sua rotina', d: 'Mais três. Depois disso a gente já sabe que pautas mexem com você de verdade.', itens: PERFIL.slice(3, 6) }
];
const TITULOS = [
  { h: 'Dinheiro e saúde', d: 'Quatorze pautas que estão na mesa em 2026, três por vez. "Tanto faz" é resposta válida — ela sai da conta em vez de virar meio-termo falso.' },
  { h: 'O que é do Estado', d: '' }, { h: 'O custo de viver', d: '' }, { h: 'Juros, emendas e armas', d: '' }, { h: 'As duas últimas', d: '' }
];
for (let i = 0, k = 0; i < TEMAS.length; i += 3, k++) PASSOS.push({ fase: 'Suas posições', tipo: 'pautas', h: TITULOS[k]?.h ?? 'Mais pautas', d: TITULOS[k]?.d ?? '', itens: TEMAS.slice(i, i + 3) });
PASSOS.push({ fase: 'O que decide seu voto', tipo: 'decisivas', h: 'Escolha suas três', d: 'Dessas quatorze, quais <b>três</b> realmente decidem seu voto? É nelas que a gente vai caçar o gol contra — e elas pesam três vezes mais no eixo CAMISA.' });
PASSOS.push({ fase: 'A escalação', tipo: 'escala', h: 'Escale o time', d: 'Seus votos de 4 de outubro: presidente, governador e os <b>dois senadores</b> — em 2026 cada estado renova duas cadeiras no Senado, então você vota em duas pessoas diferentes. Em cada vaga a gente mostra <b>quem mais veste sua camisa</b> pelas pautas que você respondeu. Não é recomendação de voto: é só quem mais concorda com você — e o selo diz se é voto registrado ou estimativa do partido.', cargos: ['presidente', 'governador', 'senador'] });
PASSOS.push({ fase: 'A escalação', tipo: 'escala', h: 'Fechando o time', d: 'Os dois últimos — e são eles que mais pesam no placar de força. As sugestões seguem o mesmo critério: quem mais veste sua camisa pelas suas respostas.', cargos: ['federal', 'estadual'] });

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const cargoDe = (id: CargoId): Cargo | undefined => ds?.cargos.find(c => c.id === id);
const vagasDe = (id: CargoId): number => cargoDe(id)?.vagas ?? 1;
/* quem já ocupa outra vaga do mesmo cargo (não pode ser escolhido de novo) */
const ocupadosFora = (id: CargoId, vaga: number): Set<string> => new Set((st.time[id] ?? []).filter((x, i) => x && i !== vaga));

function completo(i: number): boolean {
  const p = PASSOS[i];
  if (p.tipo === 'uf') return !!st.uf && !!ds && ds.uf === st.uf;
  if (p.tipo === 'perfil') return p.itens.every(g => st.perfil[g.id]);
  if (p.tipo === 'pautas') return p.itens.every(t => st.respostas[t.id]);
  if (p.tipo === 'decisivas') return st.decisivas.length === 3;
  if (p.tipo === 'escala') return p.cargos.every(c => Array.from({ length: vagasDe(c) }, (_, v) => idNaVaga(st, c, v)).every(Boolean));
  return false;
}
/* a capa (#intro) só acompanha a primeira tela do wizard */
function mostrar(sec: 'wizard' | 'resultado') {
  $('wizard').hidden = sec !== 'wizard'; $('resultado').hidden = sec !== 'resultado';
  $('intro').hidden = sec !== 'wizard' || passoAtual !== 0;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function comecar(zerar = false) {
  if (zerar) { st = estadoVazio(); ds = null; limpar(); }
  alheio = false; trocas = []; passoAtual = 0; render(); mostrar('wizard');
}
/* retoma de onde a pessoa parou; com o time completo, vai direto pro placar */
async function continuar() {
  alheio = false;
  if (st.uf && (!ds || ds.uf !== st.uf)) await escolherUf(st.uf, false);
  passoAtual = PASSOS.findIndex((_, i) => !completo(i));
  if (passoAtual < 0) { passoAtual = PASSOS.length - 1; calcular(); return; }
  render(); mostrar('wizard');
}
function reescalar() { alheio = false; trocas = []; passoAtual = PASSOS.length - 2; render(); mostrar('wizard'); }
function voltar() { if (passoAtual === 0) return; passoAtual--; render(); }
function avancar() { if (passoAtual < PASSOS.length - 1) { passoAtual++; render(); } else calcular(); }
function talvezAvancar(eraCompleto: boolean) { salvar(st); atualizarNav(); if (!eraCompleto && completo(passoAtual)) setTimeout(avancar, 350); }
function atualizarNav() {
  const ok = completo(passoAtual);
  $('btnProx').hidden = !ok;
  $('btnProx').textContent = passoAtual === PASSOS.length - 1 ? 'Ver o placar →' : 'Próxima →';
  $('navHint').textContent = ok ? '' : 'avança sozinho quando você responde tudo';
}

/* ---------- UF ---------- */
async function escolherUf(uf: string, avancarDepois = true) {
  const antes = completo(passoAtual);
  if (st.uf !== uf) { st.time = {}; }        // trocou de estado: a escalação não vale mais
  st.uf = uf; salvar(st);
  const aviso = document.getElementById('ufAviso'); if (aviso) { aviso.hidden = false; aviso.textContent = `carregando os candidatos de ${UFS.find(u => u.sigla === uf)?.nome ?? uf}…`; }
  try { ds = await carregarDataset(uf); }
  catch (e) { if (aviso) aviso.textContent = `não consegui carregar os candidatos (${(e as Error).message}). Tenta de novo.`; return; }
  if (aviso) aviso.hidden = true;
  // escalação salva de outra visita pode ter ids que não existem mais
  for (const c of ds.cargos) (st.time[c.id] ?? []).forEach((id, v) => { if (id && !c.candidatos.some(x => x.id === id)) porNaVaga(st, c.id, v, undefined); });
  if (avancarDepois) talvezAvancar(antes);
}

/* ---------- render das telas ---------- */
function seloCand(c: Candidato): string {
  return c.nominais > 0 ? `<span class="selo real">${c.nominais} ${c.nominais > 1 ? 'votos nominais' : 'voto nominal'}</span>` : `<span class="selo est">estimativa</span>`;
}
function rotuloCand(c: Candidato): string {
  return `${esc(c.nome)} · ${esc(c.partido)}${c.numero ? ' · ' + esc(c.numero) : ''}${c.mandato ? ' · mandato atual' : ''}`;
}
function render() {
  const p = PASSOS[passoAtual];
  $('progFase').textContent = p.fase;
  $('progN').innerHTML = `tela <b>${passoAtual + 1}</b> de ${PASSOS.length}`;
  $('prog').innerHTML = PASSOS.map((_, i) => `<div class="seg ${i < passoAtual ? 'feito' : i === passoAtual ? 'atual' : ''}"></div>`).join('');

  let corpo = '';
  if (p.tipo === 'uf') {
    corpo = `<div class="q"><div class="q-n">Estado</div><div class="q-t">Onde você vota em 4 de outubro?</div>
      <div class="chips chips-uf">${UFS.map(u => `<button class="chip" type="button" aria-pressed="${st.uf === u.sigla}" data-uf="${u.sigla}" title="${esc(u.nome)}">${u.sigla}</button>`).join('')}</div>
      <div class="uf-aviso" id="ufAviso" hidden></div></div>`;
  } else if (p.tipo === 'perfil') {
    corpo = p.itens.map(g => `
      <div class="q"><div class="q-n">${esc(g.hint)}</div><div class="q-t">${esc(g.label)}</div>
        <div class="chips">${g.ops.map(o => `<button class="chip" type="button" aria-pressed="${st.perfil[g.id] === o.v}" data-perfil="${g.id}" data-v="${o.v}">${esc(o.l)}</button>`).join('')}</div>
      </div>`).join('');
  } else if (p.tipo === 'pautas') {
    corpo = p.itens.map(t => `
      <div class="q"><div class="q-t"><small>${esc(t.s)}</small>${esc(t.t)}</div>
        ${t.leia ? `<a class="leia" href="${esc(t.leia.url)}" target="_blank" rel="noopener" title="${esc(t.leia.rotulo)}">entender a pauta ↗ <span>${esc(t.leia.fonte)}</span></a>` : ''}
        <div class="tb-row">
          ${(['F', 'C', 'N'] as Resposta[]).map(v => `<button class="tb" type="button" data-v="${v}" data-resp="${t.id}" aria-pressed="${st.respostas[t.id] === v}">${v === 'F' ? 'A FAVOR' : v === 'C' ? 'CONTRA' : 'TANTO FAZ'}</button>`).join('')}
        </div>
      </div>`).join('');
  } else if (p.tipo === 'decisivas') {
    corpo = `<div class="dec-list">${TEMAS.map(t => {
      const on = st.decisivas.includes(t.id), travado = !on && st.decisivas.length >= 3;
      return `<button class="dec${travado ? ' travado' : ''}" type="button" aria-pressed="${on}" data-dec="${t.id}"><span class="st">${on ? '★' : '☆'}</span><span class="tx"><b>${esc(t.s)}</b>${esc(t.t)}</span></button>`;
    }).join('')}</div><div class="dec-c" id="decC">${st.decisivas.length} de 3 escolhidas</div>`;
  } else if (p.tipo === 'escala') {
    if (!ds) { passoAtual = 0; render(); return; }
    corpo = p.cargos.map(id => cargoDe(id)!).flatMap(c => Array.from({ length: c.vagas }, (_, v) => {
      const grande = c.candidatos.length > LIMIAR_PICKER;
      const sel = c.candidatos.find(x => x.id === idNaVaga(st, c.id, v)), outros = ocupadosFora(c.id, v);
      const campo = grande
        ? `<div class="picker" data-picker="${c.id}" data-vaga="${v}">
             <input class="picker-in" type="search" autocomplete="off" placeholder="nome, partido ou número" aria-label="${esc(c.nome)}" aria-expanded="false" ${sel ? 'hidden' : ''}>
             <div class="picker-list" role="listbox" hidden></div>
             <div class="picker-sel" ${sel ? '' : 'hidden'}>${sel ? `<div class="who">${esc(sel.nome)}<small>${esc(sel.partido)}${sel.numero ? ' · ' + esc(sel.numero) : ''} ${seloCand(sel)}</small></div>` : ''}<button class="picker-x" type="button">trocar</button></div>
           </div>`
        : `<select data-cargo="${c.id}" data-vaga="${v}" class="${sel ? 'ok' : ''}" aria-label="${esc(c.nome)}${c.vagas > 1 ? ` (${v + 1}ª vaga)` : ''}">
             <option value="">— escolher —</option>
             ${c.candidatos.map(k => `<option value="${esc(k.id)}" ${sel?.id === k.id ? 'selected' : ''} ${outros.has(k.id) ? 'disabled' : ''}>${rotuloCand(k)}</option>`).join('')}
           </select>`;
      const titulo = c.vagas > 1 ? `${esc(c.nome)}<span class="vaga">${v + 1}ª vaga de ${c.vagas}</span>` : esc(c.nome);
      const nota = c.vagas > 1 && v === 0 ? `<p class="vagas-nota">Seu estado elege <b>${c.vagas} senadores</b> este ano. Escolha duas pessoas diferentes: as duas entram no time e cada uma vale metade do peso do cargo.</p>` : '';
      return `<div class="q"><div class="q-n">${esc(c.meta)}</div><div class="q-t">${titulo}</div>${nota}${campo}<div class="sug-vaga" data-sug="${c.id}" data-vaga="${v}" ${sel ? 'hidden' : ''}></div></div>`;
    })).join('');
  }

  const tela = $('tela');
  tela.classList.remove('enter');
  tela.innerHTML = `<div class="tela-h">${esc(p.h)}</div>` + (p.d ? `<p class="tela-d">${p.d}</p>` : '<div style="height:10px"></div>') + corpo;
  void tela.offsetWidth; tela.classList.add('enter');
  $('btnVoltar').hidden = passoAtual === 0; $('btnVoltar').textContent = '← Voltar'; $('intro').hidden = passoAtual !== 0;
  atualizarNav();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  pickers.clear();
  if (p.tipo === 'escala') { tela.querySelectorAll<HTMLElement>('[data-picker]').forEach(montarPicker); p.cargos.forEach(renderSugestoesVaga); }
}

/* ---------- sugestões na escalação: quem mais veste a camisa em cada vaga ----------
   Ranking puro (motor.sugerirParaVaga) pelas respostas às pautas. Some quando a vaga está preenchida e
   volta no "trocar". Nas duas vagas de senador, quem já ocupa a outra não aparece. */
function renderSugestoesVaga(cargoId: CargoId) {
  const cargo = cargoDe(cargoId); if (!cargo) return;
  document.querySelectorAll<HTMLElement>(`.sug-vaga[data-sug="${cargoId}"]`).forEach(box => {
    const vaga = Number(box.dataset.vaga ?? 0);
    if (idNaVaga(st, cargoId, vaga)) { box.hidden = true; return; }
    box.hidden = false;
    const sug = sugerirParaVaga(cargo, st, TEMAS, ocupadosFora(cargoId, vaga));
    const cab = `<div class="sug-vaga-h">Pelas suas respostas · quem mais veste sua camisa</div>`;
    if (!sug.length) { box.innerHTML = cab + `<div class="sv-vazio">Sem sugestão aqui: você marcou "tanto faz" em todas as pautas, então não tem com o que comparar.</div>`; return; }
    const grande = cargo.candidatos.length > LIMIAR_PICKER;
    box.innerHTML = cab + sug.map(x => {
      const c = x.candidato;
      const dec = x.decisivas.total ? ` · <b>${x.decisivas.batem}</b> de ${x.decisivas.total} decisivas` : '';
      const iguais = x.iguais > 0 ? `<div class="sv-nota">+ ${x.iguais} do ${esc(c.partido)} com as mesmas posições — pra camisa, tanto faz qual.${grande ? ` <button class="sv-ver" type="button" data-ver="${esc(c.partido)}" data-cargo="${esc(cargoId)}" data-vaga="${vaga}">ver os ${x.iguais + 1}</button>` : ''}</div>` : '';
      return `<div class="sv"><div class="sv-num">${x.camisa}<small>camisa</small></div>
        <div class="sv-corpo">
          <div class="sv-t">${esc(c.nome)} <small>${esc(c.partido)}${c.numero ? ' · ' + esc(c.numero) : ''}</small> ${seloCand(c)}</div>
          <div class="sv-l">bate em <b>${x.batem}</b> das ${x.contam} pautas que você respondeu${dec}</div>
          ${iguais}
          <button class="sv-btn" type="button" data-escalar="${esc(c.id)}" data-cargo="${esc(cargoId)}" data-vaga="${vaga}">escalar</button>
        </div></div>`;
    }).join('') + (cargo.candidatos.length > sug.length ? `<div class="sv-rodape">${sug.length === MAX_SUGESTOES_VAGA ? `As ${MAX_SUGESTOES_VAGA} melhores camisas` : 'Todas as camisas'} entre ${cargo.candidatos.length} candidatos. A lista completa está acima${grande ? ', com busca por nome, número ou partido' : ''}.</div>` : '');
  });
}
function escalarSugestao(cargoId: CargoId, vaga: number, id: string) {
  const cargo = cargoDe(cargoId), c = cargo?.candidatos.find(x => x.id === id); if (!cargo || !c) return;
  const picker = pickers.get(`${cargoId}:${vaga}`);
  if (picker) { picker.escolher(c); return; }
  const sel = document.querySelector<HTMLSelectElement>(`select[data-cargo="${cargoId}"][data-vaga="${vaga}"]`); if (!sel) return;
  sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ---------- picker com busca ---------- */
function montarPicker(el: HTMLElement) {
  const cargoId = el.dataset.picker as CargoId, vaga = Number(el.dataset.vaga ?? 0);
  const cargo = cargoDe(cargoId)!;
  const input = el.querySelector<HTMLInputElement>('.picker-in')!, lista = el.querySelector<HTMLElement>('.picker-list')!, selBox = el.querySelector<HTMLElement>('.picker-sel')!;
  let foco = -1, visiveis: Candidato[] = [];
  const indice = cargo.candidatos.map(c => ({ c, n: normalizarNome(`${c.nome} ${c.partido} ${c.numero ?? ''} ${ds!.partidos[c.partido]?.nome ?? ''}`) }));
  function filtrar() {
    const q = normalizarNome(input.value), outros = ocupadosFora(cargoId, vaga);
    visiveis = (q ? indice.filter(i => q.split(' ').every(t => i.n.includes(t))) : indice).filter(i => !outros.has(i.c.id)).slice(0, 12).map(i => i.c);
    foco = -1;
    lista.innerHTML = visiveis.length
      ? visiveis.map(c => `<button class="picker-op" type="button" role="option" data-id="${esc(c.id)}"><span>${esc(c.nome)}</span><small>${esc(c.partido)}${c.numero ? ' · ' + esc(c.numero) : ''} ${seloCand(c)}</small></button>`).join('') + (!q && cargo.candidatos.length > 12 ? `<div class="picker-vazio">… e mais ${cargo.candidatos.length - 12}. Digita o nome, o número ou o partido.</div>` : '')
      : `<div class="picker-vazio">ninguém com "${esc(input.value)}" — tenta só o sobrenome, o número ou a sigla do partido</div>`;
    lista.hidden = false; input.setAttribute('aria-expanded', 'true');
  }
  function escolher(c: Candidato) {
    if (ocupadosFora(cargoId, vaga).has(c.id)) return;   // já está na outra vaga
    const antes = completo(passoAtual);
    porNaVaga(st, cargoId, vaga, c.id);
    lista.hidden = true; input.hidden = true; input.setAttribute('aria-expanded', 'false');
    selBox.hidden = false;
    selBox.innerHTML = `<div class="who">${esc(c.nome)}<small>${esc(c.partido)}${c.numero ? ' · ' + esc(c.numero) : ''} ${seloCand(c)}</small></div><button class="picker-x" type="button">trocar</button>`;
    selBox.querySelector('.picker-x')!.addEventListener('click', trocar);
    renderSugestoesVaga(cargoId);
    talvezAvancar(antes);
  }
  function trocar() {
    porNaVaga(st, cargoId, vaga, undefined); salvar(st);
    selBox.hidden = true; input.hidden = false; input.value = ''; input.focus(); atualizarNav();
    renderSugestoesVaga(cargoId);
  }
  function buscar(q: string) { input.value = q; input.hidden = false; input.focus(); filtrar(); }
  input.addEventListener('focus', filtrar);
  input.addEventListener('input', filtrar);
  input.addEventListener('keydown', e => {
    if (lista.hidden) return;
    const ops = [...lista.querySelectorAll<HTMLElement>('.picker-op')];
    if (e.key === 'ArrowDown') { e.preventDefault(); foco = Math.min(ops.length - 1, foco + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); foco = Math.max(0, foco - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (foco >= 0 && visiveis[foco]) escolher(visiveis[foco]); else if (visiveis.length === 1) escolher(visiveis[0]); return; }
    else if (e.key === 'Escape') { lista.hidden = true; return; }
    else return;
    ops.forEach((o, i) => o.setAttribute('aria-selected', String(i === foco)));
    ops[foco]?.scrollIntoView({ block: 'nearest' });
  });
  lista.addEventListener('mousedown', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.picker-op'); if (!b) return;
    e.preventDefault(); const c = cargo.candidatos.find(x => x.id === b.dataset.id); if (c) escolher(c);
  });
  input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; input.setAttribute('aria-expanded', 'false'); }, 150));
  selBox.querySelector('.picker-x')?.addEventListener('click', trocar);
  pickers.set(`${cargoId}:${vaga}`, { escolher, buscar });
}

/* ---------- handlers delegados ---------- */
function onClickTela(e: Event) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button'); if (!el) return;
  if (el.dataset.uf) {
    el.parentElement!.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    el.setAttribute('aria-pressed', 'true');
    void escolherUf(el.dataset.uf);
  } else if (el.dataset.perfil) {
    const antes = completo(passoAtual);
    st.perfil[el.dataset.perfil] = el.dataset.v!;
    el.parentElement!.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    el.setAttribute('aria-pressed', 'true'); talvezAvancar(antes);
  } else if (el.dataset.resp) {
    const antes = completo(passoAtual);
    st.respostas[el.dataset.resp] = el.dataset.v as Resposta;
    el.parentElement!.querySelectorAll('.tb').forEach(b => b.setAttribute('aria-pressed', 'false'));
    el.setAttribute('aria-pressed', 'true'); talvezAvancar(antes);
  } else if (el.dataset.escalar) {
    escalarSugestao(el.dataset.cargo as CargoId, Number(el.dataset.vaga ?? 0), el.dataset.escalar);
  } else if (el.dataset.ver) {
    pickers.get(`${el.dataset.cargo}:${Number(el.dataset.vaga ?? 0)}`)?.buscar(el.dataset.ver);
  } else if (el.dataset.dec) {
    const antes = completo(passoAtual), id = el.dataset.dec;
    if (st.decisivas.includes(id)) st.decisivas = st.decisivas.filter(x => x !== id);
    else { if (st.decisivas.length >= 3) return; st.decisivas = [...st.decisivas, id]; }
    const lista = document.querySelector('.dec-list')!;
    TEMAS.forEach((t, i) => {
      const b = lista.children[i] as HTMLElement, on = st.decisivas.includes(t.id);
      b.setAttribute('aria-pressed', String(on)); b.classList.toggle('travado', !on && st.decisivas.length >= 3);
      b.querySelector('.st')!.textContent = on ? '★' : '☆';
    });
    $('decC').textContent = `${st.decisivas.length} de 3 escolhidas`;
    talvezAvancar(antes);
  }
}
function onChangeTela(e: Event) {
  const sel = e.target as HTMLSelectElement; if (!sel.dataset.cargo) return;
  const cargoId = sel.dataset.cargo as CargoId, vaga = Number(sel.dataset.vaga ?? 0);
  const antes = completo(passoAtual);
  porNaVaga(st, cargoId, vaga, sel.value || undefined);
  sel.classList.toggle('ok', !!sel.value);
  // nas outras vagas do mesmo cargo, quem já foi escolhido fica indisponível
  document.querySelectorAll<HTMLSelectElement>(`select[data-cargo="${cargoId}"]`).forEach(o => {
    if (o === sel) return;
    const outros = ocupadosFora(cargoId, Number(o.dataset.vaga ?? 0));
    for (const op of o.options) op.disabled = !!op.value && outros.has(op.value);
  });
  renderSugestoesVaga(cargoId);
  talvezAvancar(antes);
}

/* ==========================================================================
   RESULTADO
   ========================================================================== */
function counter(el: HTMLElement, ate: number, sufixo = '') {
  const dur = 900, ini = performance.now();
  const step = (now: number) => { const p = Math.min(1, (now - ini) / dur), e = 1 - Math.pow(1 - p, 3); el.innerHTML = Math.round(ate * e) + sufixo; if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const LADO = (l: string) => l === 'F' ? '<span class="f">A FAVOR</span>' : l === 'C' ? '<span class="c">CONTRA</span>' : '<span>DIVIDIDO</span>';
const fonteTag = (c: Candidato, temaId: string) => c.posicoes[temaId]?.fonte === 'voto_nominal' ? '<span class="selo real">voto</span>' : '<span class="selo est">est.</span>';
const casaNome = (casa: string, d: Dataset) => casa === 'camara' ? 'na Câmara' : casa === 'senado' ? 'no Senado' : `na ${d.casaEstadual}`;

function calcular() {
  if (!ds) { passoAtual = 0; render(); return; }
  const placar = calcularPlacar(st, ds);   // null = alguma vaga vazia (as duas de senador contam)
  if (!placar) { passoAtual = PASSOS.length - 2; render(); return; }
  placarAtual = placar; salvar(st);
  renderResultado(placar, ds);
}
function renderResultado(p: Placar, d: Dataset) {
  const res = $('resultado'); mostrar('resultado'); res.classList.add('on');
  limparStories();                               // a imagem é do placar anterior
  $('alheio').hidden = !alheio;
  if (alheio) $('alheio').innerHTML = `Você abriu o <b>placar de outra pessoa</b> (${esc(d.nomeUf)}). As respostas e a escalação são dela. <button class="picker-x" id="btnMeu" type="button">escalar o meu</button>`;
  $('btnMeu')?.addEventListener('click', () => comecar(true));

  counter($('forcaNum'), p.forca, '<small>/100</small>'); counter($('coerNum'), p.coerencia); counter($('pesoNum'), p.peso);
  const v = $('veredito'); v.className = 'veredito ' + p.veredito.c; v.textContent = p.veredito.t;
  $('vereditoDesc').textContent = p.veredito.d;
  $('coerH').textContent = p.decisivas.length ? `medida só nas ${p.decisivas.length} pautas que você marcou como decisivas` : `medida nas ${TEMAS.length} pautas`;
  $('pesoH').textContent = 'quanto do quórum de aprovação seu time cobre';
  renderTeste(p);
  renderLeitura(p, d);

  const g = $('gols'); g.className = 'gols' + (p.gols.length ? '' : ' zero');
  if (!p.gols.length) {
    g.innerHTML = `<div class="gols-h"><span class="gols-n">0</span><span class="gols-t">gol contra</span></div>
      <div class="gol">Nas pautas que você marcou como decisivas, ninguém do seu time joga contra o outro. Coerência não é pouco — mas confira o peso ao lado antes de comemorar.</div>`;
  } else {
    g.innerHTML = `<div class="gols-h"><span class="gols-n">${p.gols.length}</span><span class="gols-t">gol${p.gols.length > 1 ? 's' : ''} contra</span></div>` +
      p.gols.slice(0, 6).map(x => `<div class="gol">Em <b>${esc(x.tema.s.toLowerCase())}</b>, ${x.a.cargo.id === x.b.cargo.id ? `seus dois ${esc(x.a.cargo.curto)}es` : `seu ${esc(x.a.cargo.curto)} e seu ${esc(x.b.cargo.curto)}`} votam em lados opostos.
        <span class="vs">${esc(x.a.candidato.nome)} (${esc(x.a.candidato.partido)}) ${LADO(x.pa)} ${fonteTag(x.a.candidato, x.tema.id)} &nbsp;×&nbsp; ${esc(x.b.candidato.nome)} (${esc(x.b.candidato.partido)}) ${LADO(x.pb)} ${fonteTag(x.b.candidato, x.tema.id)}</span></div>`).join('') +
      (p.gols.length > 6 ? `<div class="gol" style="color:var(--muted)">+ ${p.gols.length - 6} outros embates no mesmo time.</div>` : '');
  }
  renderSugestoes(p, d);

  const linhas = p.linhas.map(l => {
    const c = l.e.candidato;
    const selo = c.nominais > 0 ? `${c.nominais} DE ${TEMAS.length} PAUTAS COM VOTO NOMINAL · RESTO ESTIMADO PELO PARTIDO` : d.partidos[c.partido]?.semOrientacao ? 'PARTIDO SEM ORIENTAÇÃO PÚBLICA CONSOLIDADA' : 'POSIÇÃO ESTIMADA PELO PARTIDO';
    return `<div class="row"><div class="who">${esc(c.nome)}<small>${esc(l.e.cargo.nome.toUpperCase())} · ${esc(c.partido)} · ${selo}</small></div>
      <div class="sc camisa">${l.camisa === null ? '—' : l.camisa}</div><div class="sc bolso">${l.bolso === null ? '—' : l.bolso.score}</div></div>`;
  }).join('');
  let div = '';
  if (p.divergencia && p.divergencia.d > 0) div = `<div class="divergencia">O buraco do seu time: você concorda com <b>${esc(p.divergencia.e.candidato.nome)}</b> em <b>${p.divergencia.camisa}%</b> das ideias — mas das <b>${p.divergencia.bolso.total}</b> pautas que batem direto na sua vida, ele defende <b>${p.divergencia.bolso.defende}</b>. Você veste a camisa dele. Ele não veste a sua.</div>`;
  else if (p.divergencia) div = `<div class="divergencia">Curioso: <b>${esc(p.divergencia.e.candidato.nome)}</b> defende mais pautas que mexem no seu bolso (<b>${p.divergencia.bolso.score}</b>) do que ideias com que você concorda (<b>${p.divergencia.camisa}</b>). Seu voto de consciência e seu voto de sobrevivência não são a mesma pessoa.</div>`;
  $('tabela').innerHTML = `<h3>Seu time, candidato por candidato</h3><div class="row head"><span>quem</span><span>camisa</span><span>bolso</span></div>${linhas}${div}`;

  const { ativas, conflitos } = p.bolso;
  const votosReais = p.escalados.flatMap(e => TEMAS.filter(t => e.candidato.posicoes[t.id]?.fonte === 'voto_nominal').map(t => `<li><b>${esc(e.candidato.nome)}</b> em <b>${esc(t.s)}</b>: ${esc(e.candidato.posicoes[t.id].detalhe ?? '')}</li>`));
  $('metodoBody').innerHTML = `
    <h4>Eixo CAMISA — você e ele pensam igual?</h4>
    Concordância ponderada entre as suas respostas e a posição do candidato nas ${TEMAS.length} pautas. Igual = <code>1</code>, dividido = <code>0.5</code>, oposto = <code>0</code>. Pauta decisiva pesa <code>3×</code>. "Tanto faz" sai da conta.
    <h4>De onde vem a posição de cada um</h4>
    Quem tem mandato e votou numa das votações mapeadas recebe a posição do <b>voto nominal</b>; o resto é <b>estimativa pela orientação pública do partido</b>.
    ${votosReais.length ? `<ul>${votosReais.join('')}</ul>` : 'Neste time ninguém tem voto nominal registrado nas pautas mapeadas — tudo é estimativa partidária.'}
    <h4>Eixo BOLSO — as pautas dele mexem na sua vida?</h4>
    Seu perfil ativou <b>${ativas.length}</b> das ${TEMAS.length} pautas. Pra cada uma a gente marca <b>qual lado protege quem está na sua situação</b> — e o critério está aqui, aberto:
    <ul>${ativas.map(a => `<li><b>${esc(a.tema.s)}</b>: no seu caso protege quem é <code>${a.lado === 'F' ? 'a favor' : 'contra'}</code> — "${esc(a.tema.t)}"</li>`).join('')}</ul>
    ${conflitos.length ? `<h4>Pauta que divide você mesmo</h4>${conflitos.map(c => `<b>${esc(c.tema.s)}</b> ficou de fora do score: ${c.lados.map(l => `<code>${esc(ROTULO_PERFIL[l.perfil] ?? l.perfil)}</code> puxa <b>${l.lado === 'F' ? 'a favor' : 'contra'}</b>`).join(' e ')}. Sua própria vida joga nos dois times aqui — então a gente não escolhe por você.`).join('<br>')}` : ''}
    Discorda de algum critério? Ótimo — ele está exposto de propósito. Critério escondido é editorial disfarçado de dado.
    <h4>Coerência — seu time joga junto?</h4>
    Concordância média entre <b>todos os ${p.escalados.length * (p.escalados.length - 1) / 2} pares</b> possíveis dos ${p.escalados.length} escalados (os dois senadores são dois jogadores), ${p.decisivas.length ? `medida só nas <b>${p.decisivas.length}</b> pautas que você marcou como decisivas` : `medida nas ${TEMAS.length} pautas`}. Onde um está a favor e o outro contra, é <b>gol contra</b>.
    <h4>Peso — seu time consegue aprovar?</h4>
    Um deputado sozinho vale 1 voto em 513. O que aprova é a <b>bancada</b>. O peso mede quanto do quórum o time cobre:
    <ul>${p.detalhePeso.map(x => `<li><b>${esc(x.k)}</b>${(cargoDe(x.cargo)?.vagas ?? 1) > 1 ? ` (${esc(x.nome)})` : ''} — ${x.porCampo
      ? (x.campo ? `o campo ${x.campo === 'esq' ? 'da esquerda' : x.campo === 'dir' ? 'da direita' : 'do centro'} soma <b>${x.cadeiras}</b> cadeiras ${casaNome(x.casa, d)} — é com isso que ele aprova ou trava` : `o ${esc(x.partido)} não está classificado em nenhum campo, então entra com <b>0</b> — sem chute`)
      : `a bancada do ${esc(x.partido)} tem <b>${x.cadeiras}</b> das <b>${x.quorum}</b> cadeiras da maioria ${casaNome(x.casa, d)}`} → <code>${x.v}</code></li>`).join('')}</ul>
    Média ponderada: ${d.cargos.map(c => `${c.curto} ${Math.round(c.pesoNoPlacar * 100)}%${c.vagas > 1 ? ` (${Math.round(c.pesoNoPlacar / c.vagas * 100)}% por vaga)` : ''}`).join(', ')}. Bancadas da ${esc(d.casaEstadual)}: composição eleita em 2022.
    <h4>Força do time</h4>
    <code>força = 2 × (coerência × peso) ÷ (coerência + peso)</code> — média harmônica. Ela <b>derruba</b> quem é ótimo num eixo e péssimo no outro. Um time 100% coerente e 10% pesado dá <code>18</code>, não <code>55</code>. A leitura logo abaixo do placar diz qual eixo está segurando o seu e quanto cada 10 pontos valeriam hoje.
    <h4>Sugestões de troca</h4>
    Simulação, não recomendação de voto. Pra cada vaga do time (as duas de senador contam separado), trocamos o escalado por cada candidato (quem tem partido e posições idênticos entra como um grupo), mantemos os outros cinco, recalculamos o placar inteiro e mostramos a troca que mais sobe a força — desde que o novo vista a sua camisa pelo menos tanto quanto o atual (tolerância de <code>${TOLERANCIA_CAMISA}</code> pontos). Quem deixaria o time mais forte te afastando do que você pensa não aparece.
    Método completo, votações usadas e cobertura por pauta em <a href="/metodo/">/metodo</a>.`;

  const fontes = document.getElementById('fontes');
  if (fontes) fontes.innerHTML = '<b>Fontes:</b> ' + d.fontes.map(f => `<b>${esc(f.rotulo)}:</b> ${esc(f.detalhe)}`).join(' · ') + '. Método completo e lista das votações usadas em <a href="/metodo/">/metodo</a>.';
}

/* ---------- leitura da força: por que o número é esse ---------- */
const CAMPO_NOME = (c?: string) => c === 'esq' ? 'da esquerda' : c === 'dir' ? 'da direita' : 'do centro';
function renderLeitura(p: Placar, d: Dataset) {
  const l = leituraDaForca(p);
  let abre: string;
  if (l.gargalo === 'peso') abre = `O que segura seu time é o <b>peso</b>. A força é a média harmônica dos dois eixos, e ela puxa pro mais fraco: com peso <b>${p.peso}</b>, até uma coerência de 100 daria força <b>${l.seCoerencia100}</b>. O que falta aqui é cadeira.`;
  else if (l.gargalo === 'coerencia') abre = `O que segura seu time é a <b>coerência</b>. A força é a média harmônica dos dois eixos, e ela puxa pro mais fraco: com coerência <b>${p.coerencia}</b>, até um peso de 100 daria força <b>${l.sePeso100}</b>. Seu time tem cadeira e gasta o voto brigando entre si.`;
  else abre = `Coerência (<b>${p.coerencia}</b>) e peso (<b>${p.peso}</b>) andam juntos: nenhum dos dois está derrubando o outro. A força é a média harmônica deles, então pra subir de verdade os dois precisam subir.`;
  const itens = [`<b>Cada 10 pontos</b> a mais de peso valem <b>+${l.ganho10.peso}</b> na força agora; 10 de coerência, <b>+${l.ganho10.coerencia}</b>.`];
  if (l.vazaPeso) {
    const x = l.vazaPeso, cargoX = cargoDe(x.cargo), curto = (cargoX?.curto ?? x.k) + ((cargoX?.vagas ?? 1) > 1 ? ' ' + esc(x.nome) : '');
    const motivo = x.porCampo
      ? (x.campo ? `o campo ${CAMPO_NOME(x.campo)} tem ${x.cadeiras} das ${x.quorum} cadeiras da maioria ${casaNome(x.casa, d)}` : `o ${esc(x.partido)} não está classificado em campo nenhum e entra com zero`)
      : `a bancada do ${esc(x.partido)} tem ${x.cadeiras} das ${x.quorum} cadeiras da maioria ${casaNome(x.casa, d)}`;
    itens.push(`<b>Onde o peso vaza:</b> seu ${esc(curto)} (${esc(x.partido)}) — ${motivo}. Esse cargo vale até <b>${Math.round(x.pesoNoPlacar * 100)}</b> pontos do peso e está entregando <b>${x.entrega}</b>.`);
  }
  if (l.golsPorJogador.length && p.gols.length) {
    const g = l.golsPorJogador[0], quem = g.e.cargo.vagas > 1 ? `${esc(g.e.cargo.curto)} ${esc(g.e.candidato.nome)}` : esc(g.e.cargo.curto);
    itens.push(`<b>Quem mais faz gol contra:</b> seu ${quem} está em <b>${g.n}</b> dos ${p.gols.length} gol${p.gols.length > 1 ? 's' : ''} contra.`);
  }
  $('leitura').innerHTML = `<div class="leitura-h">Lendo o placar</div><p>${abre}</p><ul>${itens.map(i => `<li>${i}</li>`).join('')}</ul>`;
}

/* ---------- sugestões: que troca de um jogador deixa o time mais forte ---------- */
function renderSugestoes(p: Placar, d: Dataset) {
  const sug = sugerirTrocas(st, d, p);
  const intro = `<div class="sug-h">Como deixar o time <span>mais forte</span></div>
    <p class="sug-d">Simulação, não recomendação de voto: a gente troca <b>um jogador por vez</b> (cada senador é um jogador), mantém os outros cinco e recalcula tudo. Só entra quem veste a sua camisa tanto quanto o atual (tolerância de ${TOLERANCIA_CAMISA} pontos) — ficar forte trocando de lado não vale.</p>`;
  if (!sug.length) {
    $('sugestoes').innerHTML = intro + `<div class="sug vazio">Nenhuma troca de um jogador só deixa seu time mais forte sem te afastar do que você pensa. Ou ele já está no teto do que as suas respostas permitem, ou o que falta é cadeira — e cadeira não se inventa.</div>`;
    return;
  }
  const seta = (a: number, b: number) => `${a} → <b>${b}</b>`;
  $('sugestoes').innerHTML = intro + sug.map(s => {
    const quem = s.iguais > 0 ? `alguém do <b>${esc(s.para.partido)}</b>` : `<b>${esc(s.para.nome)}</b> (${esc(s.para.partido)})`;
    const nota = s.iguais > 0 ? `${s.iguais + 1} candidatos do ${esc(s.para.partido)} entram com as mesmas posições — pro placar, tanto faz qual. Pra testar, a gente escala ${esc(s.para.nome)}; depois você troca por quem quiser.` : '';
    const camisa = s.camisa.para === null ? '' : `veste sua camisa em <b>${s.camisa.para}</b>${s.camisa.de !== null ? ` (o atual: ${s.camisa.de})` : ''}`;
    const vira = s.placar.veredito.chave !== p.veredito.chave ? ` · vira <b>${esc(s.placar.veredito.t)}</b>` : '';
    return `<div class="sug">
      <div class="sug-ganho">+${s.delta.forca}</div>
      <div class="sug-corpo">
        <div class="sug-t">Trocar seu ${esc(s.cargo.curto)} por ${quem}</div>
        <div class="sug-l">no lugar de ${esc(s.de.nome)} (${esc(s.de.partido)})</div>
        <div class="sug-num">força ${seta(p.forca, s.placar.forca)} · coerência ${seta(p.coerencia, s.placar.coerencia)} · peso ${seta(p.peso, s.placar.peso)} · gols contra ${seta(p.gols.length, s.placar.gols.length)}${vira}</div>
        ${camisa ? `<div class="sug-cam">${camisa} ${seloCand(s.para)}</div>` : ''}
        ${nota ? `<div class="sug-nota">${nota}</div>` : ''}
        ${alheio ? '' : `<button class="sug-btn" type="button" data-troca="${esc(s.cargo.id)}" data-vaga="${s.vaga}" data-para="${esc(s.para.id)}">Testar essa troca</button>`}
      </div></div>`;
  }).join('');
}
function testarTroca(cargoId: CargoId, vaga: number, paraId: string) {
  if (!ds || !placarAtual || alheio) return;
  const de = idNaVaga(st, cargoId, vaga); if (!de || (st.time[cargoId] ?? []).includes(paraId)) return;
  trocas.push({ cargo: cargoId, vaga, de, para: paraId, forcaAntes: placarAtual.forca });
  porNaVaga(st, cargoId, vaga, paraId);
  calcular();
}
function desfazerTroca() {
  const t = trocas.pop(); if (!t) return;
  porNaVaga(st, t.cargo, t.vaga, t.de);
  calcular();
}
function renderTeste(p: Placar) {
  const box = $('teste'), t = trocas[trocas.length - 1];
  box.hidden = !t; if (!t) return;
  const cargo = cargoDe(t.cargo), de = cargo?.candidatos.find(c => c.id === t.de), para = cargo?.candidatos.find(c => c.id === t.para);
  const delta = p.forca - t.forcaAntes;
  box.innerHTML = `<span><b>Troca de teste:</b> ${esc(para?.nome)} (${esc(para?.partido)}) entrou no lugar de ${esc(de?.nome)} (${esc(de?.partido)}) como ${esc(cargo?.curto)}. Força: ${t.forcaAntes} → <b>${p.forca}</b> (${delta >= 0 ? '+' : ''}${delta}).</span>
    <span class="acoes"><button class="picker-x" id="btnDesfazer" type="button">desfazer</button><button class="picker-x" id="btnManter" type="button">manter</button></span>`;
  $('btnDesfazer').addEventListener('click', desfazerTroca);
  $('btnManter').addEventListener('click', () => { trocas = []; box.hidden = true; });
}

/* ---------- compartilhar ---------- */
function textoPlacar(p: Placar): string {
  return `⚽ MEU TIME POLÍTICO 2026 — meu placar (${st.uf})

Força do time: ${p.forca}/100
${p.veredito.t}

Coerência: ${p.coerencia}/100 — eles jogam junto?
Peso: ${p.peso}/100 — eles aprovam alguma coisa?
Gols contra: ${p.gols.length}

Minha escalação:
${p.escalados.map(e => `· ${e.cargo.nome}: ${e.candidato.nome} (${e.candidato.partido})`).join('\n')}

Escala o teu e me diz quantos gols contra deu 👇
${linkPlacar()}`;
}
function linkPlacar(): string { return `${location.origin}/app/#s=${codificar(st)}`; }
async function copiar(txt: string, btn: HTMLButtonElement, ok: string) {
  const o = btn.textContent;
  try { await navigator.clipboard.writeText(txt); btn.textContent = ok; }
  catch { prompt('Copie:', txt); return; }
  setTimeout(() => { btn.textContent = o; }, 2600);
}

/* ---------- imagem pro stories ----------
   Um PNG 1080×1920 desenhado no navegador (src/lib/stories.ts). No celular, o botão abre a folha
   de compartilhar do sistema (Instagram aparece lá); onde não dá, baixa o arquivo. */
let storiesPng: { blob: Blob; url: string } | null = null;
function limparStories() {
  if (storiesPng) URL.revokeObjectURL(storiesPng.url);
  storiesPng = null;
  const box = document.getElementById('stories'); if (box) box.hidden = true;
}
function arquivoStories(): File { return new File([storiesPng!.blob], nomeArquivoStories(st.uf), { type: 'image/png' }); }
function podeCompartilharArquivo(): boolean {
  try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [arquivoStories()] }); }
  catch { return false; }
}
async function prepararStories(btn: HTMLButtonElement) {
  if (!placarAtual || !ds) return;
  const o = btn.textContent; btn.disabled = true; btn.textContent = 'montando a imagem…';
  try {
    if (!storiesPng) {
      const blob = await gerarPngStories(montarStories(placarAtual, ds.nomeUf, location.host, !alheio));
      storiesPng = { blob, url: URL.createObjectURL(blob) };
    }
    const box = $('stories');
    $<HTMLImageElement>('storiesImg').src = storiesPng.url;
    const celular = podeCompartilharArquivo();
    $('btnStoriesShare').hidden = !celular;
    $('storiesDesktop').hidden = celular;
    $('storiesDica').innerHTML = celular
      ? 'Toca em <b>mandar pro Instagram</b>: abre a folha de compartilhar do celular, você escolhe o Instagram e depois <b>Stories</b>. Cola o <b>link do placar</b> num sticker de link pra quem vê conseguir escalar o dele.'
      : 'Baixa a imagem, manda pra você mesmo e posta nos <b>Stories</b> pelo celular. Cola o <b>link do placar</b> num sticker de link pra quem vê conseguir escalar o dele.';
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error('imagem pros stories:', e);
    btn.textContent = 'a imagem não saiu — tenta de novo'; setTimeout(() => { btn.textContent = o; }, 3500); btn.disabled = false; return;
  }
  btn.textContent = o; btn.disabled = false;
}
async function compartilharStories(btn: HTMLButtonElement) {
  if (!storiesPng || !placarAtual) return;
  const texto = `⚽ Meu time político 2026: força ${placarAtual.forca}/100, ${placarAtual.gols.length} gol${placarAtual.gols.length === 1 ? '' : 's'} contra. Escala o teu: ${linkPlacar()}`;
  try { await navigator.share({ files: [arquivoStories()], title: 'Meu Time Político 2026', text: texto }); }
  catch (e) {
    if ((e as Error).name === 'AbortError') return;   // a pessoa fechou a folha de compartilhar
    baixarStories(btn);
  }
}
function baixarStories(btn: HTMLButtonElement) {
  if (!storiesPng) return;
  const a = document.createElement('a');
  a.href = storiesPng.url; a.download = nomeArquivoStories(st.uf); a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  const o = btn.textContent; btn.textContent = '✓ imagem salva'; setTimeout(() => { btn.textContent = o; }, 2600);
}

/* ---------- boot ---------- */
async function abrirLinkCompartilhado(): Promise<boolean> {
  const m = location.hash.match(/[#&]s=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  const outro = decodificar(m[1]);
  if (!outro?.uf) return false;
  try {
    const d = await carregarDataset(outro.uf);
    const placar = calcularPlacar(outro, d);
    if (!placar) return false;
    // o estado alheio vive só nesta visita; não sobrescreve o que a pessoa já tinha salvo
    st = outro; ds = d; alheio = true; placarAtual = placar; renderResultado(placar, d);
    return true;
  } catch { return false; }
}
export async function iniciar() {
  $('btnVoltar').addEventListener('click', voltar);
  $('btnProx').addEventListener('click', avancar);
  $('btnReescalar').addEventListener('click', reescalar);
  $('btnZerar').addEventListener('click', () => comecar(true));
  $('btnCopiar').addEventListener('click', e => { if (placarAtual) copiar(textoPlacar(placarAtual), e.currentTarget as HTMLButtonElement, '✓ copiado — cola no zap'); });
  $('btnLink').addEventListener('click', e => copiar(linkPlacar(), e.currentTarget as HTMLButtonElement, '✓ link copiado'));
  $('btnStories').addEventListener('click', e => { void prepararStories(e.currentTarget as HTMLButtonElement); });
  $('btnStoriesShare').addEventListener('click', e => { void compartilharStories(e.currentTarget as HTMLButtonElement); });
  $('btnStoriesBaixar').addEventListener('click', e => baixarStories(e.currentTarget as HTMLButtonElement));
  $('btnStoriesLink').addEventListener('click', e => copiar(linkPlacar(), e.currentTarget as HTMLButtonElement, '✓ link copiado'));
  $('btnStoriesFechar').addEventListener('click', () => { $('stories').hidden = true; });
  $('tela').addEventListener('click', onClickTela);
  $('tela').addEventListener('change', onChangeTela);
  $('sugestoes').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-troca]'); if (!b) return;
    testarTroca(b.dataset.troca as CargoId, Number(b.dataset.vaga ?? 0), b.dataset.para!);
  });
  document.querySelector('.brand')?.addEventListener('click', e => { e.preventDefault(); alheio = false; passoAtual = 0; render(); mostrar('wizard'); });
  document.addEventListener('keydown', e => {
    if ($('wizard').hidden || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'ArrowLeft') voltar();
    if ((e.key === 'ArrowRight' || e.key === 'Enter') && completo(passoAtual)) avancar();
  });

  if (await abrirLinkCompartilhado()) return;
  window.addEventListener('hashchange', () => { void abrirLinkCompartilhado(); });
  // a capa já vem com a primeira pergunta; quem já começou retoma de onde parou (time completo vai pro placar)
  const salvo = carregar();
  if (salvo && (salvo.uf || Object.keys(salvo.perfil).length || Object.keys(salvo.respostas).length)) { st = salvo; await continuar(); }
  else comecar(false);
}
