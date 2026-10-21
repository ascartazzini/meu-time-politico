# Meu Time Político 2026

Você vota seis vezes em 2026 — cinco cargos, com duas vagas de senador — e decide um de cada vez. Aqui você escala os seis como um time e descobre se eles jogam juntos — e se têm cadeira pra aprovar alguma coisa. Tech cívica, código aberto, sem vínculo com partido, campanha ou candidato. Cobre os 26 estados e o Distrito Federal.

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
src/data/cargos.json         5 cargos (senador com 2 vagas), casa, quórum, peso no placar
src/data/perfil.json         perguntas do eixo BOLSO
src/data/ufs.json            27 UFs e o nome de cada casa legislativa
src/data/generated/          camara.json, senado.json, tse-2026.json, assembleias.json, indice.json (versionados)
public/dados/<UF>.json       um dataset por UF, gerado no build (gitignored) — o app carrega só o do estado da pessoa

scripts/fetch-camara.ts      bancadas + 513 deputados (com CPF e nome civil) + votos nominais (API da Câmara)
scripts/fetch-senado.ts      senadores + bancadas + votos nominais (API do Senado)
scripts/fetch-tse.ts         consulta_cand_2026 → tse-2026.json · consulta_cand_2022 (eleitos) → assembleias.json
scripts/build-dataset.ts     casa candidato ↔ mandato (CPF na Câmara, nome no Senado), resolve votos, gera 27 datasets + índice
scripts/validate-dataset.ts  zod + invariantes em cada UF (soma de bancadas, quórum, ids, UF dos candidatos)
scripts/fetch-fontes.ts      baixa os woff2 do Google pra public/fontes/ e gera src/styles/fontes.css

src/lib/motor.ts             cálculo puro: camisa, bolso, coerência, gol contra, peso, força, veredito, leitura da força, sugestões na escalação e de troca
src/lib/dataset.ts           carrega /dados/<UF>.json e hidrata posições (voto real > estimativa do partido)
src/lib/estado.ts            persistência local + link compartilhável (#s=…, com a UF)
src/lib/stories.ts           imagem 1080×1920 pros stories (canvas, no navegador; Web Share ou download)
src/lib/wizard.ts            camada de DOM do app (escolha de UF → perfil → pautas → escalação → placar)
src/lib/analytics.ts         eventos do GA4 (no-op se o gtag não carregou)
src/lib/compartilhar.ts      botão de compartilhar: link com UTM por canal, Web Share API com fallback de copiar
src/lib/lista-espera.ts      inscrição na lista de espera do acompanhamento dos eleitos (Supabase, função pública entrar_lista_espera)
src/components/ListaEspera.astro  caixa "o jogo não acaba na urna", na home e no placar
supabase/migrations/         esquema do banco pós-eleição (projeto meu-time-politico, sa-east-1, plano gratuito); a lista de espera não é legível de fora
src/pages/index.astro        landing (como funciona) · app.astro (o app: capa + primeira pergunta na mesma tela) · metodo.astro · sobre.astro (redireciona pra /)
```

O build não bate em API nenhuma: os fetches são um passo separado e o resultado é versionado em `src/data/generated/`, então o deploy é reproduzível mesmo se a Câmara estiver fora do ar. O app pede `/dados/<UF>.json` só depois que a pessoa escolhe o estado.

## Dados: o que é real e o que é estimativa

- **Candidatos**: registro oficial do TSE (`consulta_cand_2026`), 5 cargos, 27 UFs + presidência. Em 2026 cada UF elege dois senadores, então o time tem seis escalados: `cargos.json` marca `vagas: 2` no senador e o estado do eleitor guarda uma lista de ids por cargo. Vices e suplentes ficam de fora; inaptos, renúncias, indeferidos e cassados são excluídos. Enquanto a Justiça Eleitoral julga os registros, a situação vem como "aguardando julgamento".
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

## Deploy e domínio

Endereço canônico: **https://www.meutimepolitico.com**. O site está no ar pelo **Deploya** (`deploya deploy` na raiz; app `meu-time-politico`, config em `.deploya.json`), com Dockerfile de dois estágios (build do Astro → nginx sem privilégio na porta 3000). `deploya domain status` mostra o domínio próprio e o certificado.

O certificado TLS é emitido pelo acme-companion do nginx-proxy a partir das variáveis do container, e o Deploya não repassou o domínio próprio pra elas sozinho. Por isso a app tem duas variáveis definidas com `deploya env set`, com os três nomes separados por vírgula: `VIRTUAL_HOST` e `LETSENCRYPT_HOST` = `meu-time-politico.labs.arturscartazzini.com,www.meutimepolitico.com,meutimepolitico.com`. Mudou de domínio? Atualize as duas e faça `deploya deploy` (um `restart` não recria o container e não basta).

O domínio aparece em quatro lugares, que precisam andar juntos:

| onde | o que |
| --- | --- |
| `astro.config.mjs` (`site`) | canonical, `og:url` e URLs do sitemap |
| `public/robots.txt` | linha `Sitemap:` |
| `public/llms.txt` | descrição do site pra assistentes de IA, com links absolutos |
| `nginx.conf` | apex `meutimepolitico.com` e o subdomínio antigo `meu-time-politico.labs.arturscartazzini.com` respondem 301 pro `www` |

O link de placar compartilhado (`/app/#s=…`) e a URL impressa na imagem dos stories usam `location.origin`, então seguem o host que serviu a página sem configuração.

### SEO, compartilhamento e analytics

`src/layouts/Base.astro` gera título, descrição, canonical, Open Graph, Twitter card, JSON-LD (`WebSite`, `WebApplication`, `Person`, `WebPage`) e a tag do Google Analytics 4 (`G-EQMVHHWH9C`, só no domínio de produção — ver abaixo). O sitemap sai do `@astrojs/sitemap` em `/sitemap-index.xml` (sem `/sobre/`, que é só redirecionamento com `noindex`).

A imagem de compartilhamento `public/og.png` (1200×630) e o `public/apple-touch-icon.png` são renderizados a partir de `scripts/og/*.html` com o Chrome headless:

```
sh scripts/og/render.sh
```

Os PNGs ficam versionados; rode o script só quando mudar o desenho.

### Fontes (servidas do nosso domínio)

Anton, Barlow e Chivo Mono ficam em `public/fontes/` (woff2, subsets `latin` e `latin-ext`), com as
regras em `src/styles/fontes.css`. Pelo CSS do Google elas seguravam a primeira pintura por ~1,4s no
4G, com dois handshakes externos. Os arquivos e o CSS são gerados — e versionados — por:

```
npm run fetch:fontes
```

Rode só quando a lista de famílias/pesos mudar. `Base.astro` faz `preload` das quatro faces que
aparecem na primeira dobra (Anton 400, Barlow 400 e 700, Chivo Mono 400); as outras entram com `swap`.

`src/styles/fontes-fallback.css` é escrito à mão e **não** é regenerado: são faces `Barlow medidas`
que desenham Arial local esticada até a largura e a altura de linha da Barlow. Sem elas, a troca de
fonte mudava o número de linhas do parágrafo da capa e empurrava o resto da página (CLS 0,26). Os
números saem de `canvas.measureText` comparando cada peso da Barlow com Arial regular; se algum dia
trocar a fonte do corpo, refaça a medida — os valores atuais são só pra Barlow.

### Analytics: eventos e tráfego interno

**O GA4 só existe em `www.meutimepolitico.com`.** O measurement ID é fixo no código, então `npm run
dev`, `astro preview`, acesso por IP e qualquer outro host mandariam hits pra propriedade real — foi
o que sujou os relatórios em 07/09/2026. `HOSTS_ANALYTICS`, em `Base.astro`, é a lista de hosts onde
a tag é injetada; fora dela nada é baixado, `window.gtag` não existe e todo `evento(...)` vira no-op.
Apex e o subdomínio antigo caem em 301 pro www (`nginx.conf`), então só o www renderiza página — se
esse redirect quebrar, a medição para junto (falha fechada, de propósito). Pra depurar em produção,
`?internal=1` + DebugView.

Eventos enviados pelo app (`src/lib/analytics.ts`; sem gtag na página, viram no-op):

| evento | onde | parâmetros |
| --- | --- | --- |
| `cta_app_click` | home | `local` = `hero` \| `fecho` |
| `app_open` | /app/ | `origem` = `novo` \| `retomada` \| `link_compartilhado` |
| `share_click` | home e placar | `channel` = `whatsapp` \| `instagram` \| `linkedin`, `local` = `home` \| `placar` |
| `placar_pronto` | /app/ | `uf`, `forca`, `coerencia`, `peso`, `gols_contra`, `veredito` |

`placar_pronto` é o fim do funil — respondeu as 14 pautas, escalou os seis, viu o placar. Sobe **uma
vez por visita**: trocas de teste recalculam o placar sem reenviar o evento. **No GA4, marque
`placar_pronto` como evento-chave** (Admin → Eventos), senão ele não vira conversão nos relatórios.

Os botões de compartilhar (`src/lib/compartilhar.ts`) geram um link por canal, com
`utm_source=<canal>&utm_medium=share&utm_campaign=lancamento`. Um link só, sem UTM, chega no GA4 como
Direct — que era o caso de 117 das 136 sessões da primeira semana. No placar o UTM entra antes do
`#s=`, então o link continua abrindo a escalação de quem compartilhou. Usa Web Share API onde existe
(celular) e cai pra copiar o link no computador.

**Tráfego interno sem depender de IP:** abrir `/?internal=1` uma vez grava `mtp_internal=1` no
`localStorage` deste navegador; `/?internal=0` desfaz. O parâmetro sai da barra de endereço (via
`history.replaceState`) antes do `gtag('config', …)`, então o pageview sobe com a URL limpa, com
`traffic_type: 'internal'` e sem atrapalhar UTMs que estejam na mesma URL. Funciona em qualquer
página. **Falta o passo do outro lado: no GA4, criar o filtro de dados** (Admin → Coleta e
modificação de dados → Filtros de dados) do tipo "tráfego interno" com `traffic_type` igual a
`internal`. Sem esse filtro o parâmetro chega e não filtra nada.
