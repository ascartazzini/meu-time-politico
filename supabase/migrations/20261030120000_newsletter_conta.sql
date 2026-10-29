-- Newsletter pra quem tem conta: depois do login a pessoa escolhe receber ou não o resumo da semana.
-- A escolha fica guardada (pergunta uma vez só, em qualquer aparelho) e o e-mail é o da conta Google,
-- já verificado. "Sim" põe o e-mail em lista_espera; "não" depois de "sim" tira.
create table if not exists public.newsletter_escolha (
  user_id uuid primary key references auth.users(id) on delete cascade,
  quer boolean not null,
  consentimento text,
  em timestamptz not null default now()
);
alter table public.newsletter_escolha enable row level security;   -- sem política: só pelas funções abaixo

create or replace function public.newsletter_minha()
returns boolean language sql stable security definer set search_path = '' as $$
  select quer from public.newsletter_escolha where user_id = auth.uid();
$$;

create or replace function public.newsletter_escolher(p_quer boolean, p_consentimento text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'precisa entrar' using errcode = '42501'; end if;
  if p_quer and (p_consentimento is null or length(p_consentimento) > 500) then
    raise exception 'consentimento obrigatório' using errcode = '22023';
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  insert into public.newsletter_escolha (user_id, quer, consentimento, em) values (auth.uid(), p_quer, p_consentimento, now())
    on conflict (user_id) do update set quer = excluded.quer, consentimento = excluded.consentimento, em = now();
  if v_email is null then return; end if;
  if p_quer then
    insert into public.lista_espera (email, origem, consentimento) values (v_email, 'conta', p_consentimento)
      on conflict (lower(email)) do nothing;
  else
    delete from public.lista_espera where lower(email) = v_email;
  end if;
end $$;

revoke all on function public.newsletter_minha() from public, anon;
revoke all on function public.newsletter_escolher(boolean, text) from public, anon;
grant execute on function public.newsletter_minha() to authenticated;
grant execute on function public.newsletter_escolher(boolean, text) to authenticated;
