/* Lista do resumo por e-mail (docs/plano-pos-eleicao.md). O e-mail vai pro Supabase por uma única
   função pública (entrar_lista_espera), que valida, ignora repetido e não devolve nada. */
import { rpc } from './supabase';

export const CONSENTIMENTO =
  'Aceito receber e-mail do Meu Time Político com o resumo do meu time e avisos de novidade. Meu e-mail não vai pra partido, campanha nem ninguém, e dá pra sair a qualquer hora.';

export type ResultadoInscricao = 'ok' | 'invalido' | 'erro';

export async function inscrever(email: string, uf: string | undefined, origem: string): Promise<ResultadoInscricao> {
  try {
    await rpc('entrar_lista_espera', { p_email: email.trim(), p_uf: uf ?? null, p_origem: origem, p_consentimento: CONSENTIMENTO });
    return 'ok';
  } catch (e) {
    return (e as { status?: number }).status === 400 ? 'invalido' : 'erro';
  }
}
