/* ==========================================================================
   GA4 — eventos de produto. A tag e o `config` (incluindo traffic_type) ficam
   em Base.astro; aqui só entram os eventos do funil. Sem gtag na página
   (bloqueador de anúncio, offline, teste) tudo vira no-op silencioso: medir
   nunca pode quebrar o app.
   ========================================================================== */
type Valor = string | number | boolean | undefined;
type Gtag = (comando: string, ...resto: unknown[]) => void;

export function evento(nome: string, params: Record<string, Valor> = {}): void {
  const g = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof g !== 'function') return;
  try { g('event', nome, params); } catch { /* medição não derruba a página */ }
}
