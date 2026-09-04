/* Valida public/dados/<UF>.json de todas as UFs + src/data/generated/indice.json antes do build. */
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { z } from 'zod';
import { lerJson, RAIZ, GERADO } from './util';

const Lado = z.enum(['F', 'C', 'D']);
const Candidato = z.object({
  id: z.string().min(1), nome: z.string().min(1), partido: z.string().min(1), cargo: z.enum(['presidente', 'governador', 'senador', 'federal', 'estadual']),
  uf: z.string(), numero: z.string().optional(),
  mandato: z.object({ casa: z.enum(['camara', 'senado']), id: z.number(), nome: z.string() }).optional(),
  votos: z.record(z.string(), z.object({ lado: Lado, detalhe: z.string() })).optional()
});
const Tema = z.object({ id: z.string(), s: z.string(), t: z.string(), leia: z.object({ rotulo: z.string(), url: z.url(), fonte: z.string() }).optional(), impacto: z.record(z.string(), Lado), votacoes: z.array(z.object({ casa: z.enum(['camara', 'senado']), ladoSim: z.enum(['F', 'C']), rotulo: z.string() }).loose()) });
const Cargo = z.object({
  id: z.enum(['presidente', 'governador', 'senador', 'federal', 'estadual']), nome: z.string(), curto: z.string(), casa: z.enum(['camara', 'senado', 'assembleia']),
  porCampo: z.boolean(), pesoNoPlacar: z.number().min(0).max(1), vagas: z.number().int().min(1), meta: z.string(), candidatos: z.array(Candidato).min(1)
}).loose();
const Dataset = z.object({
  uf: z.string().length(2), nomeUf: z.string(), casaEstadual: z.string(), geradoEm: z.string(), dataTse: z.string(),
  temas: z.array(Tema).length(14), ordemTemas: z.array(z.string()).length(14), cargos: z.array(Cargo).length(5),
  bancadas: z.object({ camara: z.record(z.string(), z.number()), senado: z.record(z.string(), z.number()), assembleia: z.record(z.string(), z.number()) }),
  quorum: z.object({ camara: z.number(), senado: z.number(), assembleia: z.number() }),
  cadeiras: z.object({ camara: z.number(), senado: z.number(), assembleia: z.number() }),
  partidos: z.record(z.string(), z.object({ nome: z.string(), campo: z.enum(['esq', 'centro', 'dir']).nullable(), estimativa: z.array(Lado).length(14), semOrientacao: z.boolean().optional() })),
  fontes: z.array(z.object({ rotulo: z.string(), detalhe: z.string() })), cobertura: z.array(z.object({ temaId: z.string(), nominal: z.number(), estimativa: z.number() })),
  stats: z.object({ candidatos: z.number(), federais: z.number(), estaduais: z.number(), comMandato: z.number() })
});

const pasta = resolve(RAIZ, 'public/dados');
const arquivos = readdirSync(pasta).filter(f => /^[A-Z]{2}\.json$/.test(f)).sort();
const erros: string[] = [];
const soma = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
let totalCand = 0;
for (const f of arquivos) {
  const r = Dataset.safeParse(lerJson(resolve(pasta, f)));
  if (!r.success) { erros.push(`${f}: ${r.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`); continue; }
  const ds = r.data;
  const sc = soma(ds.bancadas.camara), ss = soma(ds.bancadas.senado), sa = soma(ds.bancadas.assembleia);
  if (sc < 490 || sc > 513) erros.push(`${f}: bancadas da Câmara somam ${sc}`);
  if (ss < 75 || ss > 81) erros.push(`${f}: bancadas do Senado somam ${ss}`);
  if (sa !== ds.cadeiras.assembleia) erros.push(`${f}: assembleia soma ${sa} ≠ ${ds.cadeiras.assembleia} cadeiras`);
  if (ds.quorum.assembleia !== Math.floor(ds.cadeiras.assembleia / 2) + 1) erros.push(`${f}: quórum da assembleia inconsistente`);
  const pesos = ds.cargos.reduce((a, c) => a + c.pesoNoPlacar, 0);
  if (Math.abs(pesos - 1) > 1e-9) erros.push(`${f}: pesoNoPlacar soma ${pesos}`);
  const temaIds = new Set(ds.temas.map(t => t.id));
  const ids = ds.cargos.flatMap(c => c.candidatos.map(x => x.id));
  if (new Set(ids).size !== ids.length) erros.push(`${f}: ids de candidato repetidos`);
  for (const c of ds.cargos) {
    if (c.vagas !== (c.id === 'senador' ? 2 : 1)) erros.push(`${f}: ${c.id} com ${c.vagas} vagas (em 2026 são 2 de senador e 1 dos demais)`);
    if (c.candidatos.length < c.vagas) erros.push(`${f}: ${c.id} tem menos candidatos do que vagas`);
    if (c.id !== 'presidente' && c.candidatos.some(x => x.uf !== ds.uf)) erros.push(`${f}: candidato de outra UF em ${c.id}`);
    if (c.id === 'presidente' && c.candidatos.some(x => x.uf !== 'BR')) erros.push(`${f}: presidenciável com UF ≠ BR`);
    for (const x of c.candidatos) for (const t of Object.keys(x.votos ?? {})) if (!temaIds.has(t)) erros.push(`${f}: ${x.nome} tem voto em tema desconhecido ${t}`);
  }
  totalCand += ds.stats.candidatos;
}
const indice = lerJson<{ ufs: unknown[] }>(resolve(GERADO, 'indice.json'));
if (arquivos.length !== 27) erros.push(`esperava 27 UFs, achei ${arquivos.length}: ${arquivos.join(', ')}`);
if (indice.ufs.length !== arquivos.length) erros.push(`indice.json tem ${indice.ufs.length} UFs, pasta tem ${arquivos.length}`);
if (erros.length) { console.error('✗ dataset inválido:\n  - ' + erros.join('\n  - ')); process.exit(1); }
console.log(`✓ ${arquivos.length} datasets válidos (${totalCand} entradas de candidato somando presidenciáveis repetidos por UF)`);
