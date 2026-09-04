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
export interface Escalado { cargo: Cargo; candidato: Candidato; vaga: number }   // vaga: 0 na maioria; 0 ou 1 pros dois senadores
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
export interface DetalhePeso { cargo: CargoId; vaga: number; nome: string; k: string; v: number; cadeiras: number; quorum: number; porCampo: boolean; partido: string; campo?: Campo; casa: Casa; pesoNoPlacar: number }   // pesoNoPlacar: desta vaga (cargo ÷ vagas)
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
    const v = pct(cadeiras / q), pesoNoPlacar = e.cargo.pesoNoPlacar / (e.cargo.vagas ?? 1);   // o peso do cargo é dividido entre as vagas
    detalhe.push({ cargo: e.cargo.id, vaga: e.vaga, nome: e.candidato.nome, k: e.cargo.nome, v, cadeiras, quorum: q, porCampo: e.cargo.porCampo, partido: e.candidato.partido, campo, casa, pesoNoPlacar });
    peso += v * pesoNoPlacar;
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
  return { chave: 'rebaixado', t: 'TIME REBAIXADO', c: 'v-ruim', d: 'Seu time se contradiz e ainda não tem peso pra aprovar nada. Seus votos estão trabalhando um contra o outro.' };
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
/** quantas pessoas o time completo tem (5 cargos, senador com 2 vagas = 6) */
export function totalVagas(ds: Pick<Dataset, 'cargos'>): number { return ds.cargos.reduce((a, c) => a + (c.vagas ?? 1), 0); }
export function escalar(st: EstadoEleitor, ds: Dataset): Escalado[] {
  const out: Escalado[] = [];
  for (const cargo of ds.cargos) for (let vaga = 0; vaga < (cargo.vagas ?? 1); vaga++) {
    const id = st.time[cargo.id]?.[vaga]; if (!id) continue;
    const candidato = cargo.candidatos.find(c => c.id === id); if (!candidato) continue;
    out.push({ cargo, candidato, vaga });
  }
  return out;
}
export function calcularPlacar(st: EstadoEleitor, ds: Dataset): Placar | null {
  const escalados = escalar(st, ds);
  if (escalados.length !== totalVagas(ds)) return null;
  const decisivas = new Set(st.decisivas);
  const { coerencia, gols } = calcCoerencia(escalados, ds.temas, decisivas);
  const { peso, detalhe } = calcPeso(escalados, ds);
  const bolso = pautasDoBolso(st.perfil, ds.temas);
  // dedupe gols (mesmo tema + mesmo par)
  const unicos: GolContra[] = [];
  for (const g of gols) if (!unicos.some(u => u.tema.id === g.tema.id && u.a.candidato.id === g.a.candidato.id && u.b.candidato.id === g.b.candidato.id)) unicos.push(g);
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
  vazaPeso: (DetalhePeso & { entrega: number; perdido: number }) | null;  // vaga que mais deixa peso na mesa
  golsPorJogador: { e: Escalado; n: number }[];   // quem mais aparece nos gols contra (só quem aparece)
}
export const GARGALO_MIN = 10;                     // diferença mínima entre os eixos pra apontar um gargalo
export function leituraDaForca(p: Pick<Placar, 'coerencia' | 'peso' | 'detalhePeso' | 'gols' | 'escalados'>): Leitura {
  const { coerencia: c, peso: w } = p;
  const gargalo = Math.abs(c - w) < GARGALO_MIN ? null : c < w ? 'coerencia' : 'peso';
  const ganho10 = { coerencia: forca(Math.min(100, c + 10), w) - forca(c, w), peso: forca(c, Math.min(100, w + 10)) - forca(c, w) };
  let vazaPeso: Leitura['vazaPeso'] = null;
  for (const d of p.detalhePeso) {
    const entrega = Math.round(d.v * d.pesoNoPlacar), perdido = Math.round((100 - d.v) * d.pesoNoPlacar);
    if (perdido > 0 && (!vazaPeso || perdido > vazaPeso.perdido)) vazaPeso = { ...d, entrega, perdido };
  }
  const conta = new Map<string, number>();   // por candidato: ninguém ocupa duas vagas
  for (const g of p.gols) for (const e of [g.a, g.b]) conta.set(e.candidato.id, (conta.get(e.candidato.id) ?? 0) + 1);
  const golsPorJogador = p.escalados.map(e => ({ e, n: conta.get(e.candidato.id) ?? 0 })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  return { gargalo, seCoerencia100: forca(100, w), sePeso100: forca(c, 100), ganho10, vazaPeso, golsPorJogador };
}

/* ==========================================================================
   SUGESTÕES — que troca de UM jogador deixa o time mais forte?
   Cada vaga conta separado (os dois senadores são dois jogadores). Mantém os outros cinco, recalcula o placar inteiro e só considera quem veste a camisa
   da pessoa tanto quanto o atual (tolerância de TOLERANCIA_CAMISA pontos). Não é recomendação
   de voto: é o que o placar faria. Candidatos do mesmo partido com posições idênticas têm o
   mesmo efeito, então entram como um grupo (`iguais`) com um representante.
   ========================================================================== */
export const TOLERANCIA_CAMISA = 5;
export interface Sugestao {
  cargo: Cargo;
  vaga: number;
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
  const escalados = escalar(st, ds);
  if (escalados.length !== totalVagas(ds)) return [];
  for (const { cargo, candidato: de, vaga } of escalados) {
    const camisaDe = scoreCamisa(de, st.respostas, decisivas, ds.temas);
    const ocupados = new Set((st.time[cargo.id] ?? []).filter(Boolean));   // quem já está em alguma vaga deste cargo (inclui `de`)
    const grupos = new Map<string, Candidato[]>();
    for (const c of cargo.candidatos) { if (ocupados.has(c.id)) continue; const k = assinatura(c, ds.temas); grupos.set(k, [...(grupos.get(k) ?? []), c]); }
    let melhor: Sugestao | null = null;
    for (const grupo of grupos.values()) {
      const para = [...grupo].sort((a, b) => b.nominais - a.nominais || a.nome.localeCompare(b.nome))[0];
      const camisaPara = scoreCamisa(para, st.respostas, decisivas, ds.temas);
      if (camisaDe !== null && camisaPara !== null && camisaPara < camisaDe - tolerancia) continue;
      const time = { ...st.time, [cargo.id]: (st.time[cargo.id] ?? []).map((id, i) => (i === vaga ? para.id : id)) };
      const placar = calcularPlacar({ ...st, time }, ds); if (!placar) continue;
      const delta = { forca: placar.forca - atual.forca, coerencia: placar.coerencia - atual.coerencia, peso: placar.peso - atual.peso, gols: placar.gols.length - atual.gols.length };
      if (delta.forca <= 0) continue;
      const s: Sugestao = { cargo, vaga, de, para, iguais: grupo.length - 1, placar, delta, camisa: { de: camisaDe, para: camisaPara } };
      if (!melhor || delta.forca > melhor.delta.forca || (delta.forca === melhor.delta.forca && (delta.gols < melhor.delta.gols || (delta.gols === melhor.delta.gols && (camisaPara ?? 0) > (melhor.camisa.para ?? 0))))) melhor = s;
    }
    if (melhor) out.push(melhor);
  }
  return out.sort((a, b) => b.delta.forca - a.delta.forca || a.delta.gols - b.delta.gols);
}
