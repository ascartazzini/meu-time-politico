/* Tipos compartilhados entre pipeline (scripts/), motor (src/lib) e UI. */

export type Lado = 'F' | 'C' | 'D';          // posição de candidato/partido: a favor · contra · dividido
export type Resposta = 'F' | 'C' | 'N';      // resposta do eleitor: a favor · contra · tanto faz
export type Casa = 'camara' | 'senado' | 'assembleia';
export type Campo = 'esq' | 'centro' | 'dir';
export type CargoId = 'presidente' | 'governador' | 'senador' | 'federal' | 'estadual';
export type FontePosicao = 'voto_nominal' | 'estimativa_partido';

export interface Tema {
  id: string;
  s: string;                  // rótulo curto
  t: string;                  // frase da pauta
  impacto: Record<string, Lado>;
  votacoes: VotacaoRef[];
  leia?: { rotulo: string; url: string; fonte: string };   // link discreto pra entender a pauta
}
export interface VotacaoRef {
  casa: 'camara' | 'senado';
  id?: string;                // Câmara: id da votação (ex.: 2233802-424)
  codigoSessaoVotacao?: number; // Senado
  sigla?: string; numero?: number; ano?: number;
  ladoSim: 'F' | 'C';         // o que um voto SIM significa em relação à frase da pauta
  rotulo: string;
}

export interface Posicao {
  lado: Lado;
  fonte: FontePosicao;
  detalhe?: string;           // ex.: "votou SIM em PEC 221/2019 — 1º turno, 27/05/2026"
}

/** Como o candidato viaja no JSON: só o que não dá pra derivar do partido. */
export interface CandidatoBruto {
  id: string;
  nome: string;
  partido: string;            // sigla canônica
  cargo: CargoId;
  uf: string;
  numero?: string;
  mandato?: { casa: 'camara' | 'senado'; id: number; nome: string };
  votos?: Record<string, { lado: Lado; detalhe: string }>;   // temaId → voto nominal real
}
/** Depois de hidratar (src/lib/dataset.ts): posições completas pra todas as pautas. */
export interface Candidato extends CandidatoBruto {
  posicoes: Record<string, Posicao>;
  nominais: number;           // quantas pautas têm voto nominal
}

export interface Cargo {
  id: CargoId; nome: string; curto: string; casa: Casa;
  porCampo: boolean; pesoNoPlacar: number; abrangencia: 'BR' | 'UF';
  meta: string;
  candidatos: Candidato[];
}

export interface Bancadas {
  camara: Record<string, number>;
  senado: Record<string, number>;
  assembleia: Record<string, number>;
}

export interface PartidoInfo { nome: string; campo: Campo | null; estimativa: Lado[]; semOrientacao?: boolean }

export interface Dataset {
  uf: string;
  nomeUf: string;
  casaEstadual: string;
  geradoEm: string;
  dataTse: string;
  temas: Tema[];
  ordemTemas: string[];
  cargos: Cargo[];
  bancadas: Bancadas;
  quorum: Record<Casa, number>;
  cadeiras: Record<Casa, number>;
  partidos: Record<string, PartidoInfo>;
  fontes: { rotulo: string; detalhe: string }[];
  cobertura: { temaId: string; nominal: number; estimativa: number }[];
  stats: { candidatos: number; federais: number; estaduais: number; comMandato: number };
}
/** O mesmo Dataset como sai do build (candidatos ainda sem posicoes). */
export type DatasetBruto = Omit<Dataset, 'cargos'> & { cargos: (Omit<Cargo, 'candidatos'> & { candidatos: CandidatoBruto[] })[] };

export interface EstadoEleitor {
  uf?: string;
  perfil: Record<string, string>;
  respostas: Record<string, Resposta>;
  decisivas: string[];
  time: Partial<Record<CargoId, string>>;   // cargo → candidato.id
}
