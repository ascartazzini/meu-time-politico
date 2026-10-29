-- Imagem de compartilhamento de cada político (o hero da página dele, 1200x630).
-- Bucket público só de leitura: quem grava é o script npm run og, com a chave secreta.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('og', 'og', true, 512000, array['image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 512000, allowed_mime_types = array['image/jpeg'];
