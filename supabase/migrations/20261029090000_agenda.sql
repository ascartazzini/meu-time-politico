-- Agenda oficial no feed: fonte do Planalto e a natureza do compromisso (pública, privada, partidária, pessoal)
-- devolvida pela função feed, pra leitura "agenda pública × privada".
insert into public.fontes (id, nome, natureza, url) values
  ('planalto-agenda', 'Planalto — agenda do presidente', 'oficial', 'https://www.gov.br/planalto/pt-br/acompanhe-o-planalto')
on conflict (id) do nothing;

drop function public.feed(text[], text[], timestamptz, int);

create function public.feed(p_slugs text[], p_tipos text[] default null, p_antes timestamptz default null, p_limite int default 40)
returns table (
  id uuid, fonte_id text, fonte_nome text, natureza text, tipo text, titulo text, resumo text, resumo_ia boolean,
  url text, quando timestamptz, local text, agenda_natureza text, dados jsonb, politicos jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with alvo as (select p.id, p.slug from public.politicos p where p.slug = any(p_slugs[1:200]))
  select i.id, i.fonte_id, f.nome, f.natureza, i.tipo, i.titulo, i.resumo, i.resumo_ia, i.url, i.quando, i.local, i.agenda_natureza, i.dados,
    (select jsonb_agg(jsonb_build_object('slug', a.slug, 'papel', ip.papel, 'metodo', ip.metodo, 'confianca', ip.confianca))
       from public.item_politico ip join alvo a on a.id = ip.politico_id where ip.item_id = i.id) as politicos
  from public.itens i
  join public.fontes f on f.id = i.fonte_id
  where exists (select 1 from public.item_politico ip join alvo a on a.id = ip.politico_id where ip.item_id = i.id)
    and (p_tipos is null or i.tipo = any(p_tipos))
    and (p_antes is null or i.quando < p_antes)
  order by i.quando desc
  limit least(greatest(coalesce(p_limite, 40), 1), 100);
$$;
grant execute on function public.feed(text[], text[], timestamptz, int) to anon, authenticated;
