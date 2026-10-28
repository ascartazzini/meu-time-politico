/* Carrega src/data/generated/eleitos-2027.json no Supabase (politicos, ids_externos, mandatos).
   Idempotente: upsert por slug, por (fonte, valor) e por (politico, cargo, início). Rodar de novo atualiza.
   Precisa de SUPABASE_SECRET_KEY no .env (painel do Supabase → Project Settings → API Keys → secret).
   A chave secreta ignora RLS: nunca vai pro navegador nem pro git. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { lerJson, RAIZ, GERADO } from './util';
import type { Eleito } from './cadastro-eleitos';

if (existsSync(resolve(RAIZ, '.env'))) process.loadEnvFile(resolve(RAIZ, '.env'));
const URL_BASE = process.env.SUPABASE_URL ?? 'https://zclxjwbpfgompypncvol.supabase.co';
const CHAVE = process.env.SUPABASE_SECRET_KEY;
if (!CHAVE) { console.error('✗ falta SUPABASE_SECRET_KEY no .env (painel do Supabase → Project Settings → API Keys → secret)'); process.exit(1); }

// chave nova (sb_secret_…) vai só no apikey; a legada (JWT service_role) vai também no Authorization
const cabecalhos = {
  apikey: CHAVE, 'Content-Type': 'application/json',
  ...(CHAVE.startsWith('eyJ') ? { Authorization: `Bearer ${CHAVE}` } : {}),
};

async function upsert<T>(tabela: string, conflito: string, linhas: object[], devolver = false): Promise<T[]> {
  const saida: T[] = [];
  for (let i = 0; i < linhas.length; i += 500) {
    const r = await fetch(`${URL_BASE}/rest/v1/${tabela}?on_conflict=${conflito}`, {
      method: 'POST',
      headers: { ...cabecalhos, Prefer: `resolution=merge-duplicates,return=${devolver ? 'representation' : 'minimal'}` },
      body: JSON.stringify(linhas.slice(i, i + 500)),
    });
    if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status} ${await r.text()}`);
    if (devolver) saida.push(...((await r.json()) as T[]));
  }
  console.log(`  ✓ ${tabela}: ${linhas.length} linhas`);
  return saida;
}

async function main() {
  const { eleitos, dataGeracaoTse } = lerJson<{ eleitos: Eleito[]; dataGeracaoTse: string }>(resolve(GERADO, 'eleitos-2027.json'));
  console.log(`▶ Carregando ${eleitos.length} políticos no Supabase (TSE de ${dataGeracaoTse})`);
  const agora = new Date().toISOString();

  const politicos = await upsert<{ id: string; slug: string }>('politicos', 'slug', eleitos.map(e => ({
    slug: e.slug, nome: e.nome, nome_urna: e.nomeUrna, partido: e.partido, uf: e.uf, foto_url: e.fotoUrl, atualizado_em: agora,
  })), true);
  const idPorSlug = new Map(politicos.map(p => [p.slug, p.id]));

  const ids: { fonte: string; valor: string; politico_id: string }[] = [];
  const mandatos: object[] = [];
  for (const e of eleitos) {
    const politico_id = idPorSlug.get(e.slug)!;
    if (e.ids.tse2026) ids.push({ fonte: 'tse-2026', valor: e.ids.tse2026, politico_id });
    if (e.ids.tse2022) ids.push({ fonte: 'tse-2022', valor: e.ids.tse2022, politico_id });
    if (e.ids.camara) ids.push({ fonte: 'camara', valor: String(e.ids.camara), politico_id });
    if (e.ids.senado) ids.push({ fonte: 'senado', valor: String(e.ids.senado), politico_id });
    for (const m of e.mandatos) mandatos.push({ politico_id, cargo: m.cargo, uf: m.uf, inicio: m.inicio, fim: m.fim, eleicao: m.eleicao, suplente: !!m.suplente });
  }
  await upsert('ids_externos', 'fonte,valor', ids);
  await upsert('mandatos', 'politico_id,cargo,inicio', mandatos);
}

main().catch(e => { console.error('✗ carregar-cadastro falhou:', e.message); process.exit(1); });
