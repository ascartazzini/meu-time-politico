export const PLEITO = new Date('2026-10-04T08:00:00-03:00');
export function diasParaOPleito(agora = new Date()): number {
  return Math.max(0, Math.ceil((PLEITO.getTime() - agora.getTime()) / 86400000));
}
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
export function nomePartido(sigla: string, partidos: Record<string, { nome: string }>): string {
  return partidos[sigla]?.nome ?? sigla;
}
