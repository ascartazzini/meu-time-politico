/* Fase 0 — redes fechadas (Instagram, X, Facebook, Threads, TikTok).
   Regra do dono: só página PÚBLICA, sem login, sem conta, sem contornar bloqueio/captcha,
   sem serviço de terceiro (nitter, proxy, scraper pago), em ritmo baixo.
   Perfil de teste: Lula, que tem conta oficial verificada nas cinco redes.
   Cada prova faz poucas requisições GET, uma de cada vez, com pausa entre elas. */
import { pegar, decodificar, atraso, amostra, type Prova, type Medida, type Amostra, type Resposta } from './base';

/* O UA do helper (scripts/util.ts) tem "í" em "cívica". Meta responde 400 a ele e o Cloudflare do X dá 403.
   A mesma identificação só com ASCII passa. Tenta primeiro o do helper; se falhar, repete uma vez com o ASCII
   e registra as duas respostas na nota. Não é disfarce: continua dizendo quem somos. */
const UA_ASCII = 'MeuTimePolitico2026/0.1 (tech civica; +https://github.com/ascartazzini)';
const PAUSA_MS = 1500;
const dormir = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Tentativa { r: Resposta; nota: string }

async function pegarRede(url: string, headers: Record<string, string> = {}): Promise<Tentativa> {
  const r1 = await pegar(url, { headers });
  await dormir(PAUSA_MS);
  if (r1.ok) return { r: r1, nota: `HTTP ${r1.status} (UA do helper)` };
  const r2 = await pegar(url, { headers: { ...headers, 'User-Agent': UA_ASCII } });
  await dormir(PAUSA_MS);
  return { r: r2, nota: `UA do helper: HTTP ${r1.status}${muro(r1) ? ` (${muro(r1)})` : ''}; UA só ASCII: HTTP ${r2.status}${muro(r2) ? ` (${muro(r2)})` : ''}` };
}

/** Diagnóstico curto do corpo quando não veio o conteúdo esperado. */
function muro(r: Resposta): string {
  const c = r.corpo;
  if (r.status === 0) return r.erro ?? 'sem resposta';
  if (/Attention Required! \| Cloudflare|you have been blocked/i.test(c)) return 'bloqueio Cloudflare';
  if (/Pardon Our Interruption|Incapsula/i.test(c)) return 'desafio Imperva';
  if (/Rate limit exceeded/i.test(c)) return 'rate limit';
  if (/useragent mismatch/i.test(c)) return 'API recusa: "useragent mismatch"';
  if (/overload-protect/i.test(c)) return 'overload-protect';
  if (/4xx Client Error/.test(c)) return 'erro 4xx genérico da Meta';
  if (/access token|OAuthException/i.test(c)) return 'exige access token';
  return '';
}

const decHex = (s: string) => decodificar(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const meta = (html: string, prop: string) =>
  decHex(html.match(new RegExp(`<meta[^>]+(?:property|name)="${prop}"[^>]+content="([^"]*)"`))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="${prop}"`))?.[1] ?? '');

const unico = (s: string) => s.replace(/\s+/g, ' ').trim();
const dentro7 = (lista: Amostra[]) => lista.filter(a => Date.now() - new Date(a.data).getTime() <= 7 * 864e5).length;

/** Mede um perfil que só dá meta-dados (sem posts): devolve a nota do que veio. */
function perfilSemPosts(rotulo: string, t: Tentativa): string {
  if (!t.r.ok) return `${rotulo}: ${t.nota}`;
  const desc = meta(t.r.corpo, 'og:description') || meta(t.r.corpo, 'description');
  return `${rotulo}: ${t.nota}, ${Math.round(t.r.corpo.length / 1024)} KB; só meta-dados do perfil${desc ? ` ("${unico(desc).slice(0, 110)}")` : ''}, nenhum post no HTML`;
}

function semPosts(notas: string[], algumPerfil: boolean, formato: Medida['formato'] = 'html'): Medida {
  return { status: algumPerfil ? 'parcial' : 'bloqueado', itens: algumPerfil ? 0 : null, janela: algumPerfil ? 'só perfil' : '—', atrasoHoras: null, formato, idPolitico: false, amostra: [], notas };
}

/* ---------- Instagram ---------- */
async function instagram(): Promise<Medida> {
  const handle = 'lulaoficial';
  const notas: string[] = [];
  const perfil = await pegarRede(`https://www.instagram.com/${handle}/`);
  notas.push(perfilSemPosts(`perfil instagram.com/${handle}`, perfil));
  const api = await pegarRede(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${handle}`);
  notas.push(`API web_profile_info: ${api.nota}${muro(api.r) ? ` — ${muro(api.r)}` : ''}; exige cabeçalho de app (x-ig-app-id) do navegador, não usado (seria fingir ser o app)`);

  const emb = await pegarRede(`https://www.instagram.com/${handle}/embed/`);
  if (!emb.r.ok) { notas.push(`embed do perfil: ${emb.nota}`); return semPosts(notas, perfil.r.ok); }
  const m = emb.r.corpo.match(/"contextJSON":"((?:[^"\\]|\\.)*)"/);
  let posts: Amostra[] = [];
  if (m) {
    try {
      const ctx = JSON.parse(JSON.parse(`"${m[1]}"`));
      const achados: { shortcode: string; ts: number; texto: string }[] = [];
      const andar = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(andar); return; }
        const x = o as Record<string, any>;
        if (typeof x.shortcode === 'string' && typeof x.taken_at_timestamp === 'number') {
          achados.push({ shortcode: x.shortcode, ts: x.taken_at_timestamp, texto: x.edge_media_to_caption?.edges?.[0]?.node?.text ?? '' });
        }
        Object.values(x).forEach(andar);
      };
      andar(ctx);
      const vistos = new Set<string>();
      posts = achados.filter(a => !vistos.has(a.shortcode) && vistos.add(a.shortcode))
        .sort((a, b) => b.ts - a.ts)
        .map(a => ({ data: new Date(a.ts * 1000).toISOString(), titulo: unico(a.texto) || '(sem legenda)', url: `https://www.instagram.com/p/${a.shortcode}/` }));
    } catch (e) { notas.push(`contextJSON do embed não parseou: ${(e as Error).message}`); }
  }
  notas.push(`embed do perfil instagram.com/${handle}/embed/: ${emb.nota}; ${posts.length} posts com data e legenda no JSON embutido (contextJSON), ${dentro7(posts)} nos últimos 7 dias`);
  notas.push('o embed de perfil não é documentado pela Meta como API; o oficial (instagram_oembed no Graph) exige token de app');
  if (!posts.length) return semPosts(notas, perfil.r.ok || emb.r.ok);
  return {
    status: posts.length > 1 ? 'ok' : 'parcial', itens: posts.length, janela: `últimos ${posts.length} posts (embed do perfil)`,
    atrasoHoras: atraso(posts.map(p => p.data)), formato: 'json', idPolitico: false, amostra: amostra(posts), notas,
  };
}

/* ---------- X / Twitter ---------- */
async function x(): Promise<Medida> {
  const handle = 'LulaOficial';
  const notas: string[] = [];
  const pag = await pegarRede(`https://x.com/${handle}`);
  let posts: Amostra[] = [];
  if (pag.r.ok) {
    // A página pública vem com o resultado da consulta GraphQL do perfil serializado em strings JS (value:"{...}").
    const tweets = new Map<string, Amostra>();
    for (const m of pag.r.corpo.matchAll(/value:"((?:[^"\\]|\\.)*)"/g)) {
      if (!m[1].includes('full_text')) continue;
      let dados: unknown;
      try { dados = JSON.parse(JSON.parse(`"${m[1]}"`)); } catch { continue; }
      const andar = (o: unknown): void => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(andar); return; }
        const t = o as Record<string, any>;
        if (t.__typename === 'Tweet' && typeof t.rest_id === 'string') {
          const texto = buscar(t, 'full_text');
          const ms = buscar(t, 'created_at_ms');
          const autor = buscar(t, 'screen_name');
          if (texto && ms && !tweets.has(t.rest_id)) {
            tweets.set(t.rest_id, { data: new Date(Number(ms)).toISOString(), titulo: `${autor && autor !== handle ? `[@${autor}] ` : ''}${unico(String(texto))}`, url: `https://x.com/${handle}/status/${t.rest_id}` });
          }
        }
        Object.values(t).forEach(andar);
      };
      andar(dados);
    }
    posts = [...tweets.values()].sort((a, b) => b.data.localeCompare(a.data));
    notas.push(`perfil x.com/${handle}: ${pag.nota}; ${posts.length} posts com data e texto no HTML (resultado GraphQL embutido, pedido com count=20, veio menos), ${dentro7(posts)} nos últimos 7 dias`);
    notas.push('o X só manda os posts no HTML para clientes que ele trata como robô de indexação; com UA de navegador vem a casca JS — comportamento não documentado, pode sumir sem aviso');
  } else notas.push(`perfil x.com/${handle}: ${pag.nota}`);

  const synd = await pegarRede(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`);
  notas.push(`syndication timeline-profile (widget público): ${synd.nota}${muro(synd.r) ? ` — ${muro(synd.r)}` : ''}`);
  const oe = await pegarRede(`https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://twitter.com/${handle}`)}`);
  notas.push(`oEmbed publish.twitter.com: ${oe.nota}; devolve só o link do widget de timeline (carregado por JS), sem posts`);
  notas.push('API oficial do X: plano grátis só escreve; leitura é paga — fora pela regra do dono');

  if (!posts.length) return pag.r.ok ? semPosts(notas, true) : { ...falhaRede(pag), notas };
  return {
    status: posts.length > 1 ? 'ok' : 'parcial', itens: posts.length, janela: `últimos ${posts.length} posts (HTML público do perfil)`,
    atrasoHoras: atraso(posts.map(p => p.data)), formato: 'json', idPolitico: false, amostra: amostra(posts), notas,
  };
}

/** Primeiro valor da chave no objeto, sem descer em outro Tweet (citado/retuitado). */
function buscar(o: Record<string, any>, chave: string, raiz = true): unknown {
  if (!raiz && o.__typename === 'Tweet') return undefined;
  if (chave in o && (typeof o[chave] === 'string' || typeof o[chave] === 'number')) return o[chave];
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') {
      const achou = Array.isArray(v) ? v.map(i => (i && typeof i === 'object' ? buscar(i, chave, false) : undefined)).find(Boolean) : buscar(v, chave, false);
      if (achou !== undefined) return achou;
    }
  }
  return undefined;
}

function falhaRede(t: Tentativa): Medida {
  const bloq = [400, 401, 403, 429, 451].includes(t.r.status) || !!muro(t.r);
  return { status: bloq ? 'bloqueado' : 'falhou', itens: null, janela: '—', atrasoHoras: null, formato: 'html', idPolitico: false, amostra: [], notas: [t.nota] };
}

/* ---------- Facebook (página) ---------- */
async function facebook(): Promise<Medida> {
  const pagina = 'Lula';
  const notas: string[] = [];
  const p = await pegarRede(`https://www.facebook.com/${pagina}`);
  notas.push(perfilSemPosts(`página facebook.com/${pagina}`, p));
  const plug = await pegarRede(`https://www.facebook.com/plugins/page.php?href=${encodeURIComponent(`https://www.facebook.com/${pagina}`)}&tabs=timeline&width=500&height=800`);
  const temData = /data-utime|"publish_time"|"creation_time"/.test(plug.r.corpo);
  notas.push(`plugin de página (embed público, tabs=timeline): ${plug.nota}; ${plug.r.ok ? `traz nome e seguidores, ${temData ? 'com' : 'sem'} posts datados — a timeline é carregada depois por JS` : 'não abriu'}`);
  const oe = await pegarRede(`https://graph.facebook.com/v19.0/oembed_page?url=${encodeURIComponent(`https://www.facebook.com/${pagina}`)}`);
  notas.push(`oEmbed oficial (graph.facebook.com/oembed_page): ${oe.nota}${muro(oe.r) ? ` — ${muro(oe.r)}` : ''}; ${oe.r.ok ? 'abre sem token, mas devolve só o bloco do plugin (SDK JS), sem posts' : 'não abriu'}. Posts da página só pela Graph API com token de app Meta, fora pela regra`);
  return semPosts(notas, p.r.ok || plug.r.ok);
}

/* ---------- Threads ---------- */
async function threads(): Promise<Medida> {
  const handle = 'lulaoficial';
  const notas: string[] = [];
  const p = await pegarRede(`https://www.threads.com/@${handle}`);
  notas.push(perfilSemPosts(`perfil threads.com/@${handle} (threads.net redireciona pra cá)`, p));
  const emb = await pegarRede(`https://www.threads.com/@${handle}/embed`);
  notas.push(`embed do perfil: ${emb.nota}; ${emb.r.ok ? 'casca vazia, sem posts' : 'não abriu'}`);
  notas.push('embed de post (threads.com/@x/post/ID/embed) precisa do ID do post, que o perfil sem login não entrega; API oficial do Threads exige token do próprio dono da conta');
  return semPosts(notas, p.r.ok);
}

/* ---------- TikTok ---------- */
async function tiktok(): Promise<Medida> {
  const handle = 'lulaoficial';
  const notas: string[] = [];
  const p = await pegarRede(`https://www.tiktok.com/@${handle}`);
  if (p.r.ok) {
    const m = p.r.corpo.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    let resumo = 'sem JSON embutido';
    try {
      const ud = m ? JSON.parse(m[1]).__DEFAULT_SCOPE__?.['webapp.user-detail'] : null;
      if (ud) resumo = `JSON embutido com perfil (${ud.userInfo?.user?.nickname ?? '?'}, ${ud.userInfo?.stats?.videoCount ?? '?'} vídeos, ${ud.userInfo?.stats?.followerCount ?? '?'} seguidores) e lista de vídeos ${ud.userInfo?.itemList?.length ? `com ${ud.userInfo.itemList.length}` : 'vazia'}`;
    } catch { resumo = 'JSON embutido não parseou'; }
    notas.push(`perfil tiktok.com/@${handle}: ${p.nota}; ${resumo}. A lista de vídeos vem de /api/post/item_list com assinatura (X-Bogus/msToken) gerada no navegador — forjar isso é contornar proteção, fora`);
  } else notas.push(`perfil tiktok.com/@${handle}: ${p.nota}`);

  // O embed oscila entre 200 e 503 "overload-protect" na mesma hora; até 3 tentativas, com pausa.
  let emb = await pegarRede(`https://www.tiktok.com/embed/@${handle}`);
  for (let i = 0; i < 2 && emb.r.status === 503; i++) { await dormir(4000); emb = await pegarRede(`https://www.tiktok.com/embed/@${handle}`); }
  let posts: Amostra[] = [];
  if (emb.r.ok) {
    const m = emb.r.corpo.match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/);
    try {
      const estado = m ? JSON.parse(m[1]) : null;
      const lista: any[] = Object.values(estado?.source?.data ?? {}).map((d: any) => d?.videoList).find(Array.isArray) ?? [];
      posts = lista.filter(v => v?.id && /^\d{15,}$/.test(v.id)).map(v => ({
        // ID de vídeo do TikTok é tipo snowflake: os 32 bits altos são o epoch em segundos.
        data: new Date(Number(BigInt(v.id) >> 32n) * 1000).toISOString(),
        titulo: unico(v.desc ?? '') || '(sem legenda)',
        url: `https://www.tiktok.com/@${handle}/video/${v.id}`,
      })).sort((a, b) => b.data.localeCompare(a.data));
    } catch (e) { notas.push(`estado do embed não parseou: ${(e as Error).message}`); }
    notas.push(`embed de criador tiktok.com/embed/@${handle}: ${emb.nota}; ${posts.length} vídeos com legenda, ${dentro7(posts)} nos últimos 7 dias. A data NÃO vem explícita: é derivada do ID do vídeo (bits altos = epoch)`);
  } else notas.push(`embed de criador: ${emb.nota} — em testes manuais (curl) no mesmo dia ele alternou 200/503 e, quando abriu, trouxe 11 vídeos com legenda (data derivável do ID); instável demais pra feed diário`);
  const oe = await pegarRede(`https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@${handle}`)}`);
  notas.push(`oEmbed oficial (perfil): ${oe.nota}; devolve só nome e o bloco do widget, sem vídeos`);
  notas.push('API de pesquisa do TikTok (Research API) é só para academia aprovada; Display API exige login do dono');

  if (!posts.length) return semPosts(notas, p.r.ok || emb.r.ok);
  return {
    status: posts.length > 1 ? 'ok' : 'parcial', itens: posts.length, janela: `últimos ${posts.length} vídeos (embed de criador)`,
    atrasoHoras: atraso(posts.map(p => p.data)), formato: 'json', idPolitico: false, amostra: amostra(posts), notas,
  };
}

const RISCO_META = 'Termos da Meta proíbem coleta automatizada sem permissão; embed/HTML público não é API e muda sem aviso.';

const provas: Prova[] = [
  {
    id: 'fechada-instagram', nome: 'Instagram — perfil público (@lulaoficial)', grupo: 'rede-fechada',
    url: 'https://www.instagram.com/lulaoficial/embed/',
    custo: '0 — sem chave; só embed público do perfil',
    risco: RISCO_META,
    veredito: m => m.status === 'ok' ? 'usar com cuidado (embed, ritmo baixo, pronto pra cair)' : 'fora, por ora',
    rodar: instagram,
  },
  {
    id: 'fechada-x', nome: 'X/Twitter — perfil público (@LulaOficial)', grupo: 'rede-fechada',
    url: 'https://x.com/LulaOficial',
    custo: '0 — sem chave; API oficial de leitura é paga',
    risco: 'Termos do X proíbem scraping sem consentimento; os posts só vêm no HTML servido a robôs e isso pode mudar a qualquer hora.',
    veredito: m => m.status === 'ok' ? 'usar com cuidado (HTML de robô, pronto pra cair)' : 'fora, por ora',
    rodar: x,
  },
  {
    id: 'fechada-facebook', nome: 'Facebook — página pública (/Lula)', grupo: 'rede-fechada',
    url: 'https://www.facebook.com/Lula',
    custo: '0 — mas posts só via Graph API com token de app',
    risco: RISCO_META,
    veredito: m => m.status === 'ok' ? 'usar com cuidado' : 'fora: sem login só vem o cabeçalho da página',
    rodar: facebook,
  },
  {
    id: 'fechada-threads', nome: 'Threads — perfil público (@lulaoficial)', grupo: 'rede-fechada',
    url: 'https://www.threads.com/@lulaoficial',
    custo: '0 — mas posts só com login ou token do dono',
    risco: RISCO_META,
    veredito: m => m.status === 'ok' ? 'usar com cuidado' : 'fora: sem login só vem o cabeçalho do perfil',
    rodar: threads,
  },
  {
    id: 'fechada-tiktok', nome: 'TikTok — perfil público (@lulaoficial)', grupo: 'rede-fechada',
    url: 'https://www.tiktok.com/embed/@lulaoficial',
    custo: '0 — sem chave; só embed de criador',
    risco: 'Termos do TikTok proíbem coleta automatizada; o embed oscila (503 overload-protect) e a data sai do ID, não do dado.',
    veredito: m => m.status === 'ok' ? 'usar com cuidado (embed instável, data derivada do ID)' : 'fora, por ora',
    rodar: tiktok,
  },
];

export default provas;
