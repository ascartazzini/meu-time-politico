-- O site é estático e conhece o político pelo slug (o mesmo da URL /politico/<slug>/), não pelo uuid do banco.
-- O feed passa a receber slugs e devolve o slug de cada político ligado ao card.
drop function public.feed(uuid[], text[], timestamptz, int);

create function public.feed(p_slugs text[], p_tipos text[] default null, p_antes timestamptz default null, p_limite int default 40)
returns table (
  id uuid, fonte_id text, fonte_nome text, natureza text, tipo text, titulo text, resumo text, resumo_ia boolean,
  url text, quando timestamptz, local text, dados jsonb, politicos jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with alvo as (select p.id, p.slug from public.politicos p where p.slug = any(p_slugs[1:200]))
  select i.id, i.fonte_id, f.nome, f.natureza, i.tipo, i.titulo, i.resumo, i.resumo_ia, i.url, i.quando, i.local, i.dados,
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
