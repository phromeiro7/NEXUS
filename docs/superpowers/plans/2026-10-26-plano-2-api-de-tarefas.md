# Plano 2 — API de tarefas, processos e configurações

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A API autenticada que o painel vai consumir: CRUD de tarefas e processos, feriados locais, configurações do usuário e o briefing do dia, com os lembretes sempre em sincronia com as tarefas.

**Architecture:** Continua a arquitetura em camadas do Plano 1 (rotas → casos de uso → domínio, com repositórios Supabase atrás de portas). Toda escrita de tarefa gera ou refaz os lembretes (`buildReminders`) por uma função SQL atômica. O `user_id` sai só do token; recurso de outro usuário responde 404.

**Tech Stack:** o do Plano 1 (Hono, Zod, Vitest, Supabase local, `pg` nos testes) + `hono/cors`.

**Spec:** `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md` (§5, §6 regras de data, §7, §8, §9). Plano anterior: `docs/superpowers/plans/2026-10-26-plano-1-fundacao-e-dominio.md` (já executado e integrado na `main`).

**Renumeração dos planos.** O "Plano 2: painel" da spec foi dividido: **este é o Plano 2 (API)**; o **Plano 3 é o painel Next.js** (login, visões, formulários); 4) assistente de IA e briefing em texto; 5) Telegram, envio de lembretes e agendador; 6) acabamento e avaliação da IA.

## Global Constraints

- Prazo é `due_date` (data) + `due_time` opcional (`HH:mm`); a API nunca devolve `HH:mm:ss`. Lembretes guardam instante absoluto.
- Status: `pendente`, `em_andamento`, `concluida`, `cancelada`; tipo: `prazo`, `tarefa`, `audiencia`. Exclusão lógica (`deleted_at`). Tarefa `concluida` ou `cancelada` só pode ser reaberta (status → `pendente`); editar outros campos dela é conflito (spec §11).
- Lembretes: regras de `buildReminders` (Plano 1). Editar o prazo refaz os lembretes; concluir, cancelar ou apagar remove os pendentes.
- Hora local inexistente ou ambígua nunca é convertida em silêncio: a API responde 422 `hora_invalida` com o `reason`.
- O `user_id` nunca vem do cliente. Recurso de outro usuário ou inexistente: 404 `nao_encontrado` (nunca 403). A chave de serviço ignora o RLS, então **todo** acesso do repositório filtra por `user_id`.
- Camadas: `domain/` e `application/` não importam Hono, Supabase nem `infra/`.
- Erros 500 só com a resposta genérica `erro_interno`; o erro vai para `console.error`, nunca token nem configuração.
- Nenhum segredo no Git. Toda migration nova revoga privilégios de `anon`/`authenticated` (o teste de catálogo vigia).

## Review Focus

1. Hora local inexistente (lacuna de horário de verão) ao criar tarefa com hora: não pode sobrar tarefa gravada sem lembretes. → Task 4.
2. Lembretes seguem a tarefa: refeitos ao mudar prazo, fatal, status ou configurações; removidos ao concluir, cancelar ou apagar; nunca criados para tarefa encerrada. → Tasks 2, 4, 5, 6.
3. Acesso por id adivinhado: ler, alterar ou apagar tarefa, processo ou feriado de outro usuário, e criar tarefa com `caseId` de outro usuário, dão 404. → Tasks 4, 8, 10.
4. "Hoje" no fuso do usuário perto da meia-noite, e `due_time` voltando do Postgres como `HH:mm:ss`. → Tasks 6 e 7.
5. Mudar fuso ou antecedência refaz os lembretes das tarefas abertas; fuso inválido (`Nao/Existe`) é recusado. → Task 6.

---

## File Structure

```
packages/shared/src/{time-of-day,task-api,case-api,settings-api,holiday-api,briefing}.ts (+ testes)
supabase/migrations/0004_replace_pending_reminders.sql
apps/api/src/domain/briefing.ts (+ test)
apps/api/src/application/{ports,errors,sync-reminders,tasks,cases,holidays,settings,briefing}.ts (+ testes)
apps/api/test/fakes.ts                      repositórios em memória para os testes de aplicação
apps/api/src/infra/supabase-{task,case,profile,reminder}-repository.ts, supabase-holiday-repository.ts (ampliado)
apps/api/src/http-errors.ts · apps/api/src/routes/{tasks,cases,holidays,settings,briefing}.ts (+ testes)
apps/api/src/{app,config,server}.ts · apps/api/test/db/api.db.test.ts · README.md
```

---

### Task 1: Contratos compartilhados da API

**Files:**
- Create: `packages/shared/src/{time-of-day,task-api,case-api,settings-api,holiday-api,briefing}.ts`; Modify: `index.ts`
- Test: `packages/shared/src/{task-api,case-api,settings-api,holiday-api}.test.ts`

**Interfaces:**
- Consumes: `isoDateSchema`, `IsoDate`, `taskStatusSchema`, `taskTypeSchema`, `countTypeSchema`, `calculateDeadlineInputSchema`, `Holiday`.
- Produces (`@aj/shared`):
  - `timeOfDaySchema` (`HH:mm`, 00:00–23:59). `export function isValidTimeZone(tz: string): boolean` (usa `Intl.DateTimeFormat`).
  - `deadlineRuleSchema = calculateDeadlineInputSchema` (`{ baseDate, days, countType }`).
  - `createTaskInputSchema`: `{ title: trim 1..200; type?: TaskType (padrão 'tarefa'); caseId?: uuid|null; dueDate?: IsoDate|null; dueTime?: HH:mm|null; fatal?: boolean (padrão false); deadline?: DeadlineRule }`. Regras: `deadline` e `dueDate` não coexistem (o servidor calcula `dueDate` a partir de `deadline`); `dueTime` exige `dueDate` ou `deadline`. `type CreateTaskInput`.
  - `updateTaskInputSchema`: os mesmos campos, todos opcionais, mais `status?: TaskStatus`; pelo menos um campo presente; `deadline` e `dueDate` não coexistem. `type UpdateTaskInput`.
  - `listTasksQuerySchema`: `{ from?: IsoDate; to?: IsoDate; status?: TaskStatus[] (aceita lista separada por vírgula); caseId?: uuid; withoutDate?: boolean }` (`withoutDate` aceita 'true'/'false'; `from <= to` quando ambos). `type ListTasksQuery`.
  - `type TaskDto = { id: string; caseId: string | null; title: string; type: TaskType; status: TaskStatus; dueDate: IsoDate | null; dueTime: string | null; fatal: boolean; baseDate: IsoDate | null; periodDays: number | null; countType: CountType | null; completedAt: string | null; createdAt: string; updatedAt: string }`.
  - `createCaseInputSchema`: `{ number: trim 1..60; clientName?: string|null (<=200); description?: string|null (<=1000) }`; `updateCaseInputSchema`: parcial + `status?: 'ativo'|'arquivado'`, ao menos um campo; `type CaseDto = { id; number; clientName; description; status; createdAt; updatedAt }`.
  - `updateSettingsInputSchema`: `{ timezone?: string (isValidTimeZone); uf?: string|null (duas letras maiúsculas); city?: string|null; earlyReminderMinutes?: int 0..1440; briefingTime?: HH:mm }`, ao menos um campo; `type SettingsDto = { timezone: string; uf: string | null; city: string | null; earlyReminderMinutes: number; briefingTime: string; telegramLinked: boolean }`.
  - `createHolidayInputSchema`: `{ date: IsoDate; scope: 'estadual'|'municipal'; name: trim 1..100 }`; `type HolidayDto = { id: string; date: IsoDate; scope: 'estadual' | 'municipal'; name: string }`.
  - `type BriefingDto = { today: IsoDate; overdue: TaskDto[]; fatalToday: TaskDto[]; hearingsToday: TaskDto[]; nextTwoDays: TaskDto[] }`.

- [ ] **Step 1: Write the failing tests**, com estas asserções:
  - `timeOfDaySchema`: `'09:30'` e `'00:00'` válidos; `'24:00'`, `'9:30'`, `'09:60'` inválidos. `isValidTimeZone('America/Sao_Paulo') === true`, `isValidTimeZone('Nao/Existe') === false`.
  - `createTaskInputSchema`: `{ title: '  Contestação  ' }` gera `title 'Contestação'`, `type 'tarefa'`, `fatal false`, `caseId null`; título vazio e título de 201 caracteres falham; `dueTime '09:00'` sem data falha; `dueDate` junto com `deadline` falha; `deadline: { baseDate:'2026-10-26', days:15, countType:'uteis' }` sozinho é válido; `deadline.days: 0` falha; `dueDate '2026-02-31'` falha.
  - `updateTaskInputSchema`: `{}` falha; `{ status: 'concluida' }` válido; `{ status: 'feito' }` falha.
  - `listTasksQuerySchema`: `status: 'pendente,em_andamento'` vira `['pendente','em_andamento']`; `from '2026-11-02'` com `to '2026-11-01'` falha; `withoutDate: 'true'` vira `true`.
  - Casos e feriados: `number: ''` falha; `uf: 'sp'` falha (precisa maiúscula) e `'SP'` passa; `scope: 'nacional'` falha; `earlyReminderMinutes: -1` e `1441` falham; `timezone: 'Nao/Existe'` falha.
- [ ] **Step 2: Run** `pnpm --filter @aj/shared test` → Expected: FAIL.
- [ ] **Step 3: Implement** as assinaturas acima; reexportar tudo em `index.ts`.
- [ ] **Step 4: Run** `pnpm --filter @aj/shared test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): add task, case, settings, holiday and briefing contracts`.

---

### Task 2: Função SQL que troca os lembretes pendentes

**Files:**
- Create: `supabase/migrations/0004_replace_pending_reminders.sql`
- Test: `apps/api/test/db/reminders-fn.test.ts`

**Interfaces:**
- Produces: `public.replace_pending_reminders(p_user_id uuid, p_task_id uuid, p_drafts jsonb) returns void`, onde `p_drafts` é uma lista `[{ "kind": text, "scheduled_at": timestamptz-iso }]`. Apaga os lembretes `pendente` da tarefa e insere os novos numa só transação; ignora conflito com um lembrete `enviando` do mesmo tipo (`on conflict do nothing`). `[]` apenas remove. Só `service_role` pode executar (`revoke ... from public, anon, authenticated`).

- [ ] **Step 1: Write the failing tests** (`asServiceRole` e `createUser` de `test/db/helpers.ts`; dentro de transação com rollback): (a) com uma tarefa de A e dois rascunhos válidos, a função deixa exatamente 2 lembretes `pendente`; (b) chamar de novo com outros 2 rascunhos substitui os anteriores (continuam 2, com os novos horários); (c) um lembrete `enviado` e um `enviando` da tarefa nunca são apagados; (d) `p_drafts = '[]'` remove só os `pendente`; (e) `p_user_id` de B com `p_task_id` de A falha com 23503 (a chave composta) e não altera nada; (f) um `kind` inválido falha com 23514; (g) `anon` e `authenticated` não conseguem executar (42501).
- [ ] **Step 2: Run** `pnpm --filter @aj/api test:db` → Expected: FAIL (função ausente).
- [ ] **Step 3: Write** `0004_replace_pending_reminders.sql` (`language plpgsql`, `security invoker`, `set search_path = ''`, nomes qualificados; `jsonb_to_recordset` para inserir).
- [ ] **Step 4: Run** `./apps/api/node_modules/.bin/supabase db reset --workdir . && pnpm --filter @aj/api test:db` → Expected: PASS, incluindo o teste de catálogo existente.
- [ ] **Step 5: Commit** `feat(db): atomic replace_pending_reminders function`.

---

### Task 3: Portas, erros de aplicação e repositórios em memória

**Files:**
- Modify: `apps/api/src/application/ports.ts`; Create: `apps/api/src/application/errors.ts`, `apps/api/test/fakes.ts`
- Test: `apps/api/test/fakes.test.ts`

**Interfaces:**
- Consumes: DTOs da Task 1, `ReminderDraft`, `TaskStatus`.
- Produces:
  - `errors.ts`: `class NotFoundError extends Error { constructor(readonly resource: 'tarefa' | 'processo' | 'feriado') }`; `class ConflictError extends Error { constructor(readonly code: 'tarefa_encerrada' | 'numero_ja_cadastrado' | 'feriado_ja_cadastrado') }`.
  - `ports.ts` (além do `HolidayRepository.listByUser` que já existe, que continua igual): `type NewTask = Omit<TaskDto, 'id' | 'createdAt' | 'updatedAt'> & { source: 'painel' | 'telegram'; sourceText: string | null }`; `type TaskPatch = Partial<Omit<TaskDto, 'id' | 'createdAt' | 'updatedAt'>>`; `interface TaskRepository { create(userId: string, task: NewTask): Promise<TaskDto>; get(userId: string, id: string): Promise<TaskDto | null>; list(userId: string, query: ListTasksQuery): Promise<TaskDto[]>; update(userId: string, id: string, patch: TaskPatch): Promise<TaskDto | null>; softDelete(userId: string, id: string, now: Date): Promise<boolean>; }` (`get`/`list` nunca devolvem apagadas); `interface CaseRepository { create(userId: string, input: CreateCaseInput): Promise<CaseDto>; get(userId: string, id: string): Promise<CaseDto | null>; list(userId: string, filter: { status?: 'ativo' | 'arquivado' }): Promise<CaseDto[]>; update(userId: string, id: string, patch: UpdateCaseInput): Promise<CaseDto | null>; }` (`create` lança `ConflictError('numero_ja_cadastrado')`); `interface HolidayRepository` ganha `list(userId: string): Promise<HolidayDto[]>`, `create(userId: string, input: CreateHolidayInput): Promise<HolidayDto>` (lança `ConflictError('feriado_ja_cadastrado')`) e `remove(userId: string, id: string): Promise<boolean>`; `type ProfileRecord = SettingsDto`; `interface ProfileRepository { get(userId: string): Promise<ProfileRecord>; update(userId: string, patch: UpdateSettingsInput): Promise<ProfileRecord>; }`; `interface ReminderRepository { replacePending(userId: string, taskId: string, drafts: ReminderDraft[]): Promise<void>; }`; `interface Clock { now(): Date }`.
  - `fakes.ts`: `createFakes(seed?)` devolve implementações em memória de todas as portas (com `Clock` ajustável por `setNow(date)`), onde o fake de `ReminderRepository` guarda `calls` e o estado atual de lembretes por tarefa, e aceita `failNextReplace()` para simular falha.

- [ ] **Step 1: Write the failing tests** do `fakes.ts` (para o resto do plano poder confiar nele): criar e ler tarefa de A; B não enxerga nem altera a tarefa de A; `softDelete` esconde de `get` e `list`; `list` filtra por `status`, `from`/`to`, `caseId` e `withoutDate`; `replacePending` substitui os anteriores e `failNextReplace()` faz a próxima chamada lançar; caso duplicado lança `ConflictError('numero_ja_cadastrado')`.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test` → Expected: FAIL.
- [ ] **Step 3: Implement** as portas, os erros e o fake (o fake obedece o mesmo contrato das portas, inclusive o isolamento por `userId`).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): application ports, errors and in-memory fakes`.

---

### Task 4: Casos de uso de tarefa: criar, ler e listar (com lembretes)

**Files:**
- Create: `apps/api/src/application/{sync-reminders,tasks}.ts`; Test: `apps/api/src/application/tasks.test.ts`

**Interfaces:**
- Consumes: portas e erros da Task 3, `buildReminders`, `HoraInvalidaError`, `makeCalculateDeadline` (tipo de retorno do Plano 1), `todayIn`.
- Produces:
  - `sync-reminders.ts`: `makeSyncReminders(deps: { reminders: ReminderRepository; clock: Clock }): (userId: string, task: TaskDto, profile: ProfileRecord) => Promise<void>` — se a tarefa está `concluida`/`cancelada` ou sem `dueDate`, troca por lista vazia; senão troca por `buildReminders({ dueDate, dueTime, fatal, timeZone: profile.timezone, earlyMinutes: profile.earlyReminderMinutes, now: clock.now() })`. Também `export function remindersFor(task, profile, now): ReminderDraft[]` (a parte pura, usada para validar antes de gravar).
  - `tasks.ts`: `makeTaskUseCases(deps: { tasks: TaskRepository; cases: CaseRepository; profiles: ProfileRepository; reminders: ReminderRepository; calculateDeadline: ReturnType<typeof makeCalculateDeadline>; clock: Clock })` devolve `{ create(userId: string, input: CreateTaskInput, source?: 'painel' | 'telegram'): Promise<TaskDto>; get(userId: string, id: string): Promise<TaskDto>; list(userId: string, query: ListTasksQuery): Promise<TaskDto[]>; update(...); remove(...) }` (as duas últimas na Task 5). `get` lança `NotFoundError('tarefa')`.
- Regras de `create`: (1) se `caseId` vem, o processo precisa existir para esse usuário, senão `NotFoundError('processo')`; (2) se `deadline` vem, `dueDate` = `calculateDeadline(userId, deadline).dueDate` e a tarefa guarda `baseDate`, `periodDays`, `countType` (e `type` padrão vira `'prazo'` quando o chamador não informou o tipo); (3) **antes de gravar**, calcula os lembretes (`remindersFor`); uma `HoraInvalidaError` sobe sem gravar nada; (4) grava a tarefa, depois troca os lembretes; (5) se a troca de lembretes falhar, faz `softDelete` da tarefa recém-criada e relança o erro (nenhum estado pela metade fica visível).

- [ ] **Step 1: Write the failing tests** (fakes, `clock` fixo em `2026-10-26T12:00:00Z`, fuso `America/Sao_Paulo`, antecedência 15):
  - tarefa só com título → `type 'tarefa'`, `status 'pendente'`, sem lembretes;
  - `dueDate '2026-10-30'`, `fatal true` → 3 lembretes (`tres_dias`, `dia_anterior`, `no_dia`) nos instantes certos (11:00Z em 10-27, 10-29 e 10-30);
  - `dueDate '2026-10-27'`, `dueTime '09:00'` → `antecipado 11:45Z` e `no_horario 12:00Z`;
  - `deadline { baseDate:'2026-10-26', days:15, countType:'uteis' }` → `dueDate '2026-11-17'`, `baseDate`/`periodDays 15`/`countType 'uteis'` gravados, `type 'prazo'`, e o feriado local do usuário (via `calculateDeadline` fake) é respeitado;
  - `caseId` de outro usuário → `NotFoundError('processo')` e nada gravado;
  - **Review Focus 1:** usuário em `America/New_York`, `dueDate '2026-03-08'`, `dueTime '02:30'` → lança `HoraInvalidaError` e a lista de tarefas do usuário continua vazia;
  - **falha na troca de lembretes** (`failNextReplace()`): o erro sobe, e `list` não mostra a tarefa (foi apagada logicamente);
  - `get` de id de outro usuário → `NotFoundError('tarefa')`; `list` isola por usuário e respeita `from`/`to`/`status`/`withoutDate`.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test` → Expected: FAIL.
- [ ] **Step 3: Implement** as assinaturas e regras acima.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): create, get and list tasks with reminders`.

---

### Task 5: Casos de uso de tarefa: atualizar, mudar status e apagar

**Files:**
- Modify: `apps/api/src/application/tasks.ts`; Test: `apps/api/src/application/tasks.test.ts`

**Interfaces:**
- Consumes: Task 4, `applyStatusChange`, `InvalidTransitionError`.
- Produces: `update(userId: string, id: string, input: UpdateTaskInput): Promise<TaskDto>` e `remove(userId: string, id: string): Promise<void>` (`NotFoundError('tarefa')` se não existir ou for de outro usuário).
- Regras de `update`: (1) tarefa `concluida`/`cancelada` aceita **apenas** `status: 'pendente'` (reabrir); qualquer outro campo nela lança `ConflictError('tarefa_encerrada')`; (2) `status` passa por `applyStatusChange` (define `completedAt`; transição inválida sobe `InvalidTransitionError`); (3) `deadline` recalcula `dueDate` e atualiza `baseDate`/`periodDays`/`countType`; informar `dueDate: null` limpa também `dueTime` e a regra do prazo; (4) `caseId` novo precisa ser do usuário (`NotFoundError('processo')`), `caseId: null` desvincula; (5) lembretes são refeitos sempre que mudam `dueDate`, `dueTime`, `fatal` ou o status (vazio ao concluir/cancelar; refeitos ao reabrir), e **calculados antes de gravar** (hora inválida não grava nada); (6) falha na troca de lembretes depois do `update` restaura os campos anteriores da tarefa e relança o erro. `remove` faz `softDelete` e troca os lembretes por lista vazia.

- [ ] **Step 1: Write the failing tests:**
  - mudar `dueDate` de `2026-10-30` para `2026-11-04` troca os lembretes pelos novos instantes (e remove os antigos);
  - `status: 'concluida'` → `completedAt` = clock, lembretes vazios; reabrir (`'pendente'`) → `completedAt null` e lembretes de volta;
  - **Review Focus 2:** editar o título de uma tarefa `concluida` → `ConflictError('tarefa_encerrada')`; `concluida → em_andamento` → `InvalidTransitionError`; `remove` esvazia os lembretes e a tarefa some de `get`/`list`;
  - `dueDate: null` limpa `dueTime` e a regra; `fatal` de `false` para `true` numa tarefa só com data acrescenta `tres_dias`;
  - hora inválida (`America/New_York`, 2026-03-08 02:30) em `update` → `HoraInvalidaError` e a tarefa permanece como estava;
  - falha na troca de lembretes (`failNextReplace()`) → erro sobe e a tarefa volta ao estado anterior;
  - **Review Focus 3:** `update`/`remove` com id de outra pessoa → `NotFoundError('tarefa')`; `caseId` de outro usuário no `update` → `NotFoundError('processo')`.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test` → Expected: FAIL.
- [ ] **Step 3: Implement** `update` e `remove` conforme as regras.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): update, change status and delete tasks`.

---

### Task 6: Processos, feriados, configurações e briefing

**Files:**
- Create: `apps/api/src/domain/briefing.ts`, `apps/api/src/application/{cases,holidays,settings,briefing}.ts`
- Test: `apps/api/src/domain/briefing.test.ts`, `apps/api/src/application/{cases,holidays,settings,briefing}.test.ts`

**Interfaces:**
- Consumes: portas da Task 3, `makeSyncReminders`, `classifyTask`, `todayIn`, `addDays`.
- Produces:
  - `domain/briefing.ts`: `export function buildBriefing<T extends { status: TaskStatus; dueDate: IsoDate | null; fatal: boolean; type: TaskType }>(tasks: T[], today: IsoDate): { overdue: T[]; fatalToday: T[]; hearingsToday: T[]; nextTwoDays: T[] }` — só tarefas abertas (`pendente`/`em_andamento`) com data; `overdue` = `dueDate < today`; `fatalToday` = fatais de hoje; `hearingsToday` = tipo `audiencia` de hoje; `nextTwoDays` = `today < dueDate <= today + 2`; cada lista ordenada por `dueDate` e depois `dueTime` (sem hora por último), estável.
  - `cases.ts`: `makeCaseUseCases(deps: { cases: CaseRepository })` → `{ create, list(userId, filter), get, update }` (`NotFoundError('processo')`).
  - `holidays.ts`: `makeHolidayUseCases(deps: { holidays: HolidayRepository })` → `{ list(userId), create(userId, input), remove(userId, id) }` (`remove` de id alheio → `NotFoundError('feriado')`).
  - `settings.ts`: `makeSettingsUseCases(deps: { profiles: ProfileRepository; tasks: TaskRepository; syncReminders: ReturnType<typeof makeSyncReminders> })` → `{ get(userId): Promise<SettingsDto>; update(userId: string, input: UpdateSettingsInput): Promise<{ settings: SettingsDto; remindersRebuilt: number; remindersSkipped: number }> }`. Se `timezone` ou `earlyReminderMinutes` mudam, refaz os lembretes de todas as tarefas abertas com data (`tasks.list` com `status: ['pendente','em_andamento']`); uma tarefa cuja hora vire inexistente no novo fuso (`HoraInvalidaError`) é contada em `remindersSkipped` e não interrompe as demais.
  - `briefing.ts`: `makeGetBriefing(deps: { tasks: TaskRepository; profiles: ProfileRepository; clock: Clock })` → `(userId: string) => Promise<BriefingDto>`; `today = todayIn(profile.timezone, clock.now())`.

- [ ] **Step 1: Write the failing tests:**
  - `buildBriefing` (`today '2026-10-26'`): separa atrasadas (10-25), fatal de hoje, audiência de hoje, e as de 10-27 e 10-28 em `nextTwoDays` (10-29 fica de fora); concluída e cancelada ficam de fora de tudo; ordena por hora com "sem hora" por último; uma tarefa fatal que também é audiência aparece nas duas listas;
  - **Review Focus 4:** `makeGetBriefing` com `clock = 2026-10-27T01:30:00Z` e fuso `America/Sao_Paulo` usa `today '2026-10-26'` (ainda é dia 26 para o usuário); com fuso `Asia/Tokyo` usa `'2026-10-27'`;
  - processos: número duplicado → `ConflictError('numero_ja_cadastrado')`; arquivar com `update`; `get`/`update` de outro usuário → `NotFoundError('processo')`;
  - feriados: data duplicada → `ConflictError('feriado_ja_cadastrado')`; `remove` de outro usuário → `NotFoundError('feriado')`;
  - **Review Focus 5:** `update` de configurações mudando `earlyReminderMinutes` de 15 para 30 refaz os lembretes das tarefas abertas com hora (`antecipado` 30 min antes) e devolve `remindersRebuilt` correto; mudar só `city` não chama `replacePending`; mudar o fuso para `America/New_York` com uma tarefa em 2026-03-08 02:30 conta essa tarefa em `remindersSkipped` e refaz as outras; configurações são sempre do `userId` do token.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test` → Expected: FAIL.
- [ ] **Step 3: Implement** conforme as assinaturas.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): case, holiday, settings and briefing use cases`.

---

### Task 7: Repositórios Supabase

**Files:**
- Create: `apps/api/src/infra/supabase-{task,case,profile,reminder}-repository.ts`; Modify: `apps/api/src/infra/supabase-holiday-repository.ts`
- Test: `apps/api/src/infra/repositories.db.test.ts`

**Interfaces:**
- Consumes: as portas da Task 3; o cliente Supabase com a chave de serviço; a função da Task 2.
- Produces: `createSupabaseTaskRepository(client: SupabaseClient): TaskRepository`, `createSupabaseCaseRepository`, `createSupabaseProfileRepository`, `createSupabaseReminderRepository(client): ReminderRepository` (chama `rpc('replace_pending_reminders', …)`) e o repositório de feriados ampliado com `list`, `create`, `remove`. Regras: toda consulta filtra por `user_id`; `due_time` sai como `HH:mm` (corta os segundos); `completed_at` e carimbos como string ISO; `get`/`list` filtram `deleted_at is null`; violação única (SQLSTATE 23505) vira `ConflictError` do tipo certo; erro desconhecido do Supabase vira `Error` com a mensagem (sem vazar chaves).

- [ ] **Step 1: Write the failing test** (Supabase local com `getSupabaseEnv`, usuários A e B criados e removidos como em `supabase.db.test.ts`; sem `.db.test.ts` ele não entra no `pnpm test`): ciclo completo de cada repositório com A; B nunca enxerga nem altera linhas de A (`get` devolve `null`, `update`/`softDelete` devolvem `null`/`false`, `list` não mistura); `dueTime` gravado como `'09:00'` volta `'09:00'` (não `'09:00:00'`); **Review Focus 4**; processo duplicado → `ConflictError('numero_ja_cadastrado')`; feriado duplicado → `ConflictError('feriado_ja_cadastrado')`; `replacePending` deixa exatamente os rascunhos pedidos em `reminders`; `profiles.get` de usuário recém-criado devolve fuso `America/Sao_Paulo`, antecedência 15, `briefingTime '08:00'`, `telegramLinked false`.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test:db` → Expected: FAIL.
- [ ] **Step 3: Implement** os repositórios.
- [ ] **Step 4: Run** `pnpm --filter @aj/api test:db && pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): Supabase repositories for tasks, cases, profile, reminders and holidays`.

---

### Task 8: Rotas de tarefas e mapeamento de erros

**Files:**
- Create: `apps/api/src/http-errors.ts`, `apps/api/src/routes/tasks.ts`; Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/tasks.test.ts`, ajuste em `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: `makeTaskUseCases`, `authMiddleware`, os schemas da Task 1.
- Produces:
  - `http-errors.ts`: `class ValidationError extends Error { constructor(readonly issues: unknown) }` e `export function errorResponse(err: unknown): { status: 400 | 404 | 409 | 422 | 500; body: unknown }` — `ValidationError` → 400 `{ error:'entrada_invalida', issues }`; `NotFoundError` → 404 `{ error:'nao_encontrado' }`; `ConflictError` → 409 `{ error: code }`; `InvalidTransitionError` → 409 `{ error:'transicao_invalida', from, to }`; `HoraInvalidaError` → 422 `{ error:'hora_invalida', reason }`; qualquer outro → 500 `{ error:'erro_interno' }` (e só neste caso `app.onError` chama `console.error`).
  - `routes/tasks.ts`: `tasksRoutes(deps: { tasks: ReturnType<typeof makeTaskUseCases> }, auth: MiddlewareHandler): Hono<{ Variables: { userId: string } }>` com `GET /` (query validada por `listTasksQuerySchema`), `POST /` (201 com o `TaskDto`), `GET /:id`, `PATCH /:id`, `DELETE /:id` (204). O `id` precisa ser uuid (senão 404 `nao_encontrado`). `app.ts`: `AppDeps` ganha `tasks`; monta `app.route('/tasks', tasksRoutes(...))`.

- [ ] **Step 1: Write the failing tests** (`app.request`, casos de uso com os fakes, verificador falso `token-ok → u1`): sem token → 401 em todas as rotas; `POST /tasks` válido → 201 com o DTO; corpo inválido → 400 com `issues`; JSON malformado → 400; `GET /tasks?status=pendente,em_andamento&from=2026-10-26` repassa a query já convertida; `GET /tasks/<uuid inexistente>` → 404; `GET /tasks/abc` → 404; `PATCH` de tarefa encerrada → 409 `tarefa_encerrada`; transição inválida → 409 `transicao_invalida`; `POST` com hora inexistente → 422 `hora_invalida` com `reason`; **Review Focus 3:** o `userId` repassado ao caso de uso é o do token mesmo que o corpo traga `userId` ou `user_id`; um erro inesperado → 500 `erro_interno` sem vazar a mensagem.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test` → Expected: FAIL.
- [ ] **Step 3: Implement** conforme as assinaturas; trocar o `onError` atual para usar `errorResponse` (mantendo o `console.error` só no caso 500).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): task routes and error mapping`.

---

### Task 9: Rotas de processos, feriados, configurações, briefing e CORS

**Files:**
- Create: `apps/api/src/routes/{cases,holidays,settings,briefing}.ts`; Modify: `apps/api/src/{app,config}.ts`, `apps/api/src/config.test.ts`, `.env.example`, `README.md`
- Test: `apps/api/src/routes/{cases,holidays,settings,briefing}.test.ts`, ajuste em `app.test.ts`

**Interfaces:**
- Produces: `casesRoutes`, `holidaysRoutes`, `settingsRoutes`, `briefingRoutes` (mesmo formato de `tasksRoutes`). Rotas: `GET/POST /cases`, `GET/PATCH /cases/:id`; `GET/POST /holidays`, `DELETE /holidays/:id`; `GET/PATCH /settings` (o `PATCH` devolve `{ settings, remindersRebuilt, remindersSkipped }`); `GET /briefing` (devolve `BriefingDto`). `AppDeps` ganha `cases`, `holidays`, `settings`, `briefing` e `webOrigin: string`. CORS: `createApp` aplica `cors({ origin: deps.webOrigin, allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET','POST','PATCH','DELETE','OPTIONS'] })` antes das rotas; a resposta ao preflight não exige token. `loadConfig` passa a devolver também `webOrigin` (variável `WEB_ORIGIN`, padrão `http://localhost:3000`) e a porta padrão muda de 3000 para **3001** (o painel usará a 3000).

- [ ] **Step 1: Write the failing tests:** sem token → 401 em todas; `POST /cases` → 201, duplicado → 409 `numero_ja_cadastrado`; `PATCH /cases/:id` com `status: 'arquivado'`; `POST /holidays` → 201, `DELETE` → 204, de outro usuário → 404; `GET /settings` devolve `SettingsDto`; `PATCH /settings` com `timezone: 'Nao/Existe'` → 400; com `uf: 'sp'` → 400; `GET /briefing` devolve as quatro listas; preflight `OPTIONS /tasks` com `Origin` igual ao `webOrigin` → 204 com `access-control-allow-origin` igual ao `webOrigin`, e com outra origem a resposta **não** traz `access-control-allow-origin`; `loadConfig` com `WEB_ORIGIN` ausente → `http://localhost:3000` e porta padrão `3001`.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test` → Expected: FAIL.
- [ ] **Step 3: Implement**; atualizar `.env.example` (`WEB_ORIGIN`, sem valor) e o README (porta 3001 e rotas).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): case, holiday, settings and briefing routes with CORS`.

---

### Task 10: Montagem real e teste ponta a ponta contra o Supabase local

**Files:**
- Modify: `apps/api/src/server.ts`; Test: `apps/api/test/db/api.db.test.ts`

**Interfaces:**
- Consumes: tudo acima. `server.ts` constrói o cliente de serviço, os repositórios, os casos de uso (com `Clock` real `{ now: () => new Date() }`) e passa tudo a `createApp`. Para o teste, o mesmo montador recebe um `Clock` fixo (extrair a montagem para `buildApp(config, overrides?: { clock?: Clock })` em `apps/api/src/compose.ts`, usado por `server.ts` e pelo teste).

- [ ] **Step 1: Write the failing test** (usa tokens reais de dois usuários A e B, `clock` fixo em `2026-10-26T12:00:00Z`, consulta `reminders` direto pelo cliente de serviço):
  - A faz `POST /tasks` `{ title:'Contestação', dueDate:'2026-10-30', fatal:true }` → 201 e `reminders` tem 3 linhas `pendente` para a tarefa, nos instantes esperados;
  - `PATCH` mudando `dueDate` para `2026-11-04` → as linhas são trocadas (sem sobras); `PATCH status:'concluida'` → 0 linhas pendentes; `PATCH status:'pendente'` → voltam;
  - `DELETE` → 204, `GET /tasks/:id` → 404 e 0 lembretes;
  - `POST /tasks` com `deadline` (15 úteis a partir de 2026-10-26) devolve `dueDate '2026-11-17'`; depois de A cadastrar `POST /holidays` em 2026-11-05, o mesmo cálculo devolve `2026-11-18`;
  - hora inexistente (`PATCH /settings` para `America/New_York`, depois `POST /tasks` com `dueDate '2026-03-08'`, `dueTime '02:30'`) → 422 `hora_invalida` e `GET /tasks` não lista essa tarefa; **Review Focus 1 e 5**;
  - **Review Focus 3, ponta a ponta:** B recebe 404 em `GET/PATCH/DELETE /tasks/<id de A>`, em `PATCH /cases/<id de A>` e em `DELETE /holidays/<id de A>`; `POST /tasks` de B com `caseId` de A → 404 `nao_encontrado`; `GET /tasks`, `/cases`, `/holidays` e `/briefing` de B não contêm nada de A;
  - `dueTime` volta como `'09:00'` no JSON; `GET /briefing` usa o dia do fuso do usuário;
  - limpeza: os usuários criados são removidos e não sobra linha em `auth.users`.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test:db` → Expected: FAIL até a montagem existir.
- [ ] **Step 3: Implement** `compose.ts` e ajustar `server.ts`; corrigir na infraestrutura o que o teste apontar, sem mudar as portas.
- [ ] **Step 4: Run** `pnpm --filter @aj/api test:db && pnpm test && pnpm typecheck` → Expected: PASS em todos.
- [ ] **Step 5: Commit** `feat(api): compose real app and end-to-end tests against local Supabase`.

---

## Resultado ao final do Plano 2

Com o Supabase local ligado e `pnpm --filter @aj/api dev`, um usuário autenticado cria, lista, edita, conclui e apaga tarefas e processos, cadastra feriados locais, ajusta suas configurações e lê o briefing do dia, e a tabela `reminders` acompanha cada mudança. O painel (Plano 3) só precisa consumir essas rotas.
