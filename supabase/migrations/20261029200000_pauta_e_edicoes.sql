-- Newsletter semanal: a pauta futura do plenário (Câmara e Senado) e as edições prontas.
-- As duas são públicas (leitura): a página /semana/ lê a edição direto daqui, sem republicar o site.
create table public.pauta (
  chave text primary key,                 -- casa + sessão + matéria
  casa text not null check (casa in ('camara', 'senado')),
  quando timestamptz not null,
  sessao text,                            -- "Sessão Deliberativa Extraordinária"
  materia text not null,                  -- "PL 5902/2023"
  ementa text,
  url text not null,
  coletado_em timestamptz not null default now()
);
create index on public.pauta (quando);
alter table public.pauta enable row level security;
create policy "leitura pública" on public.pauta for select to anon, authenticated using (true);

create table public.edicoes (
  semana date primary key,                -- segunda-feira da semana da edição
  dados jsonb not null,                   -- notícias, pauta, marcos (o que a página mostra)
  html text,                              -- e-mail pronto, pra quando houver serviço de envio
  criado_em timestamptz not null default now()
);
alter table public.edicoes enable row level security;
create policy "leitura pública" on public.edicoes for select to anon, authenticated using (true);
