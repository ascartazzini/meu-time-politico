-- Envio da newsletter: cada inscrito ganha um token de descadastro (o link "Sair da lista" do e-mail leva
-- pra /sair/?t=<token>), e cada e-mail mandado fica registrado em `envios`, pra o job poder rodar de novo
-- (falha no meio, cota do dia estourada) sem mandar duas vezes pra mesma pessoa.
alter table public.lista_espera add column if not exists token uuid not null default gen_random_uuid();
create unique index if not exists lista_espera_token on public.lista_espera (token);

create table if not exists public.envios (
  semana date not null references public.edicoes(semana) on delete cascade,
  lista_id uuid not null references public.lista_espera(id) on delete cascade,
  id_servico text,                         -- id devolvido pelo serviço de envio
  enviado_em timestamptz not null default now(),
  primary key (semana, lista_id)
);
alter table public.envios enable row level security;   -- sem política: só o job, com a chave secreta

-- Descadastro sem login: quem tem o token (só o dono do e-mail recebeu) sai da lista. Não diz se o token
-- existia. Quem tinha conta passa a constar como "não quer", pra o site não perguntar de novo.
create or replace function public.newsletter_sair(p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  delete from public.lista_espera where token = p_token returning lower(email) into v_email;
  if v_email is null then return; end if;
  update public.newsletter_escolha set quer = false, em = now()
    where user_id in (select id from auth.users where lower(email) = v_email);
end $$;

revoke all on function public.newsletter_sair(uuid) from public;
grant execute on function public.newsletter_sair(uuid) to anon, authenticated;
