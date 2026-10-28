/* Agenda oficial: leitura da página do Planalto e classificação de cada compromisso em
   pública (com órgão ou autoridade), privada (empresa, entidade, sociedade civil), partidária ou pessoal.
   Puro, coberto por tests/agenda.test.ts. O critério é público em /metodo/; na dúvida, fica sem classificação. */

export type NaturezaAgenda = 'publica' | 'privada' | 'partidaria' | 'pessoal';
export interface Compromisso { quando: string; titulo: string; local: string | null }

const entidades = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const texto = (s: string | undefined) => entidades((s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Compromissos de um dia da agenda do presidente (HTML Plone do gov.br). `dia` em AAAA-MM-DD, horário de Brasília. */
export function lerAgendaPlanalto(html: string, dia: string): Compromisso[] {
  const blocos = html.match(/<li class="item-compromisso-wrapper">[\s\S]*?<\/li>/g) ?? [];
  return blocos.map(b => {
    const hora = b.match(/compromisso-inicio">\s*(\d{1,2})h(\d{2})/);
    const titulo = texto(b.match(/compromisso-titulo">([\s\S]*?)<\/h2>/)?.[1]);
    const local = texto(b.match(/compromisso-local">([\s\S]*?)<\/div>/)?.[1]) || null;
    const quando = `${dia}T${hora ? `${hora[1].padStart(2, '0')}:${hora[2]}` : '00:00'}:00-03:00`;
    return { quando, titulo, local };
  }).filter(c => c.titulo);
}

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const PESSOAL = /\b(consulta medica|exame|medic[oa]s?|hospital|velorio|sepultamento|missa de setimo|casamento|aniversario|folga|descanso|particular|familia)\b/;
const PARTIDO = /\b(partido|diretorio|executiva nacional|executiva estadual|militancia|federacao partidaria|campanha|presidente nacional d[oa] (pt|pl|psd|mdb|pp|uniao|republicanos|psb|pdt|psdb|psol|pcdob|novo|podemos|avante|solidariedade|rede|cidadania|pv))\b/;
const PRIVADO = /\b(s\.?a\.?|ltda|ceo|empresari[oa]s?|empresa|grupo [a-z]|banco (?!central|do brasil|nacional|do nordeste|da amazonia|interamericano|mundial|dos brics)|investidores?|fundo de investimento|industria|confederacao nacional d[aoe]|federacao das industrias|cni|febraban|sindicato|associacao|instituto (?!nacional|brasileiro de geografia|federal)|fundacao (?!oswaldo|nacional)|cooperativa|central unica|centrais sindicais|movimento|ong|sociedade civil|artistas?|cantor[a]?|atletas?|jogador)\b/;
const PUBLICO = /\b(ministr[oa]s?|secretari[oa]s?|governador[a]?|prefeit[oa]s?|vice-presidente|presidente d[ao] (camara|senado|supremo|stf|tcu|banco central|bndes|petrobras|caixa|correios|republica)|senador[a]?|deputad[oa]s?|embaixador[a]?|presidenta|chefe de estado|chefe de governo|primeir[oa]-ministr[oa]|rei|rainha|presidente d[ao] [a-z]+ (?:da|de|do) |stf|tcu|tse|pgr|agu|cgu|advogad[oa]-geral|procurador[a]?-geral|comandante|gabinete|despacho|reuniao ministerial|conselho|cerimonia|sancao|assinatura|posse|audiencia|visita oficial|viagem|cupula|forum|cop\d*|g20|brics|mercosul|onu)\b/;

/** Natureza do compromisso pelo texto, na ordem: pessoal > partidária > privada > pública. null = sem critério que bata. */
export function classificarAgenda(titulo: string): NaturezaAgenda | null {
  const t = ` ${sem(titulo)} `;
  if (PESSOAL.test(t)) return 'pessoal';
  if (PARTIDO.test(t)) return 'partidaria';
  if (PRIVADO.test(t)) return 'privada';
  if (PUBLICO.test(t)) return 'publica';
  return null;
}
