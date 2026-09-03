/* Puxa da API de Dados Abertos da Câmara:
   1. tamanho atual de cada bancada (partidos/{id}.status.totalMembros)
   2. deputados em exercício da(s) UF(s) de interesse
   3. votos nominais de cada votação mapeada em src/data/temas.json
   Saída: src/data/generated/camara.json (versionado — o build não bate na API). */
import { resolve } from 'node:path';
import { fetchJson, escreverJson, lerJson, agoraIso, RAIZ, GERADO } from './util';
import type { Tema } from '../src/lib/tipos';

const B = 'https://dadosabertos.camara.leg.br/api/v2';

interface Partido { id: number; sigla: string }
interface PartidoDet { sigla: string; status: { totalMembros: string; data: string; idLegislatura: string } }
interface Dep { id: number; nome: string; siglaPartido: string; siglaUf: string; urlFoto: string }
interface Voto { tipoVoto: string; deputado_: { id: number; nome: string; siglaPartido: string; siglaUf: string } }
interface VotDet { id: string; data: string; descricao: string; siglaOrgao: string; proposicoesAfetadas?: { siglaTipo: string; numero: number; ano: number }[] }

async function main() {
  console.log('▶ Câmara dos Deputados');
  const { temas } = lerJson<{ temas: Tema[] }>(resolve(RAIZ, 'src/data/temas.json'));

  // 1. bancadas
  const partidos = (await fetchJson<{ dados: Partido[] }>(`${B}/partidos?itens=100&ordem=ASC&ordenarPor=sigla`)).dados;
  const bancadas: Record<string, number> = {}; const bancadasData: Record<string, string> = {};
  for (const p of partidos) {
    const det = (await fetchJson<{ dados: PartidoDet }>(`${B}/partidos/${p.id}`)).dados;
    const n = Number(det.status?.totalMembros ?? 0);
    if (det.status?.idLegislatura && det.status.idLegislatura !== '57') continue; // partido sem bancada nesta legislatura
    bancadas[det.sigla] = n; bancadasData[det.sigla] = det.status?.data ?? '';
  }
  const total = Object.values(bancadas).reduce((a, b) => a + b, 0);
  console.log(`  bancadas: ${Object.keys(bancadas).length} partidos, ${total} cadeiras contadas`);

  // 2. todos os deputados em exercício (513) + detalhe com CPF e nome civil, pra casar com o TSE sem ambiguidade
  const todos = new Map<number, Dep>();
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await fetchJson<{ dados: Dep[]; links: { rel: string; href: string }[] }>(`${B}/deputados?itens=100&pagina=${pagina}&ordem=ASC&ordenarPor=nome`);
    for (const d of r.dados) todos.set(d.id, { id: d.id, nome: d.nome, siglaPartido: d.siglaPartido, siglaUf: d.siglaUf, urlFoto: d.urlFoto });
    if (!r.links.some(l => l.rel === 'next')) break;
  }
  console.log(`  ${todos.size} deputados em exercício; buscando CPF/nome civil…`);
  const ids = [...todos.keys()]; const detalhes = new Map<number, { cpf: string; nomeCivil: string }>();
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      try {
        const det = (await fetchJson<{ dados: { cpf?: string; nomeCivil?: string } }>(`${B}/deputados/${id}`, { tentativas: 3 })).dados;
        detalhes.set(id, { cpf: det.cpf ?? '', nomeCivil: det.nomeCivil ?? '' });
      } catch (e) { console.warn(`  ⚠ detalhe ${id}: ${(e as Error).message}`); }
    }
  }));
  const deputadosUF: Record<string, (Dep & { cpf: string; nomeCivil: string })[]> = {};
  for (const d of todos.values()) {
    const det = detalhes.get(d.id) ?? { cpf: '', nomeCivil: '' };
    (deputadosUF[d.siglaUf] ??= []).push({ ...d, ...det });
  }
  for (const uf of Object.keys(deputadosUF).sort()) deputadosUF[uf].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  console.log(`  por UF: ${Object.entries(deputadosUF).map(([u, l]) => `${u} ${l.length}`).join(' · ')}`);

  // 3. votações nominais mapeadas
  const votacoes: Record<string, { id: string; data: string; descricao: string; orgao: string; proposicao?: string; totais: Record<string, number>; votos: Record<string, string>; nomes: Record<string, { nome: string; partido: string; uf: string }> }> = {};
  const refs = temas.flatMap(t => t.votacoes.filter(v => v.casa === 'camara'));
  for (const ref of refs) {
    const id = ref.id!;
    const det = (await fetchJson<{ dados: VotDet }>(`${B}/votacoes/${id}`)).dados;
    const votos = (await fetchJson<{ dados: Voto[] }>(`${B}/votacoes/${id}/votos`)).dados;
    const totais: Record<string, number> = {}; const mapa: Record<string, string> = {}; const nomes: typeof votacoes[string]['nomes'] = {};
    for (const v of votos) {
      totais[v.tipoVoto] = (totais[v.tipoVoto] ?? 0) + 1;
      mapa[String(v.deputado_.id)] = v.tipoVoto;
      nomes[String(v.deputado_.id)] = { nome: v.deputado_.nome, partido: v.deputado_.siglaPartido, uf: v.deputado_.siglaUf };
    }
    const prop = det.proposicoesAfetadas?.[0];
    votacoes[id] = { id, data: det.data, descricao: det.descricao, orgao: det.siglaOrgao, proposicao: prop ? `${prop.siglaTipo} ${prop.numero}/${prop.ano}` : undefined, totais, votos: mapa, nomes };
    console.log(`  ${id} (${det.data}): ${votos.length} votos — ${JSON.stringify(totais)}`);
    if (!votos.length) console.warn(`  ⚠ ${id} não tem votos nominais registrados — confira o mapeamento em temas.json`);
  }

  escreverJson(resolve(GERADO, 'camara.json'), { atualizadoEm: agoraIso(), fonte: B, bancadas, bancadasData, deputadosUF, votacoes });
}
main().catch(e => { console.error('✗ fetch-camara falhou:', e); process.exit(1); });
