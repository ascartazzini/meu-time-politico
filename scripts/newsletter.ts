/* Monta a newsletter da semana e grava em `edicoes` (a página /semana/ lê de lá; o HTML fica pronto pro envio).
   Regras em src/lib/edicao.ts. Roda toda sexta no GitHub Actions (coletar.yml), depois da coleta.
   Uso: npm run newsletter */
import { resolve } from 'node:path';
import { RAIZ, GERADO, lerJson } from './util';
import { pedir } from './coletores/banco';
import { montarEdicao, htmlEmail, type NoticiaEntrada, type PautaEntrada, type Marco } from '../src/lib/edicao';
import { leve, type EleitoBruto } from '../src/lib/eleitos';

const SITE = 'https://www.meutimepolitico.com';

async function main() {
  const agora = new Date();
  const desde = new Date(agora.getTime() - 7 * 864e5).toISOString();
  console.log('▶ Newsletter da semana');
  const linhas = await pedir<{ id: string; chave: string; grupo: string | null; titulo: string; url: string; quando: string; fontes: { nome: string }; item_politico: { politicos: { slug: string } }[] }[]>(
    `itens?tipo=eq.noticia&quando=gte.${desde}&select=id,chave,grupo,titulo,url,quando,fontes(nome),item_politico(politicos(slug))&order=quando&limit=5000`);
  const reacoes = new Map<string, number>();
  for (let i = 0; i < linhas.length; i += 150) {
    const ids = linhas.slice(i, i + 150).map(l => l.id).join(',');
    for (const r of await pedir<{ item_id: string }[]>(`reacoes?item_id=in.(${ids})&select=item_id`)) reacoes.set(r.item_id, (reacoes.get(r.item_id) ?? 0) + 1);
  }
  const noticias: NoticiaEntrada[] = linhas.map(l => ({
    grupo: l.grupo ?? l.chave, titulo: l.titulo, url: l.url, fonte: l.fontes.nome, quando: l.quando,
    politicos: l.item_politico.map(ip => ip.politicos.slug), reacoes: reacoes.get(l.id) ?? 0,
  }));
  const pauta = await pedir<PautaEntrada[]>(`pauta?quando=gte.${agora.toISOString()}&select=casa,quando,sessao,materia,ementa,url&order=quando`);
  const { marcos } = lerJson<{ marcos: Marco[] }>(resolve(RAIZ, 'src/data/marcos.json'));
  const { eleitos } = lerJson<{ eleitos: EleitoBruto[] }>(resolve(GERADO, 'eleitos-2027.json'));
  const nomes = new Map(eleitos.map(e => [e.slug, leve(e).nome]));

  const ed = montarEdicao({ agora, noticias, pauta, marcos, nomes });
  await pedir('edicoes?on_conflict=semana', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ semana: ed.semana, dados: ed, html: htmlEmail(ed, SITE), criado_em: agora.toISOString() }),
  });
  console.log(`  ✓ semana de ${ed.semana}: ${ed.noticias.length} notícias, ${ed.pauta.reduce((t, d) => t + d.itens.length, 0)} matérias na pauta, ${ed.marcos.length} marcos`);
}

main().catch(e => { console.error('✗ newsletter falhou:', e.message); process.exit(1); });
