/* Placar do mandato (página do político): as contagens da função placar_mandato viram linhas legíveis.
   Sem nota única nem ranking: cada parte aparece com o que mede e o que não mede. Puro, testado em tests/mandato.test.ts. */
import { rpc } from './supabase';

export interface PlacarMandato {
  desde: string | null;
  plenario_esteve: number; plenario_faltou: number; comissoes: number;
  votos: number; votos_faltou: number; votos_justificado: number;
  projetos_autor: number; projetos_coautor: number; discursos: number; imprensa: number;
  agenda: { publica: number; privada: number; partidaria: number; pessoal: number; sem: number };
}
export interface Linha { rotulo: string; valor: string; nota?: string; tom?: 'bom' | 'ruim' }

export const buscarPlacar = (slug: string) => rpc<PlacarMandato>('placar_mandato', { p_slug: slug });

const pct = (a: number, b: number) => `${Math.round((a / b) * 100)}%`;

export function linhasDoPlacar(p: PlacarMandato): Linha[] {
  const out: Linha[] = [];
  const sessoes = p.plenario_esteve + p.plenario_faltou;
  if (sessoes) out.push({
    rotulo: 'Presença no plenário (Câmara)', valor: `${p.plenario_esteve} de ${sessoes} · ${pct(p.plenario_esteve, sessoes)}`,
    nota: 'sessões deliberativas, onde todos são esperados', tom: p.plenario_faltou / sessoes > 0.2 ? 'ruim' : 'bom',
  });
  if (p.comissoes) out.push({ rotulo: 'Reuniões de comissão', valor: String(p.comissoes), nota: 'presença registrada' });
  const chamadas = p.votos + p.votos_faltou;
  if (chamadas) out.push({
    rotulo: 'Votações nominais', valor: `votou em ${p.votos} de ${chamadas}`,
    nota: p.votos_justificado ? `fora ${p.votos_justificado} com ausência justificada (licença, missão)` : undefined,
    tom: p.votos_faltou / chamadas > 0.2 ? 'ruim' : undefined,
  });
  if (p.projetos_autor || p.projetos_coautor) out.push({
    rotulo: 'Projetos apresentados', valor: `${p.projetos_autor} como autor · ${p.projetos_coautor} assinando junto`,
    nota: 'PL, PLP, PEC e PDL; não mede se o projeto andou',
  });
  if (p.discursos) out.push({ rotulo: 'Discursos em plenário', valor: String(p.discursos) });
  const ag = p.agenda, totalAg = ag.publica + ag.privada + ag.partidaria + ag.pessoal + ag.sem;
  if (totalAg) out.push({
    rotulo: 'Agenda oficial', valor: `${totalAg} compromissos`,
    nota: [`${ag.publica} pública`, ag.privada && `${ag.privada} setor privado / sociedade`, ag.partidaria && `${ag.partidaria} partidária`,
      ag.pessoal && `${ag.pessoal} pessoal`, ag.sem && `${ag.sem} sem classificação`].filter(Boolean).join(' · '),
  });
  if (p.imprensa) out.push({ rotulo: 'Citações na imprensa', valor: String(p.imprensa), nota: 'mede exposição, não trabalho' });
  return out;
}

export function desdeEmTexto(desde: string | null): string {
  if (!desde) return 'Ainda não há nada coletado.';
  return `Contado desde ${new Date(desde).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}, quando a coleta começou. Não é o mandato inteiro.`;
}

export interface Destaque { numero: number; sufixo?: string; rotulo: string; nota?: string; tom?: 'bom' | 'ruim' }

/** Os mesmos números do placar, no formato da página do político: um número grande por bloco. */
export function destaquesDoPlacar(p: PlacarMandato): Destaque[] {
  const out: Destaque[] = [];
  const sessoes = p.plenario_esteve + p.plenario_faltou;
  if (sessoes) out.push({
    numero: Math.round((p.plenario_esteve / sessoes) * 100), sufixo: '%', rotulo: 'de presença no plenário',
    nota: `${p.plenario_esteve} de ${sessoes} sessões deliberativas`, tom: p.plenario_faltou / sessoes > 0.2 ? 'ruim' : 'bom',
  });
  const chamadas = p.votos + p.votos_faltou;
  if (chamadas) out.push({ numero: p.votos, rotulo: 'votações nominais', nota: `de ${chamadas} em que foi chamado`, tom: p.votos_faltou / chamadas > 0.2 ? 'ruim' : undefined });
  if (p.projetos_autor) out.push({ numero: p.projetos_autor, rotulo: p.projetos_autor === 1 ? 'projeto apresentado' : 'projetos apresentados', nota: p.projetos_coautor ? `e assinou junto ${p.projetos_coautor}` : undefined });
  else if (p.projetos_coautor) out.push({ numero: p.projetos_coautor, rotulo: 'projetos que assinou junto' });
  if (p.discursos) out.push({ numero: p.discursos, rotulo: p.discursos === 1 ? 'discurso em plenário' : 'discursos em plenário' });
  const ag = p.agenda, totalAg = ag.publica + ag.privada + ag.partidaria + ag.pessoal + ag.sem;
  if (totalAg) out.push({ numero: totalAg, rotulo: 'compromissos na agenda', nota: `${ag.publica} com órgão público${ag.privada ? `, ${ag.privada} com setor privado` : ''}` });
  if (p.imprensa) out.push({ numero: p.imprensa, rotulo: p.imprensa === 1 ? 'notícia nos grandes veículos' : 'notícias nos grandes veículos', nota: 'mede exposição, não trabalho' });
  return out;
}
