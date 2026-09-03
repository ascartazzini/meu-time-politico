# Meu Time Político 2026

Astro 7 estático + TypeScript + vitest + scripts tsx. Leia o README antes de mexer.

## Regras do projeto
- **Nunca** invente posição de candidato. Posição só vem de voto nominal (via `temas.json` → APIs) ou de estimativa partidária em `partidos.json`, sempre com o selo na UI.
- O app lê `public/dados/<UF>.json` (gerado no build, 27 arquivos) e `src/data/generated/indice.json`. Mudou dado de origem? `npm run build-data && npm run validate-data`.
- Cobertura nacional: nada pode ser específico de uma UF fora de `build-dataset.ts` (nomes de cargo/casa por UF) e `ufs.json`.
- `src/lib/motor.ts` é puro (sem DOM) e coberto por `tests/motor.test.ts`. Mudança de regra de cálculo = teste junto.
- Textos em pt-BR, tom direto, metáfora de futebol; sem promessa de precisão que o dado não sustenta.
- Os fetches são passo separado do build; `src/data/generated/*.json` é versionado.

## Comandos
```
npm run dev            # astro dev
npm run fetch-data     # Câmara + Senado + TSE
npm run build          # build-data → validate-data → astro build
npm test
```
Ao subir o servidor de desenvolvimento, use modo background: `astro dev --background` (gerencie com `astro dev stop|status|logs`).

## Documentação Astro
https://docs.astro.build — rotas, componentes, content collections, estilos.
