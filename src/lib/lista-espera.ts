/* Lista de espera do acompanhamento dos eleitos (docs/plano-pos-eleicao.md, Fase 0).
   O e-mail vai pro Supabase por uma única função pública (entrar_lista_espera),
   que valida, ignora repetido e não devolve nada. A chave abaixo é a publicável:
   feita pra ficar no navegador, só alcança o que as políticas de RLS liberam. */
const SUPABASE_URL = 'https://zclxjwbpfgompypncvol.supabase.co';
const SUPABASE_CHAVE_PUBLICA = 'sb_publishable_jF_A8NhI0oIvg2dYj4R_HA_PaeGvnmx';

export const CONSENTIMENTO =
  'Aceito receber e-mail do Meu Time Político quando o acompanhamento dos eleitos abrir. Meu e-mail não vai pra partido, campanha nem ninguém, e dá pra sair a qualquer hora.';

export type ResultadoInscricao = 'ok' | 'invalido' | 'erro';

export async function inscrever(email: string, uf: string | undefined, origem: string): Promise<ResultadoInscricao> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/entrar_lista_espera`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_CHAVE_PUBLICA },
      body: JSON.stringify({ p_email: email.trim(), p_uf: uf ?? null, p_origem: origem, p_consentimento: CONSENTIMENTO }),
    });
    if (r.ok) return 'ok';
    return r.status === 400 ? 'invalido' : 'erro';
  } catch {
    return 'erro';
  }
}
