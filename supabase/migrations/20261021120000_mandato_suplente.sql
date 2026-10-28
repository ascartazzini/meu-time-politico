-- Suplente em exercício ocupa a cadeira mas não foi o eleito; o card precisa dizer isso.
alter table public.mandatos add column suplente boolean not null default false;
