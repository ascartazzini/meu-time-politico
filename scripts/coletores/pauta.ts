/* Coletor da pauta futura do plenário (Câmara e Senado), pra newsletter mostrar "votações pela frente".
   As casas publicam a pauta poucos dias antes; sem sessão marcada, a newsletter diz isso.
   Requerimento (licença, urgência, informação) fica de fora: entra o que muda lei.
   Uso: npm run coletar:pauta [-- --dias=10] [-- --desde=AAAA-MM-DD, pra conferir com semana passada] */
import { fetchJson } from '../util';
import { pedir, br, diasDoArgumento } from './banco';

const CAM = 'https://dadosabertos.camara.leg.br/api/v2';
const SEN = 'https://legis.senado.leg.br/dadosabertos';
const MATERIA = /^(PL|PLP|PEC|MPV|PDL|PLN|PLV|PLS|PRS|PDS)\b/;
const lista = <T>(x: T | T[] | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);
const DESDE = process.argv.find(a => /^--desde=\d{4}-\d{2}-\d{2}$/.test(a))?.split('=')[1];
const inicio = () => (DESDE ? new Date(`${DESDE}T00:00:00-03:00`) : new Date());

interface Linha { chave: string; casa: 'camara' | 'senado'; quando: string; sessao: string | null; materia: string; ementa: string | null; url: string }

async function camara(dias: number): Promise<Linha[]> {
  const hoje = inicio(), fim = new Date(hoje.getTime() + dias * 864e5);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  const evs = (await fetchJson<{ dados: { id: number; dataHoraInicio: string; situacao: string; descricaoTipo: string; orgaos: { sigla: string }[] }[] }>(
    `${CAM}/eventos?dataInicio=${f(hoje)}&dataFim=${f(fim)}&itens=100`)).dados
    .filter(e => e.orgaos.some(o => o.sigla === 'PLEN') && /deliberativa/i.test(e.descricaoTipo) && !/cancel/i.test(e.situacao));
  const out: Linha[] = [];
  for (const e of evs) {
    const itens = (await fetchJson<{ dados: { titulo: string; proposicao_?: { id: number; ementa: string } }[] }>(`${CAM}/eventos/${e.id}/pauta`).catch(() => ({ dados: [] }))).dados;
    for (const p of itens) {
      if (!MATERIA.test(p.titulo)) continue;
      out.push({
        chave: `camara-${e.id}-${p.titulo}`, casa: 'camara', quando: br(e.dataHoraInicio)!, sessao: e.descricaoTipo, materia: p.titulo,
        ementa: p.proposicao_?.ementa?.replace(/\s+/g, ' ').trim() ?? null,
        url: p.proposicao_ ? `https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=${p.proposicao_.id}` : `https://www.camara.leg.br/evento-legislativo/${e.id}`,
      });
    }
  }
  return out;
}

type SessaoSen = { Data: string; Hora?: string; TipoSessao: string; CodigoSessao: string; Casa?: string; Materias?: { Materia: unknown } };
type MateriaSen = { CodigoMateria: string; DescricaoIdentificacaoMateria?: string; Identificacao?: string; Ementa?: string };

async function senado(dias: number): Promise<Linha[]> {
  const hoje = inicio(), limite = hoje.getTime() + dias * 864e5;
  const meses = [hoje, new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1)];
  const out: Linha[] = [];
  for (const m of meses) {
    const d = m === hoje ? hoje.toISOString().slice(0, 10).replace(/-/g, '') : `${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, '0')}01`;
    const r = await fetchJson<{ AgendaPlenario: { Sessoes?: { Sessao: unknown } } }>(`${SEN}/plenario/agenda/mes/${d}`).catch(() => null);
    for (const s of lista(r?.AgendaPlenario.Sessoes?.Sessao as SessaoSen | SessaoSen[])) {
      const quando = br(`${s.Data}T${(s.Hora ?? '00:00').slice(0, 5)}`)!;
      if (new Date(quando).getTime() < hoje.getTime() || new Date(quando).getTime() > limite || !/DELIBERATIVA/i.test(s.TipoSessao)) continue;
      for (const mat of lista(s.Materias?.Materia as MateriaSen | MateriaSen[])) {
        const id = (mat.DescricaoIdentificacaoMateria ?? mat.Identificacao ?? '').split(' - ')[0].trim();
        if (!MATERIA.test(id)) continue;
        out.push({
          chave: `senado-${s.CodigoSessao}-${mat.CodigoMateria}`, casa: 'senado', quando, sessao: s.TipoSessao.toLowerCase().replace(/^./, c => c.toUpperCase()),
          materia: id, ementa: mat.Ementa?.replace(/\s+/g, ' ').trim() ?? null,
          url: `https://www25.senado.leg.br/web/atividade/materias/-/materia/${mat.CodigoMateria}`,
        });
      }
    }
  }
  return out;
}

async function main() {
  const dias = diasDoArgumento(10);
  console.log(`▶ Pauta dos próximos ${dias} dias`);
  // a mesma matéria pode aparecer duas vezes na pauta da mesma sessão (discussão e votação)
  const linhas = [...new Map([...await camara(dias), ...await senado(dias)].map(l => [l.chave, l])).values()];
  if (linhas.length) {
    await pedir('pauta?on_conflict=chave', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas) });
  }
  console.log(`  ✓ pauta: ${linhas.filter(l => l.casa === 'camara').length} na Câmara, ${linhas.filter(l => l.casa === 'senado').length} no Senado`);
}

main().catch(e => { console.error('✗ coletor de pauta falhou:', e.message); process.exit(1); });
