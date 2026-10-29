/* /eleitos/todos.json: os 1.678 eleitos em linha leve, pra timeline mostrar nome, partido, cargo e foto de cada card. */
import type { APIRoute } from 'astro';
import cadastro from '../../data/generated/eleitos-2027.json';
import { leve, type EleitoBruto } from '../../lib/eleitos';

export const GET: APIRoute = () => new Response(JSON.stringify({
  geradoEm: cadastro.geradoEm,
  eleitos: (cadastro.eleitos as EleitoBruto[]).map(leve),
}), { headers: { 'Content-Type': 'application/json' } });
