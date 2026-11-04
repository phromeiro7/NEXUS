-- Nome opcional do convite: só para o administrador saber qual convite é de quem. Não é usado para mais nada.
alter table public.invites
  add column label text,
  add constraint invites_label_check check (label is null or char_length(label) between 1 and 60);
