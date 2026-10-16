/* Fase 0 — imprensa. Um RSS público de POLÍTICA por veículo grande (sem coluna, sem blog),
   mais Google News (busca por nome) e GDELT. Mede volume, atraso, se traz resumo, e quantos
   itens citam um político da lista NOMES (proxy de "dá pra ligar a notícia a alguém sem IA?"). */
import { UA } from '../util';
import { type Prova, type Medida, type Amostra, type Resposta, atraso, amostra, falha, decodificar, pegarJson } from './base';

/** Quem está em evidência em out/2026 (2º turno Lula × Flávio, Congresso, governadores). */
const NOMES = [
  'Lula', 'Flávio Bolsonaro', 'Jair Bolsonaro', 'Bolsonaro', 'Michelle Bolsonaro', 'Eduardo Bolsonaro', 'Tarcísio', 'Alcolumbre',
  'Hugo Motta', 'Haddad', 'Alckmin', 'Gleisi', 'Boulos', 'Nikolas', 'Caiado', 'Zema', 'Ratinho Júnior', 'Eduardo Leite',
  'Ciro Nogueira', 'Simone Tebet', 'Marina Silva', 'Eduardo Paes', 'Helder Barbalho', 'Tabata Amaral', 'Erika Hilton',
];
const reNome = new RegExp(`(?<!\\p{L})(${NOMES.join('|')})(?!\\p{L})`, 'u');
/** Coluna, blog e opinião ficam fora (decisão do projeto: só fato noticiado, nada de bastidor). */
const reColuna = /\/(colunas?|colunistas?|blogs?|opiniao|opinion|analise)\//i;

/* ---------- utilidades locais ---------- */

/** GET que respeita o charset (Folha e UOL servem ISO-8859-1; `pegar` de base.ts decodifica tudo como UTF-8). */
async function pegarTexto(url: string, timeoutMs = 30_000): Promise<Resposta> {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: ctl.signal, redirect: 'follow' });
    const buf = new Uint8Array(await r.arrayBuffer());
    const tipo = r.headers.get('content-type') ?? '';
    const cabeca = new TextDecoder('latin1').decode(buf.slice(0, 200));
    const cs = (tipo.match(/charset=([\w-]+)/i)?.[1] ?? cabeca.match(/encoding="([\w-]+)"/i)?.[1] ?? 'utf-8').toLowerCase();
    let corpo: string;
    try { corpo = new TextDecoder(cs).decode(buf); } catch { corpo = new TextDecoder('utf-8').decode(buf); }
    return { status: r.status, ok: r.ok, corpo, ms: Date.now() - t0, url: r.url, tipo };
  } catch (e) {
    return { status: 0, ok: false, corpo: '', ms: Date.now() - t0, url, erro: (e as Error).message, tipo: '' };
  } finally { clearTimeout(timer); }
}

const DIAS: Record<string, string> = { seg: 'Mon', ter: 'Tue', qua: 'Wed', qui: 'Thu', sex: 'Fri', sab: 'Sat', 'sáb': 'Sat', dom: 'Sun' };
const MESES: Record<string, string> = { jan: 'Jan', fev: 'Feb', mar: 'Mar', abr: 'Apr', mai: 'May', jun: 'Jun', jul: 'Jul', ago: 'Aug', set: 'Sep', out: 'Oct', nov: 'Nov', dez: 'Dec' };
/** Data de RSS → ISO. Aceita pubDate em português (UOL: "Sex, 16 Out 2026 15:21:56 -0300"). */
function dataIso(s: string): string {
  if (!s) return '';
  let d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    const en = s.replace(/\p{L}+/gu, w => DIAS[w.toLowerCase()] ?? MESES[w.toLowerCase()] ?? w);
    d = new Date(en);
  }
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

const limpar = (s: string) => decodificar(decodificar(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

interface Item extends Amostra { resumo: string; texto: boolean; fonte?: string }

/** RSS/Atom com resumo e indicação de texto integral (content:encoded). */
function itens(xml: string): Item[] {
  const blocos = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) ?? [];
  const tag = (b: string, n: string) => b.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`))?.[1] ?? '';
  return blocos.map(b => {
    const desc = limpar(tag(b, 'description') || tag(b, 'summary') || tag(b, 'atom:subtitle'));
    const integral = limpar(tag(b, 'content:encoded') || tag(b, 'content'));
    let url = limpar(tag(b, 'link')) || (b.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? '');
    return {
      titulo: limpar(tag(b, 'title')),
      data: dataIso(limpar(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))),
      url,
      resumo: desc,
      texto: integral.length > 600 || desc.length > 600,
      fonte: limpar(tag(b, 'source')) || undefined,
    };
  });
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const horas = (lista: Item[]) => {
  const ts = lista.map(i => new Date(i.data).getTime()).filter(n => !Number.isNaN(n));
  return ts.length > 1 ? Math.round((Math.max(...ts) - Math.min(...ts)) / 36e5) : null;
};

/* ---------- prova de um feed de veículo ---------- */

interface CfgFeed {
  id: string; nome: string; url: string;
  paywall: string;
  /** filtro de seção quando o veículo só tem feed geral */
  secao?: RegExp;
  /** feed é geral (sem feed de política) → no máximo "parcial" */
  geral?: boolean;
  risco?: string;
  extra?: string[];
}

function provaFeed(c: CfgFeed): Prova {
  return {
    id: `imprensa-${c.id}`, nome: c.nome, grupo: 'imprensa', url: c.url,
    custo: '0 — RSS público',
    risco: c.risco ?? 'Baixo: RSS é oferecido pelo veículo para leitura; republicar só título + link, nunca o texto.',
    async rodar(): Promise<Medida> {
      const r = await pegarTexto(c.url);
      if (!r.ok) return falha(r, 'rss', r.status === 403 ? 'Bloqueio por IP/CDN (máquina fora do Brasil?) — rodar do servidor no Brasil antes de descartar.' : undefined);
      const todos = itens(r.corpo);
      if (!todos.length) return { ...falha(r, 'rss', 'Resposta 200 mas sem <item>/<entry> — URL de feed mudou.'), status: 'falhou' };
      const semColuna = todos.filter(i => !reColuna.test(i.url));
      const lista = c.secao ? semColuna.filter(i => c.secao!.test(i.url)) : semColuna;
      const comNome = lista.filter(i => reNome.test(`${i.titulo} ${i.resumo}`));
      const noTitulo = lista.filter(i => reNome.test(i.titulo));
      const comResumo = lista.filter(i => i.resumo.length > 40).length;
      const integral = lista.filter(i => i.texto).length;
      const atr = atraso(lista.map(i => i.data));
      const span = horas(lista);
      const formatoConteudo = integral > lista.length / 2 ? 'texto integral no feed' : comResumo > lista.length / 2 ? 'título + resumo' : 'só título';
      const notas = [
        `${todos.length} itens no feed; ${todos.length - semColuna.length} de coluna/blog/opinião descartados${c.secao ? `; ${semColuna.length - lista.length} fora da seção de política` : ''}; sobram ${lista.length}.`,
        `Menção a político da lista: ${comNome.length}/${lista.length} (${pct(comNome.length, lista.length)}) em título+resumo; ${pct(noTitulo.length, lista.length)} só no título.`,
        `Conteúdo: ${formatoConteudo} (${comResumo}/${lista.length} com resumo, ${integral} com texto longo). Paywall: ${c.paywall}.`,
        ...(span != null ? [`O feed cobre ~${span} h de publicação.`] : []),
        ...(c.extra ?? []),
      ];
      const status: Medida['status'] = !lista.length ? 'falhou' : c.geral || (atr != null && atr > 24) ? 'parcial' : 'ok';
      return {
        status, itens: lista.length, janela: `feed atual${span != null ? ` (~${span} h)` : ''}`, atrasoHoras: atr, formato: 'rss', idPolitico: false,
        amostra: amostra(comNome.length ? comNome : lista), notas,
      };
    },
  };
}

/* ---------- Google News (busca por nome) ---------- */

const NOMES_GN = ['Hugo Motta', 'Alcolumbre', 'Tarcísio de Freitas', 'Erika Hilton', 'Nikolas Ferreira'];
const GRANDES = /Folha|g1|Globo|Estadão|Estadao|UOL|CNN Brasil|Poder360|Metrópoles|Agência Brasil|BBC|Agência Senado|Agência Câmara|Valor|Veja|InfoMoney|Exame|CartaCapital|Correio Braziliense/i;

const googleNews: Prova = {
  id: 'imprensa-google-news', nome: 'Google News — RSS de busca por nome', grupo: 'imprensa',
  url: 'https://news.google.com/rss/search?q=%22Hugo+Motta%22+when:7d&hl=pt-BR&gl=BR&ceid=BR:pt-419',
  custo: '0 — RSS público, sem chave',
  risco: 'Alto: o próprio feed diz que é só para uso pessoal e não comercial; endpoint sem contrato, pode mudar ou bloquear sem aviso.',
  veredito: () => 'fora (termos: uso pessoal e não comercial; mistura coluna e site pequeno)',
  async rodar(): Promise<Medida> {
    const notas: string[] = [];
    const juntos: Item[] = [];
    let falhou: Resposta | null = null;
    for (const nome of NOMES_GN) {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${nome}" when:7d`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
      const r = await pegarTexto(url);
      if (!r.ok) { falhou = r; notas.push(`${nome}: HTTP ${r.status}`); continue; }
      if (/personal, non-commercial use/i.test(r.corpo)) notas[0] ??= 'Copyright do feed: "personal, non-commercial use ... any other use is expressly prohibited".';
      const lista = itens(r.corpo);
      const sobrenome = nome.split(' ').pop()!;
      const comNome = lista.filter(i => new RegExp(sobrenome, 'i').test(i.titulo));
      const grandes = lista.filter(i => GRANDES.test(i.fonte ?? i.titulo.split(' - ').pop() ?? ''));
      const coluna = lista.filter(i => /coluna|blog|opini/i.test(i.titulo));
      notas.push(`"${nome}" (7 d): ${lista.length} itens; nome no título em ${pct(comNome.length, lista.length)}; de veículo grande ${pct(grandes.length, lista.length)}; ${coluna.length} com cara de coluna/blog no título.`);
      juntos.push(...lista);
      await new Promise(res => setTimeout(res, 1500));
    }
    if (!juntos.length) return falha(falhou ?? { status: 0, ok: false, corpo: '', ms: 0, url: this.url, tipo: '' }, 'rss', notas.join(' · '));
    notas.push('Teto de 100 itens por busca. Link é redirecionador news.google.com/rss/articles/… (precisa resolver pra URL do veículo). Resumo é só o título repetido. Mistura colunas, blogs e sites pequenos: exige lista branca de domínios.');
    return {
      status: 'parcial', itens: juntos.length, janela: `7 dias × ${NOMES_GN.length} nomes`, atrasoHoras: atraso(juntos.map(i => i.data)),
      formato: 'rss', idPolitico: false, amostra: amostra(juntos), notas,
    };
  },
};

/* ---------- GDELT DOC API ---------- */

const gdelt: Prova = {
  id: 'imprensa-gdelt', nome: 'GDELT DOC 2.0 (busca por nome)', grupo: 'imprensa',
  url: 'https://api.gdeltproject.org/api/v2/doc/doc?query=%22Hugo%20Motta%22%20sourcelang:por&mode=artlist&maxrecords=75&format=json&timespan=7d',
  custo: '0 — API aberta, sem chave',
  risco: 'Baixo nos termos (dado aberto), alto na estabilidade: limite de 1 requisição a cada 5 s e cobertura irregular de veículo brasileiro.',
  async rodar(): Promise<Medida> {
    type G = { articles?: { url: string; title: string; seendate: string; domain: string }[] };
    let { r, dados } = await pegarJson<G>(this.url, { timeoutMs: 60_000 });
    if (r.status === 429) { // limite documentado: 1 requisição a cada 5 s
      await new Promise(res => setTimeout(res, 6000));
      ({ r, dados } = await pegarJson<G>(this.url, { timeoutMs: 60_000 }));
    }
    if (!dados) return falha(r, 'json', r.ok ? `Não veio JSON: "${r.corpo.slice(0, 120)}"`
      : 'GDELT responde 429 (limite de 1 req/5 s, aparentemente por IP e compartilhado) ou estoura o tempo; em teste manual na mesma sessão, a busca sem filtro de idioma devolveu só 2 artigos (em inglês, riotimesonline). Cobertura de imprensa brasileira fraca.');
    const arts = dados.articles ?? [];
    const lista: Amostra[] = arts.map(a => ({ titulo: a.title, url: a.url, data: a.seendate.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z') }));
    const dominios = [...new Set(arts.map(a => a.domain))];
    const grandes = arts.filter(a => /folha|globo|estadao|uol|cnnbrasil|poder360|metropoles|ebc|bbc|leg\.br/.test(a.domain));
    return {
      status: arts.length >= 20 ? 'parcial' : 'falhou', itens: arts.length, janela: '7 dias, 1 nome ("Hugo Motta")', atrasoHoras: atraso(lista.map(a => a.data)),
      formato: 'json', idPolitico: false, amostra: amostra(lista),
      notas: [
        `${arts.length} artigos em ${dominios.length} domínios; ${grandes.length} de veículo grande (${pct(grandes.length, arts.length)}).`,
        'Só título + URL + domínio, sem resumo. Útil como rede de segurança, não como fonte principal.',
      ],
    };
  },
};

/* ---------- lista ---------- */

const RISCO_PAYWALL = 'Baixo nos termos (RSS público); o leitor bate no paywall ao clicar — mostrar só título + link.';

export default [
  provaFeed({ id: 'folha', nome: 'Folha de S.Paulo — Poder', url: 'https://feeds.folha.uol.com.br/poder/rss091.xml', paywall: 'sim (limite de matérias grátis)', risco: RISCO_PAYWALL,
    extra: ['Feed em ISO-8859-1; link passa por redir.folha.com.br (URL real vem depois do "*").'] }),
  provaFeed({ id: 'g1', nome: 'G1 — Política', url: 'https://g1.globo.com/rss/g1/politica/', paywall: 'não' }),
  provaFeed({ id: 'estadao', nome: 'Estadão — Política', url: 'https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/politica/', paywall: 'sim (rígido)', risco: RISCO_PAYWALL }),
  provaFeed({ id: 'uol', nome: 'UOL — Notícias (feed geral)', url: 'https://rss.uol.com.br/feed/noticias.xml', paywall: 'parcial (parte do conteúdo é só para assinante)', geral: true,
    extra: ['UOL não tem RSS de política acessível: noticias.uol.com.br/politica/index.xml devolve 403 daqui. Feed geral mistura esporte e outros sites do grupo; pubDate em português.'] }),
  provaFeed({ id: 'oglobo', nome: 'O Globo — Política', url: 'https://oglobo.globo.com/rss/oglobo/politica', paywall: 'sim (limite de matérias grátis)', risco: RISCO_PAYWALL,
    extra: ['O feed de política inclui blogs de bastidor (Malu Gaspar, Bela Megale, Pulso etc.) — o filtro de /blogs/ é obrigatório.'] }),
  provaFeed({ id: 'cnn', nome: 'CNN Brasil — feed geral filtrado por /politica/', url: 'https://www.cnnbrasil.com.br/feed/', paywall: 'não', secao: /\/politica\//, geral: true,
    extra: ['Não existe /politica/feed/ (404); só o feed geral de 60 itens, filtrado pela URL.'] }),
  provaFeed({ id: 'poder360', nome: 'Poder360 (feed geral)', url: 'https://www.poder360.com.br/feed/', paywall: 'não',
    risco: 'Médio: o WAF do site recusa o cliente HTTP do Node (403) mesmo com o curl passando do mesmo IP — sem contrato, pode bloquear o servidor a qualquer momento.',
    extra: ['Se der 403: o curl com o mesmo user-agent e IP recebe 200, então é filtro de robô por assinatura do cliente, não bloqueio geográfico. Não contornamos.', 'Feed geral tem só 10 itens; o site é quase todo política. Feeds por editoria (/poder-governo/feed/) vêm quase vazios.'] }),
  { ...provaFeed({ id: 'metropoles', nome: 'Metrópoles — feed geral filtrado por /brasil/', url: 'https://www.metropoles.com/feed', paywall: 'não', secao: /\/brasil\//, geral: true,
    extra: ['/politica/feed responde mas está abandonado (item mais novo de jul/2025); /brasil/feed e /politica-brasil/feed vêm com itens de 1-2 semanas atrás. Feed geral é metade coluna (fofoca e bastidor) — o filtro de /colunas/ é obrigatório.'] }), veredito: () => 'fora (feed de política abandonado; o geral é metade coluna)' },
  provaFeed({ id: 'agencia-brasil', nome: 'Agência Brasil (EBC) — Política', url: 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml', paywall: 'não',
    risco: 'Baixo: agência pública, conteúdo sob Creative Commons BY (pode republicar com crédito).' }),
  provaFeed({ id: 'bbc', nome: 'BBC News Brasil (feed geral)', url: 'https://feeds.bbci.co.uk/portuguese/rss.xml', paywall: 'não', geral: true,
    extra: ['Não há feed só de Brasil/política; o geral mistura internacional.'] }),
  provaFeed({ id: 'agencia-senado', nome: 'Agência Senado', url: 'https://www12.senado.leg.br/noticias/rss', paywall: 'não',
    risco: 'Baixo: fonte oficial, uso livre com crédito.' }),
  provaFeed({ id: 'agencia-camara', nome: 'Agência Câmara — últimas', url: 'https://www.camara.leg.br/noticias/rss/ultimas-noticias', paywall: 'não',
    risco: 'Baixo: fonte oficial, uso livre com crédito.',
    extra: ['Também existe feed por tema (rss/dinamico/POLITICA, 10 itens). Cita deputados pelo nome, mas sem id oficial no item.'] }),
  googleNews,
  gdelt,
] satisfies Prova[];
