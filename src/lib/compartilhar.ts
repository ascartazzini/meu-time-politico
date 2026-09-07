/* ==========================================================================
   COMPARTILHAR — o link sai marcado com UTM por canal.
   O GA4 mostrou 117 de 136 sessões como Direct: link compartilhado sem UTM
   chega como Direct e some da atribuição. Por isso cada canal gera a SUA
   própria URL (utm_source=whatsapp|instagram|linkedin), em vez de um link só.
   Envio: Web Share API quando o navegador tem (celular); onde não tem, copia
   pra área de transferência.
   ========================================================================== */
import { evento } from './analytics';

export const CANAIS = [
  { id: 'whatsapp', rotulo: 'WhatsApp' },
  { id: 'instagram', rotulo: 'Instagram' },
  { id: 'linkedin', rotulo: 'LinkedIn' }
] as const;
export type CanalId = (typeof CANAIS)[number]['id'];

const CAMPANHA = 'lancamento';
const MEDIUM = 'share';

/** Marca a URL com a origem do canal. Preserva o hash — no /app/ o placar vive nele. */
export function linkComUtm(url: string, canal: CanalId): string {
  const u = new URL(url, location.href);
  u.searchParams.set('utm_source', canal);
  u.searchParams.set('utm_medium', MEDIUM);
  u.searchParams.set('utm_campaign', CAMPANHA);
  return u.toString();
}

export interface OpcoesShare {
  /** de onde saiu o clique (vai pro GA4 como `local`): 'home' | 'placar' | ... */
  local: string;
  /** URL base a compartilhar, avaliada no clique (no /app/ o hash muda) */
  link: () => string;
  /** mensagem pronta pra colar, já com o link dentro */
  texto: (link: string) => string;
  titulo?: string;
}

async function copiar(txt: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(txt); return true; }
  catch { return false; }
}

/**
 * Liga o botão e o painel de canais dentro de `raiz`. Espera a marcação:
 *   [data-share-abrir]  botão que abre/fecha o painel
 *   [data-share-painel] painel com os botões [data-canal="whatsapp|…"]
 *   [data-share-aviso]  linha de retorno ("link copiado")
 */
export function instalarCompartilhar(raiz: HTMLElement, o: OpcoesShare): void {
  const abrir = raiz.querySelector<HTMLButtonElement>('[data-share-abrir]');
  const painel = raiz.querySelector<HTMLElement>('[data-share-painel]');
  const aviso = raiz.querySelector<HTMLElement>('[data-share-aviso]');
  if (!abrir || !painel) return;

  abrir.addEventListener('click', () => {
    painel.hidden = !painel.hidden;
    abrir.setAttribute('aria-expanded', String(!painel.hidden));
    if (aviso) aviso.textContent = '';
  });

  painel.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-canal]');
    if (!b) return;
    const canal = b.dataset.canal as CanalId;
    const link = linkComUtm(o.link(), canal);
    evento('share_click', { channel: canal, local: o.local });
    // navigator.share precisa do gesto do usuário: nada de await antes desta chamada
    const dados = { title: o.titulo ?? 'Meu Time Político 2026', text: o.texto(link), url: link };
    if (typeof navigator.share === 'function') {
      navigator.share(dados).catch((err: Error) => {
        if (err?.name === 'AbortError') return;      // a pessoa fechou a folha de compartilhar
        void copiarNoBotao(b, link, aviso);
      });
      return;
    }
    void copiarNoBotao(b, link, aviso);
  });
}

async function copiarNoBotao(b: HTMLButtonElement, link: string, aviso: HTMLElement | null): Promise<void> {
  const ok = await copiar(link);
  if (aviso) {
    aviso.textContent = ok
      ? `✓ link do ${b.textContent?.trim()} copiado — é só colar lá`
      : 'não consegui copiar aqui; use o menu do navegador';
  }
  if (!ok) prompt('Copie o link:', link);
}
