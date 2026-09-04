/* Monta um dataset por UF em public/dados/<UF>.json (o app carrega só o do estado da pessoa)
   e um índice nacional em src/data/generated/indice.json (landing e /metodo).
   Junta: temas + partidos + cargos + bancadas (Câmara/Senado via API; assembleias = eleitos 2022 do TSE)
        + candidatos do TSE 2026, e resolve a posição de quem tem mandato pelo voto nominal.
   O resto (estimativa partidária) é derivado no cliente — src/lib/dataset.ts — pra o JSON viajar leve. */
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { lerJson, escreverJson, agoraIso, RAIZ, GERADO } from './util';
import { normalizarNome, similaridadeNome } from '../src/lib/nomes';
import { capitalizarNome } from '../src/lib/dataset';
import type { CandidatoBruto, CargoId, DatasetBruto, Lado, PartidoInfo, Tema } from '../src/lib/tipos';

interface CamaraGen { atualizadoEm: string; bancadas: Record<string, number>; deputadosUF: Record<string, { id: number; nome: string; siglaPartido: string; siglaUf: string; cpf: string; nomeCivil: string }[]>; votacoes: Record<string, { data: string; votos: Record<string, string>; nomes: Record<string, { nome: string; partido: string; uf: string }> }> }
interface SenadoGen { atualizadoEm: string; bancadas: Record<string, number>; senadores: { codigo: number; nome: string; nomeCompleto: string; partido: string; uf: string }[]; votacoes: Record<string, { data: string; identificacao: string; votos: Record<string, string> }> }
interface TseGen { atualizadoEm: string; dataGeracaoTse: string; candidatos: { sq: string; uf: string; cargo: CargoId; numero: string; nome: string; nomeUrna: string; cpf: string; partido: string; situacao: string }[] }
interface AssGen { atualizadoEm: string; aviso: string; assembleias: Record<string, { cadeiras: number; bancadas: Record<string, number>; federais: number }> }

const PREP: Record<string, string> = { AC: 'do Acre', AL: 'de Alagoas', AM: 'do Amazonas', AP: 'do Amapá', BA: 'da Bahia', CE: 'do Ceará', DF: 'do Distrito Federal', ES: 'do Espírito Santo', GO: 'de Goiás', MA: 'do Maranhão', MG: 'de Minas Gerais', MS: 'de Mato Grosso do Sul', MT: 'de Mato Grosso', PA: 'do Pará', PB: 'da Paraíba', PE: 'de Pernambuco', PI: 'do Piauí', PR: 'do Paraná', RJ: 'do Rio de Janeiro', RN: 'do Rio Grande do Norte', RO: 'de Rondônia', RR: 'de Roraima', RS: 'do Rio Grande do Sul', SC: 'de Santa Catarina', SE: 'de Sergipe', SP: 'de São Paulo', TO: 'do Tocantins' };

function main() {
  const { temas } = lerJson<{ temas: Tema[] }>(resolve(RAIZ, 'src/data/temas.json'));
  const partidosJson = lerJson<{ ordemTemas: string[]; partidos: Record<string, PartidoInfo> }>(resolve(RAIZ, 'src/data/partidos.json'));
  const cargosJson = lerJson<{ quorum: { camara: number; senado: number }; cadeiras: { camara: number; senado: number }; cargos: { id: CargoId; nome: string; curto: string; casa: 'camara' | 'senado' | 'assembleia'; porCampo: boolean; pesoNoPlacar: number; abrangencia: 'BR' | 'UF'; vagas?: number }[] }>(resolve(RAIZ, 'src/data/cargos.json'));
  const { ufs } = lerJson<{ ufs: { sigla: string; nome: string; casaEstadual: string }[] }>(resolve(RAIZ, 'src/data/ufs.json'));
  const camara = lerJson<CamaraGen>(resolve(GERADO, 'camara.json'));
  const senado = lerJson<SenadoGen>(resolve(GERADO, 'senado.json'));
  const tse = lerJson<TseGen>(resolve(GERADO, 'tse-2026.json'));
  const ass = lerJson<AssGen>(resolve(GERADO, 'assembleias.json'));
  const P = partidosJson.partidos;
  const SAIDA = resolve(RAIZ, 'public/dados'); mkdirSync(SAIDA, { recursive: true });

  /* ---- índices pra casar candidato ↔ mandato ---- */
  const depPorCpf = new Map<string, { id: number; nome: string; uf: string; partido: string }>();
  const depPorNome: { id: number; nome: string; nomeCivil: string; uf: string; partido: string }[] = [];
  for (const lista of Object.values(camara.deputadosUF)) for (const d of lista) {
    if (d.cpf) depPorCpf.set(d.cpf.replace(/\D/g, ''), { id: d.id, nome: d.nome, uf: d.siglaUf, partido: d.siglaPartido });
    depPorNome.push({ id: d.id, nome: d.nome, nomeCivil: d.nomeCivil, uf: d.siglaUf, partido: d.siglaPartido });
  }
  const exDeputados = new Map<number, { nome: string; partido: string; uf: string }>();   // quem aparece em votação mas não está mais na Casa
  for (const v of Object.values(camara.votacoes)) for (const [id, n] of Object.entries(v.nomes)) if (!depPorNome.some(d => d.id === Number(id))) exDeputados.set(Number(id), n);
  const senadores = senado.senadores;

  const avisos: string[] = [];
  function acharMandato(c: TseGen['candidatos'][number]): CandidatoBruto['mandato'] | undefined {
    const cpf = c.cpf.replace(/\D/g, '');
    const porCpf = cpf ? depPorCpf.get(cpf) : undefined;
    if (porCpf) return { casa: 'camara', id: porCpf.id, nome: porCpf.nome };
    const nomeC = normalizarNome(c.nome);
    // senadores: nome completo idêntico, ou nome parlamentar contido + mesma UF (presidenciáveis podem ser de qualquer UF)
    const sen = senadores.filter(s => normalizarNome(s.nomeCompleto) === nomeC || (similaridadeNome(c.nomeUrna, s.nome) >= 0.8 && (c.uf === 'BR' || s.uf === c.uf) && s.partido === c.partido));
    if (sen.length === 1) return { casa: 'senado', id: sen[0].codigo, nome: sen[0].nome };
    if (sen.length > 1) avisos.push(`nome ambíguo no Senado: ${c.nome} (${c.uf}) → ${sen.map(s => s.nome).join(' | ')}`);
    // deputados sem CPF batido: nome civil idêntico e mesma UF
    const dep = depPorNome.filter(d => d.nomeCivil && normalizarNome(d.nomeCivil) === nomeC && d.uf === c.uf);
    if (dep.length === 1) return { casa: 'camara', id: dep[0].id, nome: dep[0].nome };
    // ex-deputados que votaram nas pautas: nome parlamentar idêntico ao nome de urna + mesma UF + mesmo partido
    const ex = [...exDeputados].filter(([, d]) => d.uf === c.uf && d.partido === c.partido && similaridadeNome(c.nomeUrna, d.nome) >= 1);
    if (ex.length === 1) return { casa: 'camara', id: ex[0][0], nome: ex[0][1].nome };
    return undefined;
  }

  function ladoDoVoto(voto: string | undefined, ladoSim: 'F' | 'C'): Lado | null {
    if (!voto) return null;
    const v = voto.toLowerCase();
    if (v === 'sim') return ladoSim;
    if (v === 'não' || v === 'nao') return ladoSim === 'F' ? 'C' : 'F';
    return null; // abstenção, obstrução, art. 17, ausência, licença…
  }
  function votosDe(mandato: NonNullable<CandidatoBruto['mandato']>): CandidatoBruto['votos'] {
    const out: NonNullable<CandidatoBruto['votos']> = {};
    for (const t of temas) {
      const sinais: { lado: Lado; rotulo: string; voto: string }[] = [];
      for (const ref of t.votacoes) {
        if (ref.casa !== mandato.casa) continue;
        const votos = ref.casa === 'camara' ? camara.votacoes[ref.id!]?.votos : senado.votacoes[String(ref.codigoSessaoVotacao)]?.votos;
        const voto = votos?.[String(mandato.id)];
        const lado = ladoDoVoto(voto, ref.ladoSim);
        if (lado) sinais.push({ lado, rotulo: ref.rotulo, voto: voto! });
      }
      if (!sinais.length) continue;
      const f = sinais.filter(s => s.lado === 'F').length, k = sinais.length - f;
      const lado: Lado = f > k ? 'F' : k > f ? 'C' : 'D';
      const detalhe = sinais.map(s => `votou ${s.voto.toUpperCase()} em ${s.rotulo}`).join(' · ');
      out[t.id] = { lado, detalhe: lado === 'D' ? `votou dos dois lados: ${detalhe}` : detalhe };
    }
    return Object.keys(out).length ? out : undefined;
  }

  /* ---- candidatos (todos, uma vez) ---- */
  const todos: CandidatoBruto[] = tse.candidatos.map(c => {
    const mandato = acharMandato(c);
    const b: CandidatoBruto = { id: c.sq, nome: capitalizarNome(c.nomeUrna || c.nome), partido: c.partido, cargo: c.cargo, uf: c.uf, numero: c.numero };
    if (mandato) { b.mandato = mandato; const v = votosDe(mandato); if (v) b.votos = v; }
    return b;
  });
  const semPartido = [...new Set(todos.filter(c => !P[c.partido]).map(c => c.partido))];
  if (semPartido.length) console.warn(`  ⚠ partidos sem cadastro em partidos.json (entram como 'D' e sem campo): ${semPartido.join(', ')}`);
  for (const a of avisos) console.warn(`  ⚠ ${a}`);
  const presidenciais = todos.filter(c => c.cargo === 'presidente');
  console.log(`  ${todos.length} candidatos · ${todos.filter(c => c.mandato).length} com mandato casado · ${todos.filter(c => c.votos).length} com voto nominal · ${presidenciais.length} presidenciáveis`);

  const partidos: DatasetBruto['partidos'] = {}; for (const [s, p] of Object.entries(P)) partidos[s] = { nome: p.nome, campo: p.campo, estimativa: p.estimativa, ...(p.semOrientacao ? { semOrientacao: true } : {}) };
  const temNominal = (c: CandidatoBruto, temaId: string) => !!c.votos?.[temaId];
  const ordenar = (a: CandidatoBruto, b: CandidatoBruto) => a.nome.localeCompare(b.nome, 'pt-BR');

  /* ---- um dataset por UF ---- */
  const indice: { uf: string; nome: string; candidatos: number; federais: number; estaduais: number; comMandato: number; cadeirasAssembleia: number; vagasFederais: number; bancadasAssembleia: Record<string, number> }[] = [];
  const coberturaNacional = temas.map(t => ({ temaId: t.id, nominal: todos.filter(c => temNominal(c, t.id)).length, estimativa: todos.filter(c => !temNominal(c, t.id)).length }));
  for (const uf of ufs) {
    const a = ass.assembleias[uf.sigla];
    if (!a) { console.warn(`  ⚠ ${uf.sigla}: sem composição de assembleia (2022) — pulado`); continue; }
    const daUf = todos.filter(c => c.uf === uf.sigla);
    const cargos: DatasetBruto['cargos'] = cargosJson.cargos.map(def => {
      const lista = (def.id === 'presidente' ? presidenciais : daUf.filter(c => c.cargo === def.id)).sort(ordenar);
      const nominais = lista.filter(c => c.votos).length;
      let nome = def.nome, curto = def.curto;
      if (def.id === 'governador') nome = `Governador ${PREP[uf.sigla]}`;
      if (def.id === 'senador') nome = `Senador ${uf.sigla === 'DF' ? 'pelo Distrito Federal' : 'por ' + uf.nome}`;
      if (def.id === 'estadual' && uf.sigla === 'DF') { nome = 'Deputado distrital'; curto = 'deputado distrital'; }
      let meta = `${lista.length} candidatos`;
      if (def.id === 'presidente') meta = `${lista.length} candidaturas registradas no país`;
      if (def.id === 'governador') meta = `${lista.length} candidatos ao governo`;
      if (def.id === 'senador') meta = `${def.vagas ?? 1} vagas · ${lista.length} candidatos`;
      if (def.id === 'federal') meta = `${a.federais} vagas · ${lista.length} candidatos`;
      if (def.id === 'estadual') meta = `${a.cadeiras} cadeiras · ${lista.length} candidatos`;
      if (nominais) meta += ` · ${nominais} com voto nominal`;
      return { ...def, vagas: def.vagas ?? 1, nome, curto, meta, candidatos: lista };
    });
    const todosDaUf = cargos.flatMap(c => c.candidatos);
    const cobertura = temas.map(t => ({ temaId: t.id, nominal: todosDaUf.filter(c => temNominal(c, t.id)).length, estimativa: todosDaUf.filter(c => !temNominal(c, t.id)).length }));
    const quorumAss = Math.floor(a.cadeiras / 2) + 1;
    const ds: DatasetBruto = {
      uf: uf.sigla, nomeUf: uf.nome, casaEstadual: uf.casaEstadual, geradoEm: agoraIso(), dataTse: tse.dataGeracaoTse,
      temas, ordemTemas: partidosJson.ordemTemas, cargos,
      bancadas: { camara: camara.bancadas, senado: senado.bancadas, assembleia: a.bancadas },
      quorum: { camara: cargosJson.quorum.camara, senado: cargosJson.quorum.senado, assembleia: quorumAss },
      cadeiras: { camara: cargosJson.cadeiras.camara, senado: cargosJson.cadeiras.senado, assembleia: a.cadeiras },
      partidos,
      fontes: [
        { rotulo: 'Quem é candidato', detalhe: `TSE — Portal de Dados Abertos, consulta_cand_2026, gerado em ${tse.dataGeracaoTse} (registros ainda em julgamento; inaptos, renúncias e indeferidos excluídos)` },
        { rotulo: 'Bancadas na Câmara', detalhe: `API de Dados Abertos da Câmara, ${camara.atualizadoEm.slice(0, 10)} — ${Object.values(camara.bancadas).reduce((x, y) => x + y, 0)} de 513 cadeiras` },
        { rotulo: 'Bancadas no Senado', detalhe: `API de Dados Abertos do Senado, ${senado.atualizadoEm.slice(0, 10)} — ${senado.senadores.length} senadores em exercício` },
        { rotulo: `Bancadas na ${uf.casaEstadual}`, detalhe: `composição eleita em 2022 (TSE, consulta_cand_2022) — ${a.cadeiras} cadeiras; não reflete trocas de partido posteriores` },
        { rotulo: 'Votos nominais', detalhe: `${Object.keys(camara.votacoes).length} votações da Câmara e ${Object.keys(senado.votacoes).length} do Senado, listadas em /metodo` }
      ],
      cobertura,
      stats: { candidatos: todosDaUf.length, federais: cargos.find(c => c.id === 'federal')!.candidatos.length, estaduais: cargos.find(c => c.id === 'estadual')!.candidatos.length, comMandato: todosDaUf.filter(c => c.mandato).length }
    };
    escreverJson(resolve(SAIDA, `${uf.sigla}.json`), ds);
    indice.push({ uf: uf.sigla, nome: uf.nome, ...ds.stats, cadeirasAssembleia: a.cadeiras, vagasFederais: a.federais, bancadasAssembleia: a.bancadas });
  }
  escreverJson(resolve(GERADO, 'indice.json'), {
    geradoEm: agoraIso(), dataTse: tse.dataGeracaoTse, ufs: indice,
    nacional: { candidatos: todos.length, federais: todos.filter(c => c.cargo === 'federal').length, estaduais: todos.filter(c => c.cargo === 'estadual').length, comMandato: todos.filter(c => c.mandato).length, comVotoNominal: todos.filter(c => c.votos).length, presidenciais: presidenciais.length, partidosCamara: Object.values(camara.bancadas).filter(n => n > 0).length },
    cobertura: coberturaNacional, bancadas: { camara: camara.bancadas, senado: senado.bancadas }, atualizacoes: { camara: camara.atualizadoEm, senado: senado.atualizadoEm, tse: tse.atualizadoEm, assembleias: ass.atualizadoEm }, avisoAssembleias: ass.aviso
  });
  console.log('  cobertura nacional (nominal/estimativa): ' + coberturaNacional.map(c => `${c.temaId} ${c.nominal}/${c.estimativa}`).join(' · '));
}
main();
