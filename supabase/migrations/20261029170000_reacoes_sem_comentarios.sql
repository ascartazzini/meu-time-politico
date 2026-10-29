-- Sem comentários: só reações, agora quatro (amei, gostei, odiei, odiei muito). Uma por pessoa por item.
-- Comentários e denúncias saem (ninguém tinha comentado ainda).
drop function public.comentar(uuid, text);
drop function public.comentarios_do_item(uuid);
drop function public.apagar_comentario(uuid);
drop function public.denunciar(uuid);
drop function public.tem_palavrao(text);
drop table public.denuncias;
drop table public.comentarios;

alter table public.reacoes drop constraint reacoes_tipo_check;
alter table public.reacoes add constraint reacoes_tipo_check check (tipo in ('amei', 'gostei', 'odiei', 'odiei_muito'));

create or replace function public.reagir(p_item uuid, p_tipo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'entre pra reagir' using errcode = '42501'; end if;
  if not public.pode_interagir(p_item) then raise exception 'siga alguém desta ação pra reagir' using errcode = '42501'; end if;
  if p_tipo is null then
    delete from public.reacoes where item_id = p_item and user_id = auth.uid();
  elsif p_tipo in ('amei', 'gostei', 'odiei', 'odiei_muito') then
    insert into public.reacoes (item_id, user_id, tipo) values (p_item, auth.uid(), p_tipo)
    on conflict (item_id, user_id) do update set tipo = excluded.tipo, criado_em = now();
  else
    raise exception 'reação inválida' using errcode = '22023';
  end if;
end;
$$;

drop function public.interacoes(uuid[]);
create function public.interacoes(p_itens uuid[])
returns table (item_id uuid, amei int, gostei int, odiei int, odiei_muito int, minha text, pode boolean)
language sql stable security definer set search_path = '' as $$
  select i.id,
    count(r.*) filter (where r.tipo = 'amei')::int,
    count(r.*) filter (where r.tipo = 'gostei')::int,
    count(r.*) filter (where r.tipo = 'odiei')::int,
    count(r.*) filter (where r.tipo = 'odiei_muito')::int,
    max(r.tipo) filter (where r.user_id = auth.uid()),
    public.pode_interagir(i.id)
  from public.itens i
  left join public.reacoes r on r.item_id = i.id
  where i.id = any(p_itens[1:100])
  group by i.id;
$$;
revoke all on function public.interacoes(uuid[]) from public;
grant execute on function public.interacoes(uuid[]) to anon, authenticated;
