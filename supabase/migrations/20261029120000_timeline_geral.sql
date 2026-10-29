-- Timeline geral: sem slugs, o feed devolve tudo (a home vira uma timeline de todos os políticos).
-- Com slugs, continua sendo o feed de quem a pessoa segue. Em item com muita gente (presença, votação),
-- "politicos" traz só quem foi pedido; na timeline geral traz no máximo 12, mais o total em "n_politicos".
drop function public.feed(text[], text[], timestamptz, int);

create function public.feed(p_slugs text[] default null, p_tipos text[] default null, p_antes timestamptz default null, p_limite int default 40)
returns table (
  id uuid, fonte_id text, fonte_nome text, natureza text, tipo text, titulo text, resumo text, resumo_ia boolean,
  url text, quando timestamptz, local text, agenda_natureza text, dados jsonb, politicos jsonb, n_politicos int
)
language sql
stable
security invoker
set search_path = ''
as $$
  with alvo as (select p.id, p.slug from public.politicos p where p_slugs is not null and p.slug = any(p_slugs[1:200]))
  select i.id, i.fonte_id, f.nome, f.natureza, i.tipo, i.titulo, i.resumo, i.resumo_ia, i.url, i.quando, i.local, i.agenda_natureza, i.dados,
    (select jsonb_agg(x) from (
       select jsonb_build_object('slug', p.slug, 'papel', ip.papel, 'metodo', ip.metodo, 'confianca', ip.confianca) x
       from public.item_politico ip join public.politicos p on p.id = ip.politico_id
       where ip.item_id = i.id and (p_slugs is null or p.slug = any(p_slugs[1:200]))
       order by (ip.papel = 'ausente') desc, p.slug
       limit case when p_slugs is null then 12 else 200 end) s) as politicos,
    (select count(*)::int from public.item_politico ip where ip.item_id = i.id) as n_politicos
  from public.itens i
  join public.fontes f on f.id = i.fonte_id
  where (p_slugs is null or exists (select 1 from public.item_politico ip join alvo a on a.id = ip.politico_id where ip.item_id = i.id))
    and (p_tipos is null or i.tipo = any(p_tipos))
    and (p_antes is null or i.quando < p_antes)
  order by i.quando desc
  limit least(greatest(coalesce(p_limite, 40), 1), 100);
$$;
grant execute on function public.feed(text[], text[], timestamptz, int) to anon, authenticated;
