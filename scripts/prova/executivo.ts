/* Fase 0 — provas do executivo federal (ids "exec-").
   Agenda do Presidente (Planalto), e-Agendas (CGU), Diário Oficial da União (in.gov.br),
   emendas parlamentares (Portal da Transparência) e notícias do Planalto (RSS).
   Sem login, sem chave, sem contornar bloqueio: se a fonte barrar, a prova registra. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { UA, GERADO } from '../util';
import { pegar, itensRss, atraso, janelaDias, falha, amostra, decodificar, type Prova, type Medida, type Amostra } from './base';

const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
const DIA = 864e5;
/** Datas (AAAA-MM-DD) dos últimos `n` dias, incluindo hoje, no fuso de Brasília. */
function diasBrasilia(n: number): string[] {
  const hoje = new Date(Date.now() - 3 * 36e5);
  return Array.from({ length: n + 1 }, (_, i) => new Date(hoje.getTime() - (n - i) * DIA).toISOString().slice(0, 10));
}
const brParaIso = (dmy: string) => dmy.split('/').reverse().join('-'); // 15/10/2026 → 2026-10-15
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
/** gov.br às vezes responde 200 com página de "acesso temporariamente restrito" (limite por volume de IP). */
const bloqueioGovBr = (corpo: string) => /Temporariamente (Restrita|Interrompido)/i.test(corpo);

// ---------------------------------------------------------------------------------------------
// 1. Agenda do Presidente da República (Planalto)
// ---------------------------------------------------------------------------------------------
const AGENDA_PR = 'https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/agenda-do-presidente-da-republica-lula/agenda-do-presidente-da-republica';

const agendaPresidente: Prova = {
  id: 'exec-agenda-presidente',
  nome: 'Agenda do Presidente da República (Planalto)',
  grupo: 'executivo',
  url: AGENDA_PR,
  custo: '0 — página pública, uma requisição por dia de agenda',
  risco: 'Só HTML (sem JSON/feed); a URL leva o nome do presidente no caminho e muda a cada mandato, e o gov.br corta IP com volume alto devolvendo 200 com página de bloqueio.',
  async rodar(): Promise<Medida> {
    const dias = diasBrasilia(7);
    const itens: (Amostra & { quando: string })[] = [];
    const notas: string[] = [];
    let semAgenda = 0, bloqueado = 0, ultimaResposta = null as Awaited<ReturnType<typeof pegar>> | null;
    for (const d of dias) {
      const r = await pegar(`${AGENDA_PR}/${d}`);
      ultimaResposta = r;
      if (r.status === 404) { semAgenda++; await dormir(2000); continue; }
      if (!r.ok || bloqueioGovBr(r.corpo)) { bloqueado++; await dormir(5000); continue; }
      const blocos = r.corpo.match(/<li class="item-compromisso-wrapper">[\s\S]*?<\/li>/g) ?? [];
      for (const b of blocos) {
        const hora = b.match(/compromisso-inicio">(\d{1,2})h(\d{2})/);
        const titulo = decodificar(b.match(/compromisso-titulo">([\s\S]*?)<\/h2>/)?.[1].trim() ?? '');
        const local = decodificar(b.match(/compromisso-local">([\s\S]*?)<\/div>/)?.[1].trim() ?? '');
        const quando = `${d}T${hora ? `${hora[1].padStart(2, '0')}:${hora[2]}` : '00:00'}:00-03:00`;
        itens.push({ data: quando, quando, titulo: local ? `${titulo} — ${local}` : titulo, url: `${AGENDA_PR}/${d}` });
      }
      await dormir(2000);
    }
    if (bloqueado === dias.length && ultimaResposta) return falha({ ...ultimaResposta, status: ultimaResposta.status === 200 ? 429 : ultimaResposta.status }, 'html', 'gov.br devolveu página de bloqueio por volume em todos os dias (IP fora do Brasil ou rajada de requisições).');
    notas.push(`${dias.length} dias consultados (${dias[0]} a ${dias.at(-1)}): ${dias.length - semAgenda - bloqueado} com agenda, ${semAgenda} sem página (404 = dia sem compromisso publicado), ${bloqueado} bloqueados.`);
    notas.push('Formato: HTML Plone com horário, título e local; sem JSON (Accept: application/json devolve HTML) e sem RSS. Cada compromisso tem um .ics em …/<slug>/vcal_view.');
    notas.push('Dia sem compromisso não tem página (404), então "silêncio" e "erro" só se distinguem pelo código HTTP.');
    notas.push('Liga ao presidente por construção (a página é dele), mas não há id oficial no item.');
    const passados = itens.filter(i => new Date(i.quando).getTime() <= Date.now());
    return {
      status: bloqueado ? 'parcial' : 'ok', itens: itens.length, janela: '7 dias', atrasoHoras: atraso(passados.map(i => i.quando)),
      formato: 'html', idPolitico: false, amostra: amostra([...itens].reverse().map(({ data, titulo, url }) => ({ data, titulo, url }))), notas,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// 2. e-Agendas (CGU) — agendas de ministros
// ---------------------------------------------------------------------------------------------
const EAG = 'https://eagendas.cgu.gov.br';
/** Órgãos de amostra (ids internos do e-Agendas): Fazenda, Saúde, Educação, Justiça. */
const ORGAOS_AMOSTRA = [1384, 563, 549, 856];

interface AgentePublico { pertenencia_id: number; nome: string; cargo: string; cargo_confianca_id: number; orgao_id: number; sigla: string }
interface EventoEag { tipo: string; title: string; start: string; publicado_em?: string; local?: string; pertenencia_id: number; compromisso_id?: number; agenda_de: string }

const eAgendas: Prova = {
  id: 'exec-eagendas-ministros',
  nome: 'e-Agendas (CGU) — agenda de ministros',
  grupo: 'executivo',
  url: EAG,
  custo: '0 — página pública com JSON embutido; a API v2 oficial exige token gerado após login gov.br',
  risco: 'Raspagem de JSON embutido no HTML (ng-init) de um app Angular: muda sem aviso; o download oficial em planilha passa por reCAPTCHA, então fica fora.',
  async rodar(): Promise<Medida> {
    const notas: string[] = [];
    // API oficial: só pra registrar que pede token.
    const api = await pegar(`${EAG}/api/v2/objetivos-compromissos`, { headers: { Accept: 'application/json' } });
    notas.push(`API v2 (${EAG}/api/v2) sem token: HTTP ${api.status} — o token é gerado em "Meus tokens" depois do login (doc: github.com/cgugovbr/eagendas-publico).`);

    const ministros: AgentePublico[] = [];
    for (const o of ORGAOS_AMOSTRA) {
      const r = await pegar(`${EAG}/pesquisa/agentes-publicos-obrigados-por-orgao/orgao/${o}/ativo/true`, { headers: { Accept: 'application/json' } });
      if (!r.ok) { notas.push(`lista de agentes do órgão ${o}: HTTP ${r.status}`); continue; }
      try {
        const lista = JSON.parse(r.corpo) as AgentePublico[];
        const m = lista.find(a => /^MINISTR[OA]/.test(a.cargo.toUpperCase()));
        if (m) ministros.push(m);
      } catch { notas.push(`lista de agentes do órgão ${o}: resposta não é JSON`); }
    }
    if (!ministros.length) return falha(api, 'json', 'Não foi possível listar os ministros nos órgãos de amostra.');

    const { inicio } = janelaDias(7);
    const todos: (EventoEag & { sigla: string })[] = [];
    const porMinistro: string[] = [];
    let ultimaFalha: Awaited<ReturnType<typeof pegar>> | null = null;
    for (const m of ministros) {
      const q = new URLSearchParams({ filtro_orgaos_ativos: 'on', filtro_orgao: String(m.orgao_id), filtro_cargos_ativos: 'on', filtro_cargo: String(m.cargo_confianca_id), filtro_apos_ativos: 'on', filtro_servidor: String(m.pertenencia_id) });
      const r = await pegar(`${EAG}/?${q}`, { timeoutMs: 60_000 });
      const bruto = r.corpo.match(/ng-init="events=([^"]*)"/)?.[1];
      if (!r.ok || !bruto) { ultimaFalha = r; porMinistro.push(`${m.sigla}: sem eventos (HTTP ${r.status})`); continue; }
      const eventos = JSON.parse(decodificar(bruto)) as EventoEag[];
      const naJanela = eventos.filter(e => e.start.slice(0, 10) >= inicio && e.tipo !== 'Viagem SCDP' && e.tipo !== 'Afastamento');
      porMinistro.push(`${m.sigla} (${m.nome.split(' ')[0]}): ${naJanela.length} na janela / ${eventos.length} no histórico`);
      todos.push(...naJanela.map(e => ({ ...e, sigla: m.sigla })));
      await dormir(1000);
    }
    if (!todos.length && ultimaFalha) return falha(ultimaFalha, 'html', 'Nenhum ministro devolveu eventos.');

    const atrasosPub = todos.filter(e => e.publicado_em).map(e => (new Date(`${e.publicado_em!.replace(' ', 'T')}-03:00`).getTime() - new Date(`${e.start}:00-03:00`).getTime()) / 36e5);
    const antes = atrasosPub.filter(h => h <= 0).length;
    notas.push(`Ministros medidos: ${porMinistro.join('; ')}.`);
    notas.push(`Compromissos (reunião, audiência, evento) desde ${inicio}; viagens SCDP e afastamentos ficam fora da contagem mas vêm no mesmo JSON.`);
    if (atrasosPub.length) notas.push(`${antes} de ${atrasosPub.length} compromissos foram publicados antes de acontecer; o resto saiu depois (agenda é atualizada a posteriori).`);
    notas.push('Cada item traz título, local, horário, participantes (com CPF mascarado — não guardar) e objetivo; reuniões com parlamentares aparecem só pelo nome no título, sem id da Câmara/Senado.');
    notas.push('O presidente da República não está no e-Agendas (só assessores do Gabinete Pessoal); a agenda dele fica no site do Planalto.');
    todos.sort((a, b) => b.start.localeCompare(a.start));
    const publicadosAteAgora = todos.filter(e => e.publicado_em).map(e => `${e.publicado_em!.replace(' ', 'T')}-03:00`);
    return {
      status: 'ok', itens: todos.length, janela: `7 dias, ${ministros.length} ministros`, atrasoHoras: atraso(publicadosAteAgora),
      formato: 'html', idPolitico: false,
      amostra: amostra(todos.filter(e => e.start <= new Date().toISOString()).map(e => ({ data: e.start, titulo: `[${e.sigla}] ${e.title}`, url: e.compromisso_id ? `${EAG}/info-compromisso/agenda/${e.pertenencia_id}/compromisso/${e.compromisso_id}` : EAG }))),
      notas,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// 3. Diário Oficial da União (in.gov.br)
// ---------------------------------------------------------------------------------------------
const DOU = 'https://www.in.gov.br';
interface AtoDou { pubName: string; urlTitle: string; title: string; pubDate: string; artType: string; hierarchyStr: string }
const jsonEmbutido = (html: string, id: string): { jsonArray?: AtoDou[] } | null => {
  const m = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
};
const linkAto = (a: AtoDou) => `${DOU}/web/dou/-/${a.urlTitle}`;

const douPresidente: Prova = {
  id: 'exec-dou-presidente',
  nome: 'DOU — atos assinados pelo presidente (busca pública)',
  grupo: 'executivo',
  url: `${DOU}/consulta/-/buscar/dou`,
  custo: '0 — busca pública do portal, JSON embutido no HTML; o XML oficial (INLABS) exige cadastro e login',
  risco: 'Raspagem da busca do portal (Liferay) sem API documentada; a busca é por texto, então pega o nome do signatário mas também atos que só citam o presidente.',
  async rodar(): Promise<Medida> {
    const { inicio, fim } = janelaDias(7);
    const f = (iso: string) => iso.split('-').reverse().join('-');
    const q = new URLSearchParams({ q: '"LUIZ INÁCIO LULA DA SILVA"', s: 'todos', exactDate: 'personalizado', publishFrom: f(inicio), publishTo: f(fim), delta: '50' });
    const r = await pegar(`${DOU}/consulta/-/buscar/dou?${q}`, { timeoutMs: 60_000 });
    if (!r.ok) return falha(r, 'html');
    const dados = jsonEmbutido(r.corpo, '_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params');
    if (!dados?.jsonArray) return { ...falha(r, 'html', 'Página veio sem o JSON de resultados (o portal mudou?).'), status: 'falhou' };
    const atos = dados.jsonArray;
    const total = Number(r.corpo.match(/(\d[\d.]*) resultados/)?.[1]?.replace(/\./g, '') ?? atos.length);
    const tipos = new Map<string, number>();
    for (const a of atos) tipos.set(a.artType, (tipos.get(a.artType) ?? 0) + 1);
    const notas = [
      `Busca exata pelo nome do signatário, ${inicio} a ${fim}: ${total} resultado(s) — ${[...tipos].map(([t, n]) => `${n} ${t}`).join(', ') || 'nenhum'}.`,
      'Pega decretos e MPs (assinados com o nome por extenso). Despachos e mensagens do presidente não trazem o nome e escapam; a seção "Presidência da República" da leitura diária cobre esses.',
      'O campo hierarchyStr não é confiável pra identificar o autor (decretos de 9/10 vieram sob "Atos do Poder Judiciário/STF"); filtrar por órgão perde atos.',
      'O mesmo truque serve pra qualquer autoridade que assina atos (ministros em portarias), mas a ligação é por nome, sem id oficial.',
      'INLABS (inlabs.in.gov.br, XML completo diário) exige cadastro e login — fora da regra desta fase. Não há API REST aberta documentada.',
    ];
    return {
      status: 'ok', itens: total, janela: '7 dias', atrasoHoras: atraso(atos.map(a => `${brParaIso(a.pubDate)}T06:00:00-03:00`)),
      formato: 'html', idPolitico: false,
      amostra: amostra(atos.map(a => ({ data: brParaIso(a.pubDate), titulo: `${a.title} (${a.pubName})`, url: linkAto(a) }))), notas,
    };
  },
};

const douLeitura: Prova = {
  id: 'exec-dou-leitura-diaria',
  nome: 'DOU — leitura do dia, seção 1 (todos os atos)',
  grupo: 'executivo',
  url: `${DOU}/leiturajornal`,
  custo: '0 — página pública por dia e seção, JSON embutido com todos os atos',
  risco: 'Raspagem de JSON embutido (script#params) do portal; volume alto e quase nada é ligado a político eleito sem casar nome.',
  async rodar(): Promise<Medida> {
    const dias = diasBrasilia(7);
    let total = 0, presidencia = 0, extras = 0, ultima: Awaited<ReturnType<typeof pegar>> | null = null, ok = 0;
    const atosPr: AtoDou[] = [];
    const porDia: string[] = [];
    for (const d of dias) {
      let doDia = 0;
      for (const secao of ['do1', 'do1e']) {
        const r = await pegar(`${DOU}/leiturajornal?data=${d.split('-').reverse().join('-')}&secao=${secao}`, { timeoutMs: 60_000 });
        ultima = r;
        if (!r.ok) continue;
        const atos = jsonEmbutido(r.corpo, 'params')?.jsonArray;
        if (!atos) continue;
        ok++;
        doDia += atos.length;
        if (secao === 'do1e') extras += atos.length;
        const pr = atos.filter(a => /^(Atos do Poder Executivo|Atos do Poder Legislativo|Presidência da República)$/.test(a.hierarchyStr) || /PRESIDENTE DA REPÚBLICA/.test(a.title));
        presidencia += pr.length;
        atosPr.push(...pr);
        await dormir(800);
      }
      total += doDia;
      porDia.push(`${d.slice(5)}: ${doDia}`);
    }
    if (!ok && ultima) return falha(ultima, 'html');
    atosPr.sort((a, b) => brParaIso(b.pubDate).localeCompare(brParaIso(a.pubDate)));
    return {
      status: 'ok', itens: total, janela: '7 dias (DO1 + extras)', atrasoHoras: atraso(atosPr.map(a => `${brParaIso(a.pubDate)}T06:00:00-03:00`)),
      formato: 'html', idPolitico: false,
      amostra: amostra(atosPr.map(a => ({ data: brParaIso(a.pubDate), titulo: `${a.artType}: ${a.title}`, url: linkAto(a) }))),
      notas: [
        `Atos por dia (DO1 + edição extra): ${porDia.join(', ')}. Fim de semana e feriado não têm edição. Edições extras somaram ${extras}.`,
        `${presidencia} atos sob "Atos do Poder Executivo/Legislativo", raiz "Presidência da República" ou título "… do Presidente da República" — conta por hierarquia, que erra (ver exec-dou-presidente).`,
        'Cada ato traz tipo, título, órgão (hierarquia), data, página e resumo de ~400 caracteres; o texto integral está no link do ato.',
        'Sai de madrugada no dia da publicação; atraso medido supondo 06h de Brasília.',
      ],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// 4. Portal da Transparência — emendas parlamentares (download aberto)
// ---------------------------------------------------------------------------------------------
const EMENDAS_PAGINA = 'https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares';
const EMENDAS_ZIP = `${EMENDAS_PAGINA}/UNICO`;

/** Lê um zip (sem dependência): central directory → inflateRaw de cada entrada pedida. */
function lerZip(buf: Buffer, quero: (nome: string) => boolean): Map<string, Buffer> {
  const saida = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('zip sem diretório central');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    const metodo = buf.readUInt16LE(p + 10), comprimido = buf.readUInt32LE(p + 20);
    const lNome = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lCom = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + lNome).toString('utf8');
    p += 46 + lNome + lExtra + lCom;
    if (!quero(nome)) continue;
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dado = buf.subarray(ini, ini + comprimido);
    saida.set(nome, metodo === 0 ? dado : inflateRawSync(dado));
  }
  return saida;
}
const celulas = (linha: string) => linha.slice(1, -1).split('";"');

const emendas: Prova = {
  id: 'exec-emendas-transparencia',
  nome: 'Portal da Transparência — emendas parlamentares (download)',
  grupo: 'executivo',
  url: EMENDAS_PAGINA,
  custo: '0 — ZIP aberto (~32 MB); a API de dados exige chave gratuita pedida por e-mail (não temos)',
  risco: 'Arquivo único reprocessado periodicamente (não é feed): dá pra calcular diferença entre versões, mas o autor vem com código do orçamento e nome, sem id da Câmara/Senado.',
  async rodar(): Promise<Medida> {
    const notas: string[] = [];
    const api = await pegar('https://api.portaldatransparencia.gov.br/api-de-dados/emendas?ano=2026&pagina=1', { headers: { Accept: 'application/json' } });
    notas.push(`API /api-de-dados/emendas sem chave: HTTP ${api.status} (chave gratuita via cadastro por e-mail).`);

    const t0 = Date.now();
    let res: Response;
    try { res = await fetch(EMENDAS_ZIP, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(150_000) }); }
    catch (e) { return falha({ status: 0, ok: false, corpo: '', ms: Date.now() - t0, url: EMENDAS_ZIP, erro: (e as Error).message, tipo: '' }, 'zip'); }
    const modificado = res.headers.get('last-modified');
    const tipo = res.headers.get('content-type') ?? '';
    if (!res.ok || !/zip/.test(tipo)) {
      const corpo = await res.text();
      return falha({ status: res.ok && /captcha|Human Verification/i.test(corpo) ? 403 : res.status, ok: false, corpo, ms: Date.now() - t0, url: res.url, tipo }, 'zip', /captcha|Human Verification/i.test(corpo) ? 'Caiu no captcha do AWS WAF — não contornamos.' : undefined);
    }
    const zip = Buffer.from(await res.arrayBuffer());
    notas.push(`${EMENDAS_ZIP} redireciona pra ${res.url.replace(/^https:\/\//, '')} (${(zip.length / 1e6).toFixed(1)} MB, Last-Modified ${modificado}). Partes do site estático passam por captcha AWS WAF; o arquivo, não.`);
    const arqs = lerZip(zip, n => /EmendasParlamentares(_PorFavorecido)?\.csv$/.test(n));
    const principal = arqs.get('EmendasParlamentares.csv')?.toString('latin1');
    const favorecido = arqs.get('EmendasParlamentares_PorFavorecido.csv')?.toString('latin1');
    if (!principal) return { status: 'falhou', itens: null, janela: '—', atrasoHoras: null, formato: 'zip', idPolitico: false, amostra: [], notas: [...notas, 'ZIP sem EmendasParlamentares.csv'] };

    const ano = String(new Date().getFullYear());
    const linhas = principal.split(/\r?\n/);
    const cab = celulas(linhas[0]);
    const iAno = cab.indexOf('Ano da Emenda'), iAutor = cab.indexOf('Nome do Autor da Emenda'), iCod = cab.indexOf('Código da Emenda'), iTipo = cab.indexOf('Tipo de Emenda'), iLocal = cab.indexOf('Localidade de aplicação do recurso'), iPago = cab.indexOf('Valor Pago');
    const doAno = linhas.slice(1).filter(Boolean).map(celulas).filter(c => c[iAno] === ano);
    const autores = new Set(doAno.map(c => semAcento(c[iAutor])));
    notas.push(`${linhas.length - 2} linhas no arquivo (todos os anos desde 2014); ${doAno.length} emendas de ${ano}, ${autores.size} autores distintos (inclui bancadas e comissões).`);
    notas.push('Colunas: código da emenda, ano, tipo, "Código do Autor" (código próprio do orçamento/CMO, não é id da Câmara nem do Senado), nome do autor em caixa alta, localidade, função/programa/ação e valores empenhado/liquidado/pago — acumulados, sem data por evento.');

    // Ligação com o político: casa nome parlamentar dos senadores (src/data/generated/senado.json).
    try {
      const sen = JSON.parse(readFileSync(resolve(GERADO, 'senado.json'), 'utf8')) as { senadores: { nome: string }[] };
      const achados = sen.senadores.filter(s => autores.has(semAcento(s.nome))).length;
      notas.push(`Casamento por nome exato (sem acento) com os ${sen.senadores.length} senadores do senado.json: ${achados} encontrados. O resto exige tabela de-para (nome parlamentar ≠ nome no orçamento).`);
    } catch { notas.push('Não consegui ler senado.json pra medir o casamento de nomes.'); }

    let atrasoH: number | null = modificado ? atraso([modificado]) : null;
    if (favorecido) {
      const fl = favorecido.split(/\r?\n/);
      const fc = celulas(fl[0]);
      const iMes = fc.indexOf('Ano/Mês');
      const meses = new Map<string, number>();
      for (let k = 1; k < fl.length; k++) if (fl[k]) { const m = celulas(fl[k])[iMes]; meses.set(m, (meses.get(m) ?? 0) + 1); }
      const ult = [...meses].sort((a, b) => a[0].localeCompare(b[0])).slice(-3);
      notas.push(`Pagamentos por favorecido têm granularidade mensal (Ano/Mês), sem dia: ${ult.map(([m, n]) => `${m}: ${n}`).join(', ')} linhas. Serve pra resumo mensal ("sua emenda pagou X a Y"), não pra feed diário.`);
    }
    notas.push('A página de detalhe da emenda no portal respondeu 405 (WAF) a cliente sem navegador; a amostra aponta pra página de download com o código da emenda.');
    notas.push('Atraso = horas desde o Last-Modified do ZIP (o portal informa atualização periódica, não diária).');
    const top = doAno.filter(c => /Individual/.test(c[iTipo]) && c[iAutor] !== 'Sem informação').sort((a, b) => Number(b[iPago].replace(/\./g, '').replace(',', '.')) - Number(a[iPago].replace(/\./g, '').replace(',', '.')));
    return {
      status: 'parcial', itens: doAno.length, janela: `emendas de ${ano} (arquivo completo)`, atrasoHoras: atrasoH, formato: 'zip', idPolitico: false,
      amostra: amostra(top.map(c => ({ data: ano, titulo: `${c[iAutor]} — ${c[iTipo]} — ${c[iLocal]} — pago R$ ${c[iPago]}`, url: `${EMENDAS_PAGINA}#${c[iCod]}` }))),
      notas,
    };
  },
};

// ---------------------------------------------------------------------------------------------
// 5. Extra: notícias do Planalto (Atom)
// ---------------------------------------------------------------------------------------------
const RSS_PLANALTO = 'https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/noticias/RSS';
const noticiasPlanalto: Prova = {
  id: 'exec-noticias-planalto',
  nome: 'Notícias do Planalto (feed Atom)',
  grupo: 'executivo',
  url: RSS_PLANALTO,
  custo: '0 — feed público',
  risco: 'Comunicação oficial (versão do governo), não registro de ato; mesmo limite por volume de IP do gov.br.',
  async rodar(): Promise<Medida> {
    const r = await pegar(RSS_PLANALTO);
    if (!r.ok) return falha(r, 'rss');
    if (bloqueioGovBr(r.corpo)) return falha({ ...r, status: 429 }, 'rss', 'gov.br devolveu 200 com página de bloqueio por volume.');
    const itens = itensRss(r.corpo);
    if (!itens.length) return { ...falha(r, 'rss', 'Feed sem itens.'), status: 'falhou' };

    const corte = Date.now() - 7 * DIA;
    const naJanela = itens.filter(i => new Date(i.data).getTime() >= corte);
    return {
      status: naJanela.length ? 'ok' : 'parcial', itens: naJanela.length, janela: '7 dias', atrasoHoras: atraso(itens.map(i => i.data)), formato: 'rss', idPolitico: false,
      amostra: amostra(naJanela), notas: [
        `Feed Atom com ${itens.length} entradas; ${naJanela.length} nos últimos 7 dias. Título, link e data; o resumo é curto.`,
        'Formato RSS 1.0 (RDF) com dc:date. Útil como contexto do dia do presidente, complementando a agenda.',
        ...(naJanela.length ? [] : ['Nada nos últimos 7 dias: provável congelamento da publicidade institucional no período eleitoral (a agenda segue publicada). Medir de novo depois do 2º turno.']),
        'Agência Gov (agenciagov.ebc.com.br/rss, /noticias/rss, /noticias/feed) deu 404 nesta rodada.',
      ],
    };
  },
};

export default [agendaPresidente, eAgendas, douPresidente, douLeitura, emendas, noticiasPlanalto] satisfies Prova[];
