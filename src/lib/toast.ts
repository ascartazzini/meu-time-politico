/* Aviso curto no rodapé da tela, que some sozinho. */
let atual: HTMLElement | null = null;
let timer: number | undefined;
export function toast(texto: string, ms = 3500): void {
  atual?.remove();
  clearTimeout(timer);
  atual = Object.assign(document.createElement('div'), { className: 'toast', textContent: texto });
  atual.setAttribute('role', 'status');
  document.body.append(atual);
  timer = window.setTimeout(() => { atual?.remove(); atual = null; }, ms);
}
