-- Contas (login com Google pelo Supabase Auth): quem segue quem, like/odiei, comentários e denúncias.
-- Regra do produto: reagir e comentar numa ação só quem segue ao menos um político ligado a ela.
-- As tabelas não têm política de RLS: ninguém lê nem escreve direto. Tudo passa pelas funções abaixo,
-- que conferem login, essa regra, palavrão e ritmo. Quem reagiu nunca é exposto; comentário mostra
-- só o primeiro nome e a inicial do sobrenome. Com 3 denúncias o comentário some até revisão manual.

create table public.seguindo (
  user_id uuid not null references auth.users(id) on delete cascade,
  politico_id uuid not null references public.politicos(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (user_id, politico_id)
);
create index on public.seguindo (politico_id);

create table public.reacoes (
  item_id uuid not null references public.itens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('gostei', 'odiei')),
  criado_em timestamptz not null default now(),
  primary key (item_id, user_id)
);

create table public.comentarios (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.itens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  autor text not null,                          -- "Artur S.", congelado no momento do comentário
  texto text not null check (char_length(texto) between 1 and 500),
  criado_em timestamptz not null default now(),
  oculto boolean not null default false         -- 3 denúncias escondem; revisão é manual (desmarcar aqui)
);
create index on public.comentarios (item_id, criado_em);
create index on public.comentarios (user_id, criado_em desc);

create table public.denuncias (
  comentario_id uuid not null references public.comentarios(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (comentario_id, user_id)
);

alter table public.seguindo enable row level security;
alter table public.reacoes enable row level security;
alter table public.comentarios enable row level security;
alter table public.denuncias enable row level security;

-- ---------- regras ----------

create function public.pode_interagir(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.item_politico ip
    join public.seguindo s on s.politico_id = ip.politico_id and s.user_id = auth.uid()
    where ip.item_id = p_item);
$$;

create function public.tem_palavrao(p_texto text) returns boolean
language sql immutable set search_path = '' as $$
  select lower(p_texto) ~ '\m(porra|caralh\w*|buceta|arrombad\w*|fdp|vsf|vtnc|tnc|puta|putas|puto|putos|filh[oa] da puta|viad[oa]\w*|cuz[aã]o|merda|vagabund[oa]\w*|lixo humano|macac[oa] imund\w*)\M';
$$;

-- ---------- seguir ----------

create function public.meus_seguidos() returns setof text
language sql stable security definer set search_path = '' as $$
  select p.slug from public.seguindo s join public.politicos p on p.id = s.politico_id where s.user_id = auth.uid() order by s.criado_em;
$$;

create function public.seguir(p_slugs text[], p_ligado boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'entre pra seguir' using errcode = '42501'; end if;
  if p_ligado then
    insert into public.seguindo (user_id, politico_id)
    select auth.uid(), p.id from public.politicos p where p.slug = any(p_slugs[1:300])
    on conflict do nothing;
    if (select count(*) from public.seguindo where user_id = auth.uid()) > 300 then
      raise exception 'dá pra seguir até 300 políticos' using errcode = '22023';
    end if;
  else
    delete from public.seguindo s using public.politicos p
    where s.user_id = auth.uid() and s.politico_id = p.id and p.slug = any(p_slugs[1:300]);
  end if;
end;
$$;

-- ---------- reações ----------

create function public.reagir(p_item uuid, p_tipo text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'entre pra reagir' using errcode = '42501'; end if;
  if not public.pode_interagir(p_item) then raise exception 'siga alguém desta ação pra reagir' using errcode = '42501'; end if;
  if p_tipo is null then
    delete from public.reacoes where item_id = p_item and user_id = auth.uid();
  elsif p_tipo in ('gostei', 'odiei') then
    insert into public.reacoes (item_id, user_id, tipo) values (p_item, auth.uid(), p_tipo)
    on conflict (item_id, user_id) do update set tipo = excluded.tipo, criado_em = now();
  else
    raise exception 'reação inválida' using errcode = '22023';
  end if;
end;
$$;

-- Contagens dos cards que estão na tela, mais a reação de quem está vendo e se essa pessoa pode interagir.
create function public.interacoes(p_itens uuid[])
returns table (item_id uuid, gostei int, odiei int, comentarios int, minha text, pode boolean)
language sql stable security definer set search_path = '' as $$
  select i.id,
    (select count(*)::int from public.reacoes r where r.item_id = i.id and r.tipo = 'gostei'),
    (select count(*)::int from public.reacoes r where r.item_id = i.id and r.tipo = 'odiei'),
    (select count(*)::int from public.comentarios c where c.item_id = i.id and not c.oculto),
    (select r.tipo from public.reacoes r where r.item_id = i.id and r.user_id = auth.uid()),
    public.pode_interagir(i.id)
  from public.itens i where i.id = any(p_itens[1:100]);
$$;

-- ---------- comentários ----------

create function public.comentarios_do_item(p_item uuid)
returns table (id uuid, autor text, texto text, criado_em timestamptz, meu boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.autor, c.texto, c.criado_em, c.user_id = auth.uid()
  from public.comentarios c
  where c.item_id = p_item and (not c.oculto or c.user_id = auth.uid())
  order by c.criado_em
  limit 200;
$$;

create function public.comentar(p_item uuid, p_texto text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_texto text := btrim(regexp_replace(coalesce(p_texto, ''), '\s+', ' ', 'g'));
  v_meta jsonb;
  v_nome text;
  v_autor text;
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'entre pra comentar' using errcode = '42501'; end if;
  if not public.pode_interagir(p_item) then raise exception 'siga alguém desta ação pra comentar' using errcode = '42501'; end if;
  if char_length(v_texto) < 1 or char_length(v_texto) > 500 then raise exception 'comentário de 1 a 500 caracteres' using errcode = '22023'; end if;
  if public.tem_palavrao(v_texto) then raise exception 'sem palavrão nem ofensa, por favor' using errcode = '22023'; end if;
  if (select count(*) from public.comentarios where user_id = auth.uid() and criado_em > now() - interval '10 minutes') >= 10 then
    raise exception 'muitos comentários seguidos; espera uns minutos' using errcode = '22023';
  end if;
  select raw_user_meta_data into v_meta from auth.users where id = auth.uid();
  v_nome := btrim(coalesce(v_meta->>'full_name', v_meta->>'name', 'Torcedor'));
  v_autor := split_part(v_nome, ' ', 1) ||
    case when position(' ' in v_nome) > 0 then ' ' || left(regexp_replace(v_nome, '^.* ', ''), 1) || '.' else '' end;
  insert into public.comentarios (item_id, user_id, autor, texto) values (p_item, auth.uid(), left(v_autor, 40), v_texto) returning id into v_id;
  return v_id;
end;
$$;

create function public.apagar_comentario(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.comentarios where id = p_id and user_id = auth.uid();
$$;

create function public.denunciar(p_comentario uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'entre pra denunciar' using errcode = '42501'; end if;
  insert into public.denuncias (comentario_id, user_id)
  select c.id, auth.uid() from public.comentarios c where c.id = p_comentario and c.user_id <> auth.uid()
  on conflict do nothing;
  update public.comentarios set oculto = true
  where id = p_comentario and (select count(*) from public.denuncias where comentario_id = p_comentario) >= 3;
end;
$$;

-- ---------- permissões ----------
revoke all on function public.pode_interagir(uuid), public.meus_seguidos(), public.seguir(text[], boolean), public.reagir(uuid, text),
  public.interacoes(uuid[]), public.comentarios_do_item(uuid), public.comentar(uuid, text), public.apagar_comentario(uuid),
  public.denunciar(uuid) from public;
grant execute on function public.interacoes(uuid[]), public.comentarios_do_item(uuid) to anon, authenticated;
grant execute on function public.meus_seguidos(), public.seguir(text[], boolean), public.reagir(uuid, text),
  public.comentar(uuid, text), public.apagar_comentario(uuid), public.denunciar(uuid) to authenticated;
