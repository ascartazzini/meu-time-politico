# Fase 0 — o que a prova das fontes mostrou

Rodada de 16/10/2026: 57 provas, todas sem login, sem chave e sem serviço pago, a partir de um IP fora do Brasil. A tabela completa está em [fontes.md](fontes.md) e as medidas brutas em `resultados.json`. Para refazer: `npm run prova` (ou `npm run prova -- camara` pra um grupo só).

**Cuidado com os números:** foi semana de eleição, com Congresso e assembleias quase parados. Os volumes estão abaixo do normal. Refazer depois do 2º turno e de novo em fevereiro, com a legislatura nova.

**Custo:** todas as fontes que entram custam zero. O orçamento de €10 fica todo pra IA, e a IA quase não é necessária (ver o fim).

## O que entra no feed

| frente | entra | fica de fora |
| --- | --- | --- |
| **Câmara** | agenda, **presença por sessão e comissão com id do deputado**, votos nominais, proposições, discursos, órgãos, cota (arquivo anual) | despesas pela API (vem vazia na legislatura atual) |
| **Senado** | agenda de plenário e comissões, votos nominais, matérias com autor, cota (CEAPS) | **presença: não existe API**. Só dá pra deduzir em dia de votação nominal. Discursos chegam com ~3 semanas de atraso |
| **Executivo federal** | agenda do presidente (HTML), agenda de ministros no e-Agendas (raspagem, sem login), atos no Diário Oficial | emendas parlamentares só como resumo mensal (arquivo sai com ~6 dias de atraso, pagamentos por mês) |
| **Imprensa** | G1, Folha, O Globo, Estadão, Poder360, Agência Brasil, Agência Câmara, Agência Senado | Metrópoles (feed de política abandonado, o geral é metade coluna), Google News (os termos do feed só permitem uso pessoal), GDELT (não respondeu) |
| **Imprensa com cuidado** | UOL, CNN e BBC só têm feed geral: filtrar por seção na URL | — |
| **Redes abertas** | YouTube (RSS do canal, sem chave) | Bluesky e Telegram funcionam, mas quase nenhum político usa |
| **Redes fechadas** | Instagram (embed público do perfil) e X (HTML público do perfil), em ritmo baixo e com aviso de que podem cair a qualquer dia | Facebook e Threads (sem login só vem o cabeçalho), TikTok (embed instável) |
| **Estados** | MG: API completa da assembleia (com presença) + agenda do governador. SP: dados abertos da ALESP (pesados) | BA: a assembleia bloqueia IP de fora do Brasil (**refazer de IP brasileiro**), agenda do governador vazia. SP: agenda do governador atrás de muro anti-robô |

## O que muda no plano

1. **Presença é desigual entre as casas.** Na Câmara, "estava onde precisava estar" é dado. No Senado, só dá pra dizer em dia de votação nominal. A ordem "presença" precisa dizer isso no card de senador, não esconder.
2. **Cota parlamentar não é notícia do dia.** Um mês de gasto leva uns dois meses pra completar nas duas casas. Entra como resumo mensal, com a data do dado visível.
3. **Imprensa não traz id do político.** A ligação é por nome contra a nossa base de 1.680 políticos. Nos grandes veículos, de 65% a 91% dos itens citam alguém da lista. Os feeds cobrem só 1 a 2 dias, então a coleta precisa rodar de hora em hora. Filtrar `/colunas/`, `/blogs/` e `/opiniao/` pela URL é obrigatório pra cumprir a regra de não ter bastidor.
4. **Instagram e X não aguentam 1.680 perfis.** O que funcionou foi 1 chamada por perfil, de vez em quando. Em escala, a chance de bloqueio é alta, e os dois vão contra os termos das redes. Proposta: coletar só os políticos que alguém segue de fato, no máximo 1 vez por dia cada, e o app avisar quando a fonte cair.
5. **Estado a estado vai ser desigual de verdade.** MG está pronto pra usar. SP dá trabalho, porque os arquivos são pesados. BA depende de rodar do Brasil. Antes de prometer as 27 UFs, a Fase 5 começa medindo as outras 24 assembleias com o mesmo método.
6. **IP brasileiro.** Daqui de fora, só a assembleia da Bahia bloqueou claramente. O gov.br limita por volume, devolvendo uma página de aviso com HTTP 200 (a prova já detecta). Os coletores podem nascer no GitHub Actions; quem bloquear vai pra uma máquina no Brasil.
7. **IA quase não é necessária.** Congresso, assembleia de MG e cota vêm com id oficial. Agenda e Diário Oficial ligam pelo cargo ou pelo nome exato. A IA fica pra desambiguar nome em notícia e post, na ordem de dezenas de itens por dia. Cabe com folga nos €10.

## Achados técnicos (já corrigidos no `base.ts` e no `util.ts`)

- O "í" de "cívica" no user-agent fazia a Meta devolver 400 e o X e o Poder360 devolverem 403. O UA agora é só ASCII.
- Folha e UOL servem ISO-8859-1: `pegar()` agora respeita o charset declarado.
- O gov.br disfarça o bloqueio por volume como HTTP 200: `pegar()` reconhece a página de aviso.
- `atraso()` estourava a pilha com 100 mil datas, e o runner ficava 3 minutos parado depois de acabar.
