/* Links externos de cada político: o que veio do TSE (redes declaradas na candidatura) e da Câmara
   vira URL limpa e classificada. Puro, coberto por tests/links.test.ts.
   WhatsApp e e-mail ficam de fora (número e endereço pessoal não são página pública do mandato);
   agregador de link (linktr.ee) e vaquinha de campanha também. */

export type TipoLink = 'site' | 'instagram' | 'x' | 'facebook' | 'youtube' | 'tiktok' | 'threads' | 'bluesky' | 'linkedin' | 'kwai' | 'telegram';
export interface Link { tipo: TipoLink; url: string; fonte: string }

/** As redes que a página do político sempre mostra; as que faltarem viram "insira aqui". */
export const ESSENCIAIS: TipoLink[] = ['site', 'instagram', 'x', 'facebook', 'youtube', 'tiktok'];

const DOMINIOS: [RegExp, TipoLink][] = [
  [/(^|\.)instagra[mn]\.com$/, 'instagram'],
  [/(^|\.)(x|twitter)\.com$/, 'x'],
  [/(^|\.)(facebook|fb)\.com$/, 'facebook'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)threads\.(net|com)$/, 'threads'],
  [/(^|\.)bsky\.app$/, 'bluesky'],
  [/(^|\.)linkedin\.com$/, 'linkedin'],
  [/(^|\.)(kwai\.com|kwai-video\.com)$/, 'kwai'],
  [/(^|\.)(t\.me|telegram\.me)$/, 'telegram'],
];
const FORA = /(^|\.)(wa\.me|whatsapp\.com|linktr\.ee|queroapoiar\.com\.br|apoia\.se|vakinha\.com\.br|bit\.ly|spotify\.com|flickr\.com|gmail\.com|hotmail\.com)$/;
const BASE: Record<string, string> = {
  instagram: 'https://www.instagram.com/', x: 'https://x.com/', facebook: 'https://www.facebook.com/', youtube: 'https://www.youtube.com/@',
  tiktok: 'https://www.tiktok.com/@', threads: 'https://www.threads.net/@', kwai: 'https://www.kwai.com/@', telegram: 'https://t.me/',
};
const ROTULO_ESCRITO: Record<string, TipoLink> = {
  instagram: 'instagram', instagran: 'instagram', insta: 'instagram', ig: 'instagram', facebook: 'facebook', face: 'facebook', fb: 'facebook',
  x: 'x', twitter: 'x', youtube: 'youtube', tiktok: 'tiktok', threads: 'threads', kwai: 'kwai', telegram: 'telegram', site: 'site',
};

/** Uma entrada como veio ("HTTPS://WWW.INSTAGRAM.COM/FULANO", "INSTAGRAM: @FULANO", "fulano.com.br") → link limpo, ou null. */
export function normalizarLink(bruto: string, fonte: string): Link | null {
  let s = bruto.trim().replace(/\s+/g, '');
  if (!s || /^[^@:/]+@[^@/]+\.\w+$/.test(s)) return null;   // e-mail
  // "INSTAGRAM:@FULANO" ou "INSTAGRAM@FULANO"
  const rotulo = s.match(/^([a-zçã]+)(?::@?|@)(.+)$/i);
  if (rotulo && ROTULO_ESCRITO[rotulo[1].toLowerCase()] && !/^https?$/i.test(rotulo[1])) {
    const tipo = ROTULO_ESCRITO[rotulo[1].toLowerCase()];
    const resto = rotulo[2].replace(/^@/, '');
    if (/^https?:|\.(com|net|app|me|br)\b/i.test(resto)) return normalizarLink(resto, fonte);
    if (tipo === 'site' || !/^[\w.-]{2,40}$/.test(resto)) return null;
    return { tipo, url: BASE[tipo] + resto.toLowerCase(), fonte };
  }
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s.replace(/^http:/i, 'https:')); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|web|br|pt-br|mobile)\./, '');
  if (!host.includes('.') || FORA.test(host)) return null;
  const tipo = DOMINIOS.find(([rx]) => rx.test(host))?.[1] ?? 'site';
  if (tipo === 'instagram' && /^instagran/.test(host)) u.hostname = 'www.instagram.com';
  // caminho em minúsculas (as redes não diferenciam); sem rastreio, sem barra final
  let caminho = u.pathname.toLowerCase().replace(/\/+$/, '');
  if (tipo !== 'site' && !caminho) return null;                                    // só o domínio da rede: não é perfil
  if (!ehPerfil(tipo, caminho)) return null;                                        // post, vídeo, story: não é perfil
  if (tipo === 'facebook' && /^\/(profile\.php)$/.test(caminho)) {
    const id = u.searchParams.get('id');
    if (!id) return null;
    return { tipo, url: `https://www.facebook.com/profile.php?id=${id}`, fonte };
  }
  const hostFinal = tipo === 'site' ? u.hostname.toLowerCase() : ({ instagram: 'www.instagram.com', x: 'x.com', facebook: 'www.facebook.com', youtube: 'www.youtube.com', tiktok: 'www.tiktok.com', threads: 'www.threads.net' } as Record<string, string>)[tipo] ?? u.hostname.toLowerCase();
  return { tipo, url: `https://${hostFinal}${caminho}`, fonte };
}

/** Caminho de perfil, não de um post ou vídeo solto. */
function ehPerfil(tipo: TipoLink, caminho: string): boolean {
  switch (tipo) {
    case 'youtube': return /^\/(@|c\/|channel\/|user\/)[^/]+$/.test(caminho) || /^\/[^/@]+$/.test(caminho) && !/^\/(watch|shorts|live|playlist|results)$/.test(caminho);
    case 'instagram': return /^\/[\w.]+$/.test(caminho) && !/^\/(p|reel|reels|stories|explore|tv)$/.test(caminho);
    case 'x': return /^\/\w{1,15}$/.test(caminho) && !/^\/(home|search|intent|share|i)$/.test(caminho);
    case 'tiktok': return /^\/@[\w.]+$/.test(caminho);
    case 'facebook': return !/\/(posts|videos|photos?|watch|share|reel|events|story\.php|sharer)(\/|\.php|$)/.test(caminho);
    default: return true;
  }
}

/** Junta links de várias fontes: um por URL, na ordem das fontes (a primeira ganha), no máximo 3 por tipo. */
export function juntarLinks(listas: Link[][]): Link[] {
  const vistos = new Set<string>(), porTipo = new Map<TipoLink, number>(), out: Link[] = [];
  for (const l of listas.flat()) {
    const chave = l.url.toLowerCase();
    if (vistos.has(chave) || (porTipo.get(l.tipo) ?? 0) >= 3) continue;
    vistos.add(chave);
    porTipo.set(l.tipo, (porTipo.get(l.tipo) ?? 0) + 1);
    out.push(l);
  }
  return out;
}

/** O link mais provável de ser o oficial, um por rede: fonte oficial ou aprovada primeiro, depois o que
 *  traz o nome de urna no endereço, depois "oficial", depois o endereço mais curto. Os outros ficam no dado. */
export function principais(links: Link[], nomeUrna: string): Link[] {
  const nome = nomeUrna.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const nota = (l: Link) => {
    const u = l.url.toLowerCase(), host = u.replace(/^https:\/\//, '').split('/')[0];
    return (l.fonte === 'sugestao' || l.fonte === 'camara' ? 100 : 0) + (nome.some(w => u.includes(w)) ? 10 : 0)
      + (l.tipo === 'site' && nome.some(w => host.includes(w)) ? 5 : 0)            // domínio próprio com o nome
      - (/\.(pages\.dev|vercel\.app|netlify\.app|github\.io|carrd\.co|blogspot\.com|wixsite\.com|wordpress\.com)$/.test(host) ? 8 : 0)
      + (/oficial|ofc/.test(u) ? 3 : 0) - u.length / 100;
  };
  const melhor = new Map<TipoLink, Link>();
  for (const l of links) { const atual = melhor.get(l.tipo); if (!atual || nota(l) > nota(atual)) melhor.set(l.tipo, l); }
  return [...melhor.values()];
}
