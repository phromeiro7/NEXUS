-- Escrita só pela API: o papel `authenticated` passa a só ler as próprias linhas (RLS continua valendo).
-- Antes, quem tinha um JWT podia gravar tarefas, processos, feriados e lançamentos direto pelo PostgREST,
-- pulando as validações da API (formato, prazo e criação de lembretes). O site só usa o Supabase para login.
-- A API usa service_role e não é afetada. Para reverter: `grant insert, update, delete on ... to authenticated`.
revoke insert, update, delete on table public.cases from authenticated;
revoke insert, update, delete on table public.tasks from authenticated;
revoke insert, update, delete on table public.holidays from authenticated;
revoke insert, update, delete on table public.finance_entries from authenticated;
