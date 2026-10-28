/* Coletor do Senado: votações nominais e discursos em plenário, ligados pelo código do parlamentar.
   O Senado não tem API de presença: quem não votou numa votação nominal aparece com a sigla oficial
   (AP, LS, MIS, P-NRV…), e o app diz que isso só vale em dia de votação nominal.
   Uso: npm run coletar:senado [-- --dias=7] */
import { fetchJson } from '../util';
import { idsPorFonte, gravar, br, janela, diasDoArgumento, type ItemNovo } from './banco';

const SEN = 'https://legis.senado.leg.br/dadosabertos';
const lista = <T>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const semTraco = (d: string) => d.replace(/-/g, '');

type VotoSen = { codigoParlamentar: number; siglaVotoParlamentar: string };
type VotacaoSen = {
  codigoSessaoVotacao: number; codigoMateria: number | null; dataSessao: string; identificacao: string; descricaoVotacao: string;
  ementa: string | null; votacaoSecreta: string; resultadoVotacao: string | null; totalVotosSim: number | null; totalVotosNao: number | null;
  votos: VotoSen[] | null;
};

async function votacoes(ids: Map<string, string>, inicio: string, fim: string): Promise<ItemNovo[]> {
  const vs = await fetchJson<VotacaoSen[]>(`${SEN}/votacao?dataInicio=${inicio}&dataFim=${fim}`);
  return vs.filter(v => v.votos?.length).map(v => ({
    fonte: 'senado-votacoes', chave: `senado-votacao-${v.codigoSessaoVotacao}`, tipo: 'voto' as const,
    titulo: `${v.identificacao}: ${(v.ementa ?? v.descricaoVotacao).replace(/\s+/g, ' ').trim()}`,
    resumo: `${v.descricaoVotacao}${v.votacaoSecreta === 'S' ? ' Votação secreta: só se sabe quem votou, não como.' : ''}${v.totalVotosSim != null ? ` Sim: ${v.totalVotosSim} · Não: ${v.totalVotosNao ?? 0}` : ''}`,
    url: v.codigoMateria ? `https://www25.senado.leg.br/web/atividade/materias/-/materia/${v.codigoMateria}` : `${SEN}/votacao?dataInicio=${inicio}&dataFim=${fim}`,
    ocorreuEm: br(v.dataSessao),
    dados: { casa: 'senado', secreta: v.votacaoSecreta === 'S', resultado: v.resultadoVotacao },
    politicos: v.votos!.filter(x => ids.has(String(x.codigoParlamentar)))
      .map(x => ({ id: ids.get(String(x.codigoParlamentar))!, papel: x.siglaVotoParlamentar, metodo: 'id-oficial' as const })),
  }));
}

type Pron = { CodigoPronunciamento: string; Data: string; NomeAutor: string; CodigoParlamentar?: string; Resumo?: string; TipoUsoPalavra?: { Descricao: string }; TextoIntegral?: string };

async function discursos(ids: Map<string, string>, inicio: string, fim: string): Promise<ItemNovo[]> {
  const r = await fetchJson<{ DiscursosSessao: { Sessoes: { Sessao: unknown } | null } }>(`${SEN}/plenario/lista/discursos/${semTraco(inicio)}/${semTraco(fim)}`);
  const sessoes = lista(r.DiscursosSessao.Sessoes?.Sessao as { DescricaoSessao?: string; Pronunciamentos?: { Pronunciamento: Pron | Pron[] } }[]);
  return sessoes.flatMap(s => lista(s.Pronunciamentos?.Pronunciamento).map(p => ({
    fonte: 'senado-discursos', chave: `senado-discurso-${p.CodigoPronunciamento}`, tipo: 'discurso' as const,
    titulo: `${p.NomeAutor} — ${p.TipoUsoPalavra?.Descricao ?? 'Pronunciamento'}${s.DescricaoSessao ? ` (${s.DescricaoSessao})` : ''}`,
    resumo: p.Resumo?.replace(/\s+/g, ' ').trim() ?? null,
    url: p.TextoIntegral ?? `https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/${p.CodigoPronunciamento}`,
    ocorreuEm: br(p.Data),
    dados: { casa: 'senado' },
    politicos: p.CodigoParlamentar && ids.has(p.CodigoParlamentar) ? [{ id: ids.get(p.CodigoParlamentar)!, papel: 'autor', metodo: 'id-oficial' as const }] : [],
  })));
}

async function main() {
  const { inicio, fim } = janela(diasDoArgumento(7));
  console.log(`▶ Senado ${inicio} → ${fim}`);
  const ids = await idsPorFonte('senado');
  for (const [nome, fn] of [['votações', votacoes], ['discursos', discursos]] as const) {
    const r = await gravar(await fn(ids, inicio, fim));
    console.log(`  ✓ ${nome}: ${r.itens} itens, ${r.ligacoes} ligações`);
  }
}

main().catch(e => { console.error('✗ coletor do Senado falhou:', e.message); process.exit(1); });
