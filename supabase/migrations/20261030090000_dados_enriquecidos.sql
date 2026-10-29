-- O enriquecimento (scripts/coletores/enriquecer.ts) acrescenta chaves em itens.dados: imagem da matéria,
-- trechos do discurso, participantes da agenda. O coletor regrava o item inteiro a cada passada (upsert), e sem
-- isto apagaria o que foi acrescentado. Aqui o dados novo entra por cima do antigo, chave a chave.
create or replace function public.itens_manter_dados() returns trigger language plpgsql set search_path = '' as $$
begin
  new.dados := coalesce(old.dados, '{}'::jsonb) || coalesce(new.dados, '{}'::jsonb);
  return new;
end $$;

drop trigger if exists itens_manter_dados on public.itens;
create trigger itens_manter_dados before update of dados on public.itens
  for each row execute function public.itens_manter_dados();
