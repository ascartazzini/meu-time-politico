-- Feed do time: o app manda os ids que a pessoa segue e recebe os itens, mais recentes primeiro.
-- O time fica no aparelho (sem login), então a função não guarda nada: só lê o que já é público.

-- Uma data só pra ordenar: quando aconteceu; senão quando a fonte publicou; senão quando coletamos.
alter table public.itens add column quando timestamptz
  generated always as (coalesce(ocorreu_em, publicado_em, coletado_em)) stored;
create index on public.itens (quando desc);
create index on public.itens (tipo, quando desc);

-- p_antes pagina (o "carregar mais" passa o quando do último card); p_tipos filtra a leitura (presença = presenca + voto).
create function public.feed(p_politicos uuid[], p_tipos text[] default null, p_antes timestamptz default null, p_limite int default 40)
returns table (
  id uuid, fonte_id text, fonte_nome text, natureza text, tipo text, titulo text, resumo text, resumo_ia boolean,
  url text, quando timestamptz, local text, dados jsonb, politicos jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.fonte_id, f.nome, f.natureza, i.tipo, i.titulo, i.resumo, i.resumo_ia, i.url, i.quando, i.local, i.dados,
    (select jsonb_agg(jsonb_build_object('id', ip.politico_id, 'papel', ip.papel, 'metodo', ip.metodo))
       from public.item_politico ip where ip.item_id = i.id and ip.politico_id = any(p_politicos)) as politicos
  from public.itens i
  join public.fontes f on f.id = i.fonte_id
  where exists (select 1 from public.item_politico ip where ip.item_id = i.id and ip.politico_id = any(p_politicos))
    and (p_tipos is null or i.tipo = any(p_tipos))
    and (p_antes is null or i.quando < p_antes)
  order by i.quando desc
  limit least(greatest(coalesce(p_limite, 40), 1), 100);
$$;
grant execute on function public.feed(uuid[], text[], timestamptz, int) to anon, authenticated;

insert into public.fontes (id, nome, natureza, url) values
  ('camara-presenca', 'Câmara dos Deputados', 'oficial', 'https://dadosabertos.camara.leg.br'),
  ('camara-votacoes', 'Câmara dos Deputados', 'oficial', 'https://dadosabertos.camara.leg.br'),
  ('camara-proposicoes', 'Câmara dos Deputados', 'oficial', 'https://dadosabertos.camara.leg.br'),
  ('senado-votacoes', 'Senado Federal', 'oficial', 'https://legis.senado.leg.br/dadosabertos'),
  ('senado-discursos', 'Senado Federal', 'oficial', 'https://legis.senado.leg.br/dadosabertos'),
  ('g1', 'G1', 'imprensa', 'https://g1.globo.com/politica/'),
  ('folha', 'Folha de S.Paulo', 'imprensa', 'https://www1.folha.uol.com.br/poder/'),
  ('oglobo', 'O Globo', 'imprensa', 'https://oglobo.globo.com/politica/'),
  ('estadao', 'Estadão', 'imprensa', 'https://www.estadao.com.br/politica/'),
  ('poder360', 'Poder360', 'imprensa', 'https://www.poder360.com.br/'),
  ('agencia-brasil', 'Agência Brasil', 'imprensa', 'https://agenciabrasil.ebc.com.br/politica'),
  ('agencia-camara', 'Agência Câmara', 'imprensa', 'https://www.camara.leg.br/noticias'),
  ('agencia-senado', 'Agência Senado', 'imprensa', 'https://www12.senado.leg.br/noticias')
on conflict (id) do nothing;
