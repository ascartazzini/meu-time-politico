/* Cadastro de quem vai estar em campo a partir de 2027 (docs/plano-pos-eleicao.md, Fase 1).
   Fontes:
     1. TSE consulta_cand_2026 (baixado de novo a cada rodada: o resultado e a situação mudam até a diplomação)
     2. Senado, lista de senadores em exercício: os 27 eleitos em 2022 seguem até 2031
     3. camara.json (CPF → id da Câmara) e a API do Senado (nome → código), pra quem já tem mandato
   Saída: src/data/generated/eleitos-2027.json (versionado). O CPF só serve pra casar e não é gravado.
   Cargos com 2º turno pendente ficam listados em `pendentes` e entram na rodada seguinte. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { escreverJson, fetchJson, lerJson, agoraIso, parseCsvTse, RAIZ, RAW, GERADO } from './util';
import { canonizarSigla, normalizarNome, similaridadeNome } from '../src/lib/nomes';

const URL_TSE = 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2026.zip';
const PASTA = resolve(RAW, 'tse-resultado');
const UA_NAV = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

type Cargo = 'presidente' | 'governador' | 'senador' | 'deputado-federal' | 'deputado-estadual';
const CARGOS: Record<string, Cargo> = { PRESIDENTE: 'presidente', GOVERNADOR: 'governador', SENADOR: 'senador', 'DEPUTADO FEDERAL': 'deputado-federal', 'DEPUTADO ESTADUAL': 'deputado-estadual', 'DEPUTADO DISTRITAL': 'deputado-estadual' };
// posse de presidente e governador pela EC 111/2021 (5 e 6 de janeiro); Congresso e assembleias em 1º de fevereiro
const MANDATO_2026: Record<Cargo, { inicio: string; fim: string }> = {
  presidente: { inicio: '2027-01-05', fim: '2031-01-05' },
  governador: { inicio: '2027-01-06', fim: '2031-01-06' },
  senador: { inicio: '2027-02-01', fim: '2035-01-31' },
  'deputado-federal': { inicio: '2027-02-01', fim: '2031-01-31' },
  'deputado-estadual': { inicio: '2027-02-01', fim: '2031-01-31' },
};
// quantos eleitos cada cargo precisa ter quando o resultado estiver completo
const ESPERADO: Partial<Record<Cargo, number>> = { 'deputado-federal': 513, 'deputado-estadual': 1059, senador: 54 };

export interface Eleito {
  slug: string;
  nome: string;
  nomeUrna: string;
  partido: string;
  uf: string | null;
  fotoUrl: string | null;
  ids: { tse2026?: string; tse2022?: string; camara?: number; senado?: number };
  mandatos: { cargo: Cargo; uf: string | null; inicio: string; fim: string; eleicao: number; suplente?: boolean }[];
}

async function baixarTse(): Promise<string> {
  mkdirSync(PASTA, { recursive: true });
  const zip = resolve(PASTA, 'consulta_cand_2026.zip');
  const fresco = existsSync(zip) && Date.now() - statSync(zip).mtimeMs < 6 * 36e5;
  if (!fresco) {
    const r = await fetch(URL_TSE, { headers: { 'User-Agent': UA_NAV } }).catch(() => null);
    const buf = r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
    if (buf && buf.subarray(0, 2).toString() === 'PK') {
      writeFileSync(zip, buf);
      console.log(`  ✓ TSE: consulta_cand_2026.zip (${(buf.length / 1e6).toFixed(1)} MB, CDN modificado em ${r!.headers.get('last-modified')})`);
    } else if (existsSync(zip)) {
      console.warn(`  ⚠ CDN do TSE respondeu ${r?.status ?? 'nada'} (bloqueio de IP estrangeiro?); usando o zip que já está em ${PASTA}`);
    } else {
      console.error(`  ✗ CDN do TSE respondeu ${r?.status ?? 'nada'}. Baixe ${URL_TSE} de um IP brasileiro pra ${PASTA}/ e rode de novo.`);
      process.exit(1);
    }
  } else console.log('  zip do TSE com menos de 6 h, reaproveitando');
  execFileSync('unzip', ['-o', '-q', zip, 'consulta_cand_2026_BRASIL.csv', '-d', PASTA]);
  return resolve(PASTA, 'consulta_cand_2026_BRASIL.csv');
}

const slugBase = (s: string) => normalizarNome(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

interface SenadorApi {
  IdentificacaoParlamentar: { CodigoParlamentar: string; NomeParlamentar: string; NomeCompletoParlamentar: string; SiglaPartidoParlamentar: string; UfParlamentar: string; UrlFotoParlamentar: string };
  Mandato: { DescricaoParticipacao: string; PrimeiraLegislaturaDoMandato: { DataInicio: string }; SegundaLegislaturaDoMandato: { NumeroLegislatura: string; DataFim: string } };
}

async function main() {
  console.log('▶ Cadastro dos eleitos (mandatos a partir de 2027)');
  const { aliases } = lerJson<{ aliases: Record<string, string> }>(resolve(RAIZ, 'src/data/partidos.json'));
  const avisos: string[] = [];

  /* ---- TSE 2026 ---- */
  const rows = parseCsvTse(readFileSync(await baixarTse()));
  const dataGeracaoTse = rows[0]?.DT_GERACAO ?? '';
  const porSq = new Map<string, { r: Record<string, string>; cargo: Cargo; eleito: boolean; segundoTurno: boolean }>();
  for (const r of rows) {
    if (r.ANO_ELEICAO !== '2026' || (r.CD_TIPO_ELEICAO && r.CD_TIPO_ELEICAO !== '2')) continue;
    const cargo = CARGOS[r.DS_CARGO]; if (!cargo) continue;
    const sit = (r.DS_SIT_TOT_TURNO ?? '').toUpperCase();
    const atual = porSq.get(r.SQ_CANDIDATO) ?? { r, cargo, eleito: false, segundoTurno: false };
    if (sit.startsWith('ELEITO')) atual.eleito = true;
    if (sit === '2º TURNO') atual.segundoTurno = true;
    porSq.set(r.SQ_CANDIDATO, atual);
  }
  const eleitosTse = [...porSq.values()].filter(c => c.eleito).sort((a, b) => a.r.SQ_CANDIDATO.localeCompare(b.r.SQ_CANDIDATO));
  // 2º turno ainda sem eleito: presidência e UFs de governador
  const pendentes = { presidente: false, governadores: [] as string[] };
  for (const c of porSq.values()) {
    if (!c.segundoTurno) continue;
    const decidido = eleitosTse.some(e => e.cargo === c.cargo && e.r.SG_UF === c.r.SG_UF);
    if (decidido) continue;
    if (c.cargo === 'presidente') pendentes.presidente = true;
    else if (c.cargo === 'governador' && !pendentes.governadores.includes(c.r.SG_UF)) pendentes.governadores.push(c.r.SG_UF);
  }
  pendentes.governadores.sort();

  /* ---- quem já tem mandato: Câmara (CPF) e Senado (nome) ---- */
  const camara = lerJson<{ deputadosUF: Record<string, { id: number; cpf: string; urlFoto: string }[]> }>(resolve(GERADO, 'camara.json'));
  const porCpf = new Map(Object.values(camara.deputadosUF).flat().filter(d => d.cpf).map(d => [d.cpf, d]));
  const senadoApi = (await fetchJson<{ ListaParlamentarEmExercicio: { Parlamentares: { Parlamentar: SenadorApi[] } } }>(
    'https://legis.senado.leg.br/dadosabertos/senador/lista/atual')).ListaParlamentarEmExercicio.Parlamentares.Parlamentar;
  const senadoMatch = (nome: string, nomeUrna: string, uf: string, partido: string) => {
    const n = normalizarNome(nome);
    const achados = senadoApi.filter(s => normalizarNome(s.IdentificacaoParlamentar.NomeCompletoParlamentar) === n
      || (similaridadeNome(nomeUrna, s.IdentificacaoParlamentar.NomeParlamentar) >= 0.8 && s.IdentificacaoParlamentar.UfParlamentar === uf
        && canonizarSigla(s.IdentificacaoParlamentar.SiglaPartidoParlamentar, aliases) === partido));
    if (achados.length > 1) avisos.push(`nome ambíguo no Senado: ${nome} (${uf})`);
    return achados.length === 1 ? achados[0] : undefined;
  };
  const https = (u: string) => u.replace(/^http:/, 'https:');

  /* ---- monta os eleitos de 2026 ---- */
  const eleitos: Eleito[] = [];
  const porSenado = new Map<number, Eleito>();
  for (const { r, cargo } of eleitosTse) {
    const partido = canonizarSigla(r.SG_PARTIDO, aliases);
    const uf = cargo === 'presidente' ? null : r.SG_UF;
    const dep = r.NR_CPF_CANDIDATO ? porCpf.get(r.NR_CPF_CANDIDATO) : undefined;
    const sen = senadoMatch(r.NM_CANDIDATO, r.NM_URNA_CANDIDATO, r.SG_UF, partido);
    const e: Eleito = {
      slug: '', nome: r.NM_CANDIDATO, nomeUrna: r.NM_URNA_CANDIDATO, partido, uf,
      fotoUrl: dep?.urlFoto ? https(dep.urlFoto) : sen ? https(sen.IdentificacaoParlamentar.UrlFotoParlamentar) : null,
      ids: { tse2026: r.SQ_CANDIDATO, ...(dep ? { camara: dep.id } : {}), ...(sen ? { senado: Number(sen.IdentificacaoParlamentar.CodigoParlamentar) } : {}) },
      mandatos: [{ cargo, uf, ...MANDATO_2026[cargo], eleicao: 2026 }],
    };
    eleitos.push(e);
    if (e.ids.senado) porSenado.set(e.ids.senado, e);
  }

  /* ---- senadores eleitos em 2022: seguem até 31/01/2031 ---- */
  const csv22 = resolve(RAW, 'tse/consulta_cand_2022_BRASIL.csv');
  const sen22 = existsSync(csv22)
    ? parseCsvTse(readFileSync(csv22)).filter(r => r.ANO_ELEICAO === '2022' && r.DS_CARGO === 'SENADOR' && (r.DS_SIT_TOT_TURNO ?? '').startsWith('ELEITO'))
    : (avisos.push('sem consulta_cand_2022_BRASIL.csv em data/raw/tse: senadores de 2022 ficam sem id do TSE (rode npm run fetch:tse)'), []);
  let continuam = 0;
  for (const s of senadoApi) {
    if (s.Mandato.SegundaLegislaturaDoMandato?.NumeroLegislatura !== '58') continue;   // mandato acaba em jan/2027
    continuam++;
    const id = s.IdentificacaoParlamentar, codigo = Number(id.CodigoParlamentar);
    const suplente = s.Mandato.DescricaoParticipacao !== 'Titular';
    const mandato = { cargo: 'senador' as const, uf: id.UfParlamentar, inicio: s.Mandato.PrimeiraLegislaturaDoMandato.DataInicio, fim: s.Mandato.SegundaLegislaturaDoMandato.DataFim, eleicao: 2022, ...(suplente ? { suplente: true } : {}) };
    const ja = porSenado.get(codigo);
    if (ja) { // senador de 2022 que ganhou outro cargo em 2026 (vai deixar a cadeira pro suplente)
      ja.mandatos.push(mandato);
      avisos.push(`${id.NomeParlamentar} (${id.UfParlamentar}) tem mandato de senador até 2031 e foi eleito ${ja.mandatos[0].cargo} em 2026`);
      continue;
    }
    const tse = suplente ? undefined : sen22.find(r => r.SG_UF === id.UfParlamentar && (normalizarNome(r.NM_CANDIDATO) === normalizarNome(id.NomeCompletoParlamentar) || similaridadeNome(r.NM_URNA_CANDIDATO, id.NomeParlamentar) >= 0.8));
    if (!suplente && sen22.length && !tse) avisos.push(`senador de 2022 sem registro no TSE: ${id.NomeParlamentar} (${id.UfParlamentar})`);
    eleitos.push({
      slug: '', nome: id.NomeCompletoParlamentar, nomeUrna: id.NomeParlamentar, partido: canonizarSigla(id.SiglaPartidoParlamentar, aliases), uf: id.UfParlamentar,
      fotoUrl: https(id.UrlFotoParlamentar), ids: { senado: codigo, ...(tse ? { tse2022: tse.SQ_CANDIDATO } : {}) }, mandatos: [mandato],
    });
  }

  /* ---- slugs estáveis: nome de urna + UF; colisão ganha sufixo pela ordem do id ---- */
  const usados = new Map<string, number>();
  for (const e of eleitos) {
    const base = `${slugBase(e.nomeUrna)}-${(e.uf ?? 'br').toLowerCase()}`;
    const n = (usados.get(base) ?? 0) + 1; usados.set(base, n);
    e.slug = n === 1 ? base : `${base}-${n}`;
  }

  /* ---- conferência ---- */
  const contagem: Record<string, number> = {};
  for (const e of eleitos) for (const m of e.mandatos) {
    const k = m.eleicao === 2022 ? 'senador (2022)' : m.cargo;
    contagem[k] = (contagem[k] ?? 0) + 1;
  }
  for (const [cargo, n] of Object.entries(ESPERADO)) if (contagem[cargo] !== n) avisos.push(`${cargo}: ${contagem[cargo] ?? 0} eleitos, esperado ${n}`);
  if (continuam !== 27) avisos.push(`senadores que seguem até 2031: ${continuam}, esperado 27`);
  const ligados = { camara: eleitos.filter(e => e.ids.camara).length, senado: eleitos.filter(e => e.ids.senado).length };
  console.log(`  ${eleitos.length} políticos · ${JSON.stringify(contagem)}`);
  console.log(`  com id da Câmara: ${ligados.camara} · com código do Senado: ${ligados.senado}`);
  console.log(`  2º turno pendente: ${pendentes.presidente ? 'presidência, ' : ''}governador em ${pendentes.governadores.join(', ') || 'nenhuma UF'}`);
  for (const a of avisos) console.warn(`  ⚠ ${a}`);

  escreverJson(resolve(GERADO, 'eleitos-2027.json'), {
    geradoEm: agoraIso(), dataGeracaoTse, fonte: URL_TSE,
    aviso: 'Resultado do TSE até a diplomação: decisões judiciais e retotalização ainda podem mudar quem assume.',
    contagem, pendentes, avisos, eleitos,
  });
}

main().catch(e => { console.error('✗ cadastro-eleitos falhou:', e); process.exit(1); });
