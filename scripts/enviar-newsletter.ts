/* Manda a edição desta semana (`edicoes.html`) pra quem está em `lista_espera`, pelo Resend, e registra cada
   envio em `envios`: rodar de novo só manda pra quem ainda não recebeu. Regras da mensagem em src/lib/envio.ts.
   Roda no GitHub Actions (newsletter.yml) logo depois de `npm run newsletter`, e nos dias seguintes pra
   terminar o que a cota do dia não deixou.
   Precisa de RESEND_API_KEY (sem ela avisa e sai sem erro) e SUPABASE_SECRET_KEY.
   Uso: npm run newsletter:enviar               manda pra quem falta
        npm run newsletter:enviar -- --seco     só conta quem receberia
        npm run newsletter:enviar -- --para=voce@exemplo.com   manda uma cópia de teste, sem registrar */
import { pedir } from './coletores/banco';
import { segundaDaSemana } from '../src/lib/edicao';
import { mensagem, pendentes, type Inscrito, type Mensagem } from '../src/lib/envio';

const SITE = 'https://www.meutimepolitico.com';
const REMETENTE = process.env.EMAIL_REMETENTE || 'Meu Time Político <resumo@meutimepolitico.com>';
const LIMITE = Number(process.env.EMAIL_LIMITE_DIA ?? 100);   // plano gratuito do Resend: 100 por dia, 3.000 por mês
const CHAVE = process.env.RESEND_API_KEY;

async function mandar(lote: Mensagem[]): Promise<string[]> {
  const r = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(lote),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Resend: HTTP ${r.status} ${txt.slice(0, 300)}`);
  return (JSON.parse(txt) as { data: { id: string }[] }).data.map(d => d.id);
}

async function main() {
  const seco = process.argv.includes('--seco');
  const para = process.argv.find(a => a.startsWith('--para='))?.slice('--para='.length);
  if (!CHAVE && !seco) {
    console.warn('⚠ falta RESEND_API_KEY: nada foi enviado (a edição continua em /semana/).');
    if (process.env.GITHUB_ACTIONS) console.log('::warning::Falta o secret RESEND_API_KEY; a newsletter não foi enviada.');
    return;
  }
  const semana = segundaDaSemana(new Date());
  const [ed] = await pedir<{ html: string | null }[]>(`edicoes?semana=eq.${semana}&select=html`);
  if (!ed?.html) throw new Error(`não há edição da semana de ${semana} (rode npm run newsletter antes)`);
  console.log(`▶ Envio da newsletter, semana de ${semana}`);

  if (para) {
    const [id] = await mandar([mensagem({ html: ed.html, semana, inscrito: { id: 'teste', email: para, token: 'teste' }, site: SITE, remetente: REMETENTE })]);
    console.log(`  ✓ cópia de teste enviada (${id}); o link de sair dela não funciona`);
    return;
  }

  const inscritos = await pedir<Inscrito[]>('lista_espera?select=id,email,token&order=criado_em&limit=10000');
  const ja = new Set((await pedir<{ lista_id: string }[]>(`envios?semana=eq.${semana}&select=lista_id&limit=10000`)).map(e => e.lista_id));
  const fila = pendentes(inscritos, ja, LIMITE);
  const sobra = inscritos.length - ja.size - fila.length;
  console.log(`  ${inscritos.length} inscritos, ${ja.size} já receberam, ${fila.length} agora${sobra > 0 ? `, ${sobra} ficam pra amanhã (cota do dia)` : ''}`);
  if (seco || !fila.length) return;

  let enviados = 0;
  for (let i = 0; i < fila.length; i += 100) {
    const lote = fila.slice(i, i + 100);
    const ids = await mandar(lote.map(inscrito => mensagem({ html: ed.html!, semana, inscrito, site: SITE, remetente: REMETENTE })));
    // registra logo depois de cada lote: se o próximo falhar, quem já recebeu não recebe de novo
    await pedir('envios?on_conflict=semana,lista_id', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(lote.map((l, k) => ({ semana, lista_id: l.id, id_servico: ids[k] ?? null }))),
    });
    enviados += lote.length;
    if (i + 100 < fila.length) await new Promise(r => setTimeout(r, 600));   // limite de pedidos por segundo do Resend
  }
  console.log(`  ✓ ${enviados} e-mails enviados`);
}

main().catch(e => { console.error('✗ envio da newsletter falhou:', e.message); process.exit(1); });
