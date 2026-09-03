/* Importa candidatos do TSE (Portal de Dados Abertos, base consulta_cand).
   O CDN do TSE bloqueia IPs fora do Brasil (HTTP 403/404). Ordem de tentativa:
     1. CDN oficial → 2. snapshot do Wayback Machine → 3. arquivo já em data/raw/tse/
   Gera:
     src/data/generated/tse-2026.json     candidatos válidos dos 5 cargos, todas as UFs + presidência
     src/data/generated/assembleias.json  composição ELEITA em 2022 de cada assembleia (não há API) e vagas federais por UF */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { escreverJson, lerJson, agoraIso, RAIZ, RAW, GERADO } from './util';
import { canonizarSigla } from '../src/lib/nomes';

const CDN = 'https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand';
const PASTA = resolve(RAW, 'tse');
const UA_NAV = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CARGOS: Record<string, string> = { PRESIDENTE: 'presidente', GOVERNADOR: 'governador', SENADOR: 'senador', 'DEPUTADO FEDERAL': 'federal', 'DEPUTADO ESTADUAL': 'estadual', 'DEPUTADO DISTRITAL': 'estadual' };

async function baixarComFallback(nome: string): Promise<boolean> {
  const destino = resolve(PASTA, nome);
  if (existsSync(destino)) { console.log(`  já existe: ${nome}`); return true; }
  const url = `${CDN}/${nome}`;
  const tentar = async (u: string, rotulo: string) => {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA_NAV } });
      if (!r.ok) { console.warn(`  ⚠ ${rotulo}: HTTP ${r.status}`); return false; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000 || buf.subarray(0, 2).toString() !== 'PK') { console.warn(`  ⚠ ${rotulo}: resposta não é um ZIP`); return false; }
      writeFileSync(destino, buf); console.log(`  ✓ ${nome} via ${rotulo} (${(buf.length / 1e6).toFixed(1)} MB)`); return true;
    } catch (e) { console.warn(`  ⚠ ${rotulo}: ${(e as Error).message}`); return false; }
  };
  if (await tentar(url, 'CDN do TSE')) return true;
  try {
    const av = await (await fetch(`https://archive.org/wayback/available?url=${url}`)).json() as { archived_snapshots?: { closest?: { url: string; timestamp: string } } };
    const snap = av.archived_snapshots?.closest;
    if (snap) { console.log(`  snapshot do Wayback de ${snap.timestamp.slice(0, 8)}`); if (await tentar(snap.url.replace(/\/web\/(\d+)\//, '/web/$1id_/'), 'Wayback Machine')) return true; }
    else console.warn('  ⚠ sem snapshot no Wayback');
  } catch (e) { console.warn(`  ⚠ Wayback: ${(e as Error).message}`); }
  return false;
}

/** parser de CSV do TSE: separador ';', todos os campos entre aspas, latin1 */
function parseCsv(buf: Buffer): Record<string, string>[] {
  const txt = buf.toString('latin1');
  const linhas: string[][] = []; let campo = '', linha: string[] = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) { if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; }
    else if (ch === '"') aspas = true;
    else if (ch === ';') { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else campo += ch;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const cab = linhas[0];
  return linhas.slice(1).filter(l => l.length > 1).map(l => { const o: Record<string, string> = {}; cab.forEach((k, i) => { o[k] = l[i] ?? ''; }); return o; });
}

function csvNacional(ano: number): Record<string, string>[] | null {
  const zip = resolve(PASTA, `consulta_cand_${ano}.zip`), csv = resolve(PASTA, `consulta_cand_${ano}_BRASIL.csv`);
  if (!existsSync(csv) && existsSync(zip)) execFileSync('unzip', ['-o', '-q', zip, `consulta_cand_${ano}_BRASIL.csv`, '-d', PASTA]);
  if (!existsSync(csv)) return null;
  return parseCsv(readFileSync(csv));
}

async function main() {
  mkdirSync(PASTA, { recursive: true });
  const { aliases } = lerJson<{ aliases: Record<string, string> }>(resolve(RAIZ, 'src/data/partidos.json'));

  /* ---- 2026: candidatos ---- */
  console.log('▶ TSE — consulta_cand_2026 (nacional)');
  await baixarComFallback('consulta_cand_2026.zip');
  const rows = csvNacional(2026);
  if (!rows) { console.error(`  ✗ sem consulta_cand_2026.zip em ${PASTA}. Baixe de um IP brasileiro e rode de novo.`); process.exit(1); }
  const candidatos: { sq: string; uf: string; cargo: string; numero: string; nome: string; nomeUrna: string; cpf: string; partido: string; partidoTse: string; situacao: string }[] = [];
  let dataGeracao = '';
  for (const r of rows) {
    if (r.ANO_ELEICAO !== '2026' || r.NR_TURNO !== '1' || (r.CD_TIPO_ELEICAO && r.CD_TIPO_ELEICAO !== '2')) continue;
    const cargo = CARGOS[r.DS_CARGO]; if (!cargo) continue;                       // vice e suplente ficam de fora
    const situacao = (r.DS_SITUACAO_CANDIDATURA ?? '').toUpperCase();
    const detalhe = (r.DS_DETALHE_SITUACAO_CAND ?? '').toUpperCase();
    if (situacao === 'INAPTO' || /RENÚNCIA|RENUNCIA|INDEFERIDO|CASSAD|FALECID|NÃO CONHECIMENTO|CANCELAD/.test(detalhe)) continue;
    dataGeracao ||= r.DT_GERACAO ?? '';
    candidatos.push({ sq: r.SQ_CANDIDATO, uf: r.SG_UF, cargo, numero: r.NR_CANDIDATO, nome: r.NM_CANDIDATO, nomeUrna: r.NM_URNA_CANDIDATO, cpf: r.NR_CPF_CANDIDATO ?? '', partido: canonizarSigla(r.SG_PARTIDO, aliases), partidoTse: r.SG_PARTIDO, situacao: situacao === '#NE' ? 'AGUARDANDO JULGAMENTO' : situacao });
  }
  // registros duplicados (mesma pessoa, mesmo cargo/UF/número — reapresentação do pedido): fica o SQ mais recente
  const chave = (c: typeof candidatos[number]) => `${c.uf}|${c.cargo}|${c.numero}|${c.cpf || c.nome}`;
  const vistos = new Map<string, number>();
  for (let i = 0; i < candidatos.length; i++) {
    const k = chave(candidatos[i]), j = vistos.get(k);
    if (j === undefined) vistos.set(k, i);
    else if (candidatos[i].sq > candidatos[j].sq) { candidatos[j] = null as never; vistos.set(k, i); }
    else candidatos[i] = null as never;
  }
  const antes = candidatos.length;
  for (let i = candidatos.length - 1; i >= 0; i--) if (!candidatos[i]) candidatos.splice(i, 1);
  if (antes !== candidatos.length) console.log(`  ${antes - candidatos.length} registros duplicados removidos`);
  const porCargo: Record<string, number> = {}; for (const c of candidatos) porCargo[c.cargo] = (porCargo[c.cargo] ?? 0) + 1;
  console.log(`  ${candidatos.length} candidaturas — ${JSON.stringify(porCargo)} — gerado pelo TSE em ${dataGeracao}`);
  escreverJson(resolve(GERADO, 'tse-2026.json'), { atualizadoEm: agoraIso(), dataGeracaoTse: dataGeracao, fonte: `${CDN}/consulta_cand_2026.zip`, candidatos });

  /* ---- 2022: composição eleita das assembleias + vagas federais ---- */
  console.log('▶ TSE — consulta_cand_2022 (eleitos → assembleias)');
  await baixarComFallback('consulta_cand_2022.zip');
  const rows22 = csvNacional(2022);
  if (!rows22) { console.warn('  ⚠ sem consulta_cand_2022.zip — assembleias.json não atualizado'); return; }
  const assembleias: Record<string, { cadeiras: number; bancadas: Record<string, number>; federais: number }> = {};
  for (const r of rows22) {
    if (r.ANO_ELEICAO !== '2022' || !(r.DS_SIT_TOT_TURNO ?? '').startsWith('ELEITO')) continue;
    const a = (assembleias[r.SG_UF] ??= { cadeiras: 0, bancadas: {}, federais: 0 });
    if (r.DS_CARGO === 'DEPUTADO ESTADUAL' || r.DS_CARGO === 'DEPUTADO DISTRITAL') { a.cadeiras++; const p = canonizarSigla(r.SG_PARTIDO, aliases); a.bancadas[p] = (a.bancadas[p] ?? 0) + 1; }
    else if (r.DS_CARGO === 'DEPUTADO FEDERAL') a.federais++;
  }
  console.log(`  ${Object.keys(assembleias).length} UFs · ${Object.values(assembleias).reduce((s, a) => s + a.cadeiras, 0)} cadeiras estaduais · ${Object.values(assembleias).reduce((s, a) => s + a.federais, 0)} federais`);
  escreverJson(resolve(GERADO, 'assembleias.json'), { atualizadoEm: agoraIso(), fonte: `${CDN}/consulta_cand_2022.zip (DS_SIT_TOT_TURNO = ELEITO*)`, aviso: 'Composição eleita em 2022 por partido (siglas extintas mapeadas pra sucessoras). Não reflete trocas de partido posteriores.', assembleias });
}
main().catch(e => { console.error('✗ fetch-tse falhou:', e); process.exit(1); });
