-- Esquema base do Meu Time Político pós-eleição (docs/plano-pos-eleicao.md).
-- Leitura pública de tudo que é dado público (políticos, mandatos, feed).
-- Escrita só pelos coletores, com a chave de serviço (que ignora RLS).
-- A lista de espera não é legível por ninguém de fora: só entra pela função entrar_lista_espera.

-- ---------- políticos ----------
create table public.politicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,                 -- nome civil
  nome_urna text,                     -- como aparece na urna/na casa
  slug text not null unique,          -- usado na URL da página do político
  partido text,
  uf char(2),
  foto_url text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- ids em cada fonte (camara, senado, tse_sq, almg, alesp, youtube, instagram, x...).
-- CPF não entra aqui: o casamento por CPF acontece no coletor e não é guardado.
create table public.ids_externos (
  fonte text not null,
  valor text not null,
  politico_id uuid not null references public.politicos(id) on delete cascade,
  primary key (fonte, valor)
);
create index on public.ids_externos (politico_id);

create table public.mandatos (
  id uuid primary key default gen_random_uuid(),
  politico_id uuid not null references public.politicos(id) on delete cascade,
  cargo text not null check (cargo in ('presidente', 'vice-presidente', 'governador', 'vice-governador', 'senador', 'deputado-federal', 'deputado-estadual')),
  uf char(2),                         -- null pra presidente/vice
  inicio date not null,
  fim date,
  eleicao int,                        -- ano da eleição que deu o mandato
  unique (politico_id, cargo, inicio)
);
create index on public.mandatos (cargo, uf);

-- ---------- feed ----------
create table public.fontes (
  id text primary key,                -- mesmo id das provas da Fase 0 (ex.: camara-presenca)
  nome text not null,
  natureza text not null check (natureza in ('oficial', 'imprensa', 'rede')),  -- o selo do card
  url text
);

create table public.itens (
  id uuid primary key default gen_random_uuid(),
  fonte_id text not null references public.fontes(id),
  chave text not null unique,         -- dedupe: hash estável do item na origem
  tipo text not null check (tipo in ('agenda', 'presenca', 'voto', 'discurso', 'proposicao', 'despesa', 'ato', 'emenda', 'noticia', 'post')),
  titulo text not null,
  resumo text,
  resumo_ia boolean not null default false,  -- resumo escrito por IA leva selo
  url text not null,                  -- nada sem fonte
  ocorreu_em timestamptz,             -- quando aconteceu
  publicado_em timestamptz,           -- quando a fonte publicou
  coletado_em timestamptz not null default now(),
  local text,
  agenda_natureza text check (agenda_natureza in ('publica', 'privada', 'partidaria', 'pessoal')),
  dados jsonb not null default '{}'::jsonb
);
create index on public.itens (ocorreu_em desc);
create index on public.itens (fonte_id, coletado_em desc);

create table public.item_politico (
  item_id uuid not null references public.itens(id) on delete cascade,
  politico_id uuid not null references public.politicos(id) on delete cascade,
  papel text not null default 'citado',      -- autor, votante, presente, ausente, citado...
  metodo text not null check (metodo in ('id-oficial', 'nome', 'ia')),
  confianca real not null default 1 check (confianca between 0 and 1),
  primary key (item_id, politico_id)
);
create index on public.item_politico (politico_id, item_id);

-- ---------- lista de espera ----------
create table public.lista_espera (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  uf char(2),
  origem text,                        -- utm_source ou página
  consentimento text not null,        -- o texto que a pessoa aceitou
  criado_em timestamptz not null default now()
);
create unique index lista_espera_email on public.lista_espera (lower(email));

-- Única porta de entrada pública da lista: valida, ignora repetido e não devolve nada
-- (não dá pra descobrir se um e-mail já está inscrito).
create function public.entrar_lista_espera(p_email text, p_uf text default null, p_origem text default null, p_consentimento text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_email is null or length(p_email) > 254 or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'e-mail inválido' using errcode = '22023';
  end if;
  if p_consentimento is null or length(p_consentimento) > 500 then
    raise exception 'consentimento obrigatório' using errcode = '22023';
  end if;
  insert into public.lista_espera (email, uf, origem, consentimento)
  values (
    lower(trim(p_email)),
    case when p_uf ~ '^[A-Z]{2}$' then p_uf end,
    left(p_origem, 100),
    p_consentimento
  )
  on conflict (lower(email)) do nothing;
end;
$$;
revoke all on function public.entrar_lista_espera(text, text, text, text) from public;
grant execute on function public.entrar_lista_espera(text, text, text, text) to anon, authenticated;

-- ---------- RLS ----------
alter table public.politicos enable row level security;
alter table public.ids_externos enable row level security;
alter table public.mandatos enable row level security;
alter table public.fontes enable row level security;
alter table public.itens enable row level security;
alter table public.item_politico enable row level security;
alter table public.lista_espera enable row level security;  -- sem política: ninguém de fora lê nem escreve direto

create policy "leitura pública" on public.politicos for select to anon, authenticated using (true);
create policy "leitura pública" on public.ids_externos for select to anon, authenticated using (true);
create policy "leitura pública" on public.mandatos for select to anon, authenticated using (true);
create policy "leitura pública" on public.fontes for select to anon, authenticated using (true);
create policy "leitura pública" on public.itens for select to anon, authenticated using (true);
create policy "leitura pública" on public.item_politico for select to anon, authenticated using (true);
