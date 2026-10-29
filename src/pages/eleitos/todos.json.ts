/* /eleitos/todos.json: os 1.678 eleitos em linha leve, pra timeline mostrar nome, partido, cargo e foto de cada card. */
import type { APIRoute } from 'astro';
import { cadastro, eleitos } from '../../data/cadastro';
import { leve } from '../../lib/eleitos';

export const GET: APIRoute = () => new Response(JSON.stringify({
  geradoEm: cadastro.geradoEm,
  eleitos: eleitos.map(leve),
}), { headers: { 'Content-Type': 'application/json' } });
