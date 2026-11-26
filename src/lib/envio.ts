/* Envio da newsletter: transforma o HTML pronto da edição (`edicoes.html`, de edicao.ts) numa mensagem por
   inscrito, com o link de descadastro dele. Puro (sem rede), coberto por tests/envio.test.ts.
   Quem busca a lista, manda pelo serviço de envio e registra é scripts/enviar-newsletter.ts. */

export interface Inscrito { id: string; email: string; token: string }
export interface Mensagem { from: string; to: string[]; subject: string; html: string; headers: Record<string, string> }

export const linkSair = (site: string, token: string) => `${site}/sair/?t=${encodeURIComponent(token)}`;

/** Assunto com a data da semana: "Resumo da semana de 23 de novembro — Meu Time Político". */
export function assunto(semana: string): string {
  const d = new Date(`${semana}T12:00:00Z`).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `Resumo da semana de ${d} — Meu Time Político`;
}

export function mensagem(e: { html: string; semana: string; inscrito: Inscrito; site: string; remetente: string }): Mensagem {
  const sair = linkSair(e.site, e.inscrito.token);
  return {
    from: e.remetente,
    to: [e.inscrito.email],
    subject: assunto(e.semana),
    html: e.html.replaceAll('{{descadastro}}', sair),
    // o Gmail e outros mostram "Cancelar inscrição" no topo quando há este cabeçalho
    headers: { 'List-Unsubscribe': `<${sair}>` },
  };
}

/** Quem ainda não recebeu esta edição, no máximo `limite` (a cota diária do serviço). */
export function pendentes(inscritos: Inscrito[], jaRecebeu: Set<string>, limite: number): Inscrito[] {
  const vistos = new Set<string>();
  return inscritos.filter(i => {
    const k = i.email.toLowerCase();
    if (jaRecebeu.has(i.id) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  }).slice(0, Math.max(0, limite));
}
