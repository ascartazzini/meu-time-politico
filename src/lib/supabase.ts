/* Endereço do Supabase e chave publicável. A chave é feita pra ficar no navegador:
   só alcança o que as políticas de RLS liberam (leitura do feed e as funções públicas). */
export const SUPABASE_URL = 'https://zclxjwbpfgompypncvol.supabase.co';
export const SUPABASE_CHAVE_PUBLICA = 'sb_publishable_jF_A8NhI0oIvg2dYj4R_HA_PaeGvnmx';

export async function rpc<T>(funcao: string, corpo: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_CHAVE_PUBLICA },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw Object.assign(new Error(`${funcao}: HTTP ${r.status}`), { status: r.status });
  const txt = await r.text();
  return (txt ? JSON.parse(txt) : null) as T;
}
