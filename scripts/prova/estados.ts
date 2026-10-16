/* Fase 0 — estados: assembleias de SP (ALESP), MG (ALMG) e BA (ALBA) e agenda dos governadores dos três.
   Janela padrão: 7 dias até hoje. Quando a janela vem vazia, a prova procura a última data com dado,
   pra separar "fonte quebrada" de "casa sem atividade" (outubro de 2026 é período eleitoral).
   Status nesta família: ok = dado estruturado com itens na janela; parcial = fonte responde mas a janela
   está vazia ou só parte do que se quer vem; bloqueado = 403/429/muro anti-robô; falhou = não há o dado. */
import { inflateRawSync } from 'node:zlib';
import { UA } from '../util';
import { pegar, pegarJson, decodificar, atraso, amostra, janelaDias, falha, type Prova, type Medida, type Amostra, type Resposta } from './base';

const { inicio, fim } = janelaDias(7);
const hojeIso = new Date().toISOString().slice(0, 10);
const naJanela = (d: string) => d.slice(0, 10) >= inicio && d.slice(0, 10) <= fim;
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));
const limpar = (s: string) => decodificar(s.replace(/<[^>]+>/g, ' ')).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const ultimaAte = (datas: string[], ate = fim) => datas.map(d => d.slice(0, 10)).filter(d => d <= ate).sort().at(-1) ?? null;
const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');

/* Igual ao pegar() do base, mas devolve bytes (zip) ou decodifica latin1 (sites da ALESP). */
async function pegarBytes(url: string, timeoutMs = 120_000): Promise<{ status: number; ok: boolean; bytes: Buffer; ms: number; erro?: string }> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: ctl.signal, redirect: 'follow' });
    const bytes = Buffer.from(await r.arrayBuffer());
    return { status: r.status, ok: r.ok, bytes, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ok: false, bytes: Buffer.alloc(0), ms: Date.now() - t0, erro: (e as Error).message };
  } finally { clearTimeout(timer); }
}
async function pegarLatin1(url: string): Promise<Resposta> {
  const b = await pegarBytes(url, 30_000);
  return { status: b.status, ok: b.ok, corpo: b.bytes.toString('latin1'), ms: b.ms, url, erro: b.erro, tipo: 'text/html' };
}
const comoResposta = (url: string, b: Awaited<ReturnType<typeof pegarBytes>>): Resposta =>
  ({ status: b.status, ok: b.ok, corpo: '', ms: b.ms, url, erro: b.erro, tipo: '' });

/** Primeiro arquivo de um zip (os da ALESP têm um só), lendo o diretório central. */
function unzipPrimeiro(zip: Buffer): string {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('zip sem diretório central');
  const cd = zip.readUInt32LE(eocd + 16);
  const metodo = zip.readUInt16LE(cd + 10);
  const tamComp = zip.readUInt32LE(cd + 20);
  const local = zip.readUInt32LE(cd + 42);
  const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const dados = zip.subarray(ini, ini + tamComp);
  return (metodo === 0 ? dados : inflateRawSync(dados)).toString('utf8');
}

const tag = (bloco: string, nome: string) => bloco.match(new RegExp(`<${nome}>([\\s\\S]*?)</${nome}>`))?.[1]?.trim() ?? '';
const blocos = (xml: string, nome: string) => xml.match(new RegExp(`<${nome}>[\\s\\S]*?</${nome}>`, 'g')) ?? [];

/* ======================= ALESP (SP) ======================= */
const ALESP = 'https://www.al.sp.gov.br/repositorioDados';
const LEGIS = 'https://legis-api-portal-prd.al.sp.gov.br/lista-presenca-parlamentar';
interface ParlAlesp { idParlamentar: number; nuMatricula: number; txNomeParlamentar: string; isEmExercicio: boolean | null; listaLegislaturas: number[] | null }

async function alespAgenda(): Promise<Medida> {
  const ano = fim.slice(0, 4);
  const url = `${ALESP}/agenda/agenda_eventos_${ano}.xml`;
  const r = await pegar(url, { timeoutMs: 90_000 });
  if (!r.ok) return falha(r, 'xml');
  const eventos = blocos(r.corpo, 'Evento').map(b => ({
    data: tag(b, 'Data').slice(0, 10), hora: tag(b, 'HoraIni'), titulo: decodificar(tag(b, 'Titulo')), local: decodificar(tag(b, 'Local')),
    solicitante: tag(b, 'Solicitante'), id: tag(b, 'IdEvento'),
  }));
  const parl = await pegarJson<ParlAlesp[]>(`${LEGIS}/parlamentares/`);
  const matriculas = new Map((parl.dados ?? []).map(p => [String(p.nuMatricula), p]));
  const vistos = new Set<string>();
  const janela = eventos.filter(e => naJanela(e.data) && !vistos.has(`${e.id}|${e.data}`) && vistos.add(`${e.id}|${e.data}`));
  const comDep = janela.filter(e => matriculas.has(e.solicitante));
  const ult = ultimaAte(eventos.map(e => e.data));
  // na amostra, um item por evento (exposições se repetem dia a dia)
  const umPorEvento = [...new Map([...janela].sort((a, b) => a.data.localeCompare(b.data)).map(e => [e.id, e])).values()].sort((a, b) => b.data.localeCompare(a.data));
  const lista: Amostra[] = umPorEvento.map(e => ({
    data: `${e.data}T${e.hora || '00:00'}:00-03:00`,
    titulo: `${e.titulo}${matriculas.has(e.solicitante) ? ` — solicitante: ${matriculas.get(e.solicitante)!.txNomeParlamentar}` : ''} (${e.local})`,
    url: 'https://www.al.sp.gov.br/alesp/agenda/',
  }));
  return {
    status: janela.length ? 'ok' : 'parcial', itens: janela.length, janela: `7 dias (${inicio} a ${fim})`,
    atrasoHoras: atraso([ult]), formato: 'xml', idPolitico: comDep.length > 0, amostra: amostra(lista),
    notas: [
      `${janela.length} ocorrências evento×dia na janela (${umPorEvento.length} eventos distintos); arquivo anual ${url.split('/').pop()} (${Math.round(r.corpo.length / 1024)} KB), ${eventos.length} linhas no ano, regerado todo dia de madrugada; último evento até hoje: ${ddmm(ult)}`,
      `${comDep.length}/${janela.length} eventos da janela têm <Solicitante> igual à matrícula de um deputado (casa com nuMatricula da API de presença; ${parl.dados ? `${parl.dados.length} parlamentares` : `API respondeu HTTP ${parl.r.status}`}); o resto é setor da casa`,
      'agenda é de uso do prédio (audiência, sessão solene, evento cultural), não agenda pessoal do deputado',
      'Fragilidade: baixa — arquivo de dados abertos com URL estável e documentação em PDF',
    ],
  };
}

async function alespPresencaPlenario(): Promise<Medida> {
  const parl = await pegarJson<ParlAlesp[]>(`${LEGIS}/parlamentares/`);
  if (!parl.dados) return falha(parl.r, 'json', 'lista de parlamentares da API de presença não veio');
  const atuais = parl.dados.filter(p => p.isEmExercicio && p.listaLegislaturas?.includes(20));
  const escolhidos = atuais.slice(0, 3);
  const meses = [0, 1].map(k => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k); return { mes: d.getUTCMonth() + 1, ano: d.getUTCFullYear() }; });
  // se os dois meses vierem vazios, recua até 4 meses pra achar a última sessão
  const registros: { dep: ParlAlesp; data: string; titulo: string; situacao: string }[] = [];
  let reqs = 0;
  for (const dep of escolhidos) {
    for (let k = 0; k < 5; k++) {
      const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - k);
      const { dados } = await pegarJson<{ data: string; tituloSessaoPlenaria: string; situacao: string }[]>(`${LEGIS}/${dep.nuMatricula}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`);
      reqs++;
      await dormir(300);
      for (const s of dados ?? []) {
        const [dd, mm, aa] = s.data.split('/');
        registros.push({ dep, data: `${aa}-${mm}-${dd}`, titulo: s.tituloSessaoPlenaria, situacao: s.situacao });
      }
      if (k >= meses.length - 1 && registros.some(r => r.dep === dep)) break;
    }
  }
  const janela = registros.filter(r => naJanela(r.data));
  const ult = ultimaAte(registros.map(r => r.data));
  const lista = (janela.length ? janela : registros.filter(r => r.data === ult)).map(r => ({
    data: r.data, titulo: `${r.dep.txNomeParlamentar}: ${r.titulo} — ${r.situacao}`, url: `https://www.al.sp.gov.br/deputado/presenca-plenario/?matriculaDeputado=${r.dep.nuMatricula}`,
  }));
  return {
    status: janela.length ? 'ok' : 'parcial', itens: janela.length, janela: `7 dias, amostra de ${escolhidos.length} de ${atuais.length} deputados em exercício`,
    atrasoHoras: atraso([ult]), formato: 'json', idPolitico: true, amostra: amostra(lista),
    notas: [
      `API interna do site (legis-api-portal-prd.al.sp.gov.br), sem documentação, achada no JS da página "Presença em Plenário"; ${reqs} requisições pra ${escolhidos.length} deputados`,
      `uma chamada por deputado por mês: cobertura completa = ${atuais.length} chamadas/mês; traz sessão, data e situação (Presente, Justificada, Ausência, sessão não deliberativa)`,
      `última sessão com registro: ${ddmm(ult)}${janela.length ? '' : ' — nenhuma sessão na janela'}`,
      'id: nuMatricula (= <Solicitante> da agenda) e idParlamentar (= <IdDeputado> do deputados.xml)',
      'votações nominais do plenário não estão em dados abertos: só lista HTML + PDF por votação (ver estado-sp-alesp-votacoes)',
      'Fragilidade: média — JSON limpo, mas API não publicada; pode mudar junto com o site',
    ],
  };
}

async function alespComissoes(): Promise<Medida> {
  const url = `${ALESP}/processo_legislativo/comissoes_permanentes_presencas.xml`;
  const r = await pegar(url, { timeoutMs: 120_000 });
  if (!r.ok) return falha(r, 'xml');
  const pres = blocos(r.corpo, 'ReuniaoComissaoPresenca').map(b => ({
    data: tag(b, 'DataReuniao').slice(0, 10), idDep: tag(b, 'IdDeputado'), dep: decodificar(tag(b, 'Deputado')), sigla: tag(b, 'SiglaComissao'), reuniao: tag(b, 'IdReuniao'),
  }));
  const janela = pres.filter(p => naJanela(p.data));
  const ult = ultimaAte(pres.map(p => p.data));
  const base = janela.length ? janela : pres.filter(p => p.data === ult);
  const dep = await pegar(`${ALESP}/deputados/deputados.xml`);
  const spl = new Set(blocos(dep.corpo, 'Deputado').map(b => tag(b, 'IdSPL')));
  const casam = base.filter(p => spl.has(p.idDep)).length;
  const lista = base.map(p => ({ data: p.data, titulo: `${p.dep} (id ${p.idDep}) presente na reunião ${p.reuniao} da ${p.sigla}`, url: 'https://www.al.sp.gov.br/comissao/' }));
  return {
    status: janela.length ? 'ok' : 'parcial', itens: janela.length, janela: `7 dias (${inicio} a ${fim})`,
    atrasoHoras: atraso([ult]), formato: 'xml', idPolitico: true, amostra: amostra(lista),
    notas: [
      `arquivo completo desde 2005 (${Math.round(r.corpo.length / 1024 / 1024)} MB, ${pres.length} presenças), sem recorte por ano; regerado todo dia`,
      `última reunião de comissão com presença registrada: ${ddmm(ult)}`,
      `o campo <IdDeputado> deste arquivo segue o <IdSPL> do deputados.xml (não o <IdDeputado> de lá): ${casam}/${base.length} presenças ${janela.length ? 'da janela' : `de ${ddmm(ult)}`} casam com deputado atual`,
      'mesmo repositório tem reuniões, deliberações e votações de comissão (votações = 64 MB, também sem recorte anual)',
      'Fragilidade: baixa no formato; custo é baixar o arquivo inteiro todo dia',
    ],
  };
}

async function alespProposituras(): Promise<Medida> {
  const urlP = `${ALESP}/processo_legislativo/proposituras.zip`;
  const z = await pegarBytes(urlP);
  if (!z.ok) return falha(comoResposta(urlP, z), 'zip');
  const xml = unzipPrimeiro(z.bytes);
  const props: { id: string; data: string; ementa: string; num: string; ano: string }[] = [];
  for (const m of xml.matchAll(/<propositura>([\s\S]*?)<\/propositura>/g)) {
    const data = tag(m[1], 'DtPublicacao').slice(0, 10);
    if (data < '2026-01-01') continue;
    props.push({ id: tag(m[1], 'IdDocumento'), data, ementa: decodificar(tag(m[1], 'Ementa')), num: tag(m[1], 'NroLegislativo'), ano: tag(m[1], 'AnoLegislativo') });
  }
  const tamXml = xml.length;
  const janela = props.filter(p => naJanela(p.data));
  const ult = ultimaAte(props.map(p => p.data));
  // pra provar o vínculo com deputado: autores da janela; se vazia, dos 7 dias até a última publicação
  const iniRef = janela.length ? inicio : new Date(new Date(ult ?? fim).getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const ref = janela.length ? janela : props.filter(p => p.data >= iniRef && p.data <= (ult ?? fim));
  const ids = new Set(ref.map(p => p.id));
  const urlA = `${ALESP}/processo_legislativo/documento_autor.zip`;
  const za = await pegarBytes(urlA);
  let autores = 0; let comDep = 0; const nomes = new Map<string, string>();
  const dep = await pegar(`${ALESP}/deputados/deputados.xml`);
  const spl = new Set(blocos(dep.corpo, 'Deputado').map(b => tag(b, 'IdSPL')));
  if (za.ok) {
    for (const m of unzipPrimeiro(za.bytes).matchAll(/<IdAutor>(\d+)<\/IdAutor><IdDocumento>(\d+)<\/IdDocumento><NomeAutor>([^<]*)/g)) {
      if (!ids.has(m[2])) continue;
      autores++; if (spl.has(m[1])) comDep++;
      if (!nomes.has(m[2])) nomes.set(m[2], decodificar(m[3]));
    }
  }
  const lista = ref.sort((a, b) => b.data.localeCompare(a.data)).map(p => ({
    data: p.data, titulo: `${p.num}/${p.ano} — ${p.ementa}${nomes.has(p.id) ? ` (autor: ${nomes.get(p.id)})` : ''}`, url: `https://www.al.sp.gov.br/propositura?id=${p.id}`,
  }));
  return {
    status: janela.length ? 'ok' : 'parcial', itens: janela.length, janela: `7 dias por data de publicação (${inicio} a ${fim})`,
    atrasoHoras: atraso([ult]), formato: 'zip', idPolitico: comDep > 0, amostra: amostra(lista),
    notas: [
      `proposituras.zip ${Math.round(z.bytes.length / 1024 / 1024)} MB → ${Math.round(tamXml / 1024 / 1024)} MB de XML (desde 1995, sem recorte anual); ${props.length} publicadas em 2026; última publicação: ${ddmm(ult)}`,
      `autoria: documento_autor.zip (${za.ok ? `${Math.round(za.bytes.length / 1024 / 1024)} MB` : `HTTP ${za.status}`}); ${janela.length ? 'na janela' : `nos 7 dias até ${ddmm(ult)}`}: ${autores} vínculos autor-documento, ${comDep} com IdAutor = <IdSPL> de deputado atual do deputados.xml`,
      'tramitação dos últimos 12 meses em documento_andamento_atual.zip (2 MB → 89 MB)',
      'Fragilidade: baixa no formato, alta no peso — ~25 MB baixados e ~280 MB descompactados por dia só pra ver o que é novo',
    ],
  };
}

async function alespVotacoes(): Promise<Medida> {
  const ano = fim.slice(0, 4);
  const url = `https://www.al.sp.gov.br/alesp/votacoes-no-plenario/?anoSessao=${ano}`;
  const r = await pegarLatin1(url);
  if (!r.ok) return falha(r, 'html');
  const itens = [...r.corpo.matchAll(/<li class="list-group-item[^"]*">([\s\S]*?)<\/li>/g)].map(m => {
    const b = m[1];
    const d = b.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return {
      data: d ? `${d[3]}-${d[2]}-${d[1]}` : '',
      sessao: limpar(b.match(/sessao-plenaria\/\?id=\d+"[^>]*>([^<]+)/)?.[1] ?? ''),
      resultado: limpar(b.match(/Resultado:\s*<a[^>]*>([^<]+)/)?.[1] ?? ''),
      pdf: b.match(/href="([^"]+\.pdf)"/)?.[1] ?? '',
      ementa: limpar(b.match(/Ementa:\s*<a[^>]*>([^<]+)/)?.[1] ?? ''),
    };
  }).filter(v => v.data);
  const janela = itens.filter(v => naJanela(v.data));
  const ult = ultimaAte(itens.map(v => v.data));
  const lista = (janela.length ? janela : itens.slice(0, 3)).map(v => ({ data: v.data, titulo: `${v.sessao}: ${v.resultado} — ${v.ementa}`, url: v.pdf || url }));
  return {
    status: janela.length ? 'ok' : 'parcial', itens: janela.length, janela: `7 dias (${inicio} a ${fim})`,
    atrasoHoras: atraso([ult]), formato: 'html', idPolitico: false, amostra: amostra(lista),
    notas: [
      `página HTML (latin1) com ${itens.length} votações nominais (painel) em ${ano}; última: ${ddmm(ult)}`,
      'o voto de cada deputado só está no PDF de cada votação; não há XML/JSON de votação de plenário nos dados abertos',
      'Fragilidade: alta — scraping de HTML + extração de PDF',
    ],
  };
}

/* ======================= ALMG (MG) ======================= */
const ALMG = 'https://dadosabertos.almg.gov.br/api/v2';
const amd = (iso: string) => iso.replace(/-/g, '');
/** Falha da ALMG com diagnóstico de rede: sem resposta TCP é diferente de HTTP de erro. */
function falhaAlmg(r: Resposta): Medida {
  const m = falha(r, 'json');
  if (r.status === 0) m.notas.push('a conexão TCP nem completou (timeout de conexão). Na exploração desta mesma máquina, horas antes, a API respondeu 200 a ~25 chamadas; depois disso www.almg.gov.br e dadosabertos.almg.gov.br pararam de aceitar conexão, e um teste de outra rede (fora do Brasil, não desta máquina) teve conexão recusada também — mais cara de queda ou de filtro de IP estrangeiro do que de bloqueio a esta máquina; repetir mais tarde e de IP brasileiro');
  return m;
}

async function almgAgenda(): Promise<Medida> {
  const url = `${ALMG}/agenda/diaria/agenda/pesquisa?ini=${amd(inicio)}&fim=${amd(fim)}&formato=json`;
  const { r, dados } = await pegarJson<{ agendaPeriodo: { dias?: { dia: { $: string }; itens: any[] }[] } }>(url);
  if (!dados) return falhaAlmg(r);
  const itens = (dados.agendaPeriodo.dias ?? []).flatMap(d => d.itens.map(i => ({ ...i, dia: d.dia.$ })));
  const porCat = new Map<string, number>();
  for (const i of itens) porCat.set(i.categoria?.nome ?? '?', (porCat.get(i.categoria?.nome ?? '?') ?? 0) + 1);
  const lista = itens.map(i => ({
    data: `${i.dia}T${i.horaInicial ?? '00:00'}:00-03:00`, titulo: `${i.titulo}${i.subtitulo ? ` — ${i.subtitulo}` : ''} (${i.local ?? ''})`,
    url: i.urlDetalhe ? `https://www.almg.gov.br${i.urlDetalhe}` : 'https://www.almg.gov.br/acompanhe/agenda/',
  })).sort((a, b) => b.data.localeCompare(a.data));
  return {
    status: itens.length ? 'ok' : 'parcial', itens: itens.length, janela: `7 dias (${inicio} a ${fim})`,
    atrasoHoras: atraso(lista.map(l => l.data).filter(d => d.slice(0, 10) <= hojeIso)), formato: 'json', idPolitico: false, amostra: amostra(lista),
    notas: [
      `API REST documentada (OpenAPI em dadosabertos.almg.gov.br), JSON ou XML; categorias na janela: ${[...porCat].map(([c, n]) => `${c} ${n}`).join(', ')}`,
      'agenda institucional (comissões, plenário, eventos, cultura); item não traz id de deputado — o vínculo vem dos endpoints de reunião',
      'Fragilidade: baixa — API pública versionada (v2)',
    ],
  };
}

async function almgPlenario(): Promise<Medida> {
  const url = `${ALMG}/plenario/reunioes/pesquisa?ini=${amd(inicio)}&fim=${amd(fim)}&formato=json`;
  const { r, dados } = await pegarJson<{ resultadoPesquisaReunioesPlenario: { numeroOcorrencias: number; listaReuniaoPlenario?: any[] } }>(url);
  if (!dados) return falhaAlmg(r);
  const reunioes = dados.resultadoPesquisaReunioesPlenario.listaReuniaoPlenario ?? [];
  const detalhes: { dia: string; hora: string; tipo: string; situacao: string; votosDep: number }[] = [];
  for (const re of reunioes.slice(0, 6)) {
    const [a, m, d] = re.dia.split('-');
    const det = await pegarJson<{ reuniao: { reuniao: { situacao?: { descricao: string }; descricao: string } } }>(`${ALMG}/plenario/reunioes/detalhes/${a}/${m}/${d}/${re.hora}?formato=json`);
    await dormir(300);
    const txt = det.r.corpo;
    detalhes.push({
      dia: re.dia, hora: re.hora, tipo: re.tipoReuniao?.nome ?? '', situacao: det.dados?.reuniao?.reuniao?.situacao?.descricao ?? `HTTP ${det.r.status}`,
      votosDep: (txt.match(/"idDeputado"/g) ?? []).length,
    });
  }
  const pron = await pegarJson<{ resultado: { noOcorrencias: number } }>(`${ALMG}/pronunciamentos/pesquisa/direcionada?ini=${amd(inicio)}&fim=${amd(fim)}&formato=json`);
  const lista = detalhes.map(d => ({ data: `${d.dia}T${d.hora}:00-03:00`, titulo: `Reunião ${d.tipo.toLowerCase()} de Plenário — ${d.situacao}${d.votosDep ? `, ${d.votosDep} registros com idDeputado` : ''}`, url: `${ALMG}/plenario/reunioes/detalhes/${d.dia.replace(/-/g, '/')}/${d.hora}?formato=json` }))
    .sort((a, b) => b.data.localeCompare(a.data));
  const ocorridas = detalhes.filter(d => !/não ocorrida|nao ocorrida/i.test(d.situacao)).length;
  return {
    status: reunioes.length ? (ocorridas ? 'ok' : 'parcial') : 'parcial', itens: reunioes.length, janela: `7 dias (${inicio} a ${fim})`,
    atrasoHoras: atraso(lista.map(l => l.data).filter(d => d.slice(0, 10) <= hojeIso)), formato: 'json', idPolitico: detalhes.some(d => d.votosDep > 0), amostra: amostra(lista),
    notas: [
      `${reunioes.length} reuniões de Plenário convocadas na janela, ${ocorridas} com situação diferente de "Não ocorrida" (detalhe de ${detalhes.length})`,
      'o detalhe (desde mai/2023) traz pauta, resultado e votação nominal com idDeputado quando há; presença em Plenário não aparece como lista própria na API',
      `pronunciamentos na janela: ${pron.dados ? pron.dados.resultado.noOcorrencias : `HTTP ${pron.r.status}`} (endpoint /pronunciamentos/pesquisa/direcionada, com autor)`,
      'Fragilidade: baixa — API pública documentada',
    ],
  };
}

async function almgComissoes(): Promise<Medida> {
  const pesquisa = async (ini: string) => pegarJson<{ resultadoPesquisa: { numeroOcorrencias: number; lista?: any[] } }>(`${ALMG}/comissoes/reunioes/pesquisa?ini=${amd(ini)}&fim=${amd(fim)}&tp=100&formato=json`);
  const { r, dados } = await pesquisa(inicio);
  if (!dados) return falhaAlmg(r);
  const reunioes = dados.resultadoPesquisa.lista ?? [];
  const ocorridas = reunioes.filter(x => x.reuniaoOcorrida === 'S');
  let alvo = ocorridas.slice(-2);
  const notas = [`${dados.resultadoPesquisa.numeroOcorrencias} reuniões de comissão convocadas na janela, ${ocorridas.length} marcadas como ocorridas (reuniaoOcorrida = S)`];
  if (!alvo.length) { // janela sem reunião realizada: acha a última realizada nos 90 dias, só pra provar o formato
    const tras = await pesquisa(new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10));
    const oc = (tras.dados?.resultadoPesquisa.lista ?? []).filter(x => x.reuniaoOcorrida === 'S');
    alvo = oc.slice(-1);
    notas.push(`nenhuma realizada na janela; última realizada nos 90 dias (primeira página de 100): ${alvo[0] ? ddmm(alvo[0].data) : 'nenhuma'}`);
  }
  const presencas: Amostra[] = [];
  let comId = 0;
  for (const re of alvo) {
    const [a, m, d] = re.data.split('-');
    const res = await pegarJson<{ list: ({ presencas?: { idDeputado: number; nomeParlamentar: string; partidoDeputado: string }[] } | null)[] }>(`${ALMG}/comissoes/${re.comissao.id}/reunioes/${re.tipoReuniao.id}/${a}/${m}/${d}/${re.hora}/resultados?formato=json`);
    await dormir(300);
    for (const p of res.dados?.list?.[0]?.presencas ?? []) {
      if (p.idDeputado) comId++;
      presencas.push({ data: `${re.data}T${re.hora}:00-03:00`, titulo: `${p.nomeParlamentar} (${p.partidoDeputado}, idDeputado ${p.idDeputado}) presente — ${re.comissao.nome}`, url: `https://www.almg.gov.br/atividade-parlamentar/comissoes/` });
    }
  }
  notas.push(`resultado de reunião (/comissoes/{id}/reunioes/{tipo}/{data}/{hora}/resultados) traz presenças com idDeputado: ${comId} registros nas ${alvo.length} reuniões consultadas`, 'Fragilidade: baixa — API pública documentada; uma chamada por reunião pra ter presença');
  return {
    status: ocorridas.length ? 'ok' : 'parcial', itens: ocorridas.length, janela: `7 dias (${inicio} a ${fim}), reuniões realizadas`,
    atrasoHoras: atraso((alvo.length ? alvo : reunioes).map(x => x.data as string).filter(d => d <= hojeIso)), formato: 'json', idPolitico: comId > 0, amostra: amostra(presencas), notas,
  };
}

async function almgProposicoes(): Promise<Medida> {
  const url = `${ALMG}/proposicoes/pesquisa/direcionada?ini=${amd(inicio)}&fim=${amd(fim)}&tp=100&ord=3&formato=json`;
  const { r, dados } = await pegarJson<{ resultado: { noOcorrencias: number; listaItem?: any[] } }>(url);
  if (!dados) return falhaAlmg(r);
  const itens = dados.resultado.listaItem ?? [];
  const autores = new Map<string, number>();
  for (const i of itens) { const a = limpar(i.autor ?? '?'); autores.set(a, (autores.get(a) ?? 0) + 1); }
  const lista = itens.map(i => ({
    data: i.dataPublicacao ?? '', titulo: `${i.siglaTipoProjeto} ${i.numero}/${i.ano} — ${limpar(i.ementa ?? i.assunto ?? '')} (autor: ${limpar(i.autor ?? '')})`,
    url: `https://www.almg.gov.br/atividade-parlamentar/projetos-de-lei/?tipo=${i.siglaTipoProjeto}&num=${i.numero}&ano=${i.ano}`,
  })).sort((a, b) => b.data.localeCompare(a.data));
  const top = [...autores].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([a, n]) => `${a} (${n})`).join(', ');
  return {
    status: dados.resultado.noOcorrencias ? 'ok' : 'parcial', itens: dados.resultado.noOcorrencias, janela: `7 dias por data de publicação (${inicio} a ${fim})`,
    atrasoHoras: atraso(lista.map(l => l.data)), formato: 'json', idPolitico: false, amostra: amostra(lista),
    notas: [
      `filtro ini/fim por data de publicação funciona (dataInicial/dataFinal é ignorado em silêncio e devolve a base inteira); ${itens.length} itens na 1ª página de 100`,
      `autor vem só como texto ("${limpar(itens[0]?.autor ?? '?')}"), sem id de deputado — casar por nome com /deputados/em_exercicio; autores mais frequentes: ${top}`,
      'Fragilidade: baixa — API pública documentada',
    ],
  };
}

/* ======================= ALBA (BA) ======================= */
async function albaNopaper(): Promise<Medida> {
  const url = 'https://albalegis.nopapercloud.com.br/spl/';
  const r = await pegar(url);
  await dormir(1000);
  const robots = await pegar('https://albalegis.nopapercloud.com.br/robots.txt');
  const cf = (x: Resposta) => /Cloudflare|you have been blocked/i.test(x.corpo);
  if (r.ok && !cf(r)) {
    return { status: 'parcial', itens: null, janela: '—', atrasoHoras: null, formato: 'html', idPolitico: false, amostra: [], notas: [`HTTP ${r.status} — abriu desta vez; precisa de prova de conteúdo`] };
  }
  return {
    status: 'bloqueado', itens: null, janela: '—', atrasoHoras: null, formato: 'html', idPolitico: false, amostra: [],
    notas: [
      `HTTP ${r.status}${cf(r) ? ' com página "Sorry, you have been blocked" do Cloudflare' : ''} em ${url}; robots.txt também: HTTP ${robots.status}${cf(robots) ? ' (Cloudflare)' : ''}`,
      'bloqueio vem antes de qualquer conteúdo, até no robots.txt e com qualquer UA testado: forte indício de bloqueio por IP/país (máquina em Barcelona). Precisa repetir de IP brasileiro',
      'é aqui que a ALBA publica, desde 01/08/2025, proposições, sessões e frequência dos deputados (sistema NoPaper/SPL, terceirizado); o site antigo só tem até jul/2025',
    ],
  };
}

async function albaSite(): Promise<Medida> {
  const dep = await pegar('https://www.al.ba.gov.br/deputados/deputados-estaduais');
  if (!dep.ok) return falha(dep, 'html');
  const ids = new Set([...dep.corpo.matchAll(/\/deputados\/deputado-estadual\/(\d+)/g)].map(m => m[1]));
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const busca = `https://www.al.ba.gov.br/atividade-legislativa-nova/proposicoes?dataInicio=${encodeURIComponent(br(inicio))}&dataFim=${encodeURIComponent(br(fim))}`;
  await dormir(1000);
  const prop = await pegar(busca);
  const achadas = new Set([...prop.corpo.matchAll(/\/atividade-legislativa-nova\/proposicao\/([A-Z.]+-\d+-\d{4})/g)].map(m => m[1]));
  await dormir(1000);
  const ag = await pegar('https://www.al.ba.gov.br/midia-center/agenda');
  const agTexto = limpar(ag.corpo.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''));
  return {
    status: 'parcial', itens: achadas.size, janela: `7 dias (${inicio} a ${fim})`, atrasoHoras: null, formato: 'html', idPolitico: false, amostra: [],
    notas: [
      `lista de deputados: HTTP ${dep.status}, ${ids.size} deputados com id numérico na URL (/deputados/deputado-estadual/{id}) — scraping de HTML`,
      `busca de proposições do site (dataInicio/dataFim): HTTP ${prop.status}, ${achadas.size} proposições na janela; o próprio site avisa que desde 01/08/2025 os dados estão no NoPaper (ver estado-ba-alba-nopaper)`,
      `agenda (/midia-center/agenda): HTTP ${ag.status}, ${/\d{2}\/\d{2}\/20\d{2}/.test(agTexto) ? 'tem datas' : 'sem nenhum evento datado no HTML'}`,
      'sem dados abertos, sem API, sem RSS (/rss = 404)',
      'Fragilidade: alta — HTML de site em transição de sistema',
    ],
  };
}

/* ======================= Governadores ======================= */
async function govSp(): Promise<Medida> {
  const url = 'https://www.sp.gov.br/sp/institucional/agenda_governador';
  const r = await pegar(url);
  const imperva = /Pardon Our Interruption|Incapsula|_Incapsula_Resource/i.test(r.corpo);
  if (imperva || !r.ok) {
    return {
      status: 'bloqueado', itens: null, janela: '—', atrasoHoras: null, formato: 'html', idPolitico: false, amostra: [],
      notas: [
        `HTTP ${r.status}, ${Math.round(r.corpo.length / 1024)} KB: ${imperva ? 'página "Pardon Our Interruption" do Imperva (desafio JS/cookie anti-robô)' : 'sem conteúdo'} em ${url}`,
        'passar exigiria executar o desafio JS do Imperva = contornar bloqueio; fora pela regra. A home sp.gov.br/sp às vezes abre na 1ª requisição e o desafio vem na seguinte',
        'o desafio é por comportamento de robô, não por país: IP brasileiro provavelmente não resolve (não testado)',
        'em 2 de ~10 tentativas no mesmo dia a URL abriu (92 KB, sem desafio), mas não deu pra confirmar se a agenda vem no HTML ou por JS: intermitente demais pra feed',
      ],
    };
  }
  const texto = limpar(r.corpo.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ''));
  const datas = texto.match(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b|\b\d{1,2}h\d{0,2}\b/g) ?? [];
  const apis = [...new Set(r.corpo.match(/https?:\/\/[a-z0-9.-]+\/[a-z0-9._\/-]*(?:api|agenda)[a-z0-9._\/-]*/gi) ?? [])].slice(0, 5);
  return {
    status: datas.length ? 'parcial' : 'falhou', itens: datas.length ? null : 0, janela: '—', atrasoHoras: null, formato: 'html', idPolitico: true, amostra: [],
    notas: [
      `desta vez abriu (HTTP ${r.status}, ${Math.round(r.corpo.length / 1024)} KB), sem o desafio do Imperva — que aparece em outras requisições à mesma URL (intermitente)`,
      datas.length ? `${datas.length} marcas de data/hora no texto: precisa de parser` : `nenhum compromisso datado no HTML: é casca do portal (menu "${texto.slice(0, 90)}…"), a agenda é montada por JS`,
      apis.length ? `URLs candidatas no HTML: ${apis.join(', ')}` : 'nenhuma URL de API de agenda visível no HTML',
      'Fragilidade: alta — anti-robô intermitente + conteúdo por JS',
    ],
  };
}

async function govMg(): Promise<Medida> {
  const url = `https://www.agenciaminas.mg.gov.br/api/governorSchedule?page=1&limit=100&orderBy=asc&orderByColumn=date&startDate=${inicio}&endDate=${fim}`;
  const { r, dados } = await pegarJson<{ results: { id: number; title: string; body: string; date: string; published_at: string; created_at: string }[] }>(url);
  if (!dados) return falha(r, 'json');
  const itens = dados.results ?? [];
  const lista = itens.map(i => ({ data: i.date, titulo: `${i.title} — ${limpar(i.body)}`, url: 'https://www.agenciaminas.mg.gov.br/governador#agenda' })).sort((a, b) => b.data.localeCompare(a.data));
  const atrasoPub = itens.map(i => (new Date(i.created_at).getTime() - new Date(i.date).getTime()) / 36e5).filter(h => !Number.isNaN(h));
  const vice = await pegarJson<{ results: unknown[] }>(url.replace('governorSchedule', 'viceGovernorSchedule'));
  return {
    status: itens.length ? 'ok' : 'parcial', itens: itens.length, janela: `7 dias (${inicio} a ${fim})`,
    atrasoHoras: atraso(lista.map(l => l.data).filter(d => d <= new Date().toISOString())), formato: 'json', idPolitico: true, amostra: amostra(lista),
    notas: [
      'JSON da API interna da Agência Minas (achada no JS do site, não documentada); filtro startDate/endDate funciona',
      `cada item: título, corpo HTML (local, "fechado para imprensa"), data/hora; cadastrado em média ${atrasoPub.length ? Math.round(atrasoPub.reduce((a, b) => a + b, 0) / atrasoPub.length) : '?'} h depois do horário do compromisso (há lançamento retroativo)`,
      `agenda do vice: endpoint viceGovernorSchedule ${vice.dados ? `responde (${vice.dados.results?.length ?? 0} itens)` : `HTTP ${vice.r.status}`}, mas o site esconde por chave de configuração`,
      'id do político: implícito (é a agenda do cargo de governador), não vem id',
      'Fragilidade: média — JSON limpo, mas é o backend do site, sem contrato público',
    ],
  };
}

async function govBa(): Promise<Medida> {
  const url = 'https://www.ba.gov.br/comunicacao/agenda-do-governador';
  const r = await pegar(url);
  if (!r.ok) return falha(r, 'html');
  const corpo = r.corpo.match(/field--name-body[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/article>/)?.[1] ?? '';
  const texto = limpar(corpo.replace(/<!--[\s\S]*?-->/g, ''));
  const atualizado = r.corpo.match(/Última atualização:\s*([\d/]+ às [\d:]+)/)?.[1] ?? '?';
  const datas = [...texto.matchAll(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/g)];
  return {
    status: texto.length > 20 ? 'parcial' : 'falhou', itens: datas.length || 0, janela: `7 dias (${inicio} a ${fim})`, atrasoHoras: null, formato: 'html', idPolitico: true, amostra: [],
    notas: [
      `HTTP ${r.status}: página da SECOM no ar, mas o corpo está vazio (${texto.length} caracteres de texto; só um bloco de abas residual de 7/3/2024 em comentário HTML); "Última atualização: ${atualizado}"`,
      'sem API nem JSON; www.ba.gov.br é SPA de serviços e a SECOM é Drupal; a SECOM tem RSS de notícias (ba.gov.br/comunicacao/feed), não de agenda',
      'Fragilidade: alta — quando volta a ser preenchida, é texto livre em HTML',
    ],
  };
}

/* ======================= lista ======================= */
const RISCO_ABERTO = 'Baixo: dado público oficial, publicado pra reuso.';
const provas: Prova[] = [
  {
    id: 'estado-sp-alesp-agenda', nome: 'ALESP — agenda de eventos (XML anual)', grupo: 'estado',
    url: 'https://www.al.sp.gov.br/repositorioDados/agenda/agenda_eventos_2026.xml',
    custo: '0 — dados abertos, sem chave', risco: RISCO_ABERTO,
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar (agenda do prédio, não do deputado)',
    rodar: alespAgenda,
  },
  {
    id: 'estado-sp-alesp-presenca', nome: 'ALESP — presença em plenário (API interna do site)', grupo: 'estado',
    url: 'https://www.al.sp.gov.br/deputado/presenca-plenario/',
    custo: '0 — sem chave; ~94 chamadas/mês', risco: 'Médio: API não publicada pela ALESP; pode mudar sem aviso.',
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar com cuidado (API não documentada)',
    rodar: alespPresencaPlenario,
  },
  {
    id: 'estado-sp-alesp-comissoes', nome: 'ALESP — presença em comissões (XML)', grupo: 'estado',
    url: 'https://www.al.sp.gov.br/repositorioDados/processo_legislativo/comissoes_permanentes_presencas.xml',
    custo: '0 — dados abertos; 8 MB/dia', risco: RISCO_ABERTO,
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar',
    rodar: alespComissoes,
  },
  {
    id: 'estado-sp-alesp-proposituras', nome: 'ALESP — proposituras e autores (ZIP)', grupo: 'estado',
    url: 'https://www.al.sp.gov.br/repositorioDados/processo_legislativo/proposituras.zip',
    custo: '0 — dados abertos; ~25 MB/dia de download', risco: RISCO_ABERTO,
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar (pesado: baixar 1x/dia e guardar diff)',
    rodar: alespProposituras,
  },
  {
    id: 'estado-sp-alesp-votacoes', nome: 'ALESP — votações nominais em plenário (HTML + PDF)', grupo: 'estado',
    url: 'https://www.al.sp.gov.br/alesp/votacoes-no-plenario/',
    custo: '0 — scraping', risco: 'Baixo nos termos; alto na manutenção (HTML + PDF).',
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar com cuidado (voto por deputado só no PDF)',
    rodar: alespVotacoes,
  },
  {
    id: 'estado-mg-almg-agenda', nome: 'ALMG — agenda diária (API)', grupo: 'estado',
    url: 'https://dadosabertos.almg.gov.br/api/v2/agenda/diaria/agenda/pesquisa',
    custo: '0 — API aberta, sem chave', risco: RISCO_ABERTO, rodar: almgAgenda,
  },
  {
    id: 'estado-mg-almg-plenario', nome: 'ALMG — reuniões de Plenário, votações e pronunciamentos (API)', grupo: 'estado',
    url: 'https://dadosabertos.almg.gov.br/api/v2/plenario/reunioes/pesquisa',
    custo: '0 — API aberta, sem chave', risco: RISCO_ABERTO,
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar',
    rodar: almgPlenario,
  },
  {
    id: 'estado-mg-almg-comissoes', nome: 'ALMG — reuniões e presença em comissões (API)', grupo: 'estado',
    url: 'https://dadosabertos.almg.gov.br/api/v2/comissoes/reunioes/pesquisa',
    custo: '0 — API aberta, sem chave', risco: RISCO_ABERTO,
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar',
    rodar: almgComissoes,
  },
  {
    id: 'estado-mg-almg-proposicoes', nome: 'ALMG — proposições (API)', grupo: 'estado',
    url: 'https://dadosabertos.almg.gov.br/api/v2/proposicoes/pesquisa/direcionada',
    custo: '0 — API aberta, sem chave', risco: RISCO_ABERTO,
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar (autor por nome, casar com lista de deputados)',
    rodar: almgProposicoes,
  },
  {
    id: 'estado-ba-alba-nopaper', nome: 'ALBA — NoPaper/SPL (proposições, sessões, frequência)', grupo: 'estado',
    url: 'https://albalegis.nopapercloud.com.br/spl/',
    custo: '0 — se abrir; scraping de HTML', risco: 'Médio: sistema terceirizado atrás de Cloudflare; sem API conhecida.',
    veredito: m => m.status === 'bloqueado' ? 'refazer de IP brasileiro antes de decidir' : m.status === 'falhou' ? 'fora, por ora' : 'avaliar conteúdo',
    rodar: albaNopaper,
  },
  {
    id: 'estado-ba-alba-site', nome: 'ALBA — site institucional (deputados, proposições até jul/2025, agenda)', grupo: 'estado',
    url: 'https://www.al.ba.gov.br/atividade-legislativa-nova/proposicoes',
    custo: '0 — scraping de HTML', risco: 'Baixo nos termos; alto na manutenção, e a atividade não está mais aqui.',
    veredito: () => 'só cadastro de deputados; atividade fora',
    rodar: albaSite,
  },
  {
    id: 'estado-sp-governador-agenda', nome: 'Governo de SP — agenda do governador', grupo: 'estado',
    url: 'https://www.sp.gov.br/sp/institucional/agenda_governador',
    custo: '0 — se abrir', risco: 'Alto: página atrás de anti-robô Imperva; passar seria contornar bloqueio.',
    veredito: m => m.status === 'bloqueado' ? 'fora (muro anti-robô); usar imprensa/DOE' : 'avaliar',
    rodar: govSp,
  },
  {
    id: 'estado-mg-governador-agenda', nome: 'Governo de MG — agenda do governador (Agência Minas)', grupo: 'estado',
    url: 'https://www.agenciaminas.mg.gov.br/governador#agenda',
    custo: '0 — JSON sem chave', risco: 'Médio: backend do site, sem contrato público; dado em si é público.',
    veredito: m => m.status === 'bloqueado' || m.status === 'falhou' ? 'fora, por ora' : 'usar com cuidado (API não documentada)',
    rodar: govMg,
  },
  {
    id: 'estado-ba-governador-agenda', nome: 'Governo da BA — agenda do governador (SECOM)', grupo: 'estado',
    url: 'https://www.ba.gov.br/comunicacao/agenda-do-governador',
    custo: '0 — scraping de HTML', risco: 'Baixo nos termos; página existe mas está vazia.',
    veredito: m => m.status === 'falhou' ? 'fora: página vazia; reavaliar depois da eleição' : 'usar com cuidado (texto livre)',
    rodar: govBa,
  },
];

export default provas;
