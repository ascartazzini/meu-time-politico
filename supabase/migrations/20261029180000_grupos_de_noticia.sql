-- A mesma notícia em vários veículos vira um card: o coletor marca `grupo` (chave da notícia mais antiga,
-- regra em scripts/coletores/agrupar.ts) e o feed devolve só a mais antiga de cada grupo, com as outras em
-- `outras_fontes`. Reação fica na notícia que representa o grupo, que não muda quando outra fonte entra.
alter table public.itens add column grupo text;
create index on public.itens (grupo) where grupo is not null;

drop function public.feed(text[], text[], timestamptz, int, text[]);

create function public.feed(p_slugs text[] default null, p_tipos text[] default null, p_antes timestamptz default null,
  p_limite int default 40, p_fontes text[] default null)
returns table (
  id uuid, fonte_id text, fonte_nome text, natureza text, tipo text, titulo text, resumo text, resumo_ia boolean,
  url text, quando timestamptz, local text, agenda_natureza text, dados jsonb, politicos jsonb, n_politicos int, outras_fontes jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with alvo as (select p.id, p.slug from public.politicos p where p_slugs is not null and p.slug = any(p_slugs[1:300]))
  select i.id, i.fonte_id, f.nome, f.natureza, i.tipo, i.titulo, i.resumo, i.resumo_ia, i.url, i.quando, i.local, i.agenda_natureza, i.dados,
    (select jsonb_agg(x) from (
       select jsonb_build_object('slug', p.slug, 'papel', ip.papel, 'metodo', ip.metodo, 'confianca', ip.confianca) x
       from public.item_politico ip join public.politicos p on p.id = ip.politico_id
       where ip.item_id = i.id and (p_slugs is null or p.slug = any(p_slugs[1:300]))
       order by (ip.papel in ('ausente', 'NCom', 'LP')) desc, p.slug
       limit case when p_slugs is null then 12 else 300 end) s) as politicos,
    (select count(*)::int from public.item_politico ip where ip.item_id = i.id) as n_politicos,
    (select jsonb_agg(jsonb_build_object('fonte', fo.nome, 'url', o.url, 'titulo', o.titulo) order by o.quando)
       from public.itens o join public.fontes fo on fo.id = o.fonte_id
       where i.grupo is not null and o.grupo = i.grupo and o.id <> i.id) as outras_fontes
  from public.itens i
  join public.fontes f on f.id = i.fonte_id
  where (i.grupo is null or i.grupo = i.chave)
    and (p_slugs is null or exists (
      select 1 from public.itens m join public.item_politico ip on ip.item_id = m.id join alvo a on a.id = ip.politico_id
      where m.id = i.id or (i.grupo is not null and m.grupo = i.grupo)))
    and (p_tipos is null or i.tipo = any(p_tipos))
    and (p_fontes is null or i.fonte_id = any(p_fontes) or exists (
      select 1 from public.itens m where i.grupo is not null and m.grupo = i.grupo and m.fonte_id = any(p_fontes)))
    and (p_antes is null or i.quando < p_antes)
  order by i.quando desc
  limit least(greatest(coalesce(p_limite, 40), 1), 100);
$$;
grant execute on function public.feed(text[], text[], timestamptz, int, text[]) to anon, authenticated;
