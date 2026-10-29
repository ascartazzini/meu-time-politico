/* O cadastro de eleitos como o site usa: eleitos-2027.json com a foto da Wikipédia (fotos-wiki.json)
   como reserva pra quem as APIs da Câmara e do Senado deixaram sem foto. Só no build (importa os JSON). */
import bruto from './generated/eleitos-2027.json';
import fotosWiki from './generated/fotos-wiki.json';
import type { EleitoBruto } from '../lib/eleitos';

const reserva = fotosWiki.fotos as Record<string, { foto: string; pagina: string }>;
export const cadastro = bruto;
export const eleitos: EleitoBruto[] = (bruto.eleitos as EleitoBruto[]).map(e => (e.fotoUrl || !reserva[e.slug] ? e : { ...e, fotoUrl: reserva[e.slug].foto }));
