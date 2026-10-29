/* Revisão das sugestões de link ("insira aqui" na página do político).
   npm run sugestoes                      lista as pendentes
   npm run sugestoes -- --aprovar=3,7     grava em src/data/links-manuais.json e marca aprovada
   npm run sugestoes -- --recusar=4       marca recusada
   Aprovou? Rode `npm run links` e publique: o site é estático. */
import { resolve } from 'node:path';
import { RAIZ, lerJsonSeExistir, escreverJson } from './util';
import { pedir } from './coletores/banco';
import { normalizarLink } from './links';

interface Sugestao { id: number; slug: string; tipo: string; url: string; criado_em: string }
const ARQ = resolve(RAIZ, 'src/data/links-manuais.json');
const ids = (flag: string) => (process.argv.find(a => a.startsWith(`--${flag}=`))?.split('=')[1] ?? '').split(',').filter(Boolean).map(Number);

async function main() {
  const aprovar = ids('aprovar'), recusar = ids('recusar');
  if (!aprovar.length && !recusar.length) {
    const ps = await pedir<Sugestao[]>('sugestoes_link?status=eq.pendente&select=id,slug,tipo,url,criado_em&order=criado_em');
    if (!ps.length) return console.log('Nenhuma sugestão pendente.');
    for (const s of ps) console.log(`#${s.id}  ${s.slug}  ${s.tipo.padEnd(9)} ${s.url}  (${s.criado_em.slice(0, 16).replace('T', ' ')})`);
    return console.log(`\n${ps.length} pendentes. Aprovar: npm run sugestoes -- --aprovar=ID,ID · recusar: --recusar=ID`);
  }
  if (aprovar.length) {
    const ss = await pedir<Sugestao[]>(`sugestoes_link?id=in.(${aprovar.join(',')})&select=id,slug,tipo,url,criado_em`);
    const manuais = lerJsonSeExistir<Record<string, { tipo: string; url: string }[]>>(ARQ) ?? {};
    for (const s of ss) {
      const l = normalizarLink(s.url, 'sugestao');
      if (!l) { console.warn(`  ⚠ #${s.id}: ${s.url} não é um perfil válido; não aprovei`); continue; }
      manuais[s.slug] = [...(manuais[s.slug] ?? []).filter(x => x.url !== l.url), { tipo: l.tipo, url: l.url }];
      console.log(`  ✓ #${s.id} ${s.slug}: ${l.tipo} ${l.url}`);
    }
    escreverJson(ARQ, manuais);
    await pedir(`sugestoes_link?id=in.(${aprovar.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'aprovada' }) });
  }
  if (recusar.length) {
    await pedir(`sugestoes_link?id=in.(${recusar.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'recusada' }) });
    console.log(`  ✓ recusadas: ${recusar.join(', ')}`);
  }
  if (aprovar.length) console.log('\nAgora: npm run links && publique.');
}

main().catch(e => { console.error('✗ sugestoes falhou:', e.message); process.exit(1); });
