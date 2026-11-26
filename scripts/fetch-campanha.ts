/* Gastos de campanha de 2026 dos eleitos: prestação de contas entregue ao TSE.
   Fonte: cdn.tse.jus.br/.../prestacao_contas/prestacao_de_contas_eleitorais_candidatos_2026.zip (~370 MB, regerado todo dia).
   O CDN bloqueia IP de fora do Brasil às vezes; sem ele, usa o zip que já estiver em data/raw/tse/.
   Lê, por UF (e BR, presidente), despesas contratadas e receitas, em fluxo (o CSV nacional de despesas passa de 1 GB),
   e guarda só os eleitos do cadastro (ids.tse2026). Saída: src/data/generated/campanha-2026.json (versionado). */
import { existsSync, mkdirSync, statSync, createWriteStream, renameSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { escreverJson, lerJson, agoraIso, RAW, GERADO } from './util';
import { Acumulador, type ArquivoCampanha } from '../src/lib/campanha';

const URL_ZIP = 'https://cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_2026.zip';
const ZIP = resolve(RAW, 'tse', 'prestacao_de_contas_eleitorais_candidatos_2026.zip');
const UA_NAV = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

async function baixar() {
  mkdirSync(resolve(RAW, 'tse'), { recursive: true });
  if (existsSync(ZIP) && Date.now() - statSync(ZIP).mtimeMs < 20 * 36e5) { console.log('  zip com menos de 20 h, reaproveitando'); return; }
  const r = await fetch(URL_ZIP, { headers: { 'User-Agent': UA_NAV } }).catch(() => null);
  if (r?.ok && r.body) {
    console.log(`  baixando ${(Number(r.headers.get('content-length')) / 1e6).toFixed(0)} MB (CDN modificado em ${r.headers.get('last-modified')})…`);
    const tmp = `${ZIP}.parcial`;
    await pipeline(Readable.fromWeb(r.body as never), createWriteStream(tmp));
    renameSync(tmp, ZIP);
  } else if (existsSync(ZIP)) console.warn(`  ⚠ CDN do TSE respondeu ${r?.status ?? 'nada'}; usando o zip que já está em data/raw/tse/`);
  else { console.error(`  ✗ CDN do TSE respondeu ${r?.status ?? 'nada'}. Baixe ${URL_ZIP} de um IP brasileiro pra data/raw/tse/ e rode de novo.`); process.exit(1); }
}

/** CSV do TSE (latin1, ";", aspas) lido em fluxo direto do zip; chama `linha` pra cada registro. */
function lerCsv(arquivo: string, linha: (r: Record<string, string>) => void): Promise<number> {
  return new Promise((ok, falha) => {
    const p = spawn('unzip', ['-p', ZIP, arquivo]);
    let cab: string[] | null = null, campo = '', reg: string[] = [], aspas = false, n = 0;
    const fechar = () => {
      reg.push(campo); campo = '';
      if (!cab) cab = reg;
      else if (reg.length > 1) { const o: Record<string, string> = {}; cab.forEach((k, i) => { o[k] = reg[i] ?? ''; }); linha(o); n++; }
      reg = [];
    };
    let cr = false;
    p.stdout.setEncoding('latin1');
    p.stdout.on('data', (txt: string) => {
      for (let i = 0; i < txt.length; i++) {
        const ch = txt[i];
        if (cr) { cr = false; if (ch === '\n') continue; }
        if (aspas) { if (ch === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; }
        else if (ch === '"') aspas = true;
        else if (ch === ';') { reg.push(campo); campo = ''; }
        else if (ch === '\n' || ch === '\r') { cr = ch === '\r'; fechar(); }
        else campo += ch;
      }
    });
    p.on('error', falha);
    p.on('close', code => { if (campo || reg.length) fechar(); code === 0 ? ok(n) : falha(new Error(`unzip ${arquivo} saiu com ${code}`)); });
  });
}

async function main() {
  console.log('▶ TSE — prestação de contas dos candidatos de 2026');
  await baixar();
  const cadastro = lerJson<{ eleitos: { ids: { tse2026?: string } }[] }>(resolve(GERADO, 'eleitos-2027.json'));
  const sqs = new Set(cadastro.eleitos.map(e => e.ids.tse2026).filter((x): x is string => !!x));
  const acc = new Map<string, Acumulador>();
  const de = (sq: string) => { let a = acc.get(sq); if (!a) acc.set(sq, (a = new Acumulador())); return a; };

  const lista = execFileSync('unzip', ['-Z1', ZIP]).toString().split('\n');
  const ufs = lista.map(f => /^despesas_contratadas_candidatos_2026_([A-Z]{2})\.csv$/.exec(f)?.[1]).filter((x): x is string => !!x).sort();
  let dataGeracaoTse = '';
  for (const uf of ufs) {
    const nd = await lerCsv(`despesas_contratadas_candidatos_2026_${uf}.csv`, r => { dataGeracaoTse ||= r.DT_GERACAO; if (sqs.has(r.SQ_CANDIDATO)) de(r.SQ_CANDIDATO).despesaContratada(r); });
    const nr = await lerCsv(`receitas_candidatos_2026_${uf}.csv`, r => { if (sqs.has(r.SQ_CANDIDATO)) de(r.SQ_CANDIDATO).receitaLinha(r); });
    console.log(`  ${uf}: ${nd.toLocaleString('pt-BR')} despesas, ${nr.toLocaleString('pt-BR')} receitas`);
  }
  const candidatos = Object.fromEntries([...acc].sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)).map(([sq, a]) => [sq, a.resumo()]));
  console.log(`  ${Object.keys(candidatos).length} de ${sqs.size} eleitos de 2026 com prestação de contas — TSE gerou em ${dataGeracaoTse}`);
  const saida: ArquivoCampanha = {
    geradoEm: agoraIso(), dataGeracaoTse, fonte: URL_ZIP,
    aviso: 'Valores declarados pelo próprio candidato ao TSE (despesas contratadas e receitas). A Justiça Eleitoral ainda julga as contas; retificação muda os números.',
    candidatos,
  };
  escreverJson(resolve(GERADO, 'campanha-2026.json'), saida);
}
main().catch(e => { console.error('✗ fetch-campanha falhou:', e); process.exit(1); });
