-- Placar do mandato: contagens do que já está no banco, em partes visíveis, sem nota única.
-- Lido na página do político. "desde" diz a partir de quando há coleta, pra ninguém ler como o mandato inteiro.
create function public.placar_mandato(p_slug text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with p as (select id from public.politicos where slug = p_slug),
  x as (
    select i.tipo, i.dados, i.agenda_natureza, i.quando, ip.papel
    from public.item_politico ip join public.itens i on i.id = ip.item_id
    where ip.politico_id = (select id from p)
  )
  select jsonb_build_object(
    'desde', (select min(quando) from x),
    'plenario_esteve', count(*) filter (where tipo = 'presenca' and (dados->>'plenario')::boolean and papel = 'presente'),
    'plenario_faltou', count(*) filter (where tipo = 'presenca' and (dados->>'plenario')::boolean and papel = 'ausente'),
    'comissoes', count(*) filter (where tipo = 'presenca' and not coalesce((dados->>'plenario')::boolean, false) and papel = 'presente'),
    'votos', count(*) filter (where tipo = 'voto' and papel in ('Sim', 'Não', 'Abstenção', 'Obstrução', 'Votou', 'P-NRV', 'Artigo 17', 'Presidente (art. 51 RISF)')),
    'votos_faltou', count(*) filter (where tipo = 'voto' and papel in ('NCom', 'LP')),
    'votos_justificado', count(*) filter (where tipo = 'voto' and papel in ('AP', 'LS', 'MIS', 'REP')),
    'projetos_autor', count(*) filter (where tipo = 'proposicao' and papel = 'autor'),
    'projetos_coautor', count(*) filter (where tipo = 'proposicao' and papel = 'coautor'),
    'discursos', count(*) filter (where tipo = 'discurso'),
    'imprensa', count(*) filter (where tipo = 'noticia'),
    'agenda', jsonb_build_object(
      'publica', count(*) filter (where tipo = 'agenda' and agenda_natureza = 'publica'),
      'privada', count(*) filter (where tipo = 'agenda' and agenda_natureza = 'privada'),
      'partidaria', count(*) filter (where tipo = 'agenda' and agenda_natureza = 'partidaria'),
      'pessoal', count(*) filter (where tipo = 'agenda' and agenda_natureza = 'pessoal'),
      'sem', count(*) filter (where tipo = 'agenda' and agenda_natureza is null))
  )
  from x;
$$;
grant execute on function public.placar_mandato(text) to anon, authenticated;
