/* Roda as provas de fonte da Fase 0 e escreve:
   docs/fase0/resultados.json  (medidas brutas, com amostra)
   docs/fase0/fontes.md        (tabela fonte × funciona × volume × custo × risco × veredito)
   Uso: npm run prova            → todas
        npm run prova -- camara  → só as provas cujo id começa com "camara" */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { RAIZ, escreverJson, agoraIso } from '../util';
import type { Prova, Medida, Grupo } from './base';

const DIR = import.meta.dirname;
const SAIDA = resolve(RAIZ, 'docs/fase0');
const filtro = process.argv[2];

const GRUPOS: Record<Grupo, string> = {
  oficial: 'Congresso (oficial)', executivo: 'Executivo federal (oficial)', imprensa: 'Imprensa',
  'rede-aberta': 'Redes abertas', 'rede-fechada': 'Redes fechadas (página pública, sem login)', estado: 'Estados (assembleias e governos)',
};

const vereditoPadrao = (m: Medida) =>
  m.status === 'ok' ? 'usar' : m.status === 'parcial' ? 'usar com cuidado' : 'fora, por ora';

async function main() {
  const arquivos = readdirSync(DIR).filter(f => f.endsWith('.ts') && !['base.ts', 'rodar.ts'].includes(f)).sort();
  const provas: Prova[] = [];
  for (const f of arquivos) provas.push(...((await import(resolve(DIR, f))).default as Prova[]));
  const escolhidas = filtro ? provas.filter(p => p.id.startsWith(filtro)) : provas;
  console.log(`▶ ${escolhidas.length} provas${filtro ? ` (filtro "${filtro}")` : ''}`);

  const resultados: (Omit<Prova, 'rodar' | 'veredito'> & { medida: Medida; veredito: string; ms: number })[] = [];
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < escolhidas.length) {
      const p = escolhidas[i++];
      const t0 = Date.now();
      let medida: Medida;
      let timer: NodeJS.Timeout | undefined;
      try {
        medida = await Promise.race([
          p.rodar(),
          new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error('passou de 3 min')), 180_000); }),
        ]);
      } catch (e) {
        medida = { status: 'falhou', itens: null, janela: '—', atrasoHoras: null, formato: '—', idPolitico: false, amostra: [], notas: [`erro: ${(e as Error).message}`] };
      } finally { clearTimeout(timer); }
      const ms = Date.now() - t0;
      const { rodar: _r, veredito, ...meta } = p;
      resultados.push({ ...meta, medida, veredito: (veredito ?? vereditoPadrao)(medida), ms });
      console.log(`  ${medida.status === 'ok' ? '✓' : medida.status === 'parcial' ? '~' : '✗'} ${p.id} — ${medida.status}, ${medida.itens ?? '?'} itens (${(ms / 1000).toFixed(1)}s)`);
    }
  }));
  resultados.sort((a, b) => Object.keys(GRUPOS).indexOf(a.grupo) - Object.keys(GRUPOS).indexOf(b.grupo) || a.id.localeCompare(b.id));

  if (filtro) { // rodada parcial: não sobrescreve o relatório completo
    escreverJson(resolve(SAIDA, `resultados-${filtro}.json`), { rodadoEm: agoraIso(), resultados });
    return;
  }
  escreverJson(resolve(SAIDA, 'resultados.json'), { rodadoEm: agoraIso(), origem: 'máquina local (IP fora do Brasil)', resultados });

  const cel = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const linhas: string[] = [
    '# Fase 0 — prova das fontes',
    '',
    `Gerado por \`npm run prova\` em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (horário de Brasília), rodando de IP fora do Brasil, sem login e sem chave paga. Medidas brutas e amostras em \`resultados.json\`.`,
    '',
    'Colunas: **funciona** = o que a fonte entregou nesta rodada · **volume** = itens na janela · **atraso** = horas desde o item mais recente · **id** = o item já vem ligado ao político por id oficial (dispensa IA).',
  ];
  for (const [g, titulo] of Object.entries(GRUPOS)) {
    const doGrupo = resultados.filter(r => r.grupo === g);
    if (!doGrupo.length) continue;
    linhas.push('', `## ${titulo}`, '', '| fonte | funciona | volume | atraso | id | custo | risco | veredito |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of doGrupo) {
      const m = r.medida;
      linhas.push(`| [${cel(r.nome)}](${r.url}) | ${m.status} | ${m.itens ?? '—'}${m.itens != null ? ` / ${m.janela}` : ''} | ${m.atrasoHoras != null ? `${m.atrasoHoras} h` : '—'} | ${m.idPolitico ? 'sim' : 'não'} | ${cel(r.custo)} | ${cel(r.risco)} | **${cel(r.veredito)}** |`);
    }
    const comNota = doGrupo.filter(r => r.medida.notas.length);
    if (comNota.length) {
      linhas.push('');
      for (const r of comNota) linhas.push(`- **${cel(r.nome)}**: ${r.medida.notas.map(cel).join(' · ')}`);
    }
  }
  mkdirSync(SAIDA, { recursive: true });
  writeFileSync(resolve(SAIDA, 'fontes.md'), linhas.join('\n') + '\n', 'utf8');
  console.log(`  ✓ docs/fase0/fontes.md`);
}

main().catch(e => { console.error(e); process.exit(1); });
