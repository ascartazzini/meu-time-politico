/* Newsletter semanal: monta a edição a partir do que já está coletado e gera o HTML do e-mail.
   Puro (sem rede), coberto por tests/edicao.test.ts. Quem busca os dados e grava é scripts/newsletter.ts;
   quem mostra é /semana/. Quatro blocos:
   1. as notícias da semana que mais veículos cobriram (os grupos de agrupar.ts), com reações como desempate;
   2. as votações marcadas no plenário pros próximos dias (ou o aviso de que a pauta ainda não saiu);
   3. os marcos dos próximos 60 dias (src/data/marcos.json);
   4. a chamada pra cobrar: seguir, reagir e mandar a página do político pra quem votou junto. */

export interface NoticiaEntrada { grupo: string; titulo: string; url: string; fonte: string; quando: string; politicos: string[]; reacoes: number; imagem?: string | null }
export interface PautaEntrada { casa: 'camara' | 'senado'; quando: string; sessao: string | null; materia: string; ementa: string | null; url: string }
export interface Marco { data: string; titulo: string; detalhe: string; fonte: string }

export interface Edicao {
  semana: string;                       // segunda-feira, AAAA-MM-DD
  noticias: { titulo: string; url: string; fonte: string; quando?: string; imagem?: string | null; outras: { fonte: string; url: string }[]; politicos: { slug: string; nome: string }[] }[];
  pauta: { dia: string; casa: 'camara' | 'senado'; itens: { materia: string; ementa: string | null; url: string }[] }[];
  marcos: (Marco & { faltam: number })[];
}

/** Segunda-feira da semana de `d` (horário de Brasília), em AAAA-MM-DD. */
export function segundaDaSemana(d: Date): string {
  const br = new Date(d.getTime() - 3 * 36e5);
  const dia = (br.getUTCDay() + 6) % 7;
  return new Date(br.getTime() - dia * 864e5).toISOString().slice(0, 10);
}

export function montarEdicao(e: { agora: Date; noticias: NoticiaEntrada[]; pauta: PautaEntrada[]; marcos: Marco[]; nomes: Map<string, string>; maxNoticias?: number }): Edicao {
  const agora = e.agora.getTime();
  // notícias: só dos últimos 7 dias, uma por grupo; ordem: mais veículos, depois mais reações, depois a mais nova
  const grupos = new Map<string, NoticiaEntrada[]>();
  for (const n of e.noticias) {
    if (agora - new Date(n.quando).getTime() > 7 * 864e5) continue;
    grupos.set(n.grupo, [...(grupos.get(n.grupo) ?? []), n]);
  }
  const noticias = [...grupos.values()]
    .map(g => { const s = [...g].sort((a, b) => a.quando.localeCompare(b.quando)); return { s, fontes: new Set(g.map(x => x.fonte)).size, reacoes: g.reduce((t, x) => t + x.reacoes, 0), ultima: s.at(-1)!.quando }; })
    .sort((a, b) => b.fontes - a.fontes || b.reacoes - a.reacoes || b.ultima.localeCompare(a.ultima))
    .slice(0, e.maxNoticias ?? 8)
    .map(({ s }) => ({
      titulo: s[0].titulo, url: s[0].url, fonte: s[0].fonte, quando: s[0].quando, imagem: s[0].imagem ?? null,   // só a foto do veículo da capa: a de outro levaria o crédito errado
      outras: s.slice(1).filter((x, i, arr) => x.fonte !== s[0].fonte && arr.findIndex(y => y.fonte === x.fonte) === i).map(x => ({ fonte: x.fonte, url: x.url })),
      politicos: [...new Set(s.flatMap(x => x.politicos))].slice(0, 4).map(slug => ({ slug, nome: e.nomes.get(slug) ?? slug })),
    }));

  // pauta: daqui pra frente, agrupada por dia e casa
  const dias = new Map<string, Edicao['pauta'][number]>();
  for (const p of [...e.pauta].sort((a, b) => a.quando.localeCompare(b.quando))) {
    if (new Date(p.quando).getTime() < agora) continue;
    const dia = new Date(new Date(p.quando).getTime() - 3 * 36e5).toISOString().slice(0, 10);
    const k = `${dia}|${p.casa}`;
    const atual = dias.get(k) ?? { dia, casa: p.casa, itens: [] };
    if (!atual.itens.some(i => i.materia === p.materia)) atual.itens.push({ materia: p.materia, ementa: p.ementa, url: p.url });
    dias.set(k, atual);
  }

  const hoje = new Date(agora - 3 * 36e5).toISOString().slice(0, 10);   // data de hoje em Brasília
  const marcos = e.marcos
    .map(m => ({ ...m, faltam: Math.round((Date.parse(`${m.data}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 864e5) }))
    .filter(m => m.faltam >= 0 && m.faltam <= 60);

  return { semana: segundaDaSemana(e.agora), noticias, pauta: [...dias.values()], marcos };
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const dataLonga = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
export const CASA = { camara: 'Câmara', senado: 'Senado' } as const;

/** E-mail em HTML com estilo inline (cliente de e-mail ignora <style>). `{{descadastro}}` é preenchido por quem envia. */
export function htmlEmail(ed: Edicao, site: string): string {
  const h2 = (t: string) => `<h2 style="font:700 20px/1.2 Arial,sans-serif;margin:28px 0 10px;color:#16181A">${t}</h2>`;
  const p = (t: string, extra = '') => `<p style="font:15px/1.5 Arial,sans-serif;color:#3A4047;margin:6px 0;${extra}">${t}</p>`;
  const link = (u: string, t: string) => `<a href="${esc(u)}" style="color:#1A5FD0">${t}</a>`;
  const noticias = ed.noticias.length ? ed.noticias.map(n => `<div style="border-left:4px solid #E0A800;padding:6px 0 6px 12px;margin:12px 0">
      ${p(`<b style="color:#16181A">${link(n.url, esc(n.titulo))}</b>`)}
      ${p(`${esc(n.fonte)}${n.outras.length ? ` · também em ${n.outras.map(o => link(o.url, esc(o.fonte))).join(', ')}` : ''}`, 'font-size:13px;color:#5F6670')}
      ${n.politicos.length ? p(n.politicos.map(x => link(`${site}/politico/${x.slug}/`, esc(x.nome))).join(' · '), 'font-size:13px') : ''}</div>`).join('')
    : p('Semana fraca de notícia sobre os eleitos nos veículos que acompanhamos.');
  const pauta = ed.pauta.length ? ed.pauta.map(d => `${p(`<b style="color:#1A5FD0">${esc(dataLonga(d.dia))} · ${CASA[d.casa]}</b>`)}
      <ul style="margin:4px 0 12px;padding-left:18px">${d.itens.map(i => `<li style="font:14px/1.45 Arial,sans-serif;color:#3A4047;margin:4px 0">${link(i.url, esc(i.materia))}${i.ementa ? `: ${esc(i.ementa.slice(0, 160))}${i.ementa.length > 160 ? '…' : ''}` : ''}</li>`).join('')}</ul>`).join('')
    : p('A Câmara e o Senado ainda não publicaram a pauta de votações dos próximos dias. Ela costuma sair na véspera; acompanhe na timeline.');
  const marcos = ed.marcos.length ? ed.marcos.map(m => p(`<b style="color:#7A3EA8">${esc(dataLonga(m.data))}${m.faltam ? ` · faltam ${m.faltam} dias` : ' · hoje'}</b><br><b style="color:#16181A">${esc(m.titulo)}.</b> ${esc(m.detalhe)} <span style="color:#8A9096">(${esc(m.fonte)})</span>`)).join('')
    : p('Nenhum marco nos próximos 60 dias.');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Meu Time Político · semana de ${esc(ed.semana)}</title></head>
<body style="margin:0;background:#F4F4F1"><div style="max-width:600px;margin:0 auto;padding:24px 20px;background:#FFFFFF">
  <p style="font:900 22px/1 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;margin:0">Meu time <span style="background:#FFD100;padding:0 4px">político</span></p>
  ${p(`Resumo da semana de ${esc(dataLonga(ed.semana))}. Tudo com a fonte.`, 'color:#5F6670')}
  ${h2('As notícias da semana')}${noticias}
  ${h2('Votações pela frente')}${pauta}
  ${h2('Marcos que vêm aí')}${marcos}
  <div style="background:#FFD100;border-radius:14px;padding:18px;margin-top:28px">
    <p style="font:900 22px/1.1 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;margin:0">Cobre quem você elegeu.</p>
    ${p(`Siga seus políticos, reaja ao que eles fazem e mande a página deles pra quem votou junto: quanto mais gente olhando, menos dá pra sumir do plenário.`, 'color:#16181A')}
    <p style="margin:12px 0 0"><a href="${esc(site)}/seguir/" style="display:inline-block;background:#16181A;color:#FFFFFF;font:700 15px Arial,sans-serif;text-decoration:none;border-radius:999px;padding:12px 20px">Escolher quem seguir</a></p>
  </div>
  ${p(`Você recebe porque se inscreveu em ${link(site, 'meutimepolitico.com')}. ${link('{{descadastro}}', 'Sair da lista')}.`, 'font-size:12px;color:#8A9096;margin-top:24px')}
</div></body></html>`;
}
