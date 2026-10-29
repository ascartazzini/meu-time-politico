-- "Insira aqui": qualquer pessoa sugere o site ou a rede que falta na página de um político.
-- Vai pro admin aprovar (npm run sugestoes); só aparece no site depois de aprovado e publicado.
-- Sem política de RLS: ninguém de fora lê a tabela; a única entrada é sugerir_link, que valida e limita volume.
create table public.sugestoes_link (
  id bigint generated always as identity primary key,
  slug text not null,
  tipo text not null check (tipo in ('site', 'instagram', 'x', 'facebook', 'youtube', 'tiktok', 'threads', 'bluesky', 'linkedin', 'kwai', 'telegram')),
  url text not null check (char_length(url) <= 300),
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada')),
  user_id uuid references auth.users(id) on delete set null,   -- se estava logado; não é exigido
  criado_em timestamptz not null default now()
);
create index on public.sugestoes_link (status, criado_em);
alter table public.sugestoes_link enable row level security;

create function public.sugerir_link(p_slug text, p_tipo text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text := btrim(coalesce(p_url, ''));
  v_host text;
  v_ok boolean;
begin
  if not exists (select 1 from public.politicos where slug = p_slug) then raise exception 'político não encontrado' using errcode = '22023'; end if;
  if v_url !~* '^https?://' then v_url := 'https://' || v_url; end if;
  if char_length(v_url) > 300 or v_url ~ '\s' then raise exception 'endereço inválido' using errcode = '22023'; end if;
  v_host := lower(substring(v_url from '^https?://(?:www\.|m\.)?([^/?#]+)'));
  if v_host is null or position('.' in v_host) = 0 then raise exception 'endereço inválido' using errcode = '22023'; end if;
  v_ok := case p_tipo
      when 'instagram' then v_host in ('instagram.com')
      when 'x' then v_host in ('x.com', 'twitter.com')
      when 'facebook' then v_host in ('facebook.com', 'fb.com')
      when 'youtube' then v_host in ('youtube.com', 'youtu.be')
      when 'tiktok' then v_host = 'tiktok.com'
      when 'threads' then v_host in ('threads.net', 'threads.com')
      when 'bluesky' then v_host = 'bsky.app'
      when 'linkedin' then v_host = 'linkedin.com'
      when 'kwai' then v_host in ('kwai.com', 'k.kwai.com')
      when 'telegram' then v_host in ('t.me', 'telegram.me')
      when 'site' then v_host !~ '(instagram|facebook|twitter|tiktok|youtube|wa\.me|whatsapp|linktr\.ee)'
      else false end;
  if not coalesce(v_ok, false) then
    raise exception 'esse endereço não é de %', p_tipo using errcode = '22023';
  end if;
  if (select count(*) from public.sugestoes_link where slug = p_slug and criado_em > now() - interval '1 day') >= 30
     or (select count(*) from public.sugestoes_link where criado_em > now() - interval '1 day') >= 1000 then
    raise exception 'muitas sugestões hoje; tenta amanhã' using errcode = '22023';
  end if;
  insert into public.sugestoes_link (slug, tipo, url, user_id) values (p_slug, p_tipo, v_url, auth.uid());
end;
$$;
revoke all on function public.sugerir_link(text, text, text) from public;
grant execute on function public.sugerir_link(text, text, text) to anon, authenticated;
