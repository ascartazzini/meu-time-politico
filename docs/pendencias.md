# Pendências

O que o [plano](plano-pos-eleicao.md) prevê e ainda não está no ar, com o motivo e o que destrava.
Já entregue até 29/10/2026: timeline com filtros, conta com Google, seguir, quatro reações (amei, gostei, odiei, odiei muito), páginas dos eleitos com placar do mandato, agenda do presidente com pública × privada.
Atualizar quando algo entrar ou mudar de motivo.

## Precisa de você

| item | por que parou | o que destrava |
| --- | --- | --- |
| Coletores rodando sozinhos | o GitHub Actions precisa da chave secreta | `grep '^SUPABASE_SECRET_KEY=' .env \| cut -d= -f2- \| gh secret set SUPABASE_SECRET_KEY` |
| Login com Google | o provedor Google precisa ser ligado no Supabase com um cliente OAuth criado no Google Cloud (conta sua) | guia em [login-google.md](login-google.md); até lá o botão Entrar não funciona |
| Resumo diário por e-mail | precisa de conta num serviço de envio com plano gratuito (ex.: Resend, Brevo); criar conta é seu | escolher o serviço e criar a conta; o resto (modelo do e-mail, job diário, descadastro) a gente faz |

## Próximas na fila

| item | fase | por que ainda não | observação |
| --- | --- | --- | --- |
| Push no celular (PWA) | 3 | precisa de service worker, chaves VAPID, tabela de inscrições e um job que envia | dá pra fazer sem serviço pago; push no iPhone só funciona com o site instalado na tela inicial |
| Agenda de ministros (e-Agendas) | 2 | ministros não estão no cadastro (só eleitos) | entra quando o cadastro ganhar ministros |
| Diário Oficial (atos do presidente) | 2 | volume alto e pouco legível; precisa de filtro do que é ato relevante | prova da Fase 0 funciona |
| Emendas parlamentares | 2 | arquivo do Portal da Transparência passa por captcha na página; só o zip mensal abre | resumo mensal por parlamentar |
| Cota parlamentar (gastos) | 2 | o mês leva ~2 meses pra fechar nas duas casas | entra como resumo mensal com a data do dado |
| Agenda de parlamentares e governadores | 2–3 | a API da Câmara não liga evento convocado ao deputado (só a presença depois); o Senado não publica agenda por senador; governadores, ver abaixo | a leitura pública × privada hoje só tem a agenda do presidente |
| Governadores (agenda) | 3 | 27 sites diferentes; SP atrás de anti-robô, BA vazia; e até 6/1 os governadores no cargo não são os eleitos | começar por MG (JSON aberto) depois da posse |
| Redes: YouTube (RSS) | 3 | precisa do id do canal de cada eleito (cadastro de redes oficiais) | Instagram e X só com cuidado, e só de quem alguém segue |
| Placar do mandato: o que falta | 4 | se o projeto andou (tramitação), relatorias e presidências de comissão, emendas pagas e gasto de cota ainda não são coletados | o placar já mostra presença, votos, projetos, discursos, agenda e imprensa |
| Impacto do time titular | 4 | precisa da pessoa marcar as pautas dela e de votações do Congresso novo mapeadas em `temas.json` | o motor do quiz (coerência, gol contra) é a base |
| Notificação de resposta e de ação de quem sigo | 3 | entra junto com o push |
| Titular (em quem votei) | 4 | saiu da tela pra simplificar; volta quando o impacto do time titular existir |
| "Isso não é sobre ele" | 3 | botão no card pra apontar ligação errada; precisa de tabela e função pública de denúncia | hoje o caminho é abrir issue no GitHub |
| Assembleias estaduais | 5 | sem API na maioria; MG tem API completa, SP dados abertos pesados, BA bloqueia IP de fora | medir as outras 24 com o método da Fase 0 |
| Newsletter semanal | — | pedida em 29/10: principais notícias (grupos), votações pela frente, marcos, chamada pra cobrar | o envio depende do serviço de e-mail (acima) |
| Links externos do político + "insira aqui" | 1 | pedido em 29/10; fonte: redes declaradas ao TSE e páginas oficiais; o que faltar vira sugestão pro admin | |
| Página do político como landing page | 1 | pedido em 29/10: gráfica, títulos grandes, efeitos de rolagem, feita pra compartilhar | |
| Ligação de notícia por IA | 3 | hoje só por nome exato; perde apelidos e menções indiretas | só onde o nome não resolve, com teto de custo |
| Fotos de quem não é deputado federal | 1 | só a Câmara dá foto pelo id; TSE não tem URL estável de foto | 1.300 eleitos aparecem com iniciais |
