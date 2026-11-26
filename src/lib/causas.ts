/* "Causas votadas" na página do político: as 14 pautas de temas.json, cada uma com o voto nominal real
   dele nas votações mapeadas e a leitura de quem aquele lado protege (o `impacto` de temas.json, juízo
   editorial explícito, o mesmo do quiz). Onde não há voto, só a estimativa do partido, com selo.
   Puro: roda no build da página e nos testes. Nunca inventa posição: sem voto e sem estimativa, fica de fora. */

export type Lado = 'F' | 'C';
export interface RefVotacao { casa: 'camara' | 'senado'; id?: string; codigoSessaoVotacao?: number; sigla?: string; numero?: number; ano?: number; ladoSim: Lado; rotulo: string }
export interface Tema { id: string; s: string; t: string; impacto: Record<string, Lado>; votacoes: RefVotacao[] }
export interface VotacaoCasa { data: string; totais: Record<string, number>; votos: Record<string, string> }
export interface Fontes {
  temas: Tema[];
  camara: Record<string, VotacaoCasa>;
  senado: Record<string, VotacaoCasa>;
  /** sigla canônica → estimativa na ordem de `ordemTemas` */
  partidos: Record<string, { estimativa: ('F' | 'C' | 'D')[] }>;
  ordemTemas: string[];
  aliases: Record<string, string>;
  /** perfil → texto ("renda até 2 salários") */
  rotulos: Record<string, string>;
}
export interface Quem { partido: string; ids: { camara?: number; senado?: number } }

export interface VotoNaPauta {
  rotulo: string; data: string; casa: 'camara' | 'senado'; url: string;
  /** como saiu na casa: "Sim", "Não", "Abstenção", "ausente (missão oficial)"… */
  voto: string;
  /** lado da frase da pauta que o voto apoiou; null = não tomou lado (abstenção, ausência…) */
  lado: Lado | null;
  placar: string;
}
export interface Causa {
  tema: { id: string; s: string; t: string };
  origem: 'voto' | 'partido';
  /** F/C; 'D' = votou dos dois lados (ou partido dividido); null = votou sem tomar lado */
  lado: Lado | 'D' | null;
  votos: VotoNaPauta[];
  /** perfis que o lado escolhido protege e os que ele deixa de proteger (vazio = pauta sem impacto no bolso mapeado) */
  protege: string[];
  pesaContra: string[];
}

const SENADO: Record<string, string> = {
  'P-NRV': 'presente, sem registrar voto', AP: 'ausente (atividade parlamentar)', MIS: 'ausente (missão oficial)',
  LP: 'ausente (licença particular)', LS: 'ausente (licença de saúde)', NCom: 'não compareceu', NA: 'ausente',
  'Presidente (art. 51 RISF)': 'presidia a sessão',
};
const CAMARA: Record<string, string> = { 'Artigo 17': 'presidia a sessão' };

export function votoEmTexto(casa: 'camara' | 'senado', v: string): string {
  return (casa === 'senado' ? SENADO : CAMARA)[v] ?? v;
}
export function ladoDoVoto(v: string, ladoSim: Lado): Lado | null {
  const x = v.toLowerCase();
  if (x === 'sim') return ladoSim;
  if (x === 'não' || x === 'nao') return ladoSim === 'F' ? 'C' : 'F';
  return null;
}
const placarEmTexto = (t: Record<string, number>) => `Sim ${t['Sim'] ?? 0} × Não ${t['Não'] ?? 0}`;

/** Câmara: página da proposição (o id da votação começa com ela). Senado: as votações da matéria nos dados abertos (a mesma consulta do fetch). */
export function urlVotacao(r: RefVotacao): string {
  return r.casa === 'camara'
    ? `https://www.camara.leg.br/propostas-legislativas/${String(r.id).split('-')[0]}`
    : `https://legis.senado.leg.br/dadosabertos/votacao?sigla=${r.sigla}&numero=${r.numero}&ano=${r.ano}`;
}

function leitura(t: Tema, lado: Lado | 'D' | null, rotulos: Record<string, string>) {
  if (lado !== 'F' && lado !== 'C') return { protege: [], pesaContra: [] };
  const ps = Object.entries(t.impacto);
  return {
    protege: ps.filter(([, l]) => l === lado).map(([p]) => rotulos[p] ?? p),
    pesaContra: ps.filter(([, l]) => l !== lado).map(([p]) => rotulos[p] ?? p),
  };
}

export function causasDe(q: Quem, f: Fontes): Causa[] {
  const sigla = f.aliases[q.partido.toUpperCase()] ?? q.partido;
  const est = f.partidos[sigla]?.estimativa;
  const out: Causa[] = [];
  for (const t of f.temas) {
    const votos: VotoNaPauta[] = [];
    for (const r of t.votacoes) {
      const meu = r.casa === 'camara' ? q.ids.camara : q.ids.senado;
      if (!meu) continue;
      const v = r.casa === 'camara' ? f.camara[String(r.id)] : f.senado[String(r.codigoSessaoVotacao)];
      const voto = v?.votos[String(meu)];
      if (!v || !voto) continue;   // sem registro: não estava na casa ou a casa não lista — não dá pra afirmar ausência
      votos.push({ rotulo: r.rotulo, data: v.data, casa: r.casa, url: urlVotacao(r), voto: votoEmTexto(r.casa, voto), lado: ladoDoVoto(voto, r.ladoSim), placar: placarEmTexto(v.totais) });
    }
    const tema = { id: t.id, s: t.s, t: t.t };
    if (votos.length) {
      const f_ = votos.filter(v => v.lado === 'F').length, c_ = votos.filter(v => v.lado === 'C').length;
      const lado = f_ + c_ === 0 ? null : f_ > c_ ? 'F' : c_ > f_ ? 'C' : 'D';
      out.push({ tema, origem: 'voto', lado, votos: votos.sort((a, b) => b.data.localeCompare(a.data)), ...leitura(t, lado, f.rotulos) });
      continue;
    }
    const i = f.ordemTemas.indexOf(t.id), e = est && i >= 0 ? est[i] : undefined;
    if (e) out.push({ tema, origem: 'partido', lado: e, votos: [], ...leitura(t, e, f.rotulos) });
  }
  return out;
}

/** O resumo no alto: em quantas pautas votadas o voto foi pro lado que protege cada grupo.
 *  Só voto nominal entra (estimativa do partido não), e só grupo que aparece em 2 pautas ou mais. */
export interface LinhaResumo { grupo: string; aFavor: number; pautas: number }
export function resumoPorGrupo(cs: Causa[], minimo = 2): LinhaResumo[] {
  const m = new Map<string, LinhaResumo>();
  for (const c of cs) {
    if (c.origem !== 'voto') continue;
    for (const g of c.protege) { const x = m.get(g) ?? { grupo: g, aFavor: 0, pautas: 0 }; x.aFavor++; x.pautas++; m.set(g, x); }
    for (const g of c.pesaContra) { const x = m.get(g) ?? { grupo: g, aFavor: 0, pautas: 0 }; x.pautas++; m.set(g, x); }
  }
  return [...m.values()].filter(x => x.pautas >= minimo)
    .sort((a, b) => b.aFavor / b.pautas - a.aFavor / a.pautas || b.pautas - a.pautas || a.grupo.localeCompare(b.grupo, 'pt-BR'));
}
