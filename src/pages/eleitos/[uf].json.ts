/* /eleitos/<UF>.json: quem dá pra seguir naquela UF (presidente + governador, senadores, deputados).
   Gerado no build a partir do cadastro; o app só baixa o da UF escolhida. */
import type { APIRoute, GetStaticPaths } from 'astro';
import cadastro from '../../data/generated/eleitos-2027.json';
import ufs from '../../data/ufs.json';
import { daUf, type EleitoBruto } from '../../lib/eleitos';

export const getStaticPaths = (() => ufs.ufs.map(u => ({ params: { uf: u.sigla } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) => new Response(JSON.stringify({
  uf: params.uf, geradoEm: cadastro.geradoEm, aviso: cadastro.aviso,
  eleitos: daUf(cadastro.eleitos as EleitoBruto[], params.uf!),
}), { headers: { 'Content-Type': 'application/json' } });
