/* Foto de pessoa pública pela Wikipédia em português (imagens do Wikimedia Commons, licença livre).
   Só aceita quando a página é claramente da pessoa: o título tem as palavras do nome e a descrição é
   de figura pública. Na dúvida devolve null: melhor iniciais do que o rosto de outra pessoa. */
import { normalizarNome, tokensNome } from '../../src/lib/nomes';

const UA = 'MeuTimePolitico/1.0 (https://www.meutimepolitico.com; tech civica)';
const FIGURA_PUBLICA = /pol[ií]tic|ministr|diplomat|advogad|economist|jornalist|militar|president|secret[aá]ri|empres[aá]ri|sindicalist|engenheir|professor|m[eé]dic|publicit[aá]ri|governador|senador|deputad|magistrad|juiz|procurador|chefe de estado|monarca|rei |rainha/i;

interface Resumo { type?: string; title?: string; description?: string; extract?: string; thumbnail?: { source: string }; content_urls?: { desktop: { page: string } } }

async function pegar(url: string): Promise<Response | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try { return await fetch(url, { headers: { 'User-Agent': UA }, signal: ctl.signal }); } catch { return null; } finally { clearTimeout(t); }
}

/** `pontas`: basta o primeiro e o último nome no título (nome civil completo raramente é o título da página). */
export async function wiki(nome: string, o: { pontas?: boolean; exigir?: RegExp } = {}): Promise<{ foto: string; pagina: string } | null> {
  const tokens = tokensNome(nome);
  if (tokens.length < 2) return null;
  const precisa = o.pontas ? [tokens[0], tokens.at(-1)!] : tokens;
  const confere = (j: Resumo) => {
    if (j.type !== 'standard' || !j.thumbnail?.source || !j.title) return null;
    const titulo = ` ${normalizarNome(j.title)} `;
    if (!precisa.every(t => titulo.includes(` ${t} `))) return null;
    const texto = `${j.description ?? ''} ${(j.extract ?? '').slice(0, 400)}`;
    if (!FIGURA_PUBLICA.test(texto) || (o.exigir && !o.exigir.test(texto))) return null;
    return { foto: j.thumbnail.source, pagina: j.content_urls?.desktop.page ?? `https://pt.wikipedia.org/wiki/${encodeURIComponent(j.title)}` };
  };
  const resumo = async (titulo: string) => {
    const r = await pegar(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(titulo.replace(/ /g, '_'))}?redirect=true`);
    return r?.ok ? confere(await r.json() as Resumo) : null;
  };
  const direto = await resumo(nome);
  if (direto) return direto;
  const busca = await pegar(`https://pt.wikipedia.org/w/api.php?action=query&list=search&srlimit=3&format=json&srsearch=${encodeURIComponent(nome)}`);
  if (!busca?.ok) return null;
  for (const s of ((await busca.json()) as { query?: { search?: { title: string }[] } }).query?.search ?? []) {
    const achou = await resumo(s.title);
    if (achou) return achou;
  }
  return null;
}
