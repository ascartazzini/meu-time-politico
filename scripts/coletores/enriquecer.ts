/* Enriquecimento: o que deixa o card mais visual, buscado depois da coleta e gravado em itens.dados.
   - notícia: a imagem de compartilhamento da própria matéria (og:image), exibida com link pra fonte;
   - discurso do Senado: até 4 frases literais do texto integral (linguagem.ts escolhe, sem reescrever);
   - agenda: quem está no compromisso, com foto — do cadastro de eleitos quando é um deles, senão da
     Wikipédia (Wikimedia Commons), e só quando a página é claramente da pessoa; na dúvida, fica sem foto.
   Cada item é marcado com dados.enr = VERSAO e não é refeito. Um gatilho no banco mescla o dados
   (migração dados_enriquecidos), então o coletor regravando o item não apaga nada disto.
   Uso: npm run enriquecer [-- --dias=10] */
import { UA } from '../util';
import { pedir, politicos, emLotes, diasDoArgumento } from './banco';
import { indiceDeNomes, citados } from './citacoes';
import { escolherTrechos, lerCompromisso } from '../../src/lib/linguagem';
import { wiki } from './wiki';
import { imagemDoHtml } from './imagem';

const VERSAO = 1;

interface Linha { id: string; tipo: string; chave: string; titulo: string; url: string; dados: Record<string, unknown> }

async function baixar(url: string, ms = 15_000): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: ctl.signal, redirect: 'follow' }); }
  catch { return null; } finally { clearTimeout(t); }
}

/* ---------- notícia ---------- */

async function noticia(l: Linha): Promise<Record<string, unknown>> {
  // a Folha manda o link por um redirecionador: abre o destino direto
  const destino = l.url.includes('redir.folha.com.br') ? l.url.slice(l.url.indexOf('*') + 1) : l.url;
  const r = await baixar(destino);
  if (!r?.ok) return {};
  const html = (await r.text()).slice(0, 400_000);
  const imagem = imagemDoHtml(html);
  return imagem ? { imagem } : {};
}

/* ---------- discurso ---------- */

async function discurso(l: Linha): Promise<Record<string, unknown>> {
  const cod = l.chave.match(/^senado-discurso-(\d+)$/)?.[1];
  if (!cod) return {};
  const r = await baixar(`https://legis.senado.leg.br/dadosabertos/discurso/texto-integral/${cod}`, 30_000);
  if (!r?.ok) return {};
  const trechos = escolherTrechos(await r.text());
  return trechos.length ? { trechos } : {};
}

/* ---------- agenda ---------- */

let idx: ReturnType<typeof indiceDeNomes>;
let slugPorId: Map<string, string>;

async function agenda(l: Linha): Promise<Record<string, unknown>> {
  const c = lerCompromisso(l.titulo);
  if (!c.participantes.length) return {};
  const participantes = [];
  for (const p of c.participantes) {
    const quem = citados(p.nome, idx);
    const slug = quem.length === 1 ? slugPorId.get(quem[0].id) : undefined;
    const w = slug ? null : await wiki(p.nome);
    participantes.push({ ...p, ...(slug ? { slug } : {}), ...(w ? { foto: w.foto, foto_fonte: w.pagina } : {}) });
  }
  return { participantes };
}

/* ---------- votação do Senado: placar que antes só ia no resumo ---------- */

function votoSenado(l: Linha & { resumo?: string | null }): Record<string, unknown> {
  const m = l.resumo?.match(/Sim:\s*(\d+)\s*·\s*Não:\s*(\d+)/);
  return m ? { sim: Number(m[1]), nao: Number(m[2]) } : {};
}

async function main() {
  const desde = new Date(Date.now() - diasDoArgumento(10) * 864e5).toISOString();
  console.log('▶ Enriquecimento');
  const ps = await politicos();
  idx = indiceDeNomes(ps);
  slugPorId = new Map(ps.map(p => [p.id, p.slug]));
  const linhas = await pedir<(Linha & { resumo: string | null })[]>(
    `itens?tipo=in.(noticia,discurso,agenda,voto)&quando=gte.${desde}&or=(dados->enr.is.null,dados->>enr.lt.${VERSAO})&select=id,tipo,chave,titulo,resumo,url,dados&order=quando.desc&limit=1000`);
  const conta: Record<string, number> = {};
  await emLotes(linhas, 4, async l => {
    const novo = l.tipo === 'noticia' ? await noticia(l) : l.tipo === 'discurso' ? await discurso(l)
      : l.tipo === 'agenda' ? await agenda(l) : l.dados.casa === 'senado' ? votoSenado(l) : {};
    if (Object.keys(novo).length) conta[l.tipo] = (conta[l.tipo] ?? 0) + 1;
    await pedir(`itens?id=eq.${l.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ dados: { ...novo, enr: VERSAO } }) });
  });
  console.log(`  ✓ ${linhas.length} itens vistos · ${Object.entries(conta).map(([t, n]) => `${t}: ${n}`).join(' · ') || 'nada novo'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error('✗ enriquecimento falhou:', e.message); process.exit(1); });
