/* Editor local da tabela de estimativas por partido (src/data/partidos.json).
   `npm run editor:partidos` → abre http://localhost:4400
   Mostra, pra cada partido × pauta, a estimativa atual ao lado da evidência real
   (como a bancada votou e a orientação da liderança) e grava direto no arquivo.
   Só roda na sua máquina: não faz parte do site publicado. */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { RAIZ, GERADO } from './util';

const PORTA = Number(process.env.PORTA ?? 4400);
const ARQ = resolve(RAIZ, 'src/data/partidos.json');
const ler = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function dados() {
  const ev = existsSync(resolve(GERADO, 'evidencia-partidos.json')) ? ler(resolve(GERADO, 'evidencia-partidos.json')) : { evidencia: {} };
  const camara = ler(resolve(GERADO, 'camara.json')), senado = ler(resolve(GERADO, 'senado.json'));
  return { partidos: ler(ARQ), temas: ler(resolve(RAIZ, 'src/data/temas.json')).temas, evidencia: ev, bancadas: { camara: camara.bancadas, senado: senado.bancadas } };
}

const HTML = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Estimativas por partido — editor</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--bg:#080A08;--surface:#12160F;--line:#243020;--ink:#F2F5F0;--muted:#78876F;--data:#00E676;--stance:#FFD100;--danger:#FF3B30}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 Barlow,system-ui,sans-serif}
header{position:sticky;top:0;z-index:5;background:#0B0E09;border-bottom:1px solid var(--line);padding:12px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
h1{font:700 18px/1 Impact,'Anton',sans-serif;letter-spacing:.02em;margin:0;text-transform:uppercase}h1 span{color:var(--stance)}
button{font:600 12px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:3px;padding:9px 12px;cursor:pointer}
button:hover{color:var(--ink);border-color:var(--muted)}button.p{background:var(--stance);border-color:var(--stance);color:#0B0D08}button.p:hover{background:#fff}
button:disabled{opacity:.4;cursor:default}
.msg{font:11px ui-monospace,monospace;color:var(--data)}.msg.err{color:var(--danger)}
.legenda{font:11px ui-monospace,monospace;color:var(--muted);margin-left:auto;line-height:1.7}
.wrap{overflow:auto;padding:0 0 60px}
table{border-collapse:separate;border-spacing:0;min-width:100%}
th,td{border-bottom:1px solid var(--line);padding:0;vertical-align:top}
thead th{position:sticky;top:var(--hh,53px);background:#0B0E09;z-index:3;font:600 10px/1.3 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:10px 6px;text-align:center;max-width:92px}
thead th small{display:block;color:#3D4A36;text-transform:none;letter-spacing:0;font-weight:400}
tbody th{position:sticky;left:0;background:var(--surface);z-index:2;text-align:left;padding:8px 10px;min-width:200px;border-right:1px solid var(--line)}
tbody th b{font-size:14px}tbody th small{display:block;font:10px ui-monospace,monospace;color:var(--muted);letter-spacing:.06em;margin-top:3px}
tbody th input,tbody th select{background:#0B0E09;color:var(--ink);border:1px solid var(--line);border-radius:2px;font:12px Barlow,sans-serif;padding:3px 5px;margin-top:5px}
tbody th input{width:100%}tbody th label{font:10px ui-monospace,monospace;color:var(--muted);display:flex;gap:5px;align-items:center;margin-top:5px}
tr.campo td{background:#0B0E09;padding:6px 10px;font:600 10px ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--data)}
.cel{width:92px;height:56px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;cursor:pointer;user-select:none;border-right:1px solid var(--line);position:relative}
.cel:hover{background:#1B2317}
.cel .v{font:800 16px/1 ui-monospace,monospace;width:28px;height:28px;border-radius:3px;display:grid;place-items:center}
.cel.F .v{background:var(--data);color:#06210F}.cel.C .v{background:var(--danger);color:#fff}.cel.D .v{background:#3D4A36;color:var(--ink)}
.cel .e{font:10px/1 ui-monospace,monospace;color:var(--muted);white-space:nowrap}
.cel .e.ok{color:var(--data)}.cel .e.dv{color:var(--stance)}.cel .e.dvf{color:var(--danger);font-weight:700}
.cel.mod::after{content:'';position:absolute;top:4px;right:4px;width:6px;height:6px;border-radius:50%;background:var(--stance)}
.cel.sem .v{opacity:.35}
#tip{position:fixed;z-index:10;background:#0B0E09;border:1px solid var(--line);border-radius:3px;padding:10px 12px;font:11.5px/1.6 ui-monospace,monospace;color:#C2CCBB;max-width:460px;pointer-events:none;display:none;box-shadow:0 12px 40px rgba(0,0,0,.6)}
#tip b{color:var(--stance)}#tip .f{color:var(--data)}#tip .c{color:var(--danger)}
.novo{padding:14px 18px;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center;font:12px ui-monospace,monospace;color:var(--muted)}
.novo input{background:#0B0E09;color:var(--ink);border:1px solid var(--line);border-radius:2px;padding:6px 8px;font:13px Barlow,sans-serif}
</style></head><body>
<header><h1>Estimativas <span>por partido</span></h1>
<button class="p" id="salvar" disabled>Salvar no partidos.json</button><button id="reverter" disabled>Reverter</button><button id="aplicar">Aplicar sugestões fortes</button><button id="rebuild">Salvar + regerar datasets</button>
<span class="msg" id="msg"></span>
<div class="legenda">clique na célula: F → D → C · <b style="color:var(--data)">F</b> a favor · <b style="color:var(--danger)">C</b> contra · D dividido<br>abaixo da célula: % da bancada que votou a favor da pauta (voto real) · <span style="color:var(--stance)">amarelo</span> diverge · <span style="color:var(--danger)">vermelho</span> diverge com evidência forte</div>
</header>
<div class="wrap"><table id="tab"></table></div>
<div class="novo">novo partido: <input id="nSigla" placeholder="SIGLA" size="10"> <input id="nNome" placeholder="Nome" size="24"> <select id="nCampo"><option value="">sem campo</option><option value="esq">esquerda</option><option value="centro">centro</option><option value="dir">direita</option></select> <button id="nAdd">adicionar</button></div>
<div id="tip"></div>
<script>
let D, orig, P, mods = new Set();
const CAMPOS = [['esq','Esquerda'],['centro','Centro'],['dir','Direita'],[null,'Sem campo classificado']];
const $ = s => document.querySelector(s);
const ciclo = { F:'D', D:'C', C:'F' };
function ajustarCabecalho(){ document.documentElement.style.setProperty('--hh', document.querySelector('header').offsetHeight + 'px'); }
addEventListener('resize', ajustarCabecalho);
async function carregar(){ D = await (await fetch('/dados')).json(); P = D.partidos; orig = JSON.stringify(P); mods.clear(); render(); }
function ev(t, sg){ return (D.evidencia.evidencia[t]||{})[sg]; }
function render(){
  const temas = D.temas, ordem = P.ordemTemas;
  let h = '<thead><tr><th style="text-align:left">partido<small>bancada Câmara · Senado</small></th>' + ordem.map(id => { const t = temas.find(x=>x.id===id); const n = Object.keys(D.evidencia.evidencia[id]||{}).length; return '<th title="'+esc(t.t)+'">'+esc(t.s)+'<small>'+(n? n+' partidos c/ voto':'sem votação')+'</small></th>'; }).join('') + '</tr></thead><tbody>';
  for (const [campo, rot] of CAMPOS) {
    const lista = Object.entries(P.partidos).filter(([,p]) => (p.campo||null) === campo).sort((a,b)=>((D.bancadas.camara[b[0]]||0)-(D.bancadas.camara[a[0]]||0)));
    if (!lista.length) continue;
    h += '<tr class="campo"><td colspan="'+(ordem.length+1)+'">'+rot+' · '+lista.length+' partidos</td></tr>';
    for (const [sg, p] of lista) {
      h += '<tr><th><b>'+esc(sg)+'</b><small>'+(D.bancadas.camara[sg]||0)+' dep · '+(D.bancadas.senado[sg]||0)+' sen</small>'
        + '<input data-nome="'+esc(sg)+'" value="'+esc(p.nome)+'" title="nome do partido">'
        + '<select data-campo="'+esc(sg)+'"><option value="" '+(!p.campo?'selected':'')+'>sem campo</option><option value="esq" '+(p.campo==='esq'?'selected':'')+'>esquerda</option><option value="centro" '+(p.campo==='centro'?'selected':'')+'>centro</option><option value="dir" '+(p.campo==='dir'?'selected':'')+'>direita</option></select>'
        + '<label><input type="checkbox" data-sem="'+esc(sg)+'" '+(p.semOrientacao?'checked':'')+'> sem orientação pública (tudo D)</label></th>';
      ordem.forEach((t, i) => {
        const est = p.estimativa[i] || 'D', e = ev(t, sg);
        let cls = 'cel '+est, sub = '<span class="e">—</span>';
        if (e && e.pctF !== null) {
          const div = e.sugestao && e.sugestao !== est && e.forca !== 'fraca', forte = div && e.forca === 'forte';
          const c = div ? (forte ? 'dvf' : 'dv') : (e.sugestao === est ? 'ok' : '');
          sub = '<span class="e '+c+'">'+e.pctF+'% F · '+(e.f+e.c)+'v</span>';
        }
        if (p.semOrientacao) cls += ' sem';
        if (mods.has(sg+'|'+i)) cls += ' mod';
        h += '<td><div class="'+cls+'" data-sg="'+esc(sg)+'" data-i="'+i+'" data-t="'+t+'"><span class="v">'+est+'</span>'+sub+'</div></td>';
      });
      h += '</tr>';
    }
  }
  $('#tab').innerHTML = h + '</tbody>';
  atualizarBotoes(); ajustarCabecalho();
}
function esc(s){ return String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function atualizarBotoes(){ const dif = JSON.stringify(P) !== orig; $('#salvar').disabled = !dif; $('#reverter').disabled = !dif; }
document.addEventListener('click', e => {
  const cel = e.target.closest('.cel'); if (!cel) return;
  const sg = cel.dataset.sg, i = +cel.dataset.i; const p = P.partidos[sg];
  p.estimativa[i] = ciclo[p.estimativa[i] || 'D']; mods.add(sg+'|'+i); render();
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.nome !== undefined) P.partidos[t.dataset.nome].nome = t.value;
  else if (t.dataset.campo !== undefined) P.partidos[t.dataset.campo].campo = t.value || null;
  else if (t.dataset.sem !== undefined) { if (t.checked) P.partidos[t.dataset.sem].semOrientacao = true; else delete P.partidos[t.dataset.sem].semOrientacao; }
  else return;
  render();
});
document.addEventListener('mouseover', e => {
  const cel = e.target.closest('.cel'); const tip = $('#tip');
  if (!cel) { tip.style.display = 'none'; return; }
  const ev_ = ev(cel.dataset.t, cel.dataset.sg), tema = D.temas.find(x=>x.id===cel.dataset.t);
  let h = '<b>'+esc(cel.dataset.sg)+' · '+esc(tema.s)+'</b><br>'+esc(tema.t)+'<br>';
  if (!ev_) h += '<br>sem votação nominal mapeada nesta pauta — só a estimativa vale.';
  else {
    h += '<br>bancada: <span class="f">'+ev_.f+' a favor</span> · <span class="c">'+ev_.c+' contra</span>' + (ev_.sugestao ? ' → sugestão <b>'+ev_.sugestao+'</b> ('+ev_.forca+')' : '') + '<br>';
    for (const v of ev_.votacoes) h += '· '+esc(v.rotulo)+': <span class="f">'+v.f+'</span>/<span class="c">'+v.c+'</span><br>';
    for (const o of ev_.orientacoes) h += '· orientação da liderança: <b>'+esc(o.orientacao)+'</b> em '+esc(o.rotulo.split(' — ')[0])+'<br>';
  }
  tip.innerHTML = h; tip.style.display = 'block';
  const r = cel.getBoundingClientRect(); tip.style.left = Math.min(r.left, innerWidth - 480) + 'px'; tip.style.top = (r.bottom + 6) + 'px';
});
$('#aplicar').onclick = () => {
  let n = 0;
  for (const [sg, p] of Object.entries(P.partidos)) P.ordemTemas.forEach((t, i) => { const e = ev(t, sg); if (e && e.forca === 'forte' && e.sugestao && e.sugestao !== p.estimativa[i]) { p.estimativa[i] = e.sugestao; mods.add(sg+'|'+i); n++; } });
  render(); $('#msg').textContent = n + ' células alinhadas à evidência forte (ainda não salvo)';
};
$('#reverter').onclick = () => carregar();
async function salvar(rebuild){
  const m = $('#msg'); m.className = 'msg'; m.textContent = rebuild ? 'salvando e regerando…' : 'salvando…';
  const r = await fetch('/salvar' + (rebuild ? '?rebuild=1' : ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(P) });
  const j = await r.json(); m.className = 'msg' + (j.ok ? '' : ' err'); m.textContent = j.msg;
  if (j.ok) { orig = JSON.stringify(P); mods.clear(); render(); }
}
$('#salvar').onclick = () => salvar(false);
$('#rebuild').onclick = () => salvar(true);
$('#nAdd').onclick = () => {
  const sg = $('#nSigla').value.trim().toUpperCase(); if (!sg || P.partidos[sg]) return;
  P.partidos[sg] = { nome: $('#nNome').value.trim() || sg, campo: $('#nCampo').value || null, estimativa: P.ordemTemas.map(() => 'D') };
  P.aliases[sg] = sg; render();
};
carregar();
</script></body></html>`;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); return; }
  if (req.method === 'GET' && url.pathname === '/dados') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(dados())); return; }
  if (req.method === 'POST' && url.pathname === '/salvar') {
    let corpo = ''; req.on('data', c => { corpo += c; });
    req.on('end', () => {
      try {
        const novo = JSON.parse(corpo);
        if (!novo.partidos || !Array.isArray(novo.ordemTemas)) throw new Error('formato inesperado');
        for (const [sg, p] of Object.entries<{ estimativa: string[] }>(novo.partidos)) {
          if (p.estimativa.length !== novo.ordemTemas.length || p.estimativa.some(l => !['F', 'C', 'D'].includes(l))) throw new Error(`estimativa inválida em ${sg}`);
        }
        writeFileSync(ARQ, JSON.stringify(novo, null, 1) + '\n', 'utf8');
        let msg = `✓ salvo em src/data/partidos.json (${Object.keys(novo.partidos).length} partidos)`;
        if (url.searchParams.get('rebuild')) {
          execFileSync('npx', ['tsx', 'scripts/build-dataset.ts'], { cwd: RAIZ, stdio: 'pipe' });
          execFileSync('npx', ['tsx', 'scripts/validate-dataset.ts'], { cwd: RAIZ, stdio: 'pipe' });
          msg += ' · datasets das 27 UFs regerados e validados';
        }
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, msg }));
      } catch (e) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, msg: 'não salvou: ' + (e as Error).message })); }
    });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORTA, '127.0.0.1', () => console.log(`▶ editor de estimativas em http://localhost:${PORTA}  (Ctrl+C pra parar)`));
