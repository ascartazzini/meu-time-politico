/* Lista de políticos com o botão Seguir/Seguindo: usada na home (busca e convite) e em /seguir/.
   Sem conta, "Seguir" guarda o pedido no aparelho e leva pro login com o Google; na volta a conta já segue. */
import { usuario, seguir, guardarPendente, entrar, mensagemDeErro } from './conta';
import { avatar, sobre } from './timeline';
import type { EleitoLeve } from './eleitos';
import { toast } from './toast';
import { evento } from './analytics';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function linha(e: EleitoLeve, s: Set<string>): string {
  const sim = s.has(e.slug);
  return `<li>${avatar(e, e.slug)}<div class="quem"><b><a href="/politico/${esc(e.slug)}/">${esc(e.nome)}</a></b><small>${sobre(e)}${e.suplente ? ' · suplente em exercício' : ''}</small></div>
    <button type="button" class="btn ${sim ? 'seguindo' : ''}" data-slug="${esc(e.slug)}" aria-pressed="${sim}">${sim ? 'Seguindo' : 'Seguir'}</button></li>`;
}
export const lista = (es: EleitoLeve[], s: Set<string>) => `<ul class="pessoas">${es.map(e => linha(e, s)).join('')}</ul>`;

/** Liga os botões [data-slug] dentro de `raiz`. `depois` redesenha quando a escolha muda. */
export function ligarSeguir(raiz: HTMLElement, local: string, depois: () => void): void {
  raiz.addEventListener('click', async ev => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-slug]');
    if (!b || !raiz.contains(b)) return;
    const slug = b.dataset.slug!, ligado = !b.classList.contains('seguindo');
    if (!(await usuario())) {
      guardarPendente(slug);
      evento('seguir_sem_conta', { local });
      toast('Entre com o Google pra seguir. Quando voltar, já vai estar seguindo.');
      setTimeout(() => entrar(), 900);
      return;
    }
    b.disabled = true;
    try {
      await seguir([slug], ligado);
      evento('seguir', { local, ligado });
      depois();
    } catch (err) { toast(mensagemDeErro(err)); b.disabled = false; }
  });
}
