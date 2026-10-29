/* A peça visual de cada post, um "slide" por item, como numa rede de fotos: capa de jornal pra notícia,
   placar pra votação, número grande pra presença, carrossel de trechos pra discurso, rostos pra agenda.
   Tudo sai do item e do que o enriquecimento guardou em dados (imagem, trechos, participantes); nada é
   inventado. A referência oficial (número do projeto, ementa inteira, fonte) fica sempre embaixo.
   Puro (devolve HTML), coberto por tests/pecas.test.ts. */
import type { ItemFeed, Ligacao } from './feed';
import { papelEmTexto, type NaturezaAgenda } from './feed';
import type { EleitoLeve } from './eleitos';
import { separarReferencia, explicarEmenta, explicarItemPauta, desfechoPauta, lerCompromisso, mancheteCurta, maiuscula, type DesfechoPauta, type Participante } from './linguagem';

export type ItemPeca = ItemFeed & { n_politicos: number; outras_fontes: { fonte: string; url: string; titulo: string }[] | null };

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const FUSO = 'America/Sao_Paulo';
export const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: FUSO }).replace(':', 'h');
/** "qua, 28 out 2026": curta, pra caber o nome do veículo inteiro no alto da capa */
const dataCapa = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: FUSO })
  .replace(/\./g, '').replace(/ de /g, ' ').replace(/^(\p{L}+),?\s/u, '$1, ');
const iniciais = (n: string) => n.split(' ').filter(w => w.length > 2).slice(0, 2).map(w => w[0]).join('').toUpperCase() || n[0] || '?';
const CASA: Record<string, string> = { camara: 'Câmara', senado: 'Senado', executivo: 'Planalto' };

/** Rosto redondo: foto se tiver, senão iniciais. */
export function rosto(nome: string, foto?: string | null, href?: string, classe = ''): string {
  const dentro = foto ? `<img src="${esc(foto)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : '';
  const tag = href ? `a href="${esc(href)}"` : 'span';
  return `<${tag} class="rosto ${classe}" title="${esc(nome)}"><i>${esc(iniciais(nome))}</i>${dentro}</${href ? 'a' : 'span'}>`;
}

/** Ementa oficial inteira e o número, embaixo, pra quem quer conferir. */
function referencia(ref: string | null, texto: string, url: string, fonte: string): string {
  return `<details class="ref"><summary>${ref ? `<b>${esc(ref)}</b> · ` : ''}texto oficial</summary><p>${esc(texto)}</p>
    <a href="${esc(url)}" target="_blank" rel="noopener">Ver na fonte: ${esc(fonte)} ↗</a></details>`;
}

/* ---------- notícia: capa de jornal ---------- */

function capa(i: ItemPeca): string {
  const img = typeof i.dados.imagem === 'string' ? i.dados.imagem : null;
  const resumo = i.resumo && !/newsletter|Leia mais|inscreva-se/i.test(i.resumo) ? i.resumo : '';
  const outras = (i.outras_fontes ?? []);
  return `<a class="peca capa ${img ? 'com-foto' : 'sem-foto'}" href="${esc(i.url)}" target="_blank" rel="noopener">
    <span class="capa-topo"><b>${esc(i.fonte_nome)}</b><small>${esc(dataCapa(i.quando))}</small></span>
    ${img ? `<img class="capa-foto" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.closest('.capa').classList.replace('com-foto','sem-foto');this.remove()" />` : ''}
    <span class="capa-texto"><strong>${esc(i.titulo)}</strong>${resumo ? `<span class="linha-fina">${esc(resumo)}</span>` : ''}</span>
  </a>${outras.length ? `<p class="tambem">Também na capa de ${outras.map(o => `<a href="${esc(o.url)}" target="_blank" rel="noopener" title="${esc(o.titulo)}">${esc(o.fonte)}</a>`).join(' · ')}</p>` : ''}`;
}

/* ---------- votação ---------- */

function placarVoto(sim: number | null, nao: number | null): string {
  if (sim == null || nao == null || sim + nao === 0) return '';
  const p = Math.round((sim / (sim + nao)) * 100);
  return `<div class="placar-voto"><span><b>${sim}</b> sim</span><span><b>${nao}</b> não</span>
    <div class="barra" role="img" aria-label="${sim} votos sim e ${nao} não"><i style="width:${p}%"></i></div></div>`;
}

function votacao(i: ItemPeca, solo?: Ligacao): string {
  const casa = String(i.dados.casa ?? 'camara');
  const { ref, texto } = separarReferencia(i.titulo);
  const resultado = casa === 'senado' ? (i.dados.resultado === 'A' ? 'aprovado' : i.dados.resultado === 'R' ? 'rejeitado' : null)
    : (i.dados.aprovada === true ? 'aprovado' : i.dados.aprovada === false ? 'rejeitado' : null);
  const contagem = (i.dados.contagem ?? {}) as Record<string, number>;
  const sim = num(i.dados.sim) ?? num(contagem['Sim']), nao = num(i.dados.nao) ?? num(contagem['Não']);
  const manchete = ref ? `${resultado === 'aprovado' ? 'Passou' : resultado === 'rejeitado' ? 'Caiu' : 'Em votação'}: ${explicarEmenta(texto)}` : texto;
  const voto = solo ? papelEmTexto('voto', solo.papel, casa) : null;
  return `<div class="peca painel p-voto">
    <span class="rotulo">Votação · ${esc(CASA[casa] ?? casa)}${i.dados.secreta ? ' · secreta' : ''}</span>
    ${resultado ? `<span class="carimbo ${resultado}">${resultado === 'aprovado' ? 'Aprovado' : 'Rejeitado'}</span>` : ''}
    <p class="manchete${manchete.length > 110 ? ' longa' : ''}">${esc(maiuscula(manchete))}</p>
    ${placarVoto(sim, nao)}
    ${voto ? `<p class="selo-pessoa ${voto.tom}">${esc(voto.texto)}</p>` : ''}
  </div>${referencia(ref, i.resumo ? `${texto} — ${i.resumo}` : texto, i.url, i.fonte_nome)}`;
}

/* ---------- projeto ---------- */

function projeto(i: ItemPeca, gente: Map<string, EleitoLeve>, solo?: Ligacao): string {
  const { ref, texto } = separarReferencia(i.titulo);
  const autores = num(i.dados.autores);
  const sigla = String(i.dados.siglaTipo ?? ref?.split(' ')[0] ?? '');
  const tipo: Record<string, string> = { PL: 'Projeto de lei', PLP: 'Projeto de lei complementar', PEC: 'Mudança na Constituição', PDL: 'Projeto de decreto legislativo' };
  return `<div class="peca painel p-proposicao">
    <span class="rotulo">${esc(tipo[sigla] ?? 'Projeto')} · ${esc(CASA[String(i.dados.casa)] ?? 'Câmara')}</span>
    <p class="manchete"><span class="quer">Quer</span> ${esc(explicarEmenta(texto))}</p>
    ${!solo && i.politicos?.length ? `<div class="rostos">${i.politicos.slice(0, 9).map(p => { const e = gente.get(p.slug); return rosto(e?.nome ?? p.slug, e?.foto); }).join('')}${i.n_politicos > 9 ? `<span class="rosto mais"><i>+${i.n_politicos - 9}</i></span>` : ''}</div>` : ''}
    <p class="nota">${solo ? (solo.papel === 'coautor' ? 'Assinou junto' : 'Apresentou') : 'Assinam'}${autores && autores > 1 ? ` · ${autores} autores no total` : ''}</p>
  </div>${referencia(ref, texto, i.url, i.fonte_nome)}`;
}

/* ---------- presença ---------- */

/** Painel em carrossel: um slide por bloco, contador no canto e pontos embaixo. */
function carrossel(classe: string, slides: string[], aria: string): string {
  const n = slides.length;
  return `<div class="peca painel com-slides ${classe}"><div class="carrossel" tabindex="0" aria-label="${esc(aria)}">${
    slides.map((s, k) => `<div class="slide" data-n="${k + 1}/${n}">${s}</div>`).join('')}</div>${
    n > 1 ? `<div class="pontos" aria-hidden="true">${slides.map((_, k) => `<i${k ? '' : ' class="on"'}></i>`).join('')}</div>` : ''}</div>`;
}
const fatias = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, k) => xs.slice(k * n, k * n + n));

type VotacaoSalva = { descricao: string; nominal: boolean; votos?: Record<string, string> };
type ItemPautaSalvo = { ref: string; ementa: string; situacao: string | null; url: string; votacoes?: VotacaoSalva[] };

/** Como a pessoa votou no item: só o que a Câmara registrou. Votação nominal mostra o voto (a mais recente
    primeiro, que é a decisiva); simbólica não tem voto individual e o card diz isso. Sem pessoa (timeline
    geral), só o tipo de votação. */
function votoNoItem(x: ItemPautaSalvo, solo?: Ligacao, nome?: string): string {
  const vs = x.votacoes ?? [];
  if (!vs.length) return '';
  const nominais = vs.filter(v => v.nominal);
  if (!nominais.length) return `<span class="voto-item simbolica" title="${esc(vs.map(v => v.descricao).join(' · '))}">votação simbólica${solo ? ': sem voto individual registrado' : ''}</span>`;
  if (!solo) return `<span class="voto-item">votação nominal</span>`;
  const meus = nominais.map(v => v.votos?.[solo.slug]).filter((v): v is string => !!v);
  if (!meus.length) return `<span class="voto-item ruim" title="${esc(nominais[0].descricao)}">${esc(nome ? `${nome.split(' ')[0]} não registrou voto` : 'não registrou voto')}</span>`;
  const { texto, tom } = papelEmTexto('voto', meus[0], 'camara');
  const quem = nome ? `${nome.split(' ')[0]} ` : '';
  const outras = nominais.length > 1 ? ` <i>· ${nominais.length} votações nominais</i>` : '';
  return `<span class="voto-item ${tom}" title="${esc(nominais[0].descricao)}">${esc(quem + texto)}${outras}</span>`;
}
type AusenteSalvo = { nome: string; partido: string; uf: string; foto?: string; slug?: string };
const DESFECHO: Record<DesfechoPauta, string> = { aprovado: 'aprovado', rejeitado: 'rejeitado', adiado: 'ficou pra depois' };

function presenca(i: ItemPeca, gente: Map<string, EleitoLeve>, solo?: Ligacao): string {
  const plenario = i.dados.plenario === true;
  const presentes = num(i.dados.presentes) ?? i.n_politicos;
  const esperados = num(i.dados.esperados) ?? (plenario ? 513 : null);
  const orgao = String(i.dados.orgao_nome || i.dados.orgao || '');
  const onde = plenario ? 'Plenário da Câmara' : orgao;
  const pct = esperados ? Math.round((presentes / esperados) * 100) : null;
  const eu = solo ? papelEmTexto('presenca', solo.papel) : null;
  const pauta = Array.isArray(i.dados.pauta) ? (i.dados.pauta as ItemPautaSalvo[]) : [];
  // todos os que faltaram (gravado pelo coletor); item antigo só tem os do cadastro, pelas ligações
  const salvos = Array.isArray(i.dados.ausentes) ? (i.dados.ausentes as AusenteSalvo[]) : null;
  const ausentes: AusenteSalvo[] = salvos ?? (i.politicos ?? []).filter(p => p.papel === 'ausente').map(p => {
    const e = gente.get(p.slug); return { nome: e?.nome ?? p.slug, partido: e?.partido ?? '', uf: e?.uf ?? '', foto: e?.foto, slug: p.slug };
  });

  // o que a sessão rendeu, em uma linha cada: quantos faltaram e o desfecho da pauta
  const desfechos = pauta.map(x => desfechoPauta(x.situacao));
  const conta = (d: DesfechoPauta) => desfechos.filter(x => x === d).length;
  const partesPauta = [conta('aprovado') && `${conta('aprovado')} ${conta('aprovado') === 1 ? 'aprovado' : 'aprovados'}`,
    conta('rejeitado') && `${conta('rejeitado')} ${conta('rejeitado') === 1 ? 'rejeitado' : 'rejeitados'}`,
    conta('adiado') && `${conta('adiado')} ${conta('adiado') === 1 ? 'ficou' : 'ficaram'} pra depois`].filter(Boolean);
  const resumoSessao = salvos || pauta.length ? `<ul class="resumo-sessao">
    ${salvos ? `<li><b>${ausentes.length}</b> ${ausentes.length === 1 ? 'faltou' : 'faltaram'}</li>` : ''}
    ${pauta.length ? `<li><b>${pauta.length}</b> ${pauta.length === 1 ? 'item' : 'itens'} na pauta${partesPauta.length ? `: ${partesPauta.join(', ')}` : ''}</li>` : ''}</ul>` : '';

  const total = `<span class="rotulo">Presença · ${esc(onde)} · ${esc(hora(i.quando))}</span>
    ${eu ? `<span class="carimbo ${eu.tom === 'ruim' ? 'rejeitado' : 'aprovado'}">${eu.tom === 'ruim' ? 'Faltou' : 'Esteve lá'}</span>` : ''}
    ${resumoSessao}
    <p class="numerao"><b>${presentes}</b>${esperados ? `<span>de ${esperados} deputados<br>na sessão</span>` : `<span>deputados<br>na reunião</span>`}</p>
    ${pct != null ? `<div class="barra" role="img" aria-label="${pct}% de presença"><i style="width:${pct}%"></i></div>` : ''}
    ${pauta.length || ausentes.length ? `<small class="credito">deslize pra ${[pauta.length ? 'pauta' : '', ausentes.length ? 'quem faltou' : ''].filter(Boolean).join(' e ')} →</small>` : ''}
    ${!pauta.length && i.resumo && !plenario ? `<p class="nota pauta">Na pauta: ${esc(i.resumo.slice(0, 180))}${i.resumo.length > 180 ? '…' : ''}</p>` : ''}`;

  const slidesPauta = fatias(pauta.slice(0, 12), 4).map((parte, k, todas) => `<span class="rotulo">Na pauta · ${pauta.length} ${pauta.length === 1 ? 'item' : 'itens'}${todas.length > 1 ? ` · ${k + 1}/${todas.length}` : ''}</span>
    <div class="lista-pauta">${parte.map(x => {
      const d = desfechoPauta(x.situacao);
      return `<a class="item-pauta" href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(maiuscula(explicarItemPauta(x.ref, x.ementa)))}</b>
        <small>${d ? `<span class="desfecho ${d}">${DESFECHO[d]}</span> ` : ''}${esc(x.ref)} ↗</small>${solo?.papel === 'ausente' ? '' : votoNoItem(x, solo, solo ? gente.get(solo.slug)?.nome : undefined)}</a>`;
    }).join('')}</div>${k === todas.length - 1 && pauta.length > 12 ? `<small class="credito">e mais ${pauta.length - 12} itens na pauta da fonte</small>` : ''}`);

  const slidesFalta = fatias(ausentes, 12).map((parte, k, todas) => `<span class="rotulo">Quem faltou · ${ausentes.length} ${salvos ? 'deputados' : 'dos eleitos que acompanhamos'}${todas.length > 1 ? ` · ${k + 1}/${todas.length}` : ''}</span>
    <div class="grade-rostos">${parte.map(a => `<figure>${rosto(a.nome, a.slug ? gente.get(a.slug)?.foto ?? a.foto : a.foto, a.slug ? `/politico/${a.slug}/` : undefined, 'ruim')}
      <figcaption><b>${esc(a.nome)}</b>${a.partido ? `<small>${esc(a.partido)}${a.uf ? `-${esc(a.uf)}` : ''}</small>` : ''}</figcaption></figure>`).join('')}</div>`);

  return carrossel('p-presenca', [total, ...slidesPauta, ...slidesFalta], 'Presença na sessão, pauta e quem faltou; deslize pro lado');
}

/* ---------- discurso: carrossel de trechos literais ---------- */

function discurso(i: ItemPeca, gente: Map<string, EleitoLeve>, solo?: Ligacao): string {
  const trechos = Array.isArray(i.dados.trechos) ? (i.dados.trechos as string[]) : [];
  const ocasiao = i.titulo.match(/—\s*(.+)$/)?.[1] ?? 'Pronunciamento';
  const e = solo ? gente.get(solo.slug) : undefined;
  const total = trechos.length + (i.resumo ? 1 : 0);
  const slides = [
    ...(i.resumo ? [`<div class="slide"><span class="rotulo">Discurso no Senado · ${esc(ocasiao)}</span>
      <p class="manchete-media">${esc(i.resumo)}</p><small class="credito">Resumo oficial do Senado${trechos.length ? ' · deslize pros trechos →' : ''}</small></div>`] : []),
    ...trechos.map(t => `<div class="slide citacao"><span class="aspas" aria-hidden="true">“</span><blockquote>${esc(t)}</blockquote>
      <small class="credito">${e ? `${rosto(e.nome, e.foto)} ${esc(e.nome)} · ` : ''}trecho literal do discurso</small></div>`),
  ].map((s, k) => s.replace('<div class="slide', `<div data-n="${k + 1}/${total}" class="slide`));
  if (!slides.length) slides.push(`<div class="slide"><span class="rotulo">Discurso no Senado</span><p class="manchete-media">${esc(i.titulo)}</p></div>`);
  return `<div class="peca painel p-discurso"><div class="carrossel" tabindex="0" aria-label="Trechos do discurso, deslize pro lado">${slides.join('')}</div>
    ${slides.length > 1 ? `<div class="pontos" aria-hidden="true">${slides.map((_, k) => `<i${k ? '' : ' class="on"'}></i>`).join('')}</div>` : ''}</div>
    <p class="tambem"><a href="${esc(i.url)}" target="_blank" rel="noopener">Ler o discurso inteiro no Senado ↗</a></p>`;
}

/* ---------- agenda: quem encontra quem ---------- */

const NATUREZA: Record<NaturezaAgenda, string> = {
  publica: 'compromisso público', privada: 'com setor privado ou sociedade civil', partidaria: 'compromisso partidário', pessoal: 'compromisso pessoal',
};
type ParticipanteSalvo = Participante & { slug?: string; foto?: string; foto_fonte?: string };

function agenda(i: ItemPeca, gente: Map<string, EleitoLeve>, solo?: Ligacao): string {
  const c = lerCompromisso(i.titulo);
  const salvos: ParticipanteSalvo[] = Array.isArray(i.dados.participantes) ? (i.dados.participantes as ParticipanteSalvo[]) : c.participantes;
  const dono = solo ? gente.get(solo.slug) : undefined;
  const pessoas = [
    ...(dono && solo ? [{ nome: dono.nome, cargo: null, foto: dono.foto, href: `/politico/${solo.slug}/` }] : []),
    ...salvos.map(p => {
      const e = p.slug ? gente.get(p.slug) : undefined;
      return { nome: p.nome, cargo: p.cargo, foto: e?.foto ?? p.foto, href: p.slug ? `/politico/${p.slug}/` : p.foto_fonte };
    }),
  ];
  const icone = c.modo === 'telefonema' ? '📞' : c.modo === 'video' ? '🎥' : c.modo === 'deslocamento' ? '✈️' : '';
  const nat = i.agenda_natureza ? NATUREZA[i.agenda_natureza] : null;
  const manchete = pessoas.length > 1 ? mancheteCurta(c.modo, salvos, c.manchete) : c.manchete;
  const creditos = salvos.some(p => p.foto && !p.slug) ? '<small class="credito">fotos: Wikipédia</small>' : '';
  return `<div class="peca painel p-agenda">
    <span class="rotulo">Agenda oficial · ${esc(hora(i.quando))}${i.local ? ` · ${esc(i.local)}` : ''}</span>
    ${pessoas.length > 1 ? `<div class="encontro${pessoas.length > 3 ? ' muitos' : ''}">${pessoas.map((p, k) => `<figure>${rosto(p.nome, p.foto, p.href)}
      <figcaption><b>${esc(p.nome)}</b>${p.cargo ? `<small>${esc(p.cargo)}</small>` : ''}</figcaption></figure>${k === 0 && icone ? `<span class="liga">${icone}</span>` : ''}`).join('')}</div>`
      : `<p class="icone-grande" aria-hidden="true">${icone || '🗓️'}</p>`}
    <p class="manchete${manchete.length > 90 ? ' longa' : ''}">${esc(manchete)}</p>
    ${nat ? `<span class="nat nat-${esc(i.agenda_natureza!)}">${esc(nat)}</span>` : ''}${creditos}
  </div>`;
}

export function peca(i: ItemPeca, gente: Map<string, EleitoLeve>, solo?: Ligacao): string {
  switch (i.tipo) {
    case 'noticia': return capa(i);
    case 'voto': return votacao(i, solo);
    case 'proposicao': return projeto(i, gente, solo);
    case 'presenca': return presenca(i, gente, solo);
    case 'discurso': return discurso(i, gente, solo);
    case 'agenda': return agenda(i, gente, solo);
    default: return `<a class="peca painel" href="${esc(i.url)}" target="_blank" rel="noopener"><p class="manchete">${esc(i.titulo)}</p></a>`;
  }
}

/* ---------- notícias do mesmo dia num bloco só ---------- */

/** AAAA-MM-DD no horário de Brasília. */
export const diaBr = (iso: string) => new Date(new Date(iso).getTime() - 3 * 36e5).toISOString().slice(0, 10);

export type Bloco<T> = { item: T } | { dia: string; noticias: T[] };

/** As notícias de um mesmo dia viram um bloco, no lugar da mais recente; o resto fica onde está. */
export function agruparPorDia<T extends { tipo: string; quando: string }>(itens: T[]): Bloco<T>[] {
  const out: Bloco<T>[] = [];
  const porDia = new Map<string, { dia: string; noticias: T[] }>();
  for (const i of itens) {
    if (i.tipo !== 'noticia') { out.push({ item: i }); continue; }
    const dia = diaBr(i.quando);
    const b = porDia.get(dia);
    if (b) b.noticias.push(i);
    else { const novo = { dia, noticias: [i] }; porDia.set(dia, novo); out.push(novo); }
  }
  return out;
}

/** "hoje", "ontem" ou "quinta, 29 de outubro". */
export function diaEmTexto(dia: string, agora = new Date()): string {
  if (dia === diaBr(agora.toISOString())) return 'hoje';
  if (dia === diaBr(new Date(agora.getTime() - 864e5).toISOString())) return 'ontem';
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace('-feira', '');
}
