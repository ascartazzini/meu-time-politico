# Meu Time Político 2026

Você vota em cinco cargos e decide um de cada vez. Aqui você escala os cinco como um time e descobre se eles jogam juntos — e se têm cadeira pra aprovar alguma coisa. Tech cívica, código aberto, sem vínculo com partido, campanha ou candidato. Cobre os 26 estados e o Distrito Federal.

## Como roda

```bash
npm install
npm run fetch-data     # Câmara + Senado (APIs oficiais) + TSE (CDN, com fallback pro Wayback Machine)
npm run build          # build-data → validate-data → astro build
npm run dev            # servidor local em http://localhost:4321
npm test               # motor de cálculo, codificação do link, casamento de nomes
```

## Arquitetura

```
src/data/temas.json          14 pautas, impacto por perfil, votações nominais mapeadas
src/data/partidos.json       siglas canônicas, aliases, campo ideológico, estimativa por pauta
src/data/cargos.json         5 cargos, casa, quórum, peso no placar
src/data/perfil.json         perguntas do eixo BOLSO
src/data/ufs.json            27 UFs e o nome de cada casa legislativa
src/data/generated/          camara.json, senado.json, tse-2026.json, assembleias.json, indice.json (versionados)
public/dados/<UF>.json       um dataset por UF, gerado no build (gitignored) — o app carrega só o do estado da pessoa

scripts/fetch-camara.ts      bancadas + 513 deputados (com CPF e nome civil) + votos nominais (API da Câmara)
scripts/fetch-senado.ts      senadores + bancadas + votos nominais (API do Senado)
scripts/fetch-tse.ts         consulta_cand_2026 → tse-2026.json · consulta_cand_2022 (eleitos) → assembleias.json
scripts/build-dataset.ts     casa candidato ↔ mandato (CPF na Câmara, nome no Senado), resolve votos, gera 27 datasets + índice
scripts/validate-dataset.ts  zod + invariantes em cada UF (soma de bancadas, quórum, ids, UF dos candidatos)

src/lib/motor.ts             cálculo puro: camisa, bolso, coerência, gol contra, peso, força, veredito, leitura da força, sugestões de troca
src/lib/dataset.ts           carrega /dados/<UF>.json e hidrata posições (voto real > estimativa do partido)
src/lib/estado.ts            persistência local + link compartilhável (#s=…, com a UF)
src/lib/stories.ts           imagem 1080×1920 pros stories (canvas, no navegador; Web Share ou download)
src/lib/wizard.ts            camada de DOM do app (escolha de UF → perfil → pautas → escalação → placar)
src/pages/index.astro        landing (como funciona) · app.astro (o app: capa + primeira pergunta na mesma tela) · metodo.astro · sobre.astro (redireciona pra /)
```

O build não bate em API nenhuma: os fetches são um passo separado e o resultado é versionado em `src/data/generated/`, então o deploy é reproduzível mesmo se a Câmara estiver fora do ar. O app pede `/dados/<UF>.json` só depois que a pessoa escolhe o estado.

## Dados: o que é real e o que é estimativa

- **Candidatos**: registro oficial do TSE (`consulta_cand_2026`), 5 cargos, 27 UFs + presidência. Vices e suplentes ficam de fora; inaptos, renúncias, indeferidos e cassados são excluídos. Enquanto a Justiça Eleitoral julga os registros, a situação vem como "aguardando julgamento".
- **Bancadas** da Câmara e do Senado: reais, via API, a cada `fetch-data`. **Assembleias**: composição eleita em 2022 (TSE, `consulta_cand_2022`, situação "eleito"), porque nenhuma assembleia tem API; trocas de partido posteriores não aparecem, e o app diz isso.
- **Posição por pauta**: voto nominal real quando o candidato tem mandato e votou numa votação mapeada em `temas.json`; senão, estimativa pela orientação pública do partido (`partidos.json`). Partido com `campo: null` (novo, sem orientação consolidada) entra com posição "dividido" e peso zero. Cada card mostra qual é qual.
- **Casamento candidato ↔ mandato**: CPF (TSE × API da Câmara) pra deputados; nome completo + UF pra senadores.
- **TSE fora do Brasil**: o CDN devolve 403/404. `fetch:tse` tenta o CDN e cai pro snapshot do Wayback Machine; se nenhum funcionar, coloque os ZIPs em `data/raw/tse/` e rode de novo.

## Revisar as estimativas por partido

```bash
npm run editor:partidos    # abre http://localhost:4400
```

Editor local (não vai pro ar): uma grade partido × pauta com a estimativa atual e, embaixo de cada célula, como a bancada votou de fato nas votações mapeadas e a orientação da liderança (API da Câmara). Clique na célula para alternar F → D → C; "Aplicar sugestões fortes" alinha tudo que tem ≥ 85% da bancada num lado; "Salvar + regerar datasets" grava `src/data/partidos.json` e reconstrói os 27 arquivos. A evidência é recalculada por `npm run evidencia` (`src/data/generated/evidencia-partidos.json`).

## Mapear uma votação nova

Em `src/data/temas.json`, adicione em `votacoes` da pauta:

```json
{"casa":"camara","id":"2233802-424","ladoSim":"F","rotulo":"PEC 221/2019 — 1º turno, 27/05/2026"}
{"casa":"senado","sigla":"PL","numero":2159,"ano":2021,"codigoSessaoVotacao":6935,"ladoSim":"F","rotulo":"…"}
```

`ladoSim` diz o que um voto SIM significa em relação à frase da pauta. Depois `npm run fetch-data && npm run build`.

## Deploy

Astro estático; Vercel detecta sozinho (`vercel --prod`). Ajustar `site` em `astro.config.mjs` quando houver domínio.
