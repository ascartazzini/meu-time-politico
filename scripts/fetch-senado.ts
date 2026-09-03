/* Puxa da API de Dados Abertos do Senado:
   1. senadores em exercício (→ bancadas e índice pra casar candidatos)
   2. votos nominais das votações mapeadas em src/data/temas.json (endpoint /votacao já traz os votos)
   Saída: src/data/generated/senado.json */
import { resolve } from 'node:path';
import { fetchJson, escreverJson, lerJson, agoraIso, RAIZ, GERADO } from './util';
import { canonizarSigla } from '../src/lib/nomes';
import type { Tema } from '../src/lib/tipos';

const B = 'https://legis.senado.leg.br/dadosabertos';

interface ParlamentarRaw { IdentificacaoParlamentar: { CodigoParlamentar: string; NomeParlamentar: string; NomeCompletoParlamentar: string; SiglaPartidoParlamentar?: string; UfParlamentar?: string } }
interface VotacaoRaw { codigoSessaoVotacao: number; dataSessao: string; identificacao: string; descricaoVotacao: string; votacaoSecreta: string; votos?: { codigoParlamentar: number; nomeParlamentar: string; siglaPartidoParlamentar: string; siglaUFParlamentar: string; siglaVotoParlamentar: string }[] }

async function main() {
  console.log('▶ Senado Federal');
  const { temas } = lerJson<{ temas: Tema[] }>(resolve(RAIZ, 'src/data/temas.json'));
  const { aliases } = lerJson<{ aliases: Record<string, string> }>(resolve(RAIZ, 'src/data/partidos.json'));

  const lista = await fetchJson<{ ListaParlamentarEmExercicio: { Parlamentares: { Parlamentar: ParlamentarRaw[] } } }>(`${B}/senador/lista/atual.json`);
  const senadores = lista.ListaParlamentarEmExercicio.Parlamentares.Parlamentar.map(p => ({
    codigo: Number(p.IdentificacaoParlamentar.CodigoParlamentar),
    nome: p.IdentificacaoParlamentar.NomeParlamentar,
    nomeCompleto: p.IdentificacaoParlamentar.NomeCompletoParlamentar,
    partido: canonizarSigla(p.IdentificacaoParlamentar.SiglaPartidoParlamentar ?? '', aliases),
    uf: p.IdentificacaoParlamentar.UfParlamentar ?? ''
  }));
  const bancadas: Record<string, number> = {};
  for (const s of senadores) if (s.partido) bancadas[s.partido] = (bancadas[s.partido] ?? 0) + 1;
  console.log(`  ${senadores.length} senadores em exercício — ${JSON.stringify(bancadas)}`);

  const votacoes: Record<string, { codigo: number; data: string; identificacao: string; descricao: string; totais: Record<string, number>; votos: Record<string, string>; nomes: Record<string, { nome: string; partido: string; uf: string }> }> = {};
  for (const ref of temas.flatMap(t => t.votacoes.filter(v => v.casa === 'senado'))) {
    const lista = await fetchJson<VotacaoRaw[]>(`${B}/votacao?sigla=${ref.sigla}&numero=${ref.numero}&ano=${ref.ano}`);
    const v = lista.find(x => x.codigoSessaoVotacao === ref.codigoSessaoVotacao);
    if (!v) { console.warn(`  ⚠ votação ${ref.codigoSessaoVotacao} (${ref.sigla} ${ref.numero}/${ref.ano}) não encontrada — opções: ${lista.map(x => x.codigoSessaoVotacao).join(', ')}`); continue; }
    if (v.votacaoSecreta === 'S') { console.warn(`  ⚠ votação ${v.codigoSessaoVotacao} é secreta; ignorada`); continue; }
    const totais: Record<string, number> = {}; const votos: Record<string, string> = {}; const nomes: typeof votacoes[string]['nomes'] = {};
    for (const x of v.votos ?? []) {
      totais[x.siglaVotoParlamentar] = (totais[x.siglaVotoParlamentar] ?? 0) + 1;
      votos[String(x.codigoParlamentar)] = x.siglaVotoParlamentar;
      nomes[String(x.codigoParlamentar)] = { nome: x.nomeParlamentar, partido: canonizarSigla(x.siglaPartidoParlamentar, aliases), uf: x.siglaUFParlamentar };
    }
    votacoes[String(v.codigoSessaoVotacao)] = { codigo: v.codigoSessaoVotacao, data: v.dataSessao, identificacao: v.identificacao, descricao: v.descricaoVotacao, totais, votos, nomes };
    console.log(`  ${v.codigoSessaoVotacao} ${v.identificacao} (${v.dataSessao}): ${JSON.stringify(totais)}`);
  }

  escreverJson(resolve(GERADO, 'senado.json'), { atualizadoEm: agoraIso(), fonte: B, bancadas, senadores, votacoes });
}
main().catch(e => { console.error('✗ fetch-senado falhou:', e); process.exit(1); });
