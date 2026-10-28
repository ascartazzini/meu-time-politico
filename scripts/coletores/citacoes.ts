/* Quem a notícia cita: casa o texto (título + linha fina) com o nome de urna dos 1.680 eleitos.
   Puro (sem rede), coberto por tests/citacoes.test.ts. Regras, da mais segura pra menos:
   - nome de urna com 2+ palavras ("Hugo Motta", "Delegado Palumbo"): casa sozinho;
   - nome de urna de 1 palavra só vale pra presidente, governador e senador, com 4+ letras e
     fora da lista de prenomes comuns ("Lula" sim, "Marina" não);
   - o mesmo nome em duas pessoas (homônimos entre UFs) não casa ninguém: melhor perder a notícia
     do que pôr no time errado. */
import { normalizarNome, tokensNome } from '../../src/lib/nomes';

export interface Citavel { id: string; nome: string; nome_urna: string | null; cargos: string[] }
export interface Citacao { id: string; confianca: number; termo: string }

const CARGOS_DE_DESTAQUE = new Set(['presidente', 'governador', 'senador']);
const PRENOMES = new Set([
  'joao', 'jose', 'maria', 'ana', 'carlos', 'paulo', 'pedro', 'lucas', 'luiz', 'luis', 'marcos', 'marcelo', 'antonio', 'francisco',
  'marina', 'julia', 'fernando', 'eduardo', 'rafael', 'ricardo', 'roberto', 'sergio', 'jorge', 'mario', 'daniel', 'bruno', 'andre',
  'rodrigo', 'gustavo', 'felipe', 'alexandre', 'renato', 'renan', 'flavio', 'fabio', 'marcio', 'claudio', 'patricia', 'camila',
  'professor', 'professora', 'pastor', 'delegado', 'coronel', 'capitao', 'doutor', 'doutora', 'dr', 'dra', 'irmao', 'sargento',
  'general', 'cabo', 'tenente', 'major', 'bispo', 'padre', 'missionario', 'enfermeira', 'junior', 'filho', 'neto', 'brasil',
]);
// "Maria Silva" casaria com gente demais que não é a deputada
const SOBRENOMES = new Set([
  'silva', 'santos', 'souza', 'sousa', 'oliveira', 'pereira', 'costa', 'ferreira', 'rodrigues', 'almeida', 'alves', 'gomes',
  'ribeiro', 'carvalho', 'martins', 'araujo', 'barbosa', 'rocha', 'nascimento', 'moreira', 'cardoso', 'teixeira', 'correia',
  'mendes', 'nunes', 'vieira', 'soares', 'monteiro', 'castro', 'freitas', 'campos', 'lopes', 'pinto', 'ramos', 'santana',
  'batista', 'fernandes', 'goncalves', 'marques', 'machado', 'andrade', 'medeiros', 'cavalcante', 'cavalcanti', 'moura',
]);
const SUFIXOS = new Set(['junior', 'filho', 'filha', 'neto', 'neta', 'sobrinho', 'segundo']);

/** termo normalizado → ids de quem usa esse nome */
export function indiceDeNomes(pessoas: Citavel[]): Map<string, { ids: Set<string>; palavras: number }> {
  const idx = new Map<string, { ids: Set<string>; palavras: number }>();
  const add = (termo: string, id: string) => {
    const t = normalizarNome(termo);
    if (!t) return;
    const palavras = t.split(' ').length;
    const e = idx.get(t) ?? { ids: new Set<string>(), palavras };
    e.ids.add(id);
    idx.set(t, e);
  };
  for (const p of pessoas) {
    const urna = p.nome_urna ? normalizarNome(p.nome_urna) : '';
    if (urna) {
      const uma = urna.split(' ').length === 1;
      const destaque = p.cargos.some(c => CARGOS_DE_DESTAQUE.has(c));
      if (!uma || (destaque && urna.length >= 4 && !PRENOMES.has(urna))) add(urna, p.id);
    }
    // nome civil completo raramente aparece em notícia, mas quando aparece é inequívoco
    const civil = tokensNome(p.nome);
    if (civil.length >= 3) add(p.nome, p.id);
    // A imprensa chama pelo prenome + nome de urna ("Hugo Motta", urna "MOTTA") ou prenome + último sobrenome.
    if (urna && urna.split(' ').length === 1 && civil.includes(urna) && civil[0] !== urna) add(`${civil[0]} ${urna}`, p.id);
    const ultimo = civil.at(-1);
    if (civil.length >= 2 && ultimo && ultimo.length >= 5 && !SOBRENOMES.has(ultimo) && !SUFIXOS.has(ultimo)) add(`${civil[0]} ${ultimo}`, p.id);
  }
  return idx;
}

/** Ids citados no texto, sem homônimos. Confiança cai pra nome curto. */
export function citados(texto: string, idx: ReturnType<typeof indiceDeNomes>): Citacao[] {
  const t = ` ${normalizarNome(texto)} `;
  const achados = new Map<string, Citacao>();
  for (const [termo, { ids, palavras }] of idx) {
    if (ids.size !== 1 || !t.includes(` ${termo} `)) continue;
    const id = [...ids][0];
    const confianca = palavras >= 3 ? 0.95 : palavras === 2 ? 0.85 : 0.8;
    const atual = achados.get(id);
    if (!atual || atual.confianca < confianca) achados.set(id, { id, confianca, termo });
  }
  return [...achados.values()];
}

/* ---------- RSS ---------- */

export interface Noticia { titulo: string; resumo: string; url: string; data: string | null }

const DIAS: Record<string, string> = { seg: 'Mon', ter: 'Tue', qua: 'Wed', qui: 'Thu', sex: 'Fri', sab: 'Sat', 'sáb': 'Sat', dom: 'Sun' };
const MESES: Record<string, string> = { jan: 'Jan', fev: 'Feb', mar: 'Mar', abr: 'Apr', mai: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', set: 'Sep', out: 'Oct', nov: 'Nov', dez: 'Dec' };
/** Data de RSS → ISO. Aceita pubDate em português ("Sex, 16 Out 2026 15:21:56 -0300"). */
export function dataRss(s: string): string | null {
  if (!s) return null;
  let d = new Date(s);
  if (Number.isNaN(d.getTime())) d = new Date(s.replace(/\p{L}+/gu, w => DIAS[w.toLowerCase()] ?? MESES[w.toLowerCase()] ?? w));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const entidades = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
const limpar = (s: string) => entidades(entidades(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function lerRss(xml: string): Noticia[] {
  const blocos = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  const tag = (b: string, n: string) => b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? '';
  return blocos.map(b => ({
    titulo: limpar(tag(b, 'title')),
    resumo: limpar(tag(b, 'description') || tag(b, 'summary')).slice(0, 400),
    url: limpar(tag(b, 'link')) || (b.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? ''),
    data: dataRss(limpar(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))),
  })).filter(n => n.titulo && /^https?:\/\//.test(n.url));
}

/** Coluna, blog, opinião e análise ficam fora: só fato noticiado entra (decisão do projeto, sem bastidor). */
export const ehOpiniao = (url: string) => /\/(colunas?|colunistas?|blogs?|opiniao|opinion|analise|analises|editorial|podcasts?)\//i.test(url);

/** URL sem rastreio, pra deduplicar a mesma matéria vinda por dois caminhos. */
export function urlCanonica(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|origin$|from$)/i.test(k)) u.searchParams.delete(k);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch { return url; }
}
