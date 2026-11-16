-- Remove o que sobrou da fase de assistente jurídico: processos (cases), feriados (holidays),
-- a regra de prazo gravada na tarefa (base_date, period_days, count_type), o vínculo da tarefa
-- com o processo (case_id) e a UF/cidade do perfil (só serviam aos feriados).
--
-- ATENÇÃO: apaga dados e não tem volta. Faça backup antes (scripts/backup-db.sh).
-- Ordem segura: publicar primeiro a versão da API que já não lê nem grava essas colunas e só
-- depois aplicar esta migration. Os tipos de tarefa 'prazo'/'audiencia' e o campo `fatal` ficam.

-- 1. Tarefas: vínculo com o processo e regra de prazo.
alter table public.tasks drop constraint if exists tasks_case_same_user_fkey;
alter table public.tasks drop constraint if exists tasks_count_type_check;
alter table public.tasks drop constraint if exists tasks_period_days_check;
alter table public.tasks drop column if exists case_id;
alter table public.tasks drop column if exists base_date;
alter table public.tasks drop column if exists period_days;
alter table public.tasks drop column if exists count_type;

-- 2. Tabelas (as policies e os triggers saem junto).
drop table if exists public.holidays;
drop table if exists public.cases;

-- 3. Perfil: UF e cidade (o grant de UPDATE por coluna some com a coluna).
alter table public.profiles drop constraint if exists profiles_uf_check;
alter table public.profiles drop column if exists uf;
alter table public.profiles drop column if exists city;
