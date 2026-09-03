/* ==========================================================================
   MOTOR DE CÁLCULO — funções puras, sem DOM, testadas em tests/motor.test.ts
   ========================================================================== */
import type {
  Campo, Candidato, Cargo, CargoId, Casa, Dataset, EstadoEleitor, Lado, Resposta, Tema
} from './tipos';

/** concordância entre duas posições: 1 = igual, .5 = uma indefinida, 0 = oposta, null = fora da conta */
export function concord(a: Lado | Resposta | undefined, b: Lado | Resposta | undefined): number | null {
  if (!a || !b || a === 'N' || b === 'N') return null;
  if (a === b) return 1;
  if (a === 'D' || b === 'D') return 0.5;
  return 0;
}

export function posicaoDe(c: Candidato, temaId: string): Lado {
  return c.posicoes[temaId]?.lado ?? 'D';
}

/* ---- EIXO CAMISA: você × candidato ---- */
export function scoreCamisa(c: Candidato, respostas: Record<string, Resposta>, decisivas: Set<string>, temas: Tema[]): number | null {
  let soma = 0, total = 0;
  for (const t of temas) {
    const minha = respostas[t.id];
    if (!minha || minha === 'N') continue;
    const k = concord(minha, posicaoDe(c, t.id));
    if (k === null) continue;
    const peso = decisivas.has(t.id) ? 3 : 1;
    soma += k * peso; total += peso;
  }
  return total ? Math.round(soma / total * 100) : null;
}

/* ---- EIXO BOLSO: só as pautas que a SUA vida ativa ----
   Se o seu perfil aponta lados opostos na mesma pauta, ela não entra no score — vira conflito declarado. */
export interface PautaAtiva { tema: Tema; lado: 'F' | 'C' }
export interface PautaConflito { tema: Tema; lados: { perfil: string; lado: Lado }[] }
export function pautasDoBolso(perfil: Record<string, string>, temas: Tema[]): { ativas: PautaAtiva[]; conflitos: PautaConflito[] } {
  const marcados = Object.values(perfil);
  const ativas: PautaAtiva[] = [], conflitos: PautaConflito[] = [];
  for (const t of temas) {
    const lados = marcados.map(m => t.impacto[m]).filter(Boolean) as Lado[];
    if (!lados.length) continue;
    if (lados.every(l => l === lados[0])) ativas.push({ tema: t, lado: lados[0] as 'F' | 'C' });
    else conflitos.push({ tema: t, lados: marcados.filter(m => t.impacto[m]).map(m => ({ perfil: m, lado: t.impacto[m] })) });
  }
  return { ativas, conflitos };
}
export interface ScoreBolso { score: number; defende: number; total: number }
export function scoreBolso(c: Candidato, ativas: PautaAtiva[]): ScoreBolso | null {
  if (!ativas.length) return null;
  let acertos = 0;
  for (const a of ativas) {
    const dele = posicaoDe(c, a.tema.id);
    if (dele === a.lado) acertos += 1;
    else if (dele === 'D') acertos += 0.5;
  }
  return { score: Math.round(acertos / ativas.length * 100), defende: Math.round(acertos * 10) / 10, total: ativas.length };
}

/* ---- COERÊNCIA: concordância par a par entre os escalados ---- */
export interface Escalado { cargo: Cargo; candidato: Candidato }
export interface GolContra { tema: Tema; a: Escalado; b: Escalado; pa: Lado; pb: Lado }
export function calcCoerencia(escalados: Escalado[], temas: Tema[], decisivas: Set<string>): { coerencia: number; gols: GolContra[] } {
  const pautas = decisivas.size ? temas.filter(t => decisivas.has(t.id)) : temas;
  let soma = 0, n = 0; const gols: GolContra[] = [];
  for (let i = 0; i < escalados.length; i++) for (let j = i + 1; j < escalados.length; j++) {
    const A = escalados[i], B = escalados[j];
    for (const t of pautas) {
      const pa = posicaoDe(A.candidato, t.id), pb = posicaoDe(B.candidato, t.id);
      const k = concord(pa, pb);
      if (k === null) continue;
      soma += k; n++;
      if (k === 0) gols.push({ tema: t, a: A, b: B, pa, pb });
    }
  }
  return { coerencia: n ? Math.round(soma / n * 100) : 0, gols };
}

/* ---- PESO: quanto do quórum o time cobre ---- */
export interface DetalhePeso { cargo: CargoId; k: string; v: number; cadeiras: number; quorum: number; porCampo: boolean; partido: string; campo?: Campo; casa: Casa }
export function forcaDoCampo(bancadas: Record<string, number>, partidos: Record<string, { campo: Campo | null }>): Record<Campo, number> {
  const out: Record<Campo, number> = { esq: 0, centro: 0, dir: 0 };
  for (const [sigla, n] of Object.entries(bancadas)) { const c = partidos[sigla]?.campo; if (c) out[c] += n; }
  return out;
}
const pct = (x: number) => Math.max(0, Math.min(100, Math.round(x * 100)));
export function calcPeso(escalados: Escalado[], ds: Pick<Dataset, 'bancadas' | 'quorum' | 'partidos' | 'cargos'>): { peso: number; detalhe: DetalhePeso[] } {
  const detalhe: DetalhePeso[] = []; let peso = 0;
  for (const e of escalados) {
    const casa = e.cargo.casa, q = ds.quorum[casa], banc = ds.bancadas[casa];
    let cadeiras: number, campo: Campo | undefined;
    if (e.cargo.porCampo) { campo = ds.partidos[e.candidato.partido]?.campo ?? undefined; cadeiras = campo ? forcaDoCampo(banc, ds.partidos)[campo] : 0; }
    else cadeiras = banc[e.candidato.partido] ?? 0;
    const v = pct(cadeiras / q);
    detalhe.push({ cargo: e.cargo.id, k: e.cargo.nome, v, cadeiras, quorum: q, porCampo: e.cargo.porCampo, partido: e.candidato.partido, campo, casa });
    peso += v * e.cargo.pesoNoPlacar;
  }
  return { peso: Math.round(peso), detalhe };
}

/* ---- VEREDITO 2x2 e FORÇA (média harmônica) ---- */
export interface Veredito { t: string; c: 'v-bom' | 'v-medio' | 'v-ruim'; d: string; chave: 'campeao' | 'torcida' | 'rachado' | 'rebaixado' }
export function veredito(coer: number, peso: number): Veredito {
  const C = coer >= 55, P = peso >= 55;
  if (C && P) return { chave: 'campeao', t: 'TIME CAMPEÃO', c: 'v-bom', d: 'Seu time joga junto e tem cadeira pra transformar acordo em lei. É raro. Confira o gol contra mesmo assim.' };
  if (C && !P) return { chave: 'torcida', t: 'TORCIDA ORGANIZADA', c: 'v-medio', d: 'Vocês concordam em quase tudo — e não aprovam quase nada. Seu time é coerente e impotente: falta cadeira pra chegar no quórum.' };
  if (!C && P) return { chave: 'rachado', t: 'ELENCO CARO, TIME RACHADO', c: 'v-medio', d: 'Você escalou gente com poder de verdade. O problema é que esse poder vai ser gasto na briga entre eles.' };
  return { chave: 'rebaixado', t: 'TIME REBAIXADO', c: 'v-ruim', d: 'Seu time se contradiz e ainda não tem peso pra aprovar nada. Os cinco votos estão trabalhando um contra o outro.' };
}
export function forca(coer: number, peso: number): number {
  return (coer + peso) ? Math.round(2 * coer * peso / (coer + peso)) : 0;
}

/* ---- PLACAR COMPLETO ---- */
export interface LinhaTime { e: Escalado; camisa: number | null; bolso: ScoreBolso | null }
export interface Placar {
  forca: number; coerencia: number; peso: number; veredito: Veredito;
  gols: GolContra[]; detalhePeso: DetalhePeso[]; linhas: LinhaTime[];
  divergencia: { e: Escalado; camisa: number; bolso: ScoreBolso; d: number } | null;
  bolso: ReturnType<typeof pautasDoBolso>;
  escalados: Escalado[]; decisivas: string[];
}
export function escalar(st: EstadoEleitor, ds: Dataset): Escalado[] {
  const out: Escalado[] = [];
  for (const cargo of ds.cargos) {
    const id = st.time[cargo.id]; if (!id) continue;
    const candidato = cargo.candidatos.find(c => c.id === id); if (!candidato) continue;
    out.push({ cargo, candidato });
  }
  return out;
}
export function calcularPlacar(st: EstadoEleitor, ds: Dataset): Placar | null {
  const escalados = escalar(st, ds);
  if (escalados.length !== ds.cargos.length) return null;
  const decisivas = new Set(st.decisivas);
  const { coerencia, gols } = calcCoerencia(escalados, ds.temas, decisivas);
  const { peso, detalhe } = calcPeso(escalados, ds);
  const bolso = pautasDoBolso(st.perfil, ds.temas);
  // dedupe gols (mesmo tema + mesmo par)
  const unicos: GolContra[] = [];
  for (const g of gols) if (!unicos.some(u => u.tema.id === g.tema.id && u.a.cargo.id === g.a.cargo.id && u.b.cargo.id === g.b.cargo.id)) unicos.push(g);
  const linhas: LinhaTime[] = escalados.map(e => ({ e, camisa: scoreCamisa(e.candidato, st.respostas, decisivas, ds.temas), bolso: scoreBolso(e.candidato, bolso.ativas) }));
  // maior distância entre camisa e bolso no time (só vira destaque se ≥ 15 pontos)
  let divergencia: Placar['divergencia'] = null;
  for (const l of linhas) {
    if (l.camisa === null || !l.bolso) continue;
    const d = l.camisa - l.bolso.score;
    if (divergencia === null || Math.abs(d) > Math.abs(divergencia.d)) divergencia = { e: l.e, camisa: l.camisa, bolso: l.bolso, d };
  }
  if (divergencia !== null && Math.abs(divergencia.d) < 15) divergencia = null;
  return { forca: forca(coerencia, peso), coerencia, peso, veredito: veredito(coerencia, peso), gols: unicos, detalhePeso: detalhe, linhas, divergencia, bolso, escalados, decisivas: [...decisivas] };
}

/* ==========================================================================
   LEITURA DA FORÇA — por que o número é esse e o que mexe nele
   ========================================================================== */
export interface Leitura {
  gargalo: 'coerencia' | 'peso' | null;            // eixo que mais segura a força (null = os dois andam juntos)
  seCoerencia100: number;                          // força se a coerência fosse 100 e o peso ficasse como está
  sePeso100: number;                               // força se o peso fosse 100 e a coerência ficasse como está
  ganho10: { coerencia: number; peso: number };    // quanto a força sobe com +10 pontos em cada eixo, hoje
  vazaPeso: (DetalhePeso & { pesoNoPlacar: number; entrega: number; perdido: number }) | null;  // cargo que mais deixa peso na mesa
  golsPorCargo: { cargo: Cargo; n: number }[];     // quem mais aparece nos gols contra (só quem aparece)
}
export const GARGALO_MIN = 10;                     // diferença mínima entre os eixos pra apontar um gargalo
export function leituraDaForca(p: Pick<Placar, 'coerencia' | 'peso' | 'detalhePeso' | 'gols' | 'escalados'>): Leitura {
  const { coerencia: c, peso: w } = p;
  const gargalo = Math.abs(c - w) < GARGALO_MIN ? null : c < w ? 'coerencia' : 'peso';
  const ganho10 = { coerencia: forca(Math.min(100, c + 10), w) - forca(c, w), peso: forca(c, Math.min(100, w + 10)) - forca(c, w) };
  let vazaPeso: Leitura['vazaPeso'] = null;
  for (const d of p.detalhePeso) {
    const cargo = p.escalados.find(e => e.cargo.id === d.cargo)?.cargo; if (!cargo) continue;
    const entrega = Math.round(d.v * cargo.pesoNoPlacar), perdido = Math.round((100 - d.v) * cargo.pesoNoPlacar);
    if (perdido > 0 && (!vazaPeso || perdido > vazaPeso.perdido)) vazaPeso = { ...d, pesoNoPlacar: cargo.pesoNoPlacar, entrega, perdido };
  }
  const conta = new Map<CargoId, number>();
  for (const g of p.gols) for (const e of [g.a, g.b]) conta.set(e.cargo.id, (conta.get(e.cargo.id) ?? 0) + 1);
  const golsPorCargo = p.escalados.map(e => ({ cargo: e.cargo, n: conta.get(e.cargo.id) ?? 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  return { gargalo, seCoerencia100: forca(100, w), sePeso100: forca(c, 100), ganho10, vazaPeso, golsPorCargo };
}

/* ==========================================================================
   SUGESTÕES — que troca de UM jogador deixa o time mais forte?
   Mantém os outros quatro, recalcula o placar inteiro e só considera quem veste a camisa
   da pessoa tanto quanto o atual (tolerância de TOLERANCIA_CAMISA pontos). Não é recomendação
   de voto: é o que o placar faria. Candidatos do mesmo partido com posições idênticas têm o
   mesmo efeito, então entram como um grupo (`iguais`) com um representante.
   ========================================================================== */
export const TOLERANCIA_CAMISA = 5;
export interface Sugestao {
  cargo: Cargo;
  de: Candidato;
  para: Candidato;                                 // representante do grupo (mais votos nominais, depois nome)
  iguais: number;                                  // outros candidatos do mesmo partido com as mesmas posições
  placar: Placar;
  delta: { forca: number; coerencia: number; peso: number; gols: number };
  camisa: { de: number | null; para: number | null };
}
function assinatura(c: Candidato, temas: Tema[]): string { return c.partido + '|' + temas.map(t => posicaoDe(c, t.id)).join(''); }
export function sugerirTrocas(st: EstadoEleitor, ds: Dataset, atual: Placar, tolerancia = TOLERANCIA_CAMISA): Sugestao[] {
  const decisivas = new Set(st.decisivas);
  const out: Sugestao[] = [];
  for (const cargo of ds.cargos) {
    const de = cargo.candidatos.find(c => c.id === st.time[cargo.id]); if (!de) continue;
    const camisaDe = scoreCamisa(de, st.respostas, decisivas, ds.temas);
    const grupos = new Map<string, Candidato[]>();
    for (const c of cargo.candidatos) { if (c.id === de.id) continue; const k = assinatura(c, ds.temas); grupos.set(k, [...(grupos.get(k) ?? []), c]); }
    let melhor: Sugestao | null = null;
    for (const grupo of grupos.values()) {
      const para = [...grupo].sort((a, b) => b.nominais - a.nominais || a.nome.localeCompare(b.nome))[0];
      const camisaPara = scoreCamisa(para, st.respostas, decisivas, ds.temas);
      if (camisaDe !== null && camisaPara !== null && camisaPara < camisaDe - tolerancia) continue;
      const placar = calcularPlacar({ ...st, time: { ...st.time, [cargo.id]: para.id } }, ds); if (!placar) continue;
      const delta = { forca: placar.forca - atual.forca, coerencia: placar.coerencia - atual.coerencia, peso: placar.peso - atual.peso, gols: placar.gols.length - atual.gols.length };
      if (delta.forca <= 0) continue;
      const s: Sugestao = { cargo, de, para, iguais: grupo.length - 1, placar, delta, camisa: { de: camisaDe, para: camisaPara } };
      if (!melhor || delta.forca > melhor.delta.forca || (delta.forca === melhor.delta.forca && (delta.gols < melhor.delta.gols || (delta.gols === melhor.delta.gols && (camisaPara ?? 0) > (melhor.camisa.para ?? 0))))) melhor = s;
    }
    if (melhor) out.push(melhor);
  }
  return out.sort((a, b) => b.delta.forca - a.delta.forca || a.delta.gols - b.delta.gols);
}
