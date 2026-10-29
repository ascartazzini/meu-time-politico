/* Foto da Wikipédia pros eleitos de cargo visível (presidente, governador, senador) que o cadastro deixou
   sem foto: as APIs da Câmara e do Senado só têm quem já está lá, e o TSE barra acesso de fora do Brasil.
   Grava src/data/generated/fotos-wiki.json (slug → foto + página); src/data/cadastro.ts usa como reserva.
   Tenta o nome civil (bastam primeiro e último nome no título) e depois o de urna; a página tem de falar do
   cargo. Na dúvida fica sem foto. Uso: npm run fotos */
import { resolve } from 'node:path';
import { GERADO, lerJson, lerJsonSeExistir, escreverJson } from './util';
import { cargoPrincipal, nomeBonito, type EleitoBruto } from '../src/lib/eleitos';
import { wiki } from './coletores/wiki';

const ARQ = resolve(GERADO, 'fotos-wiki.json');
const CARGO: Record<string, RegExp> = { presidente: /president/i, governador: /governador|governadora/i, senador: /senador|senadora/i };

async function main() {
  const cadastro = lerJson<{ eleitos: EleitoBruto[] }>(resolve(GERADO, 'eleitos-2027.json'));
  const antes = lerJsonSeExistir<{ fotos: Record<string, { foto: string; pagina: string }> }>(ARQ)?.fotos ?? {};
  const alvo = cadastro.eleitos.filter(e => !e.fotoUrl && CARGO[cargoPrincipal(e).cargo]);
  const fotos: Record<string, { foto: string; pagina: string }> = {};
  let novas = 0;
  for (const e of alvo) {
    if (antes[e.slug]) { fotos[e.slug] = antes[e.slug]; continue; }
    const exigir = CARGO[cargoPrincipal(e).cargo];
    const achou = await wiki(nomeBonito(e.nome), { pontas: true, exigir }) ?? await wiki(nomeBonito(e.nomeUrna), { exigir });
    if (achou) { fotos[e.slug] = achou; novas++; }
    console.log(`  ${achou ? '✓' : '·'} ${e.slug}${achou ? ` → ${achou.pagina}` : ''}`);
  }
  escreverJson(ARQ, { geradoEm: new Date().toISOString(), fonte: 'Wikipédia (imagens do Wikimedia Commons)', fotos });
  console.log(`✓ ${Object.keys(fotos).length} de ${alvo.length} sem foto agora têm (${novas} novas)`);
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
