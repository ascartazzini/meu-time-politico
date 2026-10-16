/* Fase 0 — redes abertas, sem login e sem chave: YouTube (RSS do canal), Bluesky (AppView público)
   e Telegram (prévia pública t.me/s/<canal>). Só canais verificados como existentes nesta data;
   nenhum handle é inventado: o que não foi achado vira nota. */
import { type Prova, type Medida, type Amostra, pegar, pegarJson, itensRss, atraso, amostra, falha, decodificar } from './base';

const SEMANA = 7 * 864e5;
const naSemana = (d: string) => Date.now() - new Date(d).getTime() < SEMANA;

/* ---------- YouTube ---------- */

/** channel_id conferidos em 16/out/2026 abrindo youtube.com/@handle (campo externalId). */
const CANAIS_YT = [
  { quem: 'Lula (presidente)', handle: '@LulaOficial', id: 'UCvO2BExvkAbGMsTGnEnI_Ng', obs: 'selo de verificado' },
  { quem: 'Tarcísio de Freitas (governador de SP)', handle: '@tarcisiogdf', id: 'UC9KMn-rfwWXb7JXepLWnx-w', obs: 'selo de verificado' },
  { quem: 'Nikolas Ferreira (deputado federal, MG)', handle: '@nikolasferreiradm', id: 'UCsqFXdZhmkwxL__zlPVSSxA', obs: 'mesmo handle das outras redes dele; @nikolasferreira é canal antigo, parado desde 2014' },
];

const youtube: Prova = {
  id: 'rede-youtube', nome: 'YouTube — RSS público do canal', grupo: 'rede-aberta',
  url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UCvO2BExvkAbGMsTGnEnI_Ng',
  custo: '0 — RSS público, sem chave',
  risco: 'Baixo: feed oficial e estável há anos; mostrar título + link (embed), não baixar vídeo.',
  async rodar(): Promise<Medida> {
    const notas: string[] = [];
    const todos: Amostra[] = [];
    let ultimaFalha = null as Awaited<ReturnType<typeof pegar>> | null;
    for (const c of CANAIS_YT) {
      const r = await pegar(`https://www.youtube.com/feeds/videos.xml?channel_id=${c.id}`);
      if (!r.ok) { ultimaFalha = r; notas.push(`${c.quem}: HTTP ${r.status}`); continue; }
      const v = itensRss(r.corpo).map(a => ({ ...a, titulo: `${c.quem.split(' (')[0]}: ${a.titulo}` }));
      const semana = v.filter(a => naSemana(a.data));
      notas.push(`${c.quem} ${c.handle} (${c.obs}): ${v.length} vídeos no feed, ${semana.length} nos últimos 7 dias, mais recente há ${atraso(v.map(a => a.data)) ?? '?'} h.`);
      todos.push(...semana);
    }
    if (!todos.length && ultimaFalha) return falha(ultimaFalha, 'xml', notas.join(' · '));
    notas.push('Feed dá os 15 vídeos mais recentes (Atom) com título, data e descrição; sem contagem confiável de views. O channel_id liga ao político de forma estável (cadastrar à mão uma vez).');
    todos.sort((a, b) => b.data.localeCompare(a.data));
    return {
      status: todos.length ? 'ok' : 'parcial', itens: todos.length, janela: `7 dias × ${CANAIS_YT.length} canais`, atrasoHoras: atraso(todos.map(a => a.data)),
      formato: 'xml', idPolitico: false, amostra: amostra(todos), notas,
    };
  },
};

/* ---------- Bluesky ---------- */

const NOMES_BSKY = [
  'Lula', 'Fernando Haddad', 'Tarcísio Gomes de Freitas', 'Guilherme Boulos', 'Erika Hilton',
  'Tabata Amaral', 'Gleisi Hoffmann', 'Marina Silva', 'Nikolas Ferreira', 'Randolfe Rodrigues', 'Flávio Bolsonaro', 'Hugo Motta',
];
const sem = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

interface Ator { did: string; handle: string; displayName?: string; description?: string; verification?: { verifiedStatus?: string } }
interface Post { post: { uri: string; record: { createdAt: string; text: string } }; reason?: unknown }

const bluesky: Prova = {
  id: 'rede-bluesky', nome: 'Bluesky — AppView público (searchActors + getAuthorFeed)', grupo: 'rede-aberta',
  url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=lulaoficialbluesky.bsky.social',
  custo: '0 — API pública, sem login',
  risco: 'Baixo: protocolo aberto e API pública documentada; o risco é a conta não ser oficial (só o selo de verificação garante).',
  async rodar(): Promise<Medida> {
    const API = 'https://public.api.bsky.app/xrpc';
    const notas: string[] = [];
    const posts: Amostra[] = [];
    let achadas = 0, verificadas = 0, ativas = 0, ativasVerif = 0;
    for (const nome of NOMES_BSKY) {
      const { r, dados } = await pegarJson<{ actors: Ator[] }>(`${API}/app.bsky.actor.searchActors?q=${encodeURIComponent(nome)}&limit=10`);
      if (!dados) { if (!r.ok && !achadas) return falha(r, 'json'); notas.push(`${nome}: busca falhou (HTTP ${r.status})`); continue; }
      const alvo = sem(nome);
      const candidatos = dados.actors.filter(a => sem(a.displayName ?? '').includes(alvo) || (sem(a.displayName ?? '') === alvo.split(' ')[0]));
      const limpos = candidatos.filter(a => !/n[aã]o oficial|apoi|f[aã] clube|parod|fake/i.test(`${a.displayName} ${a.description}`));
      // oficial = selo do Bluesky. Sem selo, só aceitamos como "plausível" se o handle começa pelo prenome; o resto é homônimo.
      const verificada = limpos.find(a => a.verification?.verifiedStatus === 'valid');
      const plausivel = limpos.find(a => sem(a.handle).startsWith(alvo.split(' ')[0]));
      const conta = verificada ?? plausivel;
      if (!conta) { notas.push(`${nome}: nenhuma conta plausível (${candidatos.length} perfis com o nome, nenhum com selo nem handle compatível).`); continue; }
      achadas++;
      const verif = conta === verificada;
      if (verif) verificadas++;
      const f = await pegarJson<{ feed: Post[] }>(`${API}/app.bsky.feed.getAuthorFeed?actor=${conta.did}&limit=50&filter=posts_no_replies`);
      const proprios = (f.dados?.feed ?? []).filter(p => !p.reason);
      const datas = proprios.map(p => p.post.record.createdAt).sort().reverse();
      const semana = proprios.filter(p => naSemana(p.post.record.createdAt));
      if (semana.length) { ativas++; if (verif) ativasVerif++; }
      notas.push(`${nome} → @${conta.handle} (${verif ? 'verificada pelo Bluesky' : 'sem selo, oficialidade não confirmada'}${candidatos.length > 1 ? `; ${candidatos.length} perfis com esse nome` : ''}): ${semana.length} posts em 7 d, último ${datas[0]?.slice(0, 10) ?? 'nunca'}.`);
      if (verif) posts.push(...semana.map(p => {
        const [, , did, , rkey] = p.post.uri.split('/');
        return { data: p.post.record.createdAt, titulo: `@${conta.handle}: ${p.post.record.text.replace(/\s+/g, ' ')}`, url: `https://bsky.app/profile/${did}/post/${rkey}` };
      }));
    }
    notas.unshift(`${NOMES_BSKY.length} nomes testados: ${achadas} com conta plausível, ${verificadas} verificada(s) pelo Bluesky, ${ativas} com post nos últimos 7 dias (${ativasVerif} delas verificadas). Itens e amostra contam só contas verificadas.`);
    notas.push('Muitos perfis homônimos (fã-clube, paródia, "não oficial"); sem selo, a ligação conta→político precisa de conferência manual (link no site oficial do político).');
    posts.sort((a, b) => b.data.localeCompare(a.data));
    return {
      status: ativasVerif >= 3 ? 'ok' : ativas ? 'parcial' : 'falhou', itens: posts.length, janela: `7 dias × ${verificadas} conta(s) verificada(s)`, atrasoHoras: atraso(posts.map(p => p.data)),
      formato: 'json', idPolitico: false, amostra: amostra(posts), notas,
    };
  },
};

/* ---------- Telegram ---------- */

/** Canais com selo de verificado do Telegram, conferidos na prévia pública em 16/out/2026. */
const CANAIS_TG = [
  { quem: 'Nikolas Ferreira (deputado federal, MG)', canal: 'nikolasferreira' },
  { quem: 'Flávio Bolsonaro (senador, RJ)', canal: 'SenadorFlavioBolsonaro' },
  { quem: 'Jair Bolsonaro (ex-presidente)', canal: 'jairbolsonarobrasil' },
];

const telegram: Prova = {
  id: 'rede-telegram', nome: 'Telegram — prévia pública t.me/s/<canal>', grupo: 'rede-aberta',
  url: 'https://t.me/s/nikolasferreira',
  custo: '0 — página pública, sem login',
  risco: 'Médio: é HTML pensado pra navegador, sem API documentada pra isso; markup pode mudar e o Telegram pode limitar acesso automatizado.',
  async rodar(): Promise<Medida> {
    const notas: string[] = [];
    const posts: Amostra[] = [];
    let ultimaFalha = null as Awaited<ReturnType<typeof pegar>> | null;
    for (const c of CANAIS_TG) {
      const r = await pegar(`https://t.me/s/${c.canal}`);
      if (!r.ok) { ultimaFalha = r; notas.push(`${c.quem}: HTTP ${r.status}`); continue; }
      const verificado = /verified-icon/.test(r.corpo);
      const inscritos = r.corpo.match(/<span class="counter_value">([^<]+)<\/span>\s*<span class="counter_type">subscribers/)?.[1] ?? '?';
      const blocos = r.corpo.split('tgme_widget_message_wrap').slice(1);
      const msgs = blocos.map(b => {
        const data = b.match(/datetime="([^"]+)"/)?.[1] ?? '';
        const link = b.match(/data-post="([^"]+)"/)?.[1];
        const texto = decodificar((b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
        return { data, url: link ? `https://t.me/${link}` : '', titulo: `${c.quem.split(' (')[0]}: ${texto || '[mídia sem texto]'}` };
      }).filter(m => m.data);
      const semana = msgs.filter(m => naSemana(m.data));
      notas.push(`${c.quem} t.me/${c.canal} (${verificado ? 'verificado' : 'sem selo'}, ${inscritos} inscritos): prévia mostra ${msgs.length} posts, ${semana.length} em 7 d, último há ${atraso(msgs.map(m => m.data)) ?? '?'} h.`);
      posts.push(...semana);
    }
    if (!posts.length && ultimaFalha) return falha(ultimaFalha, 'html', notas.join(' · '));
    notas.push('Prévia mostra só os ~20 posts mais recentes (mais antigos exigem paginação ?before=). Muitos posts são vídeo/repost sem texto.');
    notas.push('Não achei canal oficial do Lula, do Tarcísio nem do Boulos (t.me/s/lula, LulaOficial, tarcisiogdf etc. não existem). Uso no Brasil é concentrado na direita.');
    posts.sort((a, b) => b.data.localeCompare(a.data));
    const ativos = new Set(posts.map(p => p.titulo.split(':')[0])).size;
    return {
      status: ativos ? 'parcial' : 'falhou', itens: posts.length, janela: `7 dias × ${CANAIS_TG.length} canais`, atrasoHoras: atraso(posts.map(p => p.data)),
      formato: 'html', idPolitico: false, amostra: amostra(posts), notas,
    };
  },
};

export default [youtube, bluesky, telegram] satisfies Prova[];
