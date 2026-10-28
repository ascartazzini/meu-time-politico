/* Os eleitos que assumem em 2027, do jeito que o site usa (src/data/generated/eleitos-2027.json,
   gerado por scripts/cadastro-eleitos.ts). Puro: roda no build e no navegador. */
import type { Cargo } from './time';

export interface MandatoBruto { cargo: Cargo; uf: string | null; inicio: string; fim: string; eleicao: number; suplente?: boolean }
export interface EleitoBruto {
  slug: string; nome: string; nomeUrna: string; partido: string; uf: string | null; fotoUrl: string | null;
  ids: { tse2026?: string; tse2022?: string; camara?: number; senado?: number }; mandatos: MandatoBruto[];
}
/** Linha enxuta que vai pro navegador em /eleitos/<UF>.json */
export interface EleitoLeve { slug: string; nome: string; partido: string; uf: string | null; cargo: Cargo; suplente?: boolean; foto?: string }

const MINUSCULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'o', 'a']);
/** "HUGO MOTTA DA NÓBREGA" → "Hugo Motta da Nóbrega". Siglas curtas sem vogal ficam em caixa alta ("PM"). */
export function nomeBonito(s: string): string {
  return s.toLowerCase().split(/\s+/).filter(Boolean).map((w, i) => {
    if (i > 0 && MINUSCULAS.has(w)) return w;
    if (w.length <= 3 && !/[aeiouáéíóúâêôãõà]/.test(w)) return w.toUpperCase();
    return w.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('-');
  }).join(' ');
}

/** Cargo que vale a partir de 2027: o da eleição mais recente (Moro, senador até 2031, vira governador). */
export function cargoPrincipal(e: EleitoBruto): MandatoBruto {
  return [...e.mandatos].sort((a, b) => b.eleicao - a.eleicao || b.inicio.localeCompare(a.inicio))[0];
}

export function cargoEmTexto(cargo: Cargo, uf: string | null, plural = false): string {
  const base: Record<Cargo, [string, string]> = {
    presidente: ['Presidente', 'Presidente'],
    governador: [uf === 'DF' ? 'Governador do DF' : 'Governador', uf === 'DF' ? 'Governador do DF' : 'Governador'],
    senador: ['Senador', 'Senadores'],
    'deputado-federal': ['Deputado federal', 'Deputados federais'],
    'deputado-estadual': [uf === 'DF' ? 'Deputado distrital' : 'Deputado estadual', uf === 'DF' ? 'Deputados distritais' : 'Deputados estaduais'],
  };
  return base[cargo][plural ? 1 : 0];
}

export function leve(e: EleitoBruto): EleitoLeve {
  const m = cargoPrincipal(e);
  return {
    slug: e.slug, nome: nomeBonito(e.nomeUrna || e.nome), partido: e.partido, uf: e.uf, cargo: m.cargo,
    ...(m.suplente ? { suplente: true } : {}), ...(e.fotoUrl ? { foto: e.fotoUrl } : {}),
  };
}

/** Quem a pessoa daquela UF pode seguir: presidente + governador, senadores e deputados da UF. */
export function daUf(todos: EleitoBruto[], uf: string): EleitoLeve[] {
  return todos.map(leve).filter(e => e.cargo === 'presidente' || e.uf === uf)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Link oficial do mandato, quando a casa tem página por parlamentar. */
export function paginaOficial(e: EleitoBruto): { rotulo: string; url: string }[] {
  const out: { rotulo: string; url: string }[] = [];
  if (e.ids.camara) out.push({ rotulo: 'Página na Câmara', url: `https://www.camara.leg.br/deputados/${e.ids.camara}` });
  if (e.ids.senado) out.push({ rotulo: 'Página no Senado', url: `https://www25.senado.leg.br/web/senadores/senador/-/perfil/${e.ids.senado}` });
  return out;
}
