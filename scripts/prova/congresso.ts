/* Fase 0 — provas das fontes oficiais do Congresso (Câmara e Senado).
   Uma prova por tipo de dado; janela de 7 dias onde faz sentido.
   Datas das duas casas vêm sem fuso (horário de Brasília): normalizamos com -03:00
   antes de medir atraso, senão a máquina (fora do Brasil) erra em horas. */
import { inflateRawSync } from 'node:zlib';
import { UA } from '../util';
import { pegar, pegarJson, atraso, janelaDias, falha, amostra, type Prova, type Medida } from './base';

const CAM = 'https://dadosabertos.camara.leg.br/api/v2';
const SEN = 'https://legis.senado.leg.br/dadosabertos';
const CEAPS = 'https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps';
const COTA_CAMARA = 'https://www.camara.leg.br/cotas';

/** Data/hora de Brasília sem fuso → ISO com -03:00. */
function br(d: string | null | undefined): string | null {
  if (!d) return null;
  const s = d.trim().replace(' ', 'T');
  if (/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00-03:00`;
  return `${s}-03:00`;
}
const agora = () => Date.now();
const passou = (d: string | null) => !!d && new Date(d).getTime() <= agora();
const semTraco = (d: string) => d.replace(/-/g, '');
/** Só a data mais recente: atraso() de base.ts faz Math.max(...lista) e estoura a pilha com >100 mil datas. */
const recente = (ds: (string | null)[]) => {
  let m: string | null = null, t = -Infinity;
  for (const d of ds) { const x = d ? new Date(d).getTime() : NaN; if (x > t) { t = x; m = d; } }
  return m ? [m] : [];
};
const lista = <T>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

/** Roda `fn` sobre `itens` com no máximo `n` em paralelo. */
async function emLotes<T, R>(itens: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k]); }
  }));
  return out;
}

function medida(p: Partial<Medida> & Pick<Medida, 'status' | 'formato'>): Medida {
  return { itens: null, janela: '7 dias', atrasoHoras: null, idPolitico: false, amostra: [], notas: [], ...p };
}

/* ---------------- Câmara ---------------- */

interface Evento { id: number; dataHoraInicio: string; situacao: string; descricaoTipo: string; descricao: string; orgaos: { sigla: string }[] }
async function eventosCamara(inicio: string, fim: string): Promise<{ ok: boolean; r: Awaited<ReturnType<typeof pegar>>; eventos: Evento[] }> {
  const eventos: Evento[] = [];
  let r!: Awaited<ReturnType<typeof pegar>>;
  for (let pagina = 1; pagina <= 20; pagina++) {
    const res = await pegarJson<{ dados: Evento[]; links: { rel: string; href: string }[] }>(`${CAM}/eventos?dataInicio=${inicio}&dataFim=${fim}&itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=dataHoraInicio`);
    r = res.r;
    if (!res.dados) return { ok: false, r, eventos };
    eventos.push(...res.dados.dados);
    if (!res.dados.links.some(l => l.rel === 'next')) break;
  }
  return { ok: true, r, eventos };
}
const encerrado = (e: Evento) => /^Encerrada/.test(e.situacao);

const camaraAgenda: Prova = {
  id: 'camara-agenda',
  nome: 'Câmara — agenda de eventos (plenário e comissões)',
  grupo: 'oficial',
  url: `${CAM}/eventos`,
  custo: '0 — API aberta, sem chave.',
  risco: 'Baixo: API oficial estável há anos, dado público por lei (LAI).',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    const { ok, r, eventos } = await eventosCamara(inicio, fim);
    if (!ok) return falha(r, 'json');
    const realizados = eventos.filter(e => passou(br(e.dataHoraInicio)));
    const porSit: Record<string, number> = {};
    for (const e of eventos) porSit[e.situacao] = (porSit[e.situacao] ?? 0) + 1;
    const plen = eventos.filter(e => e.orgaos.some(o => o.sigla === 'PLEN')).length;
    return medida({
      status: eventos.length ? 'ok' : 'parcial', formato: 'json', itens: eventos.length,
      atrasoHoras: atraso(realizados.map(e => br(e.dataHoraInicio))),
      amostra: amostra(realizados.slice().reverse().map(e => ({ data: br(e.dataHoraInicio)!, titulo: `${e.orgaos.map(o => o.sigla).join('/')} — ${e.descricaoTipo} (${e.situacao})`, url: `${CAM}/eventos/${e.id}` }))),
      notas: [
        `situações: ${Object.entries(porSit).map(([k, v]) => `${k} ${v}`).join(', ')}; ${plen} do plenário`,
        'evento traz órgão, tipo, situação e pauta (/eventos/{id}/pauta), mas não o deputado; o vínculo com o político vem de /eventos/{id}/deputados (presença) e /eventos/{id}/votacoes',
        'agenda futura também vem (situação "Convocada"), dá pra avisar antes; datas sem fuso (Brasília)',
        'paginação por links rel=next, até 100 itens por página; sem limite de requisição observado',
      ],
    });
  },
};

const camaraPresenca: Prova = {
  id: 'camara-presenca',
  nome: 'Câmara — presença por evento (/eventos/{id}/deputados)',
  grupo: 'oficial',
  url: `${CAM}/eventos/{id}/deputados`,
  custo: '0 — API aberta; 1 requisição por evento encerrado.',
  risco: 'Baixo na fonte; médio na leitura: lista de presença registrada não é o mesmo que ter votado ou ficado na sessão.',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    const { ok, r, eventos } = await eventosCamara(inicio, fim);
    if (!ok) return falha(r, 'json');
    const alvo = eventos.filter(encerrado);
    const res = await emLotes(alvo, 5, async e => {
      const x = await pegarJson<{ dados: { id: number; nome: string }[] }>(`${CAM}/eventos/${e.id}/deputados`);
      return { e, n: x.dados ? x.dados.dados.length : null };
    });
    const falhas = res.filter(x => x.n === null).length;
    const total = res.reduce((s, x) => s + (x.n ?? 0), 0);
    const plen = res.filter(x => x.e.orgaos.some(o => o.sigla === 'PLEN') && (x.n ?? 0) > 0);
    const com = res.filter(x => !x.e.orgaos.some(o => ['PLEN', 'CN'].includes(o.sigla)) && (x.n ?? 0) > 0);
    const zerados = res.filter(x => x.n === 0).map(x => `${x.e.orgaos.map(o => o.sigla).join('/')} ${x.e.descricaoTipo}`);
    return medida({
      status: total > 0 ? (falhas ? 'parcial' : 'ok') : 'falhou', formato: 'json', itens: total, idPolitico: true,
      atrasoHoras: atraso(res.filter(x => (x.n ?? 0) > 0).map(x => br(x.e.dataHoraInicio))),
      amostra: amostra(res.filter(x => (x.n ?? 0) > 0).reverse().map(x => ({ data: br(x.e.dataHoraInicio)!, titulo: `${x.e.orgaos.map(o => o.sigla).join('/')} ${x.e.descricaoTipo}: ${x.n} deputados presentes`, url: `${CAM}/eventos/${x.e.id}/deputados` }))),
      notas: [
        `itens = pares (evento, deputado) presentes em ${alvo.length} eventos encerrados${falhas ? `; ${falhas} eventos sem resposta` : ''}`,
        `plenário: ${plen.map(x => x.n).join(', ') || '—'} presentes por sessão (de 513); comissões: ${com.map(x => x.n).join(', ') || '—'}`,
        zerados.length ? `eventos encerrados com lista vazia: ${zerados.slice(0, 6).join('; ')}` : 'nenhum evento encerrado com lista vazia',
        'existe presença registrada por sessão e por reunião de comissão, já com id do deputado; ausência = 513 menos a lista (cuidado com licenciados e missão oficial, que a lista não distingue)',
        'não há /eventos/{id}/requerimentos (HTTP 405); /eventos/{id}/pauta, /orgaos e /votacoes existem',
      ],
    });
  },
};

const camaraVotacoes: Prova = {
  id: 'camara-votacoes',
  nome: 'Câmara — votações da semana e votos nominais',
  grupo: 'oficial',
  url: `${CAM}/votacoes`,
  custo: '0 — API aberta; 1 requisição por votação pra achar votos nominais.',
  risco: 'Baixo: mesma fonte que o app já usa em produção.',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    const { r, dados } = await pegarJson<{ dados: { id: string; dataHoraRegistro: string; siglaOrgao: string; descricao: string }[] }>(`${CAM}/votacoes?dataInicio=${inicio}&dataFim=${fim}&itens=200&ordem=DESC&ordenarPor=dataHoraRegistro`);
    if (!dados) return falha(r, 'json');
    const vots = dados.dados;
    const votos = await emLotes(vots, 5, async v => {
      const x = await pegarJson<{ dados: { tipoVoto: string; deputado_: { id: number } }[] }>(`${CAM}/votacoes/${v.id}/votos`);
      return { v, n: x.dados ? x.dados.dados.length : null };
    });
    const nominais = votos.filter(x => (x.n ?? 0) > 0);
    const totVotos = nominais.reduce((s, x) => s + (x.n ?? 0), 0);
    const porOrgao: Record<string, number> = {};
    for (const v of vots) porOrgao[v.siglaOrgao] = (porOrgao[v.siglaOrgao] ?? 0) + 1;
    return medida({
      status: vots.length ? 'ok' : 'parcial', formato: 'json', itens: vots.length, idPolitico: nominais.length > 0,
      atrasoHoras: atraso(vots.map(v => br(v.dataHoraRegistro))),
      amostra: amostra((nominais.length ? nominais : votos).map(x => ({ data: br(x.v.dataHoraRegistro)!, titulo: `${x.v.siglaOrgao}: ${x.v.descricao}${x.n ? ` (${x.n} votos nominais)` : ''}`, url: `${CAM}/votacoes/${x.v.id}/votos` }))),
      notas: [
        `${vots.length} votações (${Object.entries(porOrgao).map(([k, v]) => `${k} ${v}`).join(', ')}); só ${nominais.length} nominais, somando ${totVotos} votos com id do deputado`,
        'votação simbólica não tem /votos (lista vazia): pro feed, só a nominal liga ação a político; as demais servem como contexto do dia',
        'votos trazem dataRegistroVoto, tipoVoto e deputado_.id; orientação de bancada em /votacoes/{id}/orientacoes',
        'lista cabe numa página com itens=200 numa semana normal; acima disso, paginar',
      ],
    });
  },
};

/** Amostra fixa de deputados: espalhada na lista atual (ordem alfabética). */
async function amostraDeputados(n: number): Promise<{ id: number; nome: string; siglaPartido: string; siglaUf: string }[] | null> {
  const { dados } = await pegarJson<{ dados: { id: number; nome: string; siglaPartido: string; siglaUf: string }[] }>(`${CAM}/deputados?itens=600&ordem=ASC&ordenarPor=nome`);
  if (!dados?.dados.length) return null;
  const todos = dados.dados;
  const passo = Math.floor(todos.length / n);
  return Array.from({ length: n }, (_, i) => todos[i * passo + Math.floor(passo / 2)]);
}

const camaraDiscursos: Prova = {
  id: 'camara-discursos',
  nome: 'Câmara — discursos por deputado (amostra de 10, extrapolada)',
  grupo: 'oficial',
  url: `${CAM}/deputados/{id}/discursos`,
  custo: '0 — API aberta; 513 requisições por rodada (uma por deputado).',
  risco: 'Baixo na fonte; transcrição chega com dias de atraso e sem revisão do orador.',
  async rodar() {
    const deps = await amostraDeputados(10);
    if (!deps) return falha(await pegar(`${CAM}/deputados?itens=1`), 'json', 'não consegui listar deputados');
    const j7 = janelaDias(7), j30 = janelaDias(30);
    type Disc = { dataHoraInicio: string; tipoDiscurso: string; sumario: string | null; transcricao: string | null; urlTexto: string | null; urlAudio: string | null; urlVideo: string | null };
    const res = await emLotes(deps, 5, async d => {
      const x = await pegarJson<{ dados: Disc[] }>(`${CAM}/deputados/${d.id}/discursos?dataInicio=${j30.inicio}&dataFim=${j30.fim}&itens=100&ordem=DESC&ordenarPor=dataHoraInicio`);
      return { d, lista: x.dados?.dados ?? null };
    });
    const ok = res.filter(x => x.lista);
    if (!ok.length) return falha(await pegar(`${CAM}/deputados/${deps[0].id}/discursos`), 'json');
    const todos = ok.flatMap(x => x.lista!.map(s => ({ ...s, d: x.d })));
    const em7 = todos.filter(s => (br(s.dataHoraInicio) ?? '') >= `${j7.inicio}`);
    const extrap7 = Math.round((em7.length / ok.length) * 513);
    const extrap30 = Math.round((todos.length / ok.length) * 513);
    const comTexto = todos.filter(s => s.transcricao).length;
    const comSumario = todos.filter(s => s.sumario).length;
    const comMidia = todos.filter(s => s.urlAudio || s.urlVideo || s.urlTexto).length;
    return medida({
      status: todos.length ? 'ok' : 'parcial', formato: 'json', itens: em7.length, janela: `7 dias, ${ok.length} deputados`, idPolitico: true,
      atrasoHoras: atraso(todos.map(s => br(s.dataHoraInicio))),
      amostra: amostra(todos.map(s => ({ data: br(s.dataHoraInicio)!, titulo: `${s.d.nome} (${s.d.siglaPartido}-${s.d.siglaUf}) — ${s.tipoDiscurso}: ${(s.transcricao ?? s.sumario ?? '').replace(/\s+/g, ' ').slice(0, 90)}`, url: `${CAM}/deputados/${s.d.id}/discursos` }))),
      notas: [
        `amostra: ${deps.map(d => `${d.nome} ${res.find(x => x.d.id === d.id)?.lista?.length ?? '?'}`).join(', ')} (discursos em 30 dias)`,
        `extrapolação pra 513: ~${extrap7} discursos em 7 dias, ~${extrap30} em 30 dias (variância alta: poucos deputados concentram a fala)`,
        `campos: transcrição em ${comTexto}/${todos.length}, sumário em ${comSumario}/${todos.length}, link de áudio/vídeo/texto em ${comMidia}/${todos.length}`,
        'não há endpoint de discursos por período pra Casa toda: é 1 chamada por deputado (513/dia); atraso = horas desde o discurso mais recente da amostra',
        'paginação padrão de 15 itens; usar itens=100',
      ],
    });
  },
};

const camaraProposicoes: Prova = {
  id: 'camara-proposicoes',
  nome: 'Câmara — proposições apresentadas na semana',
  grupo: 'oficial',
  url: `${CAM}/proposicoes`,
  custo: '0 — API aberta; +1 requisição por proposição pra saber o autor.',
  risco: 'Baixo: API oficial; volume dominado por requerimentos e pareceres, precisa filtrar tipo.',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    type P = { id: number; siglaTipo: string; numero: number; ano: number; ementa: string; dataApresentacao: string };
    const props: P[] = [];
    let r0: Awaited<ReturnType<typeof pegar>> | null = null;
    for (let pagina = 1; pagina <= 30; pagina++) {
      const { r, dados } = await pegarJson<{ dados: P[]; links: { rel: string }[] }>(`${CAM}/proposicoes?dataApresentacaoInicio=${inicio}&dataApresentacaoFim=${fim}&itens=100&pagina=${pagina}&ordem=DESC&ordenarPor=id`);
      if (!dados) { r0 = r; break; }
      props.push(...dados.dados);
      if (!dados.links.some(l => l.rel === 'next')) break;
    }
    if (!props.length && r0) return falha(r0, 'json');
    const porTipo: Record<string, number> = {};
    for (const p of props) porTipo[p.siglaTipo] = (porTipo[p.siglaTipo] ?? 0) + 1;
    const top = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).slice(0, 8);
    // autor de 3 proposições, pra provar o vínculo
    const amostraAut = await emLotes(props.filter(p => ['PL', 'PLP', 'PEC', 'REQ', 'RIC'].includes(p.siglaTipo)).slice(0, 3), 3, async p => {
      const x = await pegarJson<{ dados: { nome: string; tipo: string; uri: string | null }[] }>(`${CAM}/proposicoes/${p.id}/autores`);
      return { p, autores: x.dados?.dados ?? [] };
    });
    return medida({
      status: props.length ? 'ok' : 'parcial', formato: 'json', itens: props.length,
      atrasoHoras: atraso(props.map(p => br(p.dataApresentacao))),
      amostra: amostra(amostraAut.map(x => ({ data: br(x.p.dataApresentacao)!, titulo: `${x.p.siglaTipo} ${x.p.numero}/${x.p.ano} (${x.autores.map(a => a.nome).join(', ') || 'autor ?'}): ${x.p.ementa}`, url: `${CAM}/proposicoes/${x.p.id}` }))),
      notas: [
        `tipos: ${top.map(([k, v]) => `${k} ${v}`).join(', ')}`,
        'a lista não traz autor: precisa de /proposicoes/{id}/autores (uri com id do deputado) ou consultar por deputado com ?idDeputadoAutor= (513 chamadas)',
        'muito item é parecer, redação final, requerimento: filtrar PL/PLP/PEC/PDL/REQ/RIC/INC para o feed',
        'paginação de 100 por página via links rel=next; header X-Total-Count disponível (pegar() não expõe headers)',
      ],
    });
  },
};

const camaraDespesasApi: Prova = {
  id: 'camara-despesas-api',
  nome: 'Câmara — cota parlamentar pela API (/deputados/{id}/despesas)',
  grupo: 'oficial',
  url: `${CAM}/deputados/{id}/despesas`,
  custo: '0 — API aberta; 1 requisição por deputado e mês.',
  risco: 'Alto: o endpoint respondeu vazio nesta rodada; não dá pra depender dele sem o arquivo anual de reserva.',
  async rodar() {
    const deps = await amostraDeputados(5);
    if (!deps) return falha(await pegar(`${CAM}/deputados?itens=1`), 'json');
    const ano = new Date().getFullYear();
    type D = { ano: number; mes: number; dataDocumento: string | null; tipoDespesa: string; nomeFornecedor: string; valorLiquido: number; urlDocumento: string | null };
    const res = await emLotes(deps, 5, async d => {
      const x = await pegarJson<{ dados: D[] }>(`${CAM}/deputados/${d.id}/despesas?ano=${ano}&itens=100&ordem=DESC&ordenarPor=dataDocumento`);
      return { d, lista: x.dados?.dados ?? null };
    });
    const todos = res.flatMap(x => (x.lista ?? []).map(s => ({ ...s, d: x.d })));
    // checagem: a mesma rota devolve dados de legislatura antiga?
    const antigo = await pegarJson<{ dados: D[] }>(`${CAM}/deputados/${deps[0].id}/despesas?idLegislatura=56&itens=5`);
    const passadas = todos.filter(s => passou(br(s.dataDocumento)));
    return medida({
      status: todos.length ? 'ok' : 'falhou', formato: 'json', itens: todos.length, janela: `ano ${ano}, ${deps.length} deputados`, idPolitico: true,
      atrasoHoras: atraso(passadas.map(s => br(s.dataDocumento))),
      amostra: amostra(passadas.map(s => ({ data: br(s.dataDocumento)!, titulo: `${s.d.nome}: ${s.tipoDespesa} — ${s.nomeFornecedor} R$ ${s.valorLiquido}`, url: s.urlDocumento ?? `${CAM}/deputados/${s.d.id}/despesas` }))),
      notas: [
        `despesas de ${ano} por deputado: ${res.map(x => `${x.d.nome} ${x.lista ? x.lista.length : 'erro'}`).join(', ')}`,
        todos.length ? 'endpoint respondeu com dados' : `endpoint devolve lista vazia (HTTP 200) para ${ano} na legislatura atual, inclusive sem filtro de ano; com idLegislatura=56 devolve ${antigo.dados?.dados.length ?? '?'} itens — parece quebrado só pro mandato corrente`,
        'reserva: arquivo anual Ano-AAAA.csv.zip (prova camara-despesas-csv), que traz o mesmo dado com nuDeputadoId',
      ],
    });
  },
};

/** Baixa um .zip de um arquivo só e devolve o conteúdo descompactado (via diretório central). */
async function baixarZipUnico(url: string): Promise<{ ok: true; texto: string; bytes: number; ms: number; modificado: string | null } | { ok: false; status: number; erro?: string }> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal });
    if (!r.ok) return { ok: false, status: r.status };
    const buf = Buffer.from(await r.arrayBuffer());
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return { ok: false, status: r.status, erro: 'zip sem diretório central' };
    const cd = buf.readUInt32LE(eocd + 16);
    const metodo = buf.readUInt16LE(cd + 10);
    const tamComp = buf.readUInt32LE(cd + 20);
    const local = buf.readUInt32LE(cd + 42);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tamComp);
    const bruto = metodo === 0 ? dados : inflateRawSync(dados);
    return { ok: true, texto: bruto.toString('utf8'), bytes: buf.length, ms: Date.now() - t0, modificado: r.headers.get('last-modified') };
  } catch (e) {
    return { ok: false, status: 0, erro: (e as Error).message };
  } finally { clearTimeout(timer); }
}

const camaraDespesasCsv: Prova = {
  id: 'camara-despesas-csv',
  nome: 'Câmara — cota parlamentar, arquivo anual (Ano-AAAA.csv.zip)',
  grupo: 'oficial',
  url: `${COTA_CAMARA}/Ano-${new Date().getFullYear()}.csv.zip`,
  custo: '0 — download aberto, ~4 MB zipado (~45 MB CSV) por dia.',
  risco: 'Baixo: arquivo oficial regerado diariamente; lançamento atrasa semanas, então o mês corrente sempre aparece incompleto.',
  async rodar() {
    const ano = new Date().getFullYear();
    const z = await baixarZipUnico(`${COTA_CAMARA}/Ano-${ano}.csv.zip`);
    if (!z.ok) return medida({ status: z.status === 403 || z.status === 451 ? 'bloqueado' : 'falhou', formato: 'zip', notas: [`HTTP ${z.status}${z.erro ? ` (${z.erro})` : ''} ao baixar Ano-${ano}.csv.zip`] });
    const linhas = z.texto.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
    const cab = linhas[0].split(';').map(c => c.replace(/^"|"$/g, ''));
    const col = (n: string) => cab.indexOf(n);
    const [iNome, iId, iData, iMes, iDesc, iForn, iVal, iUrl] = ['txNomeParlamentar', 'nuDeputadoId', 'datEmissao', 'numMes', 'txtDescricao', 'txtFornecedor', 'vlrLiquido', 'urlDocumento'].map(col);
    const ideCad = col('ideCadastro');
    const regs = linhas.slice(1).map(l => l.slice(1, -1).split('";"')).filter(c => c.length === cab.length);
    const { inicio } = janelaDias(7);
    const datas = regs.map(c => br(c[iData]?.slice(0, 10))).filter((d): d is string => !!d);
    const passadas = datas.filter(passou);
    const futuras = datas.length - passadas.length;
    const em7 = regs.filter(c => (c[iData] ?? '').slice(0, 10) >= inicio && passou(br(c[iData]?.slice(0, 10))));
    const porMes: Record<string, number> = {};
    for (const c of regs) porMes[c[iMes]] = (porMes[c[iMes]] ?? 0) + 1;
    const meses = Object.keys(porMes).map(Number).sort((a, b) => a - b);
    const cheios = meses.slice(0, -3).map(m => porMes[m]).sort((a, b) => a - b);
    const mediana = cheios.length ? cheios[Math.floor(cheios.length / 2)] : null;
    const comIdDep = regs.filter(c => c[ideCad]).length;
    const recentes = em7.sort((a, b) => (b[iData] ?? '').localeCompare(a[iData] ?? ''));
    return medida({
      status: regs.length ? 'ok' : 'parcial', formato: 'zip', itens: em7.length, janela: '7 dias (pela data de emissão do documento)', idPolitico: true,
      atrasoHoras: atraso(recente(passadas)),
      amostra: amostra(recentes.map(c => ({ data: br(c[iData].slice(0, 10))!, titulo: `${c[iNome]} (id ${c[iId] || '—'}): ${c[iDesc]} — ${c[iForn]} R$ ${c[iVal]}`, url: c[iUrl] || `${COTA_CAMARA}/Ano-${ano}.csv.zip` }))),
      notas: [
        `${regs.length} lançamentos no ano; arquivo ${(z.bytes / 1e6).toFixed(1)} MB zipado, baixado em ${(z.ms / 1000).toFixed(1)} s; Last-Modified ${z.modificado ?? '?'}`,
        `lançamentos por mês: ${meses.map(m => `${m}:${porMes[m]}`).join(' ')}${mediana ? ` (mediana dos meses fechados ${mediana}; os últimos 1–2 meses ainda estão chegando)` : ''}`,
        'não há data de lançamento no arquivo: atraso real (emissão → publicação) só se mede comparando o arquivo dia a dia; o volume mostra que um mês leva ~2 meses pra completar',
        `ideCadastro (= id da API) presente em ${comIdDep}/${regs.length}; linhas sem id são lideranças/órgãos (ex.: LID.GOV-CD)`,
        futuras ? `${futuras} lançamentos com data de emissão no futuro (erro de digitação na origem)` : 'nenhuma data no futuro',
        'pegar() de base.ts só lê texto; o zip foi baixado com fetch próprio e descompactado com zlib (sem dependência)',
      ],
    });
  },
};

const camaraOrgaos: Prova = {
  id: 'camara-orgaos',
  nome: 'Câmara — órgãos e frentes de cada deputado',
  grupo: 'oficial',
  url: `${CAM}/deputados/{id}/orgaos`,
  custo: '0 — API aberta; 1 requisição por deputado, dado lento (muda pouco).',
  risco: 'Baixo: é cadastro, não atividade; serve de contexto pro feed, não como evento diário.',
  async rodar() {
    const deps = await amostraDeputados(3);
    if (!deps) return falha(await pegar(`${CAM}/deputados?itens=1`), 'json');
    const res = await emLotes(deps, 3, async d => {
      const o = await pegarJson<{ dados: { siglaOrgao: string; titulo: string; dataInicio: string; dataFim: string | null }[] }>(`${CAM}/deputados/${d.id}/orgaos?itens=100&ordem=DESC&ordenarPor=dataInicio`);
      const f = await pegarJson<{ dados: { titulo: string }[] }>(`${CAM}/deputados/${d.id}/frentes`);
      return { d, orgaos: o.dados?.dados ?? null, frentes: f.dados?.dados ?? null };
    });
    const orgs = res.flatMap(x => (x.orgaos ?? []).map(o => ({ ...o, d: x.d })));
    return medida({
      status: res.some(x => x.orgaos) ? 'ok' : 'falhou', formato: 'json', itens: orgs.length, janela: `${deps.length} deputados, cargos vigentes e passados`, idPolitico: true,
      atrasoHoras: atraso(orgs.map(o => br(o.dataInicio)).filter(passou)),
      amostra: amostra(orgs.map(o => ({ data: br(o.dataInicio)!, titulo: `${o.d.nome}: ${o.titulo} em ${o.siglaOrgao}`, url: `${CAM}/deputados/${o.d.id}/orgaos` }))),
      notas: [
        `por deputado: ${res.map(x => `${x.d.nome} ${x.orgaos?.length ?? '?'} órgãos, ${x.frentes?.length ?? '?'} frentes`).join('; ')}`,
        'útil pra contextualizar (titular de comissão X), não é evento do dia; frentes não têm data de adesão',
      ],
    });
  },
};

/* ---------------- Senado ---------------- */

const senadoAgendaPlenario: Prova = {
  id: 'senado-agenda-plenario',
  nome: 'Senado — agenda e sessões do plenário (SF e CN)',
  grupo: 'oficial',
  url: `${SEN}/plenario/agenda/mes/{AAAAMMDD}`,
  custo: '0 — API aberta, sem chave.',
  risco: 'Baixo: API oficial; JSON é tradução do XML (objeto vira lista só quando há mais de um).',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    const pedidos = [semTraco(inicio)];
    if (inicio.slice(0, 7) !== fim.slice(0, 7)) pedidos.push(`${semTraco(fim).slice(0, 6)}01`);
    type S = { Data: string; Hora: string; CodigoSessao: string; Casa: string; TipoSessao: string; SituacaoSessao: string };
    const sessoes: S[] = [];
    for (const d of pedidos) {
      const { r, dados } = await pegarJson<{ AgendaPlenario: { Sessoes: { Sessao: S | S[] } | null } }>(`${SEN}/plenario/agenda/mes/${d}`);
      if (!dados) return falha(r, 'json');
      sessoes.push(...lista(dados.AgendaPlenario.Sessoes?.Sessao));
    }
    const naJanela = sessoes.filter(s => s.Data >= inicio && s.Data <= fim);
    const realizadas = naJanela.filter(s => /Encerrada|Realizada/i.test(s.SituacaoSessao));
    const quando = (s: S) => br(`${s.Data}T${(s.Hora || '00:00').padStart(5, '0')}`);
    return medida({
      status: naJanela.length ? 'ok' : 'parcial', formato: 'json', itens: naJanela.length,
      atrasoHoras: atraso(realizadas.map(quando).filter(passou)),
      amostra: amostra(realizadas.reverse().map(s => ({ data: quando(s)!, titulo: `${s.Casa} — ${s.TipoSessao.trim()} (${s.SituacaoSessao})`, url: `${SEN}/plenario/encontro/${s.CodigoSessao}` }))),
      notas: [
        `${realizadas.length} sessões encerradas, ${naJanela.length - realizadas.length} não realizadas/canceladas/agendadas na janela`,
        'o serviço /agenda/mes/{data} devolve da data até o fim do mês; traz oradores inscritos por nome (sem código), sem id do senador',
        'resultado por item de pauta em /plenario/resultado/{AAAAMMDD} e detalhes em /plenario/encontro/{codigo}',
      ],
    });
  },
};

const senadoAgendaComissoes: Prova = {
  id: 'senado-agenda-comissoes',
  nome: 'Senado — agenda de reuniões de comissão',
  grupo: 'oficial',
  url: `${SEN}/comissao/agenda/{inicio}/{fim}`,
  custo: '0 — API aberta, sem chave.',
  risco: 'Baixo: API oficial; reunião não lista os senadores presentes.',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    type R = { codigo: string; titulo: string; dataInicio: string; situacao: string; colegiadoCriador: { sigla: string; siglaCasa: string } };
    const { r, dados } = await pegarJson<{ AgendaReuniao: { reunioes: { reuniao: R | R[] } | null } }>(`${SEN}/comissao/agenda/${semTraco(inicio)}/${semTraco(fim)}`);
    if (!dados) return falha(r, 'json');
    const reus = lista(dados.AgendaReuniao.reunioes?.reuniao);
    const porSit: Record<string, number> = {};
    for (const x of reus) porSit[x.situacao] = (porSit[x.situacao] ?? 0) + 1;
    const feitas = reus.filter(x => /^(Realizada|Encerrada)/i.test(x.situacao)).sort((a, b) => a.dataInicio.localeCompare(b.dataInicio));
    // a reunião detalhada traz presença?
    let presenca = 'sem reunião realizada pra checar';
    if (feitas[0]) {
      const det = await pegar(`${SEN}/comissao/reuniao/${feitas[0].codigo}`, { headers: { Accept: 'application/json' } });
      const chaves = [...new Set(det.corpo.match(/"[A-Za-z]*[Pp]resen[a-zç]*"/g) ?? [])];
      presenca = `detalhe da reunião (/comissao/reuniao/{codigo}) tem só ${chaves.join(', ') || 'nenhum campo de presença'}; não lista quem compareceu`;
    }
    return medida({
      status: reus.length ? 'ok' : 'parcial', formato: 'json', itens: reus.length,
      atrasoHoras: atraso(feitas.map(x => br(x.dataInicio)).filter(passou)),
      amostra: amostra(feitas.reverse().map(x => ({ data: br(x.dataInicio)!, titulo: `${x.colegiadoCriador.sigla} (${x.colegiadoCriador.siglaCasa}) — ${x.titulo} (${x.situacao})`, url: `${SEN}/comissao/reuniao/${x.codigo}` }))),
      notas: [
        `situações: ${Object.entries(porSit).map(([k, v]) => `${k} ${v}`).join(', ')}`,
        presenca,
        'inclui comissões mistas (CN); relator do item vem com código do parlamentar dentro da pauta do detalhe',
      ],
    });
  },
};

type VotoSen = { codigoParlamentar: number; nomeParlamentar: string; siglaVotoParlamentar: string };
type VotacaoSen = { codigoSessaoVotacao: number; codigoSessao: number; dataSessao: string; identificacao: string; descricaoVotacao: string; votacaoSecreta: string; resultadoVotacao: string | null; votos: VotoSen[] | null };

const senadoVotacoes: Prova = {
  id: 'senado-votacoes',
  nome: 'Senado — votações nominais da semana',
  grupo: 'oficial',
  url: `${SEN}/votacao`,
  custo: '0 — API aberta, sem chave.',
  risco: 'Baixo: mesma fonte que o app já usa; votação simbólica e secreta não identificam o voto.',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    const { r, dados } = await pegarJson<VotacaoSen[]>(`${SEN}/votacao?dataInicio=${inicio}&dataFim=${fim}`);
    if (!dados) return falha(r, 'json');
    const votos = dados.flatMap(v => v.votos ?? []);
    const siglas: Record<string, number> = {};
    for (const v of votos) siglas[v.siglaVotoParlamentar] = (siglas[v.siglaVotoParlamentar] ?? 0) + 1;
    const secretas = dados.filter(v => v.votacaoSecreta === 'S').length;
    return medida({
      status: dados.length ? 'ok' : 'parcial', formato: 'json', itens: dados.length, idPolitico: true,
      atrasoHoras: atraso(dados.map(v => br(v.dataSessao))),
      amostra: amostra(dados.slice().reverse().map(v => ({ data: br(v.dataSessao)!, titulo: `${v.identificacao}: ${v.descricaoVotacao} (${v.votos?.length ?? 0} votos)`, url: `${SEN}/votacao?codigoSessao=${v.codigoSessao}` }))),
      notas: [
        `${dados.length} votações nominais (${secretas} secretas), ${votos.length} votos individuais com codigoParlamentar`,
        `siglas de voto: ${Object.entries(siglas).map(([k, v]) => `${k} ${v}`).join(', ')} — P-NRV (presente, não votou), AP/LS/MIS/NCom etc. viram proxy de presença só nos dias com votação nominal`,
        'só nominais: votação simbólica do plenário fica em /plenario/resultado/{data}, sem voto por senador',
        'votações de comissão em /votacaoComissao/comissao/{sigla} ou /parlamentar/{codigo} (não medido aqui)',
        'atraso medido pela data da sessão (sem hora): votos aparecem no mesmo dia',
      ],
    });
  },
};

const senadoPresenca: Prova = {
  id: 'senado-presenca',
  nome: 'Senado — presença por sessão',
  grupo: 'oficial',
  url: `${SEN}/v3/api-docs`,
  custo: '0 — mas não há serviço próprio.',
  risco: 'Médio: sem lista oficial de presença na API, qualquer "faltou" vira inferência a partir dos votos.',
  async rodar() {
    const { r, dados } = await pegarJson<{ paths: Record<string, unknown> }>(`${SEN}/v3/api-docs`);
    if (!dados) return falha(r, 'json');
    const rotas = Object.keys(dados.paths).filter(p => /presenca|comparec|frequen/i.test(p));
    const { inicio, fim } = janelaDias(7);
    const v = await pegarJson<VotacaoSen[]>(`${SEN}/votacao?dataInicio=${inicio}&dataFim=${fim}`);
    const sessoesComVoto = new Set((v.dados ?? []).map(x => x.codigoSessao)).size;
    const temServico = rotas.some(p => !/tiposComparecimento/.test(p));
    return medida({
      status: temServico ? 'parcial' : 'falhou', formato: 'json', itens: temServico ? null : 0, janela: '—',
      notas: [
        `rotas da API (OpenAPI v3) com presença/comparecimento: ${rotas.join(', ') || 'nenhuma'}`,
        temServico ? 'há rota candidata; conferir manualmente' : 'não existe lista de presença por sessão nem por reunião de comissão na API de dados abertos',
        '/plenario/encontro/{codigo} e /resumo só têm tipoPresenca (presencial/semipresencial) e permitePresenca, não quem esteve',
        `proxy: votos nominais trazem P-NRV/AP/LS/NCom por senador — nesta semana cobre ${sessoesComVoto} sessão(ões) com votação nominal`,
        'o portal do Senado publica frequência mensal em página HTML (não testado aqui)',
      ],
    });
  },
};

type Pron = { CodigoPronunciamento: string; Data: string; TipoAutor: string; NomeAutor: string; CodigoParlamentar?: string; Partido?: string; UF?: string; Resumo?: string; TipoUsoPalavra?: { Descricao: string }; TextoIntegral?: string };
async function discursosSenado(ini: string, fim: string) {
  const { r, dados } = await pegarJson<{ DiscursosSessao: { Sessoes: { Sessao: { DataSessao: string; Pronunciamentos?: { Pronunciamento: Pron | Pron[] } } | unknown[] } | null } }>(`${SEN}/plenario/lista/discursos/${semTraco(ini)}/${semTraco(fim)}`);
  if (!dados) return { r, pron: null as Pron[] | null };
  const sess = lista(dados.DiscursosSessao.Sessoes?.Sessao as { Pronunciamentos?: { Pronunciamento: Pron | Pron[] } } | { Pronunciamentos?: { Pronunciamento: Pron | Pron[] } }[]);
  return { r, pron: sess.flatMap(s => lista(s.Pronunciamentos?.Pronunciamento)) };
}

const senadoDiscursos: Prova = {
  id: 'senado-discursos',
  nome: 'Senado — pronunciamentos do plenário',
  grupo: 'oficial',
  url: `${SEN}/plenario/lista/discursos/{inicio}/{fim}`,
  custo: '0 — API aberta; 1 requisição por período (máx. 1 mês).',
  risco: 'Baixo na fonte; o pronunciamento só entra depois de taquigrafado e publicado no Diário, com semanas de atraso.',
  async rodar() {
    const j7 = janelaDias(7), j30 = janelaDias(30);
    const a = await discursosSenado(j7.inicio, j7.fim);
    if (!a.pron) return falha(a.r, 'json');
    const b = await discursosSenado(j30.inicio, j30.fim);
    const p30 = b.pron ?? [];
    const sen30 = p30.filter(p => p.CodigoParlamentar);
    const ord = p30.slice().sort((x, y) => y.Data.localeCompare(x.Data));
    return medida({
      status: a.pron.length ? 'ok' : p30.length ? 'parcial' : 'falhou', formato: 'json', itens: a.pron.length, idPolitico: true,
      atrasoHoras: atraso(p30.map(p => br(p.Data))),
      amostra: amostra(ord.map(p => ({ data: br(p.Data)!, titulo: `${p.NomeAutor}${p.Partido ? ` (${p.Partido}-${p.UF})` : ''} — ${p.TipoUsoPalavra?.Descricao ?? ''}: ${p.Resumo ?? ''}`, url: p.TextoIntegral ?? `${SEN}/discurso/texto-integral/${p.CodigoPronunciamento}` }))),
      notas: [
        `7 dias: ${a.pron.length} pronunciamentos; 30 dias: ${p30.length} (${sen30.length} de senadores com CodigoParlamentar, o resto é autor externo em sessão especial)`,
        'atraso = horas desde o pronunciamento mais recente já publicado; sessões da semana costumam aparecer só depois da publicação no Diário do Senado',
        'traz resumo, indexação e link pro texto integral (.txt em /discurso/texto-integral/{codigo}); por senador: /senador/{codigo}/discursos',
        'JSON vindo de XML: objeto único não vem em lista',
      ],
    });
  },
};

const senadoMaterias: Prova = {
  id: 'senado-materias',
  nome: 'Senado — documentos e matérias apresentadas',
  grupo: 'oficial',
  url: `${SEN}/processo/documento`,
  custo: '0 — API aberta, sem chave.',
  risco: 'Baixo: API oficial nova (processo); maioria dos documentos é ofício/emenda/relatório, precisa filtrar tipo.',
  async rodar() {
    const { inicio, fim } = janelaDias(7);
    type Doc = { id: number; identificacao: string; descricao: string; descricaoTipo: string; siglaTipo: string; dataDocumento: string | null; dataRecebimento: string | null; autores: { autor: string; codigoParlamentar: number | null; siglaTipo: string }[] | null; urlDocumento: string };
    const { r, dados } = await pegarJson<Doc[]>(`${SEN}/processo/documento?dataInicio=${inicio}&dataFim=${fim}`);
    if (!dados) return falha(r, 'json');
    const deSenador = dados.filter(d => (d.autores ?? []).some(a => a.codigoParlamentar));
    const porTipo: Record<string, number> = {};
    for (const d of dados) porTipo[d.siglaTipo] = (porTipo[d.siglaTipo] ?? 0) + 1;
    const top = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const proc = await pegarJson<{ identificacao: string; autoria: string; dataApresentacao: string }[]>(`${SEN}/processo?dataInicioApresentacao=${inicio}&dataFimApresentacao=${fim}`);
    const relevantes = deSenador.filter(d => /PROJETO|REQUERIMENTO|PROPOSTA|EMENDA/.test(d.siglaTipo));
    const ord = (relevantes.length ? relevantes : deSenador).slice().sort((a, b) => (b.dataDocumento ?? '').localeCompare(a.dataDocumento ?? ''));
    return medida({
      status: dados.length ? 'ok' : 'parcial', formato: 'json', itens: dados.length, idPolitico: deSenador.length > 0,
      atrasoHoras: atraso(dados.map(d => br(d.dataRecebimento ?? d.dataDocumento)).filter(passou)),
      amostra: amostra(ord.map(d => ({ data: br(d.dataDocumento ?? d.dataRecebimento) ?? '', titulo: `${d.identificacao} (${(d.autores ?? []).map(a => a.autor).join(', ')}): ${d.descricao}`, url: d.urlDocumento }))),
      notas: [
        `${dados.length} documentos, ${deSenador.length} com autor parlamentar identificado por codigoParlamentar; tipos: ${top.map(([k, v]) => `${k} ${v}`).join(', ')}`,
        proc.dados ? `/processo por data de apresentação: ${proc.dados.length} processos novos, mas autoria só em texto (sem código)` : `/processo falhou: HTTP ${proc.r.status}`,
        'filtro por autor: ?codigoParlamentarAutor= (documento e processo); janela máx. 6 meses em documento, 1 ano em processo',
        'sem paginação: devolve tudo numa resposta',
      ],
    });
  },
};

const senadoCeaps: Prova = {
  id: 'senado-ceaps',
  nome: 'Senado — CEAPS (cota) pela API administrativa',
  grupo: 'oficial',
  url: `${CEAPS}/${new Date().getFullYear()}`,
  custo: '0 — API aberta; ~6 MB JSON por ano, 1 requisição por dia.',
  risco: 'Baixo: API oficial de transparência; lançamento atrasa semanas e há datas digitadas erradas.',
  async rodar() {
    const ano = new Date().getFullYear();
    const { r, dados } = await pegarJson<{ id: number; ano: number; mes: number; codSenador: number; nomeSenador: string; tipoDespesa: string; fornecedor: string; data: string | null; valorReembolsado: number }[]>(`${CEAPS}/${ano}`, { timeoutMs: 120_000 });
    if (!dados) {
      const csv = await pegar(`https://www.senado.gov.br/transparencia/LAI/verba/despesa_ceaps_${ano}.csv`);
      return falha(r, 'json', `CSV antigo (senado.gov.br/transparencia/LAI/verba) respondeu HTTP ${csv.status}`);
    }
    const { inicio } = janelaDias(7);
    const passadas = dados.filter(d => passou(br(d.data)));
    const futuras = dados.length - passadas.length - dados.filter(d => !d.data).length;
    const em7 = passadas.filter(d => (d.data ?? '') >= inicio);
    const porMes: Record<number, number> = {};
    for (const d of dados) porMes[d.mes] = (porMes[d.mes] ?? 0) + 1;
    const meses = Object.keys(porMes).map(Number).sort((a, b) => a - b);
    const csv = await pegar(`https://www.senado.gov.br/transparencia/LAI/verba/despesa_ceaps_${ano}.csv`);
    return medida({
      status: dados.length ? 'ok' : 'parcial', formato: 'json', itens: em7.length, janela: '7 dias (pela data do documento)', idPolitico: true,
      atrasoHoras: atraso(recente(passadas.map(d => br(d.data)))),
      amostra: amostra(em7.sort((a, b) => (b.data ?? '').localeCompare(a.data ?? '')).map(d => ({ data: br(d.data)!, titulo: `${d.nomeSenador} (${d.codSenador}): ${d.tipoDespesa} — ${d.fornecedor} R$ ${d.valorReembolsado}`, url: `${CEAPS}/${ano}` }))),
      notas: [
        `${dados.length} lançamentos no ano, ${(r.corpo.length / 1e6).toFixed(1)} MB em ${(r.ms / 1000).toFixed(1)} s; por mês: ${meses.map(m => `${m}:${porMes[m]}`).join(' ')}`,
        'meses recentes ainda incompletos (o reembolso entra semanas depois); sem data de lançamento, atraso real só comparando dia a dia',
        futuras > 0 ? `${futuras} lançamentos com data no futuro (erro na origem)` : 'nenhuma data no futuro',
        'codSenador = mesmo código da API legislativa; sem link do comprovante',
        `CSV antigo despesa_ceaps_${ano}.csv: HTTP ${csv.status}${csv.status === 406 ? ' (recusa pelo cabeçalho Accept, não por IP)' : csv.ok ? ' — alternativa em CSV também funciona' : ''}`,
      ],
    });
  },
};

const provas: Prova[] = [
  camaraAgenda, camaraPresenca, camaraVotacoes, camaraDiscursos, camaraProposicoes, camaraDespesasApi, camaraDespesasCsv, camaraOrgaos,
  senadoAgendaPlenario, senadoAgendaComissoes, senadoVotacoes, senadoPresenca, senadoDiscursos, senadoMaterias, senadoCeaps,
];
export default provas;
