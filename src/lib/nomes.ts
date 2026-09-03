/* Normalização de nomes e siglas — usado no pipeline pra casar candidato do TSE com deputado/senador da API. */
export function normalizarNome(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'van', 'von', 'del', 'di']);
export function tokensNome(s: string): string[] { return normalizarNome(s).split(' ').filter(t => t && !PARTICULAS.has(t)); }

/** 1 = mesmo nome; 0.8 = um está contido no outro (nome de urna dentro do nome completo); 0 = não casa */
export function similaridadeNome(a: string, b: string): number {
  const na = normalizarNome(a), nb = normalizarNome(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokensNome(a), tb = tokensNome(b);
  if (ta.length >= 2 && ta.every(t => tb.includes(t))) return 0.8;
  if (tb.length >= 2 && tb.every(t => ta.includes(t))) return 0.8;
  return 0;
}

export function canonizarSigla(sigla: string, aliases: Record<string, string>): string {
  const k = sigla.trim();
  return aliases[k] ?? aliases[k.toUpperCase()] ?? aliases[k.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()] ?? k.toUpperCase();
}
