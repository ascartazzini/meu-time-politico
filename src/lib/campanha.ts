/* Gastos de campanha de 2026 na página do eleito: a prestação de contas entregue ao TSE
   (prestacao_de_contas_eleitorais_candidatos_2026), resumida por candidato.
   Puro: `Acumulador` roda no script de coleta (linha a linha do CSV) e `leitura` no build da página e nos testes.
   Nunca estima: o que não está na prestação não aparece. Fornecedor pessoa física entra só somado (sem nome nem CPF);
   doador não aparece por nome, só a origem do dinheiro. */

/** Resumo de um candidato, como fica gravado em src/data/generated/campanha-2026.json */
export interface Campanha {
  /** tipo da última prestação ("Final", "Parcial", "Relatório Financeiro") e a data de entrega */
  prestacao: string; entregueEm: string;
  despesas: {
    total: number;
    /** [tipo de despesa do TSE, valor], maior primeiro; os pequenos somados em "Outros" */
    porTipo: [string, number][];
    /** [nome na Receita Federal, valor, CNPJ], só pessoa jurídica, os maiores */
    empresas: [string, number, string][];
    /** pagamentos a pessoas físicas (cabo eleitoral, militância, pessoal): só soma e quantas pessoas */
    pessoas: { valor: number; quantas: number };
  };
  receitas: {
    total: number;
    /** fundo eleitoral (FEFC), fundo partidário e outros recursos */
    porFonte: { fundoEleitoral: number; fundoPartidario: number; outros: number };
    /** [origem do TSE, valor]: pessoas físicas, partido, recursos próprios… */
    porOrigem: [string, number][];
    /** quanto da receita foi em bens e serviços doados (estimável), não em dinheiro */
    estimavel: number;
  };
}

export interface ArquivoCampanha {
  geradoEm: string; dataGeracaoTse: string; fonte: string; aviso: string;
  /** SQ_CANDIDATO (ids.tse2026 no cadastro) → resumo */
  candidatos: Record<string, Campanha>;
}

const NULO = (s: string | undefined) => !s || s === '#NULO' || s === '#NULO#' || s === '-1' || s === '-4';
/** "1.234,56" ou "1234,56" → 1234.56 */
export function valorTse(s: string): number {
  const n = Number((s ?? '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
const centavos = (n: number) => Math.round(n * 100) / 100;
const ORDEM_PRESTACAO: Record<string, number> = { 'relatório financeiro': 0, parcial: 1, final: 2, retificadora: 3 };
const tituloPrestacao = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const somar = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);

/** Agrega as linhas de despesa contratada e de receita de um candidato. */
export class Acumulador {
  private prestacao = ''; private entregueEm = '';
  private despesa = 0; private tipos = new Map<string, number>();
  private pj = new Map<string, { nome: string; valor: number; docs: Map<string, number> }>();
  private pf = new Map<string, number>();
  private receita = 0; private origens = new Map<string, number>(); private estimavel = 0;
  private fontes = { fundoEleitoral: 0, fundoPartidario: 0, outros: 0 };

  private prestou(tp: string, dt: string) {
    const [d, m, a] = (dt ?? '').split('/'); const iso = a ? `${a}-${m}-${d}` : '';
    const r = (x: string) => ORDEM_PRESTACAO[x.toLowerCase()] ?? -1;
    if (r(tp) > r(this.prestacao) || (r(tp) === r(this.prestacao) && iso > this.entregueEm)) { this.prestacao = tp; this.entregueEm = iso; }
  }

  /** linha de despesas_contratadas_candidatos_2026_<UF>.csv */
  despesaContratada(r: Record<string, string>) {
    this.prestou(r.TP_PRESTACAO_CONTAS, r.DT_PRESTACAO_CONTAS);
    const v = valorTse(r.VR_DESPESA_CONTRATADA); if (!v) return;
    this.despesa += v;
    somar(this.tipos, NULO(r.DS_ORIGEM_DESPESA) ? 'Sem tipo informado' : r.DS_ORIGEM_DESPESA, v);
    const doc = r.NR_CPF_CNPJ_FORNECEDOR ?? '';
    if (r.CD_TIPO_FORNECEDOR === '1') {
      const nome = (NULO(r.NM_FORNECEDOR_RFB) ? r.NM_FORNECEDOR : r.NM_FORNECEDOR_RFB).replace(/\s+/g, ' ').trim();
      // matriz e filiais (mesma raiz de 8 dígitos do CNPJ) são a mesma empresa; mostra o CNPJ que recebeu mais
      const cnpj = /^\d{14}$/.test(doc) ? doc : '';
      const chave = cnpj ? cnpj.slice(0, 8) : nome;
      const x = this.pj.get(chave) ?? { nome, valor: 0, docs: new Map<string, number>() };
      x.valor += v; if (cnpj) somar(x.docs, cnpj, v); this.pj.set(chave, x);
    } else if (r.CD_TIPO_FORNECEDOR === '0') somar(this.pf, NULO(doc) ? r.NM_FORNECEDOR : doc, v);
  }

  /** linha de receitas_candidatos_2026_<UF>.csv */
  receitaLinha(r: Record<string, string>) {
    this.prestou(r.TP_PRESTACAO_CONTAS, r.DT_PRESTACAO_CONTAS);
    const v = valorTse(r.VR_RECEITA); if (!v) return;
    this.receita += v;
    const fonte = (r.DS_FONTE_RECEITA ?? '').toUpperCase();
    if (fonte === 'FUNDO ESPECIAL') this.fontes.fundoEleitoral += v;
    else if (fonte === 'FUNDO PARTIDARIO' || fonte === 'FUNDO PARTIDÁRIO') this.fontes.fundoPartidario += v;
    else this.fontes.outros += v;
    somar(this.origens, NULO(r.DS_ORIGEM_RECEITA) ? 'Sem origem informada' : r.DS_ORIGEM_RECEITA, v);
    if ((r.DS_NATUREZA_RECEITA ?? '').toUpperCase().startsWith('ESTIM')) this.estimavel += v;
  }

  resumo(maxTipos = 7, maxEmpresas = 5): Campanha {
    const ordenar = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const tipos = ordenar(this.tipos);
    const porTipo: [string, number][] = tipos.slice(0, maxTipos).map(([k, v]) => [k, centavos(v)]);
    const resto = tipos.slice(maxTipos).reduce((s, [, v]) => s + v, 0);
    if (resto > 0) porTipo.push(['Outros', centavos(resto)]);
    const empresas = [...this.pj].sort((a, b) => b[1].valor - a[1].valor || a[1].nome.localeCompare(b[1].nome)).slice(0, maxEmpresas)
      .map(([, x]): [string, number, string] => [x.nome, centavos(x.valor), [...x.docs].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '']);
    return {
      prestacao: tituloPrestacao(this.prestacao), entregueEm: this.entregueEm,
      despesas: { total: centavos(this.despesa), porTipo, empresas, pessoas: { valor: centavos([...this.pf.values()].reduce((s, v) => s + v, 0)), quantas: this.pf.size } },
      receitas: {
        total: centavos(this.receita),
        porFonte: { fundoEleitoral: centavos(this.fontes.fundoEleitoral), fundoPartidario: centavos(this.fontes.fundoPartidario), outros: centavos(this.fontes.outros) },
        porOrigem: ordenar(this.origens).map(([k, v]) => [k, centavos(v)]),
        estimavel: centavos(this.estimavel),
      },
    };
  }
}

/* ---------- leitura pra página ---------- */

export interface Par { sq: string; cargo: string; uf: string | null }
export interface Leitura {
  c: Campanha;
  /** parte do dinheiro que veio de fundo público (eleitoral + partidário), 0–100 */
  publicoPct: number;
  /** comparação com os outros eleitos do mesmo cargo na mesma UF (null quando são menos de 3) */
  comparacao: { mediana: number; posicao: number; de: number } | null;
}

export function mediana(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Leitura de um eleito: o resumo, quanto veio de dinheiro público e onde ele fica entre os pares (cargo + UF). */
export function leitura(eu: Par, pares: Par[], candidatos: Record<string, Campanha>): Leitura | null {
  const c = candidatos[eu.sq]; if (!c) return null;
  const publico = c.receitas.porFonte.fundoEleitoral + c.receitas.porFonte.fundoPartidario;
  const publicoPct = c.receitas.total > 0 ? Math.round((publico / c.receitas.total) * 100) : 0;
  const grupo = pares.filter(p => p.cargo === eu.cargo && p.uf === eu.uf && candidatos[p.sq]).map(p => candidatos[p.sq].despesas.total);
  const comparacao = grupo.length >= 3
    ? { mediana: centavos(mediana(grupo)), posicao: grupo.filter(v => v > c.despesas.total).length + 1, de: grupo.length }
    : null;
  return { c, publicoPct, comparacao };
}

/** R$ 1,2 mi · R$ 85 mil · R$ 930 */
export function reaisCurto(v: number): string {
  const a = Math.abs(v);
  const fmt = (n: number, casas: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas });
  if (a >= 1e6) return `R$ ${fmt(v / 1e6, a >= 1e7 ? 1 : 2)} mi`;
  if (a >= 1e4) return `R$ ${fmt(Math.round(v / 1e3), 0)} mil`;
  return `R$ ${fmt(Math.round(v), 0)}`;
}
/** R$ 1.234.567 (sem centavos) */
export function reais(v: number): string {
  return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
}
