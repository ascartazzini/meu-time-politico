/* Coletor da Câmara: presença por evento, votos nominais e projetos apresentados.
   Tudo liga ao deputado pelo id oficial (ids_externos fonte=camara). Até a posse de fev/2027,
   só os reeleitos têm id; os novatos entram quando a API publicar a legislatura nova.
   Uso: npm run coletar:camara [-- --dias=3] */
import { fetchJson } from '../util';
import { idsPorFonte, gravar, br, janela, emLotes, diasDoArgumento, politicos as listarPoliticos, type ItemNovo } from './banco';

const CAM = 'https://dadosabertos.camara.leg.br/api/v2';
const paginaEvento = (id: number | string) => `https://www.camara.leg.br/evento-legislativo/${id}`;

interface Evento { id: number; dataHoraInicio: string; situacao: string; descricaoTipo: string; descricao: string; localCamara?: { nome: string | null }; orgaos: { sigla: string; nome: string }[] }

async function eventos(inicio: string, fim: string): Promise<Evento[]> {
  const out: Evento[] = [];
  for (let pagina = 1; pagina <= 30; pagina++) {
    const r = await fetchJson<{ dados: Evento[]; links: { rel: string }[] }>(`${CAM}/eventos?dataInicio=${inicio}&dataFim=${fim}&itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=dataHoraInicio`);
    out.push(...r.dados);
    if (!r.links.some(l => l.rel === 'next')) break;
  }
  return out;
}

const ehPlenarioDeliberativo = (e: Evento) => e.orgaos.some(o => o.sigla === 'PLEN') && /deliberativa/i.test(e.descricaoTipo);

interface Deputado { id: number; nome: string; siglaPartido: string; siglaUf: string; urlFoto: string }
interface ItemPauta { titulo: string; situacaoItem: string | null; proposicao_: { id: number; ementa: string } | null; proposicaoRelacionada_?: { id: number } | null }
interface VotacaoEvento { id: string; descricao: string; uriProposicaoObjeto: string | null }

/* Votações da reunião, pra mostrar no item da pauta como cada eleito votou. O id da votação começa pelo
   id da proposição votada ("2620905-56"). Votação simbólica não tem lista de votos: a Câmara não registra
   o voto de cada um, e o card diz isso em vez de supor. Os votos guardados são só dos eleitos do cadastro. */
async function votacoesDoEvento(id: number, ids: Map<string, string>, slugPorId: Map<string, string>) {
  const lista = (await fetchJson<{ dados: VotacaoEvento[] }>(`${CAM}/eventos/${id}/votacoes`).catch(() => null))?.dados ?? [];
  return Promise.all(lista.map(async v => {
    const r = await fetchJson<{ dados: { tipoVoto: string; deputado_: { id: number } }[] }>(`${CAM}/votacoes/${v.id}/votos`).catch(() => null);
    const votos: Record<string, string> = {};
    for (const x of r?.dados ?? []) {
      const slug = slugPorId.get(ids.get(String(x.deputado_.id)) ?? '');
      if (slug) votos[slug] = x.tipoVoto;
    }
    const proposicoes = [v.id.split('-')[0], v.uriProposicaoObjeto?.split('/').pop()].filter((x): x is string => !!x);
    return { proposicoes, descricao: v.descricao.replace(/\s+/g, ' ').trim(), nominal: !!r?.dados.length, votos };
  }));
}

async function presenca(ids: Map<string, string>, inicio: string, fim: string): Promise<ItemNovo[]> {
  const encerrados = (await eventos(inicio, fim)).filter(e => /^Encerrada/.test(e.situacao));
  // Só falta quem está em exercício hoje: licenciado, quem virou ministro e quem saiu não estava sendo esperado.
  const emExercicio = new Map((await fetchJson<{ dados: Deputado[] }>(`${CAM}/deputados?itens=1000`)).dados.map(d => [String(d.id), d]));
  const slugPorId = new Map((await listarPoliticos()).map(p => [p.id, p.slug]));
  // presença e pauta (com o que aconteceu em cada item) de cada reunião
  const res = await emLotes(encerrados, 5, async e => {
    const [r, pauta, votacoes] = await Promise.all([
      fetchJson<{ dados: { id: number }[] }>(`${CAM}/eventos/${e.id}/deputados`).catch(() => null),
      fetchJson<{ dados: ItemPauta[] }>(`${CAM}/eventos/${e.id}/pauta`).catch(() => null),
      votacoesDoEvento(e.id, ids, slugPorId),
    ]);
    return { e, presentes: r?.dados.map(d => String(d.id)) ?? null, pauta: pauta?.dados ?? [], votacoes };
  });
  const itens: ItemNovo[] = [];
  for (const { e, presentes, pauta, votacoes } of res) {
    if (!presentes?.length) continue;   // lista vazia = presença não registrada; não dá pra dizer quem faltou
    const orgao = e.orgaos.map(o => o.sigla).join('/');
    const politicos = presentes.filter(p => ids.has(p)).map(p => ({ id: ids.get(p)!, papel: 'presente', metodo: 'id-oficial' as const }));
    // Ausência só no plenário deliberativo, onde todos os 513 são esperados. Em comissão só os membros são,
    // e a lista de membros muda; ali a gente só registra quem foi.
    if (ehPlenarioDeliberativo(e)) {
      const vieram = new Set(presentes);
      for (const [camara, id] of ids) if (emExercicio.has(camara) && !vieram.has(camara)) politicos.push({ id, papel: 'ausente', metodo: 'id-oficial' });
    }
    // todos os que faltaram, não só os do cadastro (nome, partido e foto vêm da própria Câmara)
    const ausentes = ehPlenarioDeliberativo(e) ? [...emExercicio.values()].filter(d => !presentes.includes(String(d.id))).map(d => {
      const pid = ids.get(String(d.id));
      return { nome: d.nome, partido: d.siglaPartido, uf: d.siglaUf, foto: d.urlFoto.replace(/^http:/, 'https:'), ...(pid && slugPorId.has(pid) ? { slug: slugPorId.get(pid) } : {}) };
    }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) : [];
    // a mesma proposição pode vir repetida na pauta (uma linha por fase); fica uma
    const vistas = new Set<number>();
    const itensPauta = pauta.filter(x => x.proposicao_?.ementa && !vistas.has(x.proposicao_.id) && vistas.add(x.proposicao_.id)).slice(0, 20).map(x => {
      const alvo = [x.proposicao_!.id, x.proposicaoRelacionada_?.id].filter(Boolean).map(String);
      const votadas = votacoes.filter(v => v.proposicoes.some(p => alvo.includes(p)))
        .map(v => ({ descricao: v.descricao, nominal: v.nominal, ...(v.nominal ? { votos: v.votos } : {}) }));
      return {
        ref: x.titulo, ementa: x.proposicao_!.ementa.replace(/\s+/g, ' ').trim(), situacao: x.situacaoItem?.replace(/\s+/g, ' ').trim() || null,
        url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${x.proposicao_!.id}`,
        ...(votadas.length ? { votacoes: votadas } : {}),
      };
    });
    itens.push({
      fonte: 'camara-presenca', chave: `camara-evento-${e.id}`, tipo: 'presenca',
      titulo: `${orgao}: ${e.descricaoTipo}`, resumo: e.descricao?.replace(/\s+/g, ' ').trim().slice(0, 400) || null,
      url: paginaEvento(e.id), ocorreuEm: br(e.dataHoraInicio), local: e.localCamara?.nome ?? null,
      // esperados: em plenário deliberativo, todos os deputados em exercício (o "de 513" do card)
      dados: { casa: 'camara', orgao, orgao_nome: e.orgaos.map(o => o.nome).join(' / '), presentes: presentes.length, plenario: ehPlenarioDeliberativo(e),
        ...(ehPlenarioDeliberativo(e) ? { esperados: emExercicio.size, ausentes } : {}), ...(itensPauta.length ? { pauta: itensPauta } : {}) },
      politicos,
    });
  }
  return itens;
}

interface Votacao { id: string; dataHoraRegistro: string; siglaOrgao: string; descricao: string; aprovacao: number | null; uriEvento: string | null }

async function votos(ids: Map<string, string>, inicio: string, fim: string): Promise<ItemNovo[]> {
  const lista = (await fetchJson<{ dados: Votacao[] }>(`${CAM}/votacoes?dataInicio=${inicio}&dataFim=${fim}&itens=200&ordem=DESC&ordenarPor=dataHoraRegistro`)).dados;
  const res = await emLotes(lista, 5, async v => {
    const r = await fetchJson<{ dados: { tipoVoto: string; deputado_: { id: number } }[] }>(`${CAM}/votacoes/${v.id}/votos`).catch(() => null);
    return { v, votos: r?.dados ?? [] };
  });
  return res.filter(x => x.votos.length).map(({ v, votos }) => {
    const evento = v.uriEvento?.split('/').pop();
    const contagem: Record<string, number> = {};
    for (const x of votos) contagem[x.tipoVoto] = (contagem[x.tipoVoto] ?? 0) + 1;
    return {
      fonte: 'camara-votacoes', chave: `camara-votacao-${v.id}`, tipo: 'voto' as const,
      titulo: v.descricao.replace(/\s+/g, ' ').trim(),
      resumo: `Votação nominal (${v.siglaOrgao}). ${Object.entries(contagem).map(([k, n]) => `${k}: ${n}`).join(' · ')}`,
      url: evento ? paginaEvento(evento) : `${CAM}/votacoes/${v.id}`, ocorreuEm: br(v.dataHoraRegistro),
      dados: { casa: 'camara', orgao: v.siglaOrgao, aprovada: v.aprovacao === 1, contagem },
      politicos: votos.filter(x => ids.has(String(x.deputado_.id)))
        .map(x => ({ id: ids.get(String(x.deputado_.id))!, papel: x.tipoVoto, metodo: 'id-oficial' as const })),
    };
  });
}

interface Proposicao { id: number; siglaTipo: string; numero: number; ano: number; ementa: string }
const TIPOS = ['PL', 'PLP', 'PEC', 'PDL'];   // requerimento e indicação são volume demais e pouco impacto pro feed

async function proposicoes(ids: Map<string, string>, inicio: string, fim: string): Promise<ItemNovo[]> {
  const props: Proposicao[] = [];
  for (let pagina = 1; pagina <= 20; pagina++) {
    const r = await fetchJson<{ dados: Proposicao[]; links: { rel: string }[] }>(
      `${CAM}/proposicoes?dataApresentacaoInicio=${inicio}&dataApresentacaoFim=${fim}&${TIPOS.map(t => `siglaTipo=${t}`).join('&')}&itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=id`);
    props.push(...r.dados);
    if (!r.links.some(l => l.rel === 'next')) break;
  }
  const res = await emLotes(props, 5, async p => {
    const [autores, det] = await Promise.all([
      fetchJson<{ dados: { uri: string; ordemAssinatura: number }[] }>(`${CAM}/proposicoes/${p.id}/autores`).catch(() => null),
      fetchJson<{ dados: { dataApresentacao: string } }>(`${CAM}/proposicoes/${p.id}`).catch(() => null),
    ]);
    return { p, autores: autores?.dados ?? [], data: det?.dados.dataApresentacao ?? null };
  });
  return res.map(({ p, autores, data }) => ({
    fonte: 'camara-proposicoes', chave: `camara-proposicao-${p.id}`, tipo: 'proposicao' as const,
    titulo: `${p.siglaTipo} ${p.numero}/${p.ano}: ${p.ementa.replace(/\s+/g, ' ').trim()}`,
    url: `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${p.id}`, ocorreuEm: br(data),
    dados: { casa: 'camara', siglaTipo: p.siglaTipo, autores: autores.length },
    politicos: autores.map(a => a.uri.match(/\/deputados\/(\d+)$/)?.[1]).filter((c): c is string => !!c && ids.has(c))
      .map((c, i) => ({ id: ids.get(c)!, papel: i === 0 ? 'autor' : 'coautor', metodo: 'id-oficial' as const })),
  }));
}

async function main() {
  const { inicio, fim } = janela(diasDoArgumento(3));
  console.log(`▶ Câmara ${inicio} → ${fim}`);
  const ids = await idsPorFonte('camara');
  for (const [nome, fn] of [['presença', presenca], ['votos', votos], ['projetos', proposicoes]] as const) {
    const itens = await fn(ids, inicio, fim);
    const r = await gravar(itens);
    console.log(`  ✓ ${nome}: ${r.itens} itens, ${r.ligacoes} ligações`);
  }
}

main().catch(e => { console.error('✗ coletor da Câmara falhou:', e.message); process.exit(1); });
