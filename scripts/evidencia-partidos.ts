/* Evidência objetiva pra revisar a tabela de estimativas por partido (src/data/partidos.json).
   Pra cada pauta com votação nominal mapeada, mede por partido:
     - como a bancada votou de fato (Sim/Não, já traduzido pro lado da pauta)
     - a orientação oficial da liderança, quando a API da Câmara publica
   e sugere um lado: F/C quando ≥ 70% da bancada foi pra um lado (mín. 3 votos), D quando ficou entre 40% e 60%.
   Saída: src/data/generated/evidencia-partidos.json — lida pelo editor (scripts/editor-partidos.ts) e pelo revisor. */
import { resolve } from 'node:path';
import { lerJson, escreverJson, agoraIso, RAIZ, GERADO } from './util';
import { canonizarSigla } from '../src/lib/nomes';
import type { Lado, Tema } from '../src/lib/tipos';

interface Vot { data: string; votos: Record<string, string>; nomes: Record<string, { nome: string; partido: string; uf: string }>; orientacoes?: Record<string, string> }
interface Acum { f: number; c: number; orientacoes: { rotulo: string; casa: string; orientacao: string; lado: Lado | null }[]; votacoes: { rotulo: string; casa: string; f: number; c: number }[] }

export interface EvidenciaPartido { f: number; c: number; pctF: number | null; sugestao: Lado | null; forca: 'forte' | 'media' | 'fraca' | null; orientacoes: Acum['orientacoes']; votacoes: Acum['votacoes'] }

function main() {
  const { temas } = lerJson<{ temas: Tema[] }>(resolve(RAIZ, 'src/data/temas.json'));
  const { aliases } = lerJson<{ aliases: Record<string, string> }>(resolve(RAIZ, 'src/data/partidos.json'));
  const camara = lerJson<{ votacoes: Record<string, Vot> }>(resolve(GERADO, 'camara.json'));
  const senado = lerJson<{ votacoes: Record<string, Vot> }>(resolve(GERADO, 'senado.json'));
  const ladoDoVoto = (voto: string, ladoSim: 'F' | 'C'): Lado | null => {
    const v = voto.toLowerCase();
    if (v === 'sim') return ladoSim; if (v === 'não' || v === 'nao') return ladoSim === 'F' ? 'C' : 'F'; return null;
  };
  const out: Record<string, Record<string, EvidenciaPartido>> = {};
  for (const t of temas) {
    const acc: Record<string, Acum> = {};
    const get = (p: string) => (acc[p] ??= { f: 0, c: 0, orientacoes: [], votacoes: [] });
    for (const ref of t.votacoes) {
      const v = ref.casa === 'camara' ? camara.votacoes[ref.id!] : senado.votacoes[String(ref.codigoSessaoVotacao)];
      if (!v) continue;
      const porPartido: Record<string, { f: number; c: number }> = {};
      for (const [id, voto] of Object.entries(v.votos)) {
        const lado = ladoDoVoto(voto, ref.ladoSim); if (!lado) continue;
        const p = canonizarSigla(v.nomes[id]?.partido ?? '', aliases); if (!p) continue;
        const pp = (porPartido[p] ??= { f: 0, c: 0 }); if (lado === 'F') pp.f++; else pp.c++;
      }
      for (const [p, n] of Object.entries(porPartido)) { const a = get(p); a.f += n.f; a.c += n.c; a.votacoes.push({ rotulo: ref.rotulo, casa: ref.casa, f: n.f, c: n.c }); }
      for (const [bloco, ori] of Object.entries(v.orientacoes ?? {})) {
        if (!ori) continue;
        // partido isolado ("PL") ou federação ("Fdr PT-PCdoB-PV" → PT, PCdoB, PV); blocos e lideranças de Governo/Oposição ficam de fora
        let siglas: string[] = [];
        if (/^Fdr /.test(bloco)) siglas = bloco.replace(/^Fdr /, '').split('-');
        else if (/^[A-ZÇÃa-z]+$/.test(bloco) && !['GOVERNO', 'MINORIA', 'MAIORIA', 'OPOSIÇÃO'].includes(bloco.toUpperCase())) siglas = [bloco];
        for (const sg of siglas) {
          const p = canonizarSigla(sg, aliases), lado = ladoDoVoto(ori, ref.ladoSim), pv = porPartido[p];
          // guarda de qualidade: se a orientação contradiz ≥80% dos votos da própria bancada (mín. 3), a API
          // está devolvendo a orientação de outra questão (acontece na PEC 32) — descarta
          if (lado && pv && pv.f + pv.c >= 3) { const pct = (lado === 'F' ? pv.f : pv.c) / (pv.f + pv.c); if (pct <= 0.2) continue; }
          get(p).orientacoes.push({ rotulo: ref.rotulo, casa: ref.casa, orientacao: ori, lado });
        }
      }
    }
    out[t.id] = {};
    for (const [p, a] of Object.entries(acc)) {
      const n = a.f + a.c, pctF = n ? Math.round(a.f / n * 100) : null;
      let sugestao: Lado | null = null, forca: EvidenciaPartido['forca'] = null;
      if (n >= 3 && pctF !== null) {
        if (pctF >= 70) { sugestao = 'F'; forca = n >= 8 && pctF >= 85 ? 'forte' : 'media'; }
        else if (pctF <= 30) { sugestao = 'C'; forca = n >= 8 && pctF <= 15 ? 'forte' : 'media'; }
        else if (pctF >= 40 && pctF <= 60) { sugestao = 'D'; forca = n >= 8 ? 'media' : 'fraca'; }
      } else if (n > 0 && pctF !== null) { sugestao = pctF >= 50 ? 'F' : 'C'; forca = 'fraca'; }
      out[t.id][p] = { f: a.f, c: a.c, pctF, sugestao, forca, orientacoes: a.orientacoes, votacoes: a.votacoes };
    }
  }
  escreverJson(resolve(GERADO, 'evidencia-partidos.json'), { geradoEm: agoraIso(), criterio: 'F/C quando ≥70% da bancada votou pra um lado (mín. 3 votos); D entre 40% e 60%; "forte" = ≥8 votos e ≥85%.', evidencia: out });
  const comEv = temas.filter(t => Object.keys(out[t.id]).length);
  console.log(`  evidência em ${comEv.length} pautas: ${comEv.map(t => `${t.id} (${Object.keys(out[t.id]).length} partidos)`).join(' · ')}`);
}
main();
