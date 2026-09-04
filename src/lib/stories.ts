/* ==========================================================================
   IMAGEM PRO STORIES — 1080×1920, desenhada em canvas no navegador.
   montarStories() é pura (sem DOM) e decide o que aparece; desenharStories() pinta.
   Nada sai do navegador: a pessoa recebe o PNG e escolhe onde postar.
   ========================================================================== */
import type { Placar } from './motor';

export const LARGURA = 1080;
export const ALTURA = 1920;

export interface ConteudoStories {
  kicker: string;                                   // BRASIL · RIO GRANDE DO SUL · 4 DE OUTUBRO
  forca: number;
  veredito: string;
  classe: Placar['veredito']['c'];
  coerencia: number;
  peso: number;
  gols: number;
  golsRotulo: string;                               // "GOL CONTRA" / "GOLS CONTRA"
  golsSub: string;                                  // onde foi medido
  tituloEscalacao: string;                          // "MINHA ESCALAÇÃO" / "A ESCALAÇÃO"
  escalacao: { cargo: string; nome: string; partido: string }[];
  cta: string;
  url: string;                                      // sem protocolo, pra caber e ser lido
  rodape: string;
}

const CORES = {
  bg: '#080A08', surface: '#12160F', card: '#050703', line: '#243020', ink: '#F2F5F0', muted: '#78876F',
  stance: '#FFD100', data: '#00E676', danger: '#FF3B30', golsBg: '#1A0A08', golsLine: '#3D1512', zeroBg: '#08170D', zeroLine: '#12351F'
};
const FONTE = {
  display: 'Anton, Impact, "Arial Narrow", sans-serif',
  mono: '"Chivo Mono", ui-monospace, Menlo, monospace',
  body: 'Barlow, system-ui, -apple-system, sans-serif'
};

export function montarStories(p: Placar, nomeUf: string, host: string, dono = true): ConteudoStories {
  const n = p.gols.length, dec = p.decisivas.length;
  return {
    kicker: `BRASIL · ${nomeUf} · 4 DE OUTUBRO`.toUpperCase(),
    forca: p.forca,
    veredito: p.veredito.t.toUpperCase(),
    classe: p.veredito.c,
    coerencia: p.coerencia,
    peso: p.peso,
    gols: n,
    golsRotulo: n === 1 ? 'GOL CONTRA' : 'GOLS CONTRA',
    golsSub: n === 0
      ? (dec ? 'ninguém do time joga contra nas pautas decisivas' : 'ninguém do time joga contra')
      : dec === 1 ? 'na pauta que decide o voto' : dec ? `nas ${dec} pautas que decidem o voto` : 'em todas as pautas',
    tituloEscalacao: dono ? 'MINHA ESCALAÇÃO' : 'A ESCALAÇÃO',
    escalacao: p.escalados.map(e => ({ cargo: (e.cargo.vagas > 1 ? `${e.cargo.curto} ${e.vaga + 1}` : e.cargo.curto).toUpperCase(), nome: e.candidato.nome, partido: e.candidato.partido })),
    cta: 'ESCALA O TEU E ME DIZ QUANTOS GOLS CONTRA DEU',
    url: host.replace(/^https?:\/\//, '').replace(/\/$/, '') + '/app',
    rodape: 'posições por voto nominal em plenário ou estimativa do partido · TSE · Câmara · Senado'
  };
}

export function nomeArquivoStories(uf?: string): string {
  return `meu-time-politico-2026${uf ? '-' + uf.toLowerCase() : ''}.png`;
}

/* ---------- utilidades de texto no canvas ---------- */
type Ctx = CanvasRenderingContext2D;

/** corta com reticências até caber em maxW */
export function encurtar(mede: (s: string) => number, texto: string, maxW: number): string {
  if (mede(texto) <= maxW) return texto;
  let t = texto;
  while (t.length > 1 && mede(t + '…') > maxW) t = t.slice(0, -1).trimEnd();
  return t + '…';
}
/** quebra por palavra em até maxLinhas; a última leva reticências se sobrar */
export function quebrar(mede: (s: string) => number, texto: string, maxW: number, maxLinhas: number): string[] {
  const palavras = texto.split(/\s+/).filter(Boolean), linhas: string[] = [];
  let atual = '';
  for (const w of palavras) {
    const tenta = atual ? `${atual} ${w}` : w;
    if (mede(tenta) <= maxW || !atual) atual = tenta;
    else { linhas.push(atual); atual = w; }
  }
  if (atual) linhas.push(atual);
  if (linhas.length > maxLinhas) {
    const resto = linhas.slice(maxLinhas - 1).join(' ');
    return [...linhas.slice(0, maxLinhas - 1), encurtar(mede, resto, maxW)];
  }
  return linhas;
}

function texto(ctx: Ctx, s: string, x: number, y: number, o: { fonte: string; cor: string; alinhar?: CanvasTextAlign; espaco?: number; maxW?: number }): number {
  ctx.font = o.fonte; ctx.fillStyle = o.cor; ctx.textAlign = o.alinhar ?? 'left'; ctx.textBaseline = 'alphabetic';
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${o.espaco ?? 0}px`;
  const t = o.maxW ? encurtar(w => ctx.measureText(w).width, s, o.maxW) : s;
  ctx.fillText(t, x, y);
  return ctx.measureText(t).width;
}
function caixa(ctx: Ctx, x: number, y: number, w: number, h: number, fundo: string, borda: string, r = 6, esquerda?: string) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fundo; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = borda; ctx.stroke();
  if (esquerda) { ctx.fillStyle = esquerda; ctx.fillRect(x, y + r, 6, h - 2 * r); }
}
function linha(ctx: Ctx, x1: number, y: number, x2: number, cor: string, tracejada = false) {
  ctx.beginPath(); ctx.setLineDash(tracejada ? [6, 8] : []); ctx.strokeStyle = cor; ctx.lineWidth = 2;
  ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke(); ctx.setLineDash([]);
}

/* ---------- fundo: preto-estádio com listras de gramado cortado ---------- */
function fundo(ctx: Ctx) {
  ctx.fillStyle = CORES.bg; ctx.fillRect(0, 0, LARGURA, ALTURA);
  ctx.save(); ctx.translate(LARGURA / 2, ALTURA / 2); ctx.rotate(-25 * Math.PI / 180);
  ctx.fillStyle = 'rgba(0,230,118,.035)';
  for (let x = -1800; x < 1800; x += 140) ctx.fillRect(x, -1800, 70, 3600);
  ctx.restore();
  // brilho verde no centro, como o holofote do placar
  const g = ctx.createRadialGradient(LARGURA / 2, 620, 60, LARGURA / 2, 620, 900);
  g.addColorStop(0, 'rgba(0,230,118,.10)'); g.addColorStop(1, 'rgba(0,230,118,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, LARGURA, ALTURA);
}

/** Pinta a imagem inteira no canvas (1080×1920). Fontes devem estar carregadas antes (carregarFontesStories). */
export function desenharStories(ctx: Ctx, c: ConteudoStories): void {
  const M = 60, W = LARGURA - 2 * M, CX = LARGURA / 2;
  const mede = (fonte: string) => (s: string) => { ctx.font = fonte; return ctx.measureText(s).width; };
  fundo(ctx);

  // cabeçalho (abaixo dos ~250px que o Instagram cobre com o nome do perfil)
  texto(ctx, c.kicker, CX, 300, { fonte: `24px ${FONTE.mono}`, cor: CORES.data, alinhar: 'center', espaco: 5, maxW: W });
  ctx.textAlign = 'left';
  const fBrand = `62px ${FONTE.display}`;
  const w1 = mede(fBrand)('MEU TIME '), w2 = mede(fBrand)('POLÍTICO'), w3 = mede(`700 30px ${FONTE.mono}`)(' 2026');
  let bx = CX - (w1 + w2 + w3) / 2;
  bx += texto(ctx, 'MEU TIME ', bx, 378, { fonte: fBrand, cor: CORES.ink });
  bx += texto(ctx, 'POLÍTICO', bx, 378, { fonte: fBrand, cor: CORES.stance });
  texto(ctx, ' 2026', bx, 368, { fonte: `700 30px ${FONTE.mono}`, cor: CORES.data });
  linha(ctx, M, 412, LARGURA - M, CORES.line);

  // placar principal — a altura acompanha o veredito (normalmente uma linha)
  const corVer = c.classe === 'v-bom' ? CORES.data : c.classe === 'v-ruim' ? CORES.danger : CORES.stance;
  const fVer = `64px ${FONTE.display}`;
  const linhasVer = quebrar(mede(fVer), c.veredito, W - 80, 2);
  const topo = 440, hCard = 470 + 64 * (linhasVer.length - 1);
  caixa(ctx, M, topo, W, hCard, CORES.card, CORES.line);
  texto(ctx, 'FORÇA DO TIME', CX, topo + 60, { fonte: `24px ${FONTE.mono}`, cor: CORES.muted, alinhar: 'center', espaco: 7 });
  const fNum = `300px ${FONTE.display}`, fSub = `700 44px ${FONTE.mono}`;
  const wn = mede(fNum)(String(c.forca)), ws = mede(fSub)('/100');
  const nx = CX - (wn + 14 + ws) / 2;
  ctx.shadowColor = 'rgba(255,209,0,.35)'; ctx.shadowBlur = 50;
  texto(ctx, String(c.forca), nx, topo + 350, { fonte: fNum, cor: CORES.stance });
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  texto(ctx, '/100', nx + wn + 14, topo + 280, { fonte: fSub, cor: CORES.muted });
  linhasVer.forEach((l, i) => texto(ctx, l, CX, topo + 435 + i * 64, { fonte: fVer, cor: corVer, alinhar: 'center' }));
  let y = topo + hCard + 30;

  // eixos
  const eixo = (x: number, rotulo: string, v: number, cor: string, dica: string) => {
    caixa(ctx, x, y, (W - 20) / 2, 180, CORES.surface, CORES.line);
    texto(ctx, rotulo, x + 28, y + 42, { fonte: `20px ${FONTE.mono}`, cor: CORES.muted, espaco: 4 });
    texto(ctx, String(v), x + 28, y + 130, { fonte: `84px ${FONTE.display}`, cor });
    texto(ctx, dica, x + 28, y + 160, { fonte: `22px ${FONTE.body}`, cor: CORES.muted, maxW: (W - 20) / 2 - 56 });
  };
  eixo(M, 'COERÊNCIA', c.coerencia, CORES.data, 'eles jogam junto?');
  eixo(M + (W - 20) / 2 + 20, 'PESO DE APROVAÇÃO', c.peso, CORES.stance, 'eles aprovam alguma coisa?');
  y += 180 + 30;

  // gols contra
  const zero = c.gols === 0;
  caixa(ctx, M, y, W, 112, zero ? CORES.zeroBg : CORES.golsBg, zero ? CORES.zeroLine : CORES.golsLine, 6, zero ? CORES.data : CORES.danger);
  const wg = texto(ctx, String(c.gols), M + 40, y + 84, { fonte: `84px ${FONTE.display}`, cor: zero ? CORES.data : CORES.danger });
  texto(ctx, c.golsRotulo, M + 40 + wg + 26, y + 60, { fonte: `40px ${FONTE.display}`, cor: CORES.ink });
  texto(ctx, c.golsSub, M + 40 + wg + 26, y + 96, { fonte: `21px ${FONTE.body}`, cor: CORES.muted, maxW: W - 80 - wg - 26 });
  y += 112 + 30;

  // escalação
  const linhas = c.escalacao.slice(0, 6), ROW = linhas.length > 5 ? 50 : 58;   // seis escalados (dois senadores) apertam um pouco a linha
  caixa(ctx, M, y, W, 58 + ROW * linhas.length + 12, CORES.surface, CORES.line);
  texto(ctx, c.tituloEscalacao, M + 28, y + 40, { fonte: `20px ${FONTE.mono}`, cor: CORES.muted, espaco: 4 });
  linhas.forEach((e, i) => {
    const ry = y + 58 + i * ROW;
    if (i > 0) linha(ctx, M + 28, ry, LARGURA - M - 28, CORES.line, true);
    texto(ctx, e.cargo, M + 28, ry + 38, { fonte: `18px ${FONTE.mono}`, cor: CORES.muted, espaco: 2, maxW: 250 });
    const wp = texto(ctx, e.partido, LARGURA - M - 28, ry + 38, { fonte: `700 22px ${FONTE.mono}`, cor: CORES.data, alinhar: 'right' });
    texto(ctx, e.nome, M + 300, ry + 40, { fonte: `600 32px ${FONTE.body}`, cor: CORES.ink, maxW: W - 300 - 28 - wp - 24 });
  });
  y += 58 + ROW * linhas.length + 12;

  // chamada + endereço (a parte de baixo pode ficar sob a barra de resposta do Instagram; o link vai no sticker)
  const fCta = `38px ${FONTE.display}`;
  const cta = quebrar(mede(fCta), c.cta, W, 2);
  cta.forEach((l, i) => texto(ctx, l, CX, y + 52 + i * 44, { fonte: fCta, cor: CORES.stance, alinhar: 'center' }));
  y += 52 + 44 * (cta.length - 1);
  texto(ctx, c.url, CX, y + 50, { fonte: `700 26px ${FONTE.mono}`, cor: CORES.ink, alinhar: 'center', espaco: 1, maxW: W });
  texto(ctx, c.rodape, CX, Math.max(y + 108, ALTURA - 100), { fonte: `17px ${FONTE.mono}`, cor: CORES.muted, alinhar: 'center', maxW: W });
}

/** Garante que as fontes da marca estão prontas antes de pintar (senão o canvas cai no fallback). */
export async function carregarFontesStories(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const pedidos = [`320px ${FONTE.display}`, `700 30px ${FONTE.mono}`, `24px ${FONTE.mono}`, `600 32px ${FONTE.body}`, `22px ${FONTE.body}`];
  try { await Promise.race([Promise.all(pedidos.map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 2500))]); }
  catch { /* segue com fallback */ }
}

/** Gera o PNG pronto pra postar. */
export async function gerarPngStories(c: ConteudoStories): Promise<Blob> {
  await carregarFontesStories();
  const canvas = document.createElement('canvas');
  canvas.width = LARGURA; canvas.height = ALTURA;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas indisponível');
  desenharStories(ctx, c);
  return new Promise((ok, erro) => canvas.toBlob(b => b ? ok(b) : erro(new Error('não consegui gerar a imagem')), 'image/png'));
}
