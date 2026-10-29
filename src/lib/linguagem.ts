/* Linguagem simples pros cards. Nada inventado: tudo sai do texto oficial, só reorganizado e encurtado.
   - ementa → o que o projeto quer: tira o "Altera a Lei nº … para", troca verbo jurídico por comum, encolhe a citação de lei;
     a ementa inteira continua no card como referência;
   - discurso → trechos literais (frases inteiras do texto do Senado, sem cerimonial);
   - agenda → quem está no compromisso, separado em cargo e nome.
   Puro, coberto por tests/linguagem.test.ts. Roda no navegador e nos coletores. */

const SIGLAS = 'PL|PLP|PEC|PDL|PDS|PLS|PLN|PLV|MPV|PRS|PRC|REQ|PDC';
/** "PLP 186/2026: Altera …" → ref "PLP 186/2026" e o texto. */
export function separarReferencia(titulo: string): { ref: string | null; texto: string } {
  const m = titulo.match(new RegExp(`^((?:${SIGLAS})\\s*(?:n[º°o]\\.?\\s*)?[\\d.]+\\s*\\/\\s*\\d{4})\\s*[:\\-–]\\s*(.+)$`, 'i'));
  if (!m) return { ref: null, texto: titulo };
  return { ref: m[1].replace(/\s*n[º°o]\.?\s*/i, ' ').replace(/\s*\/\s*/, '/').replace(/\s+/g, ' '), texto: m[2].trim() };
}

export const maiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "a Lei nº 9.503, de 23 de setembro de 1997 (Código de Trânsito Brasileiro)" → "o Código de Trânsito Brasileiro";
 *  sem nome entre parênteses → "a Lei 9.503/1997". */
function encolherLeis(s: string): string {
  return s.replace(
    /\b(?:(a|o|da|do|na|no)\s+)?(Lei Complementar|Lei|Decreto-Lei|Decreto Legislativo|Decreto|Medida Provisória)\s+n?[º°o]?\.?\s*([\d.]+)(?:,?\s*de\s+(?:\d{1,2}º?\s+de\s+\p{L}+\s+de\s+)?(\d{4}))?(?:\s*\(([^)]{3,80})\))?/giu,
    (_, art: string | undefined, tipo: string, num: string, ano: string | undefined, nome: string | undefined) => {
      const pre = art ? `${art} ` : '';
      if (nome && !/^[A-Z0-9/\-\s]{2,12}$/.test(nome)) {
        // o nome próprio da lei vem com o próprio artigo: "do Código Civil", "da Consolidação das Leis do Trabalho"
        const fem = /^(Consolidação|Lei|Política|Lei)\b/i.test(nome);
        const novoArt = art ? art.replace(/^(a|o)$/, fem ? 'a' : 'o').replace(/^d[ao]$/, fem ? 'da' : 'do').replace(/^n[ao]$/, fem ? 'na' : 'no') : '';
        return `${novoArt ? `${novoArt} ` : ''}${nome}`;
      }
      return `${pre}${tipo} ${num}${ano ? `/${ano}` : ''}`;
    });
}

/* Verbo do começo da ementa (presente, jurídico) → infinitivo comum, pra ler "Quer criar…", "Aprovou: criar…". */
const VERBOS: [RegExp, string][] = [
  [/^Institui\b/i, 'criar'], [/^Cria\b/i, 'criar'], [/^Disp[õo]e sobre (o|a|os|as)\b/i, 'tratar d$1'], [/^Disp[õo]e sobre\b/i, 'tratar de'],
  [/^Susta\b/i, 'derrubar'], [/^Veda\b/i, 'proibir'], [/^Pro[ií]be\b/i, 'proibir'], [/^Denomina\b/i, 'dar o nome de'],
  [/^Estabelece\b/i, 'estabelecer'], [/^Concede\b/i, 'conceder'], [/^Garante\b/i, 'garantir'], [/^Prev[êe]\b/i, 'prever'],
  [/^Inscreve\b/i, 'inscrever'], [/^Reconhece\b/i, 'reconhecer'], [/^Confere\b/i, 'conferir'], [/^Converte\b/i, 'converter'],
  [/^Abre\b/i, 'abrir'], [/^Inclui\b/i, 'incluir'], [/^Permite\b/i, 'permitir'], [/^Transforma\b/i, 'transformar'],
  [/^(Altera|Modifica)\b/i, 'mudar'],
  [/^(\p{L}+)a\b/iu, '$1ar'],                                   // Autoriza → autorizar, Revoga → revogar, Torna → tornar
];
/* Jargão no meio da frase, trocado por palavra comum sem mudar o sentido. */
const JARGAO: [RegExp, string][] = [
  [/^dispor sobre (o|a|os|as)\b/i, 'tratar d$1'], [/^dispor sobre\b/i, 'tratar de'],
  [/\bdispor sobre (o|a|os|as)\b/gi, 'tratar d$1'], [/\bdispor sobre\b/gi, 'tratar de'],
  [/\btipificar (?:o crime|como crime)\b/gi, 'criar o crime'], [/\btipificar (o|a|os|as)\b/gi, 'tornar crime $1'], [/\binstituir\b/gi, 'criar'], [/\bvedar\b/gi, 'proibir'],
  [/\b(\d+) \([a-zà-ú\s-]+\)/g, '$1'],                       // "2 (dois) dias" → "2 dias" (só número por extenso, minúsculo)
];

/** O que o projeto quer, em linguagem comum, começando no infinitivo: "reduzir a duração máxima semanal do trabalho…".
 *  A ementa inteira segue no card como referência. */
export function explicarEmenta(ementa: string, max = 150): string {
  let t = ementa.replace(/\s+/g, ' ').trim()
    .replace(/[;,]?\s*e dá outras providências\.?$/i, '')
    .replace(/\.$/, '');
  // "Altera a Lei X, para fazer Y" → "fazer Y": o objetivo vem depois do "para"
  const objetivo = t.match(/^(?:Altera|Acrescenta|Inclui|Modifica|Dá nova redação a|Insere)\b[\s\S]*?,?\s+(?:para|a fim de|com o objetivo de)\s+([\s\S]+)$/i);
  if (objetivo) t = objetivo[1];
  else for (const [re, por] of VERBOS) if (re.test(t)) { t = t.replace(re, por); break; }
  for (const [re, por] of JARGAO) t = t.replace(re, por);
  t = encolherLeis(t)
    .replace(/\s*\((?:[A-Z][A-Z0-9]*[/\-]?)+\)/g, '')      // "(PDAA/SEALBA)": sigla entre parênteses é ruído na manchete
    .replace(/,?\s+e (?:dispõe sobre|altera|acrescenta|revoga|dá nova redação)\b[\s\S]*$/i, '')   // o resto é detalhe técnico
    .replace(/\s{2,}/g, ' ').trim();
  t = t.split(/;\s/)[0];
  if (t.length > max) {
    const corte = t.slice(0, max);
    const virgula = corte.lastIndexOf(', ');
    const onde = virgula > max * 0.55 ? virgula : corte.lastIndexOf(' ');
    t = `${corte.slice(0, onde).replace(/[,;:\s]+$/, '')}…`;
  }
  return t.charAt(0).toLowerCase() + t.slice(1);
}

/* ---------- discurso ---------- */

const ABREV = /\b(Sr|Sra|Srs|Sras|Exa|Exas|Exmo|Exma|Dr|Dra|art|arts|inciso|Prof|Profa|Gen|Cel|Dep|Sen|Min|V|S|n|nº|p|pág|etc)\./g;
const CERIMONIAL = /\b(obrigad[oa]|agradeç|agradecer|cumpriment|parabeniz|parabéns|saúdo|saudar|saudação|boa tarde|bom dia|boa noite|V\.\s?Exa|Vossa Excelência|Sr\.\s?Presidente|Senhor Presidente|Sra\.\s?Presidente|pela ordem|questão de ordem|concedo|aparte|com a palavra|para encerrar|vou concluir|minha fala|meu pronunciamento|tribuna|registrar|registro)/i;
const POSICAO = /\b(eu|nós|nosso|nossa|nossos|defendo|defendemos|quero|vamos|precisamos|não podemos|é preciso|é inaceitável|sou contra|sou a favor|votarei|votamos)\b/i;

/** Até `max` frases literais do discurso, na ordem em que foram ditas. Só as falas de quem discursou
 *  (os apartes de outros senadores ficam fora), sem cerimonial nem anotação de taquigrafia. */
export function escolherTrechos(texto: string, max = 4): string[] {
  const paragrafos = texto.replace(/\r/g, '').split(/\n\s*\n|\n\s{2,}/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cabecalho = /^(?:O|A) SR[A]?\.\s+([^(–-]+?)\s*(?:\([^)]*\))?\s*[–-]\s*/;
  let autor: string | null = null, falando = true;
  const falas: string[] = [];
  for (const p of paragrafos) {
    const c = p.match(cabecalho);
    if (c) {
      const quem = c[1].trim();
      autor ??= quem;
      falando = quem === autor;
      if (falando) falas.push(p.slice(c[0].length));
    } else if (falando) falas.push(p);
  }
  const frases = falas.join(' ')
    .replace(/\((?:[^()]{0,60}\.)\)/g, ' ')                  // (Palmas.) (Soa a campainha.) (Pausa.)
    .replace(ABREV, '$1§')
    .split(/(?<=[.!?])\s+(?=["“A-ZÁÉÍÓÚÂÊÔÃÕÇ])/)
    .map(f => f.replace(/§/g, '.').replace(/\s+/g, ' ').trim());
  const notas = frases.map((f, i) => {
    const aspas = (f.match(/["“”]/g) ?? []).length;
    if (f.length < 80 || f.length > 320 || CERIMONIAL.test(f) || !/[.!?]["”]?$/.test(f) || aspas % 2) return { f, i, nota: -Infinity };
    let nota = 0;
    if (/\d/.test(f)) nota += 2;
    if (POSICAO.test(f)) nota += 1.5;
    if (/!$/.test(f)) nota += 0.5;
    nota -= Math.abs(f.length - 170) / 120;
    return { f, i, nota };
  }).filter(x => x.nota > -Infinity);
  return notas.sort((a, b) => b.nota - a.nota).slice(0, max).sort((a, b) => a.i - b.i).map(x => x.f);
}

/* ---------- agenda ---------- */

export interface Participante { cargo: string | null; nome: string }
export type ModoAgenda = 'encontro' | 'telefonema' | 'video' | 'deslocamento' | 'evento';

const CARGO = /^(Ministr[oa]|Secretári[oa]|Chefe|President[ea]|Vice|Governador[a]?|Senador[a]?|Deputad[oa]|Embaixador[a]?|Prefeit[oa]|Advogad[oa]|Procurador[a]?|Comandante|Diretor[a]?|Assessor[a]?|Primeir[oa]|Rei|Rainha|Príncipe|Princesa|Porta-voz|Líder|Reitor[a]?|Juiz[a]?|Desembargador[a]?|Almirante|General|Brigadeiro|Coordenador[a]?|Superintendente|Conselheir[oa])\b/;
const HONORIFICO = /^(Senador[a]?|Deputad[oa](?: Federal| Estadual)?|Governador[a]?|Ministr[oa]|Embaixador[a]?|Dr[a]?\.?|General|Almirante|Brigadeiro|Coronel|Prefeit[oa])\s+/;

function participantes(s: string): Participante[] | null {
  const partes = s.replace(/^(?:o|a)\s+(?=\p{Lu})/u, '').split(/,\s+e\s+(?=\p{Lu})|;\s*|\s+e\s+(?=(?:o|a)\s+\p{Lu})/u).map(x => x.trim()).filter(Boolean);
  const out: Participante[] = [];
  for (const p of partes) {
    const virgula = p.lastIndexOf(', ');
    if (virgula > 0 && CARGO.test(p)) out.push({ cargo: p.slice(0, virgula).trim(), nome: p.slice(virgula + 2).replace(HONORIFICO, '').trim() });
    else if (/^(\p{Lu}[\p{L}'-]+)(\s+(d[aeo]s?|\p{Lu}[\p{L}'-]+))+$/u.test(p)) out.push({ cargo: null, nome: p });
    else return null;
  }
  return out.length ? out : null;
}

/** "o ministro da Defesa, José Mucio"; `semNome` quando o nome já aparece embaixo da foto: "o ministro da Defesa". */
export function quemEmTexto(p: Participante, semNome = false): string {
  if (!p.cargo) return p.nome;
  const fem = /^(Ministra|Secretária|Presidenta|Governadora|Senadora|Deputada|Embaixadora|Prefeita|Advogada|Procuradora|Diretora|Assessora|Primeira|Rainha|Princesa|Reitora|Juíza|Desembargadora|Coordenadora|Conselheira)\b/.test(p.cargo);
  const cargo = p.cargo.charAt(0).toLowerCase() + p.cargo.slice(1);
  return `${fem ? 'a' : 'o'} ${cargo}${semNome ? '' : `, ${p.nome}`}`;
}

/** Manchete com os cargos só (os nomes estão embaixo das fotos): "Encontro com o ministro da Defesa". */
export function mancheteCurta(modo: ModoAgenda, ps: Participante[], original: string): string {
  if (!ps.length) return original;
  const verbo = { telefonema: 'Telefonema', video: 'Videoconferência', encontro: 'Encontro', deslocamento: 'Encontro', evento: 'Encontro' }[modo];
  return `${verbo} com ${ps.map(p => quemEmTexto(p, true)).join(' e ')}`;
}

export function lerCompromisso(titulo: string): { modo: ModoAgenda; manchete: string; participantes: Participante[] } {
  const t = titulo.replace(/\s+/g, ' ').trim();
  if (/^(Partida|Chegada|Embarque|Desembarque|Deslocamento|Retorno)\b/i.test(t)) return { modo: 'deslocamento', manchete: t, participantes: [] };
  const com = t.match(/^(Telefonema|Ligação telefônica|Conversa telefônica|Videoconferência|Reunião virtual|Reunião|Encontro|Audiência|Almoço|Jantar|Café da manhã)\s+com\s+(.+)$/i);
  if (com) {
    const ps = participantes(com[2]) ?? [];
    const modo: ModoAgenda = /telef/i.test(com[1]) ? 'telefonema' : /v[ií]deo|virtual/i.test(com[1]) ? 'video' : 'encontro';
    return { modo, manchete: ps.length ? `${maiuscula(com[1].toLowerCase())} com ${ps.map(p => quemEmTexto(p)).join(' e ')}` : t, participantes: ps };
  }
  // A página do Planalto costuma listar só quem vem: "Ministra da Casa Civil, Miriam Belchior"
  const ps = CARGO.test(t) ? participantes(t) : null;
  if (ps) return { modo: 'encontro', manchete: `Encontro com ${ps.map(p => quemEmTexto(p)).join(' e ')}`, participantes: ps };
  return { modo: 'evento', manchete: t, participantes: [] };
}

/* ---------- pauta do plenário ---------- */

/** Item da pauta em linguagem comum. Pedido de urgência vira "urgência pro projeto que quer …". */
export function explicarItemPauta(ref: string, ementa: string): string {
  const urgencia = ementa.match(/urg[êe]ncia[\s\S]*?(?:Projeto|Proposta|Medida Provis[óo]ria|Substitutivo|PL|PEC|PLP|PDL)[^,]*?,?\s*(?:de \d{4},\s*)?que\s+([\s\S]+)$/i);
  if (/^REQ\b/i.test(ref) && urgencia) return `urgência pro projeto que quer ${explicarEmenta(maiuscula(urgencia[1].trim()))}`;
  return explicarEmenta(ementa);
}

export type DesfechoPauta = 'aprovado' | 'rejeitado' | 'adiado';
/** O que aconteceu com o item, pela situação oficial. null quando o texto não diz. */
export function desfechoPauta(situacao: string | null): DesfechoPauta | null {
  if (!situacao) return null;
  if (/rejeitad/i.test(situacao)) return 'rejeitado';
  if (/aprovad/i.test(situacao)) return 'aprovado';
  if (/não apreciad|adiad|retirad|encerramento da ordem|prejudicad/i.test(situacao)) return 'adiado';
  return null;
}
