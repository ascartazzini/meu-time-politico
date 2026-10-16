# Meu Time Político — depois da eleição

Plano de reconstrução, escrito em 16/10/2026 (entre o 1º e o 2º turno).

## A virada

Hoje o site responde a uma pergunta de outubro: *em quem eu escalo?* O produto novo responde a uma pergunta dos próximos quatro anos: **o que o meu time está fazendo hoje?**

A pessoa monta o time com os eleitos, pode seguir mais de um por cargo e marca os **titulares** (normalmente em quem votou). A partir daí recebe, todo dia, tudo o que esses políticos fizeram, disseram, publicaram ou tiveram publicado sobre eles, com a fonte de cada item.

Cinco formas de ler o mesmo feed:

| ordem | pergunta que responde | de onde vem |
| --- | --- | --- |
| **Cronológica** | o que aconteceu, na ordem | todas as fontes |
| **Presença** | estava onde precisava estar? | pauta de plenário e comissões × presença registrada × agenda oficial |
| **Agenda pública × privada** | com quem se reuniu, e a pedido de quem? | agendas oficiais, classificadas (órgão público, setor privado, partido, evento pessoal) |
| **Impacto do mandato** | o que mudou por causa dele? | votos decisivos, proposições que andaram, relatorias, emendas pagas, gasto de cota |
| **Impacto do time titular** | meu time joga junto e a meu favor? | votos do time nas pautas que a pessoa marcou como importantes |

## O que muda de regra (e o que fica)

Fica, e vale ainda mais num feed:

- **Nada sem fonte.** Todo item tem link para a origem. Resumo feito por IA leva selo de IA e nunca substitui o link.
- **Selo de natureza em todo card**: `oficial` (registro do governo/casa), `imprensa` (fato noticiado por grande veículo), `rede` (o próprio político disse). O selo é a versão nova do "voto real × estimativa".
- **Cobertura nacional**, mas com honestidade: quando uma UF não tem fonte, o app diz "sem fonte pra isso aqui", não finge vazio.

Muda:

- O site deixa de ser estático. Feed diário pede banco, ingestão contínua e contas.
- **Sem coluna de bastidor.** "Fofoca" só entra quando um grande veículo noticiou como fato, e entra como `imprensa`, com link. Nota de coluna, "segundo interlocutores" e especulação ficam de fora. A gente não produz bastidor próprio e não publica vida privada de familiares. Isso é proteção jurídica (difamação, LGPD) e de credibilidade.
- **Nenhum serviço pago.** Tudo o que não tem API aberta é coleta própria (scraping) ou fica de fora. O teto de custo é **€10/mês** (ver "Orçamento").

## Universo de políticos

| cargo | quantos em exercício a partir de 2027 | fonte de mandato |
| --- | --- | --- |
| Presidente (+ vice) | 1 (+1) | Planalto, e-Agendas, DOU |
| Governador | 27 | 27 sites diferentes, sem API |
| Senador | 81 (54 eleitos agora + 27 de 2022) | API do Senado |
| Deputado federal | 513 | API da Câmara |
| Deputado estadual / distrital | 1.059 | 27 assembleias, quase nenhuma com API |

~1.680 pessoas. Ministros e secretários ficam pra depois.

Datas que mandam no cronograma: 2º turno em **25/10/2026**, diplomação até meados de dezembro, posse do presidente em **5/1/2027** e dos governadores em **6/1/2027**, Câmara, Senado e assembleias em **1/2/2027**. Novatos só ganham id na API da Câmara depois da posse.

## O que dá pra reaproveitar

| peça | destino |
| --- | --- |
| Domínio, deploy, marca, fontes, `tokens.css`, metáfora de futebol | ficam |
| `fetch-camara.ts`, `fetch-senado.ts` | viram base dos coletores de mandato (ampliar pra eventos, discursos, presença, proposições, despesas) |
| `fetch-tse.ts` e o casamento por CPF/nome (`build-dataset.ts`, `nomes.ts`) | carga dos eleitos e ligação TSE ↔ Câmara/Senado |
| `temas.json` + votações mapeadas + `partidos.json` | pautas da pessoa → alertas de "votou contra o que você marcou" |
| Partes do `motor.ts` (coerência, gol contra, força da bancada) | "impacto do time titular" |
| `stories.ts`, `compartilhar.ts`, `analytics.ts` | "a rodada da semana do meu time" pra compartilhar |
| `wizard.ts`, `app.astro`, datasets estáticos por UF | saem |

## Arquitetura proposta

```
Coletores (cron, um por fonte, idempotentes)
   Câmara · Senado · e-Agendas · DOU · Portal da Transparência
   RSS de veículos · YouTube · Bluesky · sites oficiais · assembleias (scraping, UF a UF)
        │  item bruto + url + data + fonte
        ▼
Enriquecimento
   dedupe (hash de url + agrupamento: a mesma notícia em 12 veículos vira 1 card com 12 fontes)
   ligação item → político (ids oficiais primeiro; nome + contexto via LLM só quando não há id)
   classificação: tipo, pauta (temas.json), público × privado, local
   resumo neutro de uma linha (selo IA)
        ▼
Postgres
   politicos · ids_externos · mandatos · itens · item_politico · presencas · votos
   usuarios · times (seguindo, cargo, titular) · pautas_do_usuario · notificacoes
        ▼
Web (Astro híbrido)
   perfis de político estáticos e reconstruídos a cada coleta (1.680 páginas boas pra busca)
   feed e time dinâmicos, com login por link mágico
   PWA com push · resumo diário por e-mail
```

Decidido: **Supabase** (Postgres + auth), **coletores separados do site** e **Astro híbrido no Deploya**.

## Orçamento: €10/mês

O custo cresce com o número de políticos e de fontes, não de usuários. Cabe em €10 se cada peça ficar no plano gratuito e o único gasto variável for IA, com teto.

| peça | onde | custo |
| --- | --- | --- |
| Site | Deploya (servidor que já existe) | 0 |
| Banco + login | Supabase gratuito (500 MB de banco, projeto pausa após 7 dias sem uso, que a coleta diária evita) | 0 |
| Coletores | GitHub Actions (repositório público: minutos grátis) | 0 |
| Notificação | push do navegador (PWA, VAPID) | 0 |
| E-mail | plano gratuito de um serviço de envio (na ordem de 100 a 300 por dia) | 0 |
| IA (ligar notícia ao político, classificar, resumir) | modelo pequeno, em lote, só onde regra e id oficial não resolvem | **até ~€8, com teto que desliga a IA quando estoura** |
| Folga | domínio, imprevisto | ~€2 |

Consequências pro produto:

- **Push é o canal principal**, e-mail é o resumo diário enquanto couber no plano gratuito. WhatsApp sai do plano.
- **Banco enxuto**: guarda título, link, data, resumo e ligações; não guarda o HTML da matéria. Item antigo de imprensa vira só link depois de um tempo.
- **IA é exceção, não regra**: voto, presença e agenda oficial já vêm com id do político e não passam por IA. A IA entra pra notícia e post sem id, com cache e processamento em lote.
- **A confirmar na Fase 0**: cotas do Supabase gratuito, quantos e-mails por dia o plano gratuito escolhido dá, e quanto custa por item o modelo escolhido.
- **IP brasileiro**: GitHub Actions roda fora do Brasil, e algumas fontes (o TSE já bloqueia) recusam IP estrangeiro. Se um site de governo ou assembleia bloquear, esse coletor precisa rodar de uma máquina no Brasil, ou a fonte fica de fora.

## Fases

### Fase 0 — até o 2º turno (16/10 → 25/10)

O site atual fica no ar e intocado até a eleição acabar. Em paralelo:

> Primeira rodada feita em 16/10/2026: resultado e o que muda no plano em [fase0/README.md](fase0/README.md). Refazer depois do 2º turno, quando o Congresso voltar a funcionar.


- **Prova de cada fonte**: pra cada uma, um script que puxa uma semana real e mede volume, atraso, formato e termos de uso. Resultado: tabela "fonte × confiável × custo × risco". Inclui Câmara (eventos, discursos, presença, despesas), Senado (agenda, pronunciamentos, votações), e-Agendas, agenda do Planalto, DOU, Portal da Transparência (emendas), RSS dos grandes veículos, YouTube, Bluesky, Telegram, 3 assembleias de teste (SP, MG, BA) e, pra cada rede fechada (Instagram, X, Facebook, Threads, TikTok), o que a página pública de um político mostra sem login. Cada prova roda também a partir do GitHub Actions, pra ver quem bloqueia IP estrangeiro.
- **Custo medido**: quanto a IA gasta por item numa semana real, pra calibrar o teto dos €10.
- **Lista de espera** no site atual: "quando os eleitos assumirem, a gente te conta o que eles fazem" (e-mail).

### Fase 1 — Monte o time dos eleitos (26/10 → meados de novembro)

Entrega: a pessoa entra, escolhe a UF, segue os eleitos (vários por cargo) e marca titulares.

- Cadastro canônico de político: eleitos de 2026 (TSE) + senadores de 2022 em mandato + deputados estaduais, com ids externos e redes oficiais declaradas.
- Página pública de cada político (foto, partido, cargo, mandatos anteriores, votos já mapeados, links oficiais).
- Time salvo no aparelho, sem login; e-mail opcional pra receber o resumo quando o feed abrir.
- Onboarding curto reaproveitando o quiz de pautas: "o que importa pra você" vira o filtro do impacto lá na fase 4.

### Fase 2 — Feed oficial (meados de novembro → dezembro)

Entrega: o feed diário com tudo o que é registro oficial e estruturado. Até a posse ele vale pros reeleitos, pros senadores em exercício e pra transição de governo.

- Câmara e Senado: votos, discursos, proposições, eventos e comissões, presença, despesas de cota.
- Executivo federal: agenda do presidente e e-Agendas, atos no DOU.
- Emendas parlamentares (Portal da Transparência).
- Ordens **cronológica** e **presença** ("tinha sessão deliberativa e não estava").
- Contas com link mágico; resumo diário por e-mail.

### Fase 3 — Imprensa e redes (dezembro → posse em janeiro)

Entrega: o feed pronto pra posse do presidente e dos governadores.

- Grandes veículos via RSS público, com agrupamento de notícias iguais e ligação ao político. Só fato noticiado; colunas de bastidor ficam fora da lista de feeds.
- Redes, por ordem de facilidade:
  1. **Abertas, sem custo**: YouTube (API gratuita com cota), Bluesky (API aberta), canais públicos do Telegram (a prévia `t.me/s/<canal>` abre sem login), sites e blogs oficiais.
  2. **Fechadas, por scraping de página pública**: Instagram, X, Facebook, Threads e TikTok. Só o que abre sem login, sem conta falsa e sem contornar bloqueio. Nessas redes isso hoje é pouco ou nada: a maior parte exige login e bloqueia coleta. Cada uma passa pela prova da Fase 0; a que não abrir sem login fica de fora e o app diz "post de Instagram só aparece quando a imprensa noticia".
- Push no celular (PWA) e configuração de quanto a pessoa quer ser avisada.
- Governadores: agenda oficial dos 27, coletada estado a estado, começando pelos mais populosos.

### Fase 4 — Impacto (fevereiro → abril de 2027, com o Congresso novo)

Entrega: as leituras que ninguém mais faz.

- **Impacto do mandato**: pontuação em partes visíveis (votos em votações decisivas, proposições que andaram, relatorias e presidências, emendas pagas, presença, gasto), nunca um número mágico sem explicação. Regra de cálculo em módulo puro com teste, como o `motor.ts` hoje.
- **Público × privado** nas agendas, com o critério aberto em `/metodo`.
- **Impacto do time titular**: placar do mês, "seu time votou junto?", "gol contra" quando um titular vota contra pauta que a pessoa marcou. Comparação titular × reservas.
- **A rodada da semana**: imagem pros stories com o resumo do time.

### Fase 5 — Estados e hábito (a partir do 2º trimestre de 2027)

- Assembleias UF a UF (presença, votações, proposições), na ordem da população, com o estado de cobertura de cada UF visível no app.
- Alertas por tema ("tudo sobre reforma tributária do meu time").
- De olho em 2030: o mesmo time vira o ponto de partida do "renovo ou troco?" da próxima eleição, e o quiz atual volta com quatro anos de dado real.

## Riscos

| risco | o que fazer |
| --- | --- |
| Redes fechadas (Meta, X, TikTok) exigem login e bloqueiam coleta; scraping vai contra os termos de uso delas | só página pública sem login, sem conta falsa, sem contornar bloqueio, em ritmo baixo; se quebrar ou for bloqueado, a fonte sai e o app avisa |
| IA estourar os €10 | teto mensal no código que desliga a IA e deixa o item sem resumo; id oficial e regra antes de IA |
| Fonte que recusa IP estrangeiro | coletor dessa fonte roda de máquina no Brasil, ou a fonte fica fora |
| Assembleias e governos estaduais sem API, cada site de um jeito, quebrando sem aviso | coletor por UF com alarme de quebra; cobertura por UF exposta no app |
| Ligar notícia ao político errado (homônimos, apelidos) | id oficial primeiro; LLM só com contexto e limiar de confiança; botão "isso não é sobre ele" |
| Difamação ou dado pessoal sensível | sem coluna de bastidor; só fato noticiado por grande veículo, com link; sem vida privada de terceiros; canal de remoção |
| Direito autoral dos veículos | título + link + resumo próprio curto; nunca o texto da matéria |
| Custo de LLM e coleta crescendo com o número de políticos, não de usuários | classificar por lote, cachear, coletar sobre os 1.680 independentemente de quantos seguem |
| Excesso de notificação matar o hábito | resumo diário como padrão; alerta imediato só pra voto e presença dos titulares |

## Decisões tomadas (16/10/2026)

1. **Nenhum serviço pago.** Redes sem API aberta entram por scraping de página pública, quando der; senão ficam de fora.
2. **Sem coluna de bastidor.** Só entra fato noticiado por grande veículo.
3. **Stack**: Supabase + coletores separados + Astro híbrido no Deploya.
4. **Orçamento**: €10/mês no total.
