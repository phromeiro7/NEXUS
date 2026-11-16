# Plano 1 — Fundação e Domínio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo funcionando com banco (migrações + RLS), domínio jurídico testado (calculadora de prazos, status, lembretes) e uma API autenticada que já expõe a calculadora de prazos.

**Architecture:** Monorepo pnpm em TypeScript. `packages/shared` guarda contratos Zod e funções puras usadas pelo front e pelo back. `apps/api` (Hono) segue as camadas da spec: interface → aplicação → domínio, com infraestrutura atrás de portas. O banco é o Supabase local (Docker) com RLS.

**Tech Stack:** pnpm workspaces, TypeScript (strict, ESM), Vitest, Zod, Hono + `@hono/node-server`, `@supabase/supabase-js`, Supabase CLI, `pg` (só em testes), `tsx`.

**Spec:** `docs/archive/planejamento/specs/2026-10-26-assistente-juridico-design.md`

**Este plano é o 1 de 5.** Os próximos, escritos quando este terminar: 2) painel Next.js com login e CRUD; 3) assistente (ciclo de ferramentas e briefing); 4) Telegram, lembretes e agendador; 5) acabamento e avaliação da IA. O **login (tela)** sai da etapa 1 da spec e vai para o Plano 2, porque depende do painel; aqui o login é coberto no lado da API (verificação de token).

## Global Constraints

- Fuso padrão `America/Sao_Paulo`, configurável por usuário.
- Prazo é `due_date` (data) + `due_time` opcional. Lembretes guardam instante absoluto (`timestamptz`).
- Status da tarefa: `pendente`, `em_andamento`, `concluida`, `cancelada`. Tipo: `prazo`, `tarefa`, `audiencia`. Exclusão lógica (`deleted_at`).
- Lembretes: prazo só com data → 1 dia antes e no dia às 08h, e 3 dias antes se `fatal`; tarefa com hora → aviso antecipado (padrão 15 min) e aviso no horário; aviso que já ficou no passado é pulado.
- Hora local inexistente ou ambígua por mudança de fuso nunca é convertida em silêncio.
- A IA e o `user_id` nunca vêm do cliente: o `user_id` da API sai do token validado.
- RLS ativo em todas as tabelas; service role só na API; nenhum segredo no Git (`.env.example` sem valores).
- Camadas: domínio não importa banco, Hono nem Supabase.

## Review Focus

1. Prazo que cruza a virada de ano e o dia 29/02 (calendário e feriados do ano seguinte). → Task 4 e Task 10.
2. Data de publicação em sábado, domingo ou feriado. → Task 4.
3. `days` zero, negativo, fracionário ou enorme na calculadora. → Task 2 e Task 9.
4. Perto da meia-noite, o "hoje" do usuário difere do "hoje" do servidor (UTC). → Task 2.
5. Hora que não existe ou repete na mudança de horário de verão. → Task 5.
6. Usuário tenta gravar linha com `user_id` alheio, ou trocar `telegram_chat_id` pelo próprio perfil. → Task 8.

---

## File Structure

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · .gitignore · .env.example
packages/shared/src/{index,primitives,task,deadline,time}.ts (+ *.test.ts)
apps/api/src/domain/{holidays,calendar,deadline,timezone,task-status,reminders}.ts (+ *.test.ts)
apps/api/src/application/{ports,calculate-deadline}.ts (+ test)
apps/api/src/infra/{supabase-auth,supabase-holiday-repository}.ts
apps/api/src/{config,auth,app,server}.ts (+ tests)
apps/api/test/db/{helpers,rls}.ts
supabase/migrations/0001_schema.sql · supabase/migrations/0002_rls.sql
```

---

### Task 1: Monorepo e ferramentas

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.env.example`, `packages/shared/{package.json,tsconfig.json,src/index.ts}`, `apps/api/{package.json,tsconfig.json,vitest.config.ts}`
- Test: `packages/shared/src/index.test.ts`

**Interfaces:**
- Produces: workspaces `@nexus/shared` (exporta o TypeScript direto, `"exports": "./src/index.ts"`) e `@nexus/api`. Scripts na raiz: `test` (unitários, sem banco), `typecheck`. Em `apps/api`: `test:db` (só arquivos `*.db.test.ts` e `test/db/*.test.ts`).

- [ ] **Step 1: Write the failing test** — `packages/shared/src/index.test.ts`: `expect(APP_NAME).toBe('assistente-juridico')`, importando de `./index`.
- [ ] **Step 2: Run** `pnpm install && pnpm --filter @nexus/shared test` → Expected: FAIL (`APP_NAME` não exportado).
- [ ] **Step 3: Scaffold.** TypeScript `strict`, `module ESNext`, `moduleResolution Bundler`, `noUncheckedIndexedAccess`. Dependências: `zod` (shared e api); `hono`, `@hono/node-server`, `@supabase/supabase-js` (api); dev: `vitest`, `typescript`, `tsx`, `pg`, `@types/pg`, `@types/node`, `supabase`. `.gitignore` cobre `node_modules`, `.env`, `.env.local`, `dist`, `supabase/.temp`. `.env.example` lista `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `PORT` sem valores. `export const APP_NAME = 'assistente-juridico'` em `packages/shared/src/index.ts`. `apps/api/vitest.config.ts` exclui `**/*.db.test.ts` e `test/db/**` do `test` padrão.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `chore: scaffold pnpm monorepo`.

---

### Task 2: Contratos e funções puras compartilhadas

**Files:**
- Create: `packages/shared/src/{primitives,task,deadline,time}.ts`; Modify: `index.ts` (reexporta tudo)
- Test: `packages/shared/src/{primitives,deadline,time}.test.ts`

**Interfaces:**
- Produces (`@nexus/shared`):
  - `type IsoDate = string` (`YYYY-MM-DD`); `isoDateSchema: z.ZodType<IsoDate>` que rejeita datas inexistentes.
  - `taskStatusSchema`, `taskTypeSchema`, `countTypeSchema` (`'uteis' | 'corridos'`) e os tipos `TaskStatus`, `TaskType`, `CountType`.
  - `calculateDeadlineInputSchema = z.object({ baseDate: isoDateSchema, days: int 1..365, countType: countTypeSchema })`; `type CalculateDeadlineInput`.
  - `type Holiday = { date: IsoDate; name: string }`.
  - `todayIn(timeZone: string, now: Date): IsoDate`.
  - `classifyTask(task: { status: TaskStatus; dueDate: IsoDate | null }, today: IsoDate): 'atrasada' | 'hoje' | 'futura' | 'sem_data' | 'encerrada'` (`concluida` e `cancelada` → `encerrada`).

- [ ] **Step 1: Write the failing tests**, com estas asserções:
  - `isoDateSchema.safeParse('2026-02-31').success === false`; `'2028-02-29'` válido; `'2027-02-29'` inválido.
  - `calculateDeadlineInputSchema` rejeita `days` = `0`, `-3`, `2.5`, `366`.
  - `todayIn('America/Sao_Paulo', new Date('2026-10-27T01:30:00Z')) === '2026-10-26'` (no UTC já é dia 27).
  - `classifyTask({status:'pendente', dueDate:'2026-10-25'}, '2026-10-26') === 'atrasada'`; mesmo dia → `'hoje'`; dia seguinte → `'futura'`; `dueDate: null` → `'sem_data'`; `status:'concluida'` → `'encerrada'`.
- [ ] **Step 2: Run** `pnpm --filter @nexus/shared test` → Expected: FAIL.
- [ ] **Step 3: Implement** as assinaturas acima. `todayIn` usa `Intl.DateTimeFormat` com o fuso informado.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `feat(shared): add contracts, todayIn and classifyTask`.

---

### Task 3: Feriados nacionais

**Files:**
- Create: `apps/api/src/domain/holidays.ts`; Test: `apps/api/src/domain/holidays.test.ts`

**Interfaces:**
- Consumes: `IsoDate`, `Holiday` de `@nexus/shared`.
- Produces: `easterSunday(year: number): IsoDate`; `nationalHolidays(year: number): Holiday[]` (ordenado por data).

- [ ] **Step 1: Write the failing tests:** `easterSunday(2025) === '2025-04-20'`, `(2026) === '2026-04-05'`, `(2027) === '2027-03-28'`. `nationalHolidays(2026)` contém `'2026-04-03'` (Sexta-feira Santa), `'2026-11-20'` (Consciência Negra), `'2026-11-02'` (Finados) e tem 10 itens.
- [ ] **Step 2: Run** → Expected: FAIL.
- [ ] **Step 3: Implement.** Fixos: 01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 11-20, 12-25; móvel: Sexta-feira Santa (Páscoa − 2 dias). Páscoa pelo algoritmo de Meeus/Jones/Butcher. Carnaval e Corpus Christi **não** entram: são ponto facultativo nacional, e o usuário os cadastra como feriado local do tribunal quando valer.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): national holidays`.

---

### Task 4: Calendário e calculadora de prazos

**Files:**
- Create: `apps/api/src/domain/{calendar,deadline}.ts`; Test: `apps/api/src/domain/{calendar,deadline}.test.ts`

**Interfaces:**
- Consumes: `IsoDate`, `CountType`.
- Produces:
  - `addDays(date: IsoDate, n: number): IsoDate`; `isBusinessDay(date: IsoDate, holidays: ReadonlySet<IsoDate>): boolean`; `nextBusinessDay(date: IsoDate, holidays: ReadonlySet<IsoDate>): IsoDate` (o próprio dia, se útil).
  - `calculateDeadline(input: { baseDate: IsoDate; days: number; countType: CountType; holidays: ReadonlySet<IsoDate> }): { dueDate: IsoDate; prorrogado: boolean; feriadosDescontados: IsoDate[] }`.
- Regra (decisão deste plano, a validar com o advogado do cliente): `baseDate` é a data de publicação; a contagem **exclui** o dia do começo e **inclui** o do vencimento. `uteis`: conta só dias úteis. `corridos`: conta todos os dias e, se o vencimento cair em dia não útil, prorroga para o próximo dia útil (`prorrogado: true`). `feriadosDescontados`: feriados em dia de semana entre `baseDate` (exclusive) e `dueDate` (inclusive). **Fora deste plano:** prazo em dobro, suspensões e recesso forense.

- [ ] **Step 1: Write the failing tests** (feriados de 2026 = Finados `2026-11-02`):
  - `addDays('2028-02-28', 1) === '2028-02-29'`; `addDays('2027-12-31', 1) === '2028-01-01'`.
  - `isBusinessDay('2026-10-31', ∅) === false` (sábado); `isBusinessDay('2026-11-02', {2026-11-02}) === false`.
  - 15 úteis a partir de `2026-10-26` → `dueDate '2026-11-17'`, `feriadosDescontados ['2026-11-02']`, `prorrogado false`.
  - 5 úteis com publicação em sábado `2026-10-31` → `'2026-11-09'`.
  - 3 corridos a partir de `2026-10-28` → cai em sábado, prorroga: `dueDate '2026-11-03'`, `prorrogado true`.
  - 5 úteis a partir de `2027-12-29` → `'2028-01-05'` (virada de ano).
- [ ] **Step 2: Run** → Expected: FAIL.
- [ ] **Step 3: Implement** as assinaturas, com aritmética em UTC sobre as datas (sem `Date` local).
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): business-day calendar and deadline calculator`.

---

### Task 5: Conversão de hora local para instante

**Files:**
- Create: `apps/api/src/domain/timezone.ts`; Test: `apps/api/src/domain/timezone.test.ts`

**Interfaces:**
- Produces: `localToUtc(date: IsoDate, time: string /* HH:mm */, timeZone: string): { ok: true; utc: Date } | { ok: false; reason: 'hora_inexistente' | 'hora_ambigua' }`.

- [ ] **Step 1: Write the failing tests:**
  - `localToUtc('2026-10-27','09:00','America/Sao_Paulo')` → `{ ok: true, utc: 2026-10-27T12:00:00Z }`.
  - `localToUtc('2026-03-08','02:30','America/New_York')` → `{ ok:false, reason:'hora_inexistente' }`.
  - `localToUtc('2026-11-01','01:30','America/New_York')` → `{ ok:false, reason:'hora_ambigua' }`.
  - `localToUtc('2026-11-01','03:00','America/New_York')` → `ok: true`.
- [ ] **Step 2: Run** → Expected: FAIL.
- [ ] **Step 3: Implement** sondando o deslocamento do fuso antes e depois do instante candidato (`Intl.DateTimeFormat`): zero candidatos válidos = inexistente; dois = ambígua.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): timezone-safe local to UTC conversion`.

---

### Task 6: Status e geração de lembretes

**Files:**
- Create: `apps/api/src/domain/{task-status,reminders}.ts`; Test: `apps/api/src/domain/{task-status,reminders}.test.ts`

**Interfaces:**
- Consumes: `localToUtc`, `addDays`, `TaskStatus`, `IsoDate`.
- Produces:
  - `class HoraInvalidaError extends Error { reason: 'hora_inexistente' | 'hora_ambigua' }`.
  - `class InvalidTransitionError extends Error`; `canTransition(from: TaskStatus, to: TaskStatus): boolean`; `applyStatusChange(task: { status: TaskStatus; completedAt: Date | null }, to: TaskStatus, now: Date): { status: TaskStatus; completedAt: Date | null }`.
  - `type ReminderKind = 'tres_dias' | 'dia_anterior' | 'no_dia' | 'antecipado' | 'no_horario'`; `type ReminderDraft = { kind: ReminderKind; scheduledAt: Date }`.
  - `buildReminders(input: { dueDate: IsoDate | null; dueTime: string | null; fatal: boolean; timeZone: string; earlyMinutes: number | null; now: Date }): ReminderDraft[]` (ordenado por `scheduledAt`; lança `HoraInvalidaError` com `reason` se a `dueTime` do usuário for inexistente ou ambígua).
- Regras: transições permitidas `pendente → {em_andamento, concluida, cancelada}`, `em_andamento → {pendente, concluida, cancelada}`, `concluida → pendente`, `cancelada → pendente`; qualquer outra lança `InvalidTransitionError`. `completedAt = now` ao entrar em `concluida`, `null` ao sair. O horário-padrão dos lembretes de data é `08:00` local; se cair numa lacuna de horário de verão, usa `09:00`.

- [ ] **Step 1: Write the failing tests.**
  - Status: `canTransition('concluida','em_andamento') === false`; `applyStatusChange({status:'pendente',completedAt:null},'concluida',now).completedAt` é `now`; voltar a `pendente` zera; transição inválida lança `InvalidTransitionError`.
  - Lembretes em `America/Sao_Paulo`, `now = 2026-10-26T12:00:00Z`:
    - só data `2026-10-30`, não fatal → `[dia_anterior 2026-10-29T11:00Z, no_dia 2026-10-30T11:00Z]`.
    - mesma data com `fatal: true` → inclui `tres_dias 2026-10-27T11:00Z` como primeiro item.
    - `dueDate '2026-10-27'` com `dueTime '09:00'`, `earlyMinutes 15` → `[antecipado 2026-10-27T11:45Z, no_horario 2026-10-27T12:00Z]`.
    - `dueDate '2026-10-26'` com `dueTime '09:10'`, `earlyMinutes 15` → só `no_horario` (o antecipado, 11:55Z, já passou).
    - `earlyMinutes: null` → sem `antecipado`; `dueDate: null` → `[]`.
- [ ] **Step 2: Run** → Expected: FAIL.
- [ ] **Step 3: Implement** as assinaturas acima. Descartar todo rascunho com `scheduledAt <= now`.
- [ ] **Step 4: Run** → Expected: PASS.
- [ ] **Step 5: Commit** `feat(domain): task status rules and reminder generation`.

---

### Task 7: Supabase local e esquema do banco

**Files:**
- Create: `supabase/config.toml` (via `pnpm exec supabase init`), `supabase/migrations/0001_schema.sql`
- Test: `apps/api/test/db/schema.test.ts` (usa `pg` com `DATABASE_URL`)

**Interfaces:**
- Produces (tabelas, tipos de texto com `check` em vez de enums; todas com `created_at timestamptz default now()`):
  - `profiles(id uuid pk → auth.users on delete cascade, timezone text default 'America/Sao_Paulo', uf text, city text, early_reminder_minutes int default 15, briefing_time time default '08:00', last_briefing_sent_on date, telegram_chat_id bigint unique, channel_paused boolean default false)` + trigger que cria o perfil quando nasce um `auth.users`.
  - `cases(id, user_id, number text, client_name text, description text, status check in ('ativo','arquivado') default 'ativo', updated_at; unique(user_id, number))`.
  - `tasks(id, user_id, case_id → cases on delete set null, title text check 1..200, type, status default 'pendente', due_date date, due_time time, fatal boolean default false, source check in ('painel','telegram'), source_text, base_date date, period_days int, count_type, completed_at, deleted_at, updated_at; check(due_time is null or due_date is not null))` + índice `(user_id, status, due_date) where deleted_at is null`.
  - `reminders(id, user_id, task_id → tasks on delete cascade, kind, scheduled_at timestamptz, status check in ('pendente','enviando','enviado','falhou','cancelado') default 'pendente', attempts int default 0, last_error, sent_at, locked_at)` + índice `(status, scheduled_at)`.
  - `holidays(id, user_id, date, scope check in ('estadual','municipal'), name; unique(user_id, date))`.
  - `inbound_events(id, channel, external_id, user_id, status, received_at, processed_at, attempt_count; unique(channel, external_id))`.
  - `chat_messages(id, user_id, channel, role check in ('user','assistant'), content, expires_at default now()+interval '24 hours')`.
  - `link_codes(code pk, user_id, expires_at)`; `task_confirmations(channel, chat_id bigint, message_id bigint, task_id → tasks on delete cascade; pk(channel, chat_id, message_id, task_id))`.
  - trigger `set_updated_at()` em `cases` e `tasks`.

- [ ] **Step 1: Write the failing test** `schema.test.ts`: consulta `information_schema.tables` e espera as 10 tabelas acima; insere duas linhas em `inbound_events` com o mesmo `(channel, external_id)` e espera erro de unicidade; insere task com `due_time` e sem `due_date` e espera erro de check; insere um `auth.users` e espera o `profiles` correspondente com `timezone = 'America/Sao_Paulo'`.
- [ ] **Step 2: Run** `pnpm exec supabase start && pnpm --filter @nexus/api test:db` → Expected: FAIL (tabelas ausentes). Anotar `DATABASE_URL` impresso pelo `supabase start` em `.env`.
- [ ] **Step 3: Write** `0001_schema.sql` conforme acima.
- [ ] **Step 4: Run** `pnpm exec supabase db reset && pnpm --filter @nexus/api test:db` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): initial schema`.

---

### Task 8: RLS e testes de isolamento

**Files:**
- Create: `supabase/migrations/0002_rls.sql`, `apps/api/test/db/helpers.ts`
- Test: `apps/api/test/db/rls.test.ts`

**Interfaces:**
- Produces: `helpers.ts` exporta `createUser(): Promise<string>` (insere em `auth.users` como superusuário) e `asUser<T>(userId: string, fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>): Promise<T>` (transação com `set local role authenticated` e `request.jwt.claims` do usuário, sempre com rollback). `asAnon` análogo.
- Políticas: RLS ligado em todas as tabelas. `authenticated` tem select/insert/update/delete com `user_id = auth.uid()` em `cases`, `tasks`, `holidays`; select em `reminders` (próprios); select em `profiles` (próprio); **update em `profiles` só nas colunas** `timezone, uf, city, early_reminder_minutes, briefing_time` (`revoke update` geral + `grant update (...)`). `inbound_events`, `chat_messages`, `link_codes`, `task_confirmations` sem política para `authenticated` (só service role). `anon` sem acesso a nada.

- [ ] **Step 1: Write the failing tests** (usuários A e B, cada um com uma task e um case):
  - B não enxerga tasks, cases nem profile de A (`select` devolve 0 linhas); B não consegue `update` nem `delete` em linha de A (0 linhas afetadas).
  - B tenta `insert into tasks (user_id = A, ...)` → erro de política.
  - A tenta `update profiles set telegram_chat_id = 123` → erro de permissão; `update profiles set timezone = 'America/Recife'` funciona.
  - A não lê `inbound_events`, `chat_messages`, `link_codes`, `task_confirmations` (erro de permissão); `asAnon` não lê `tasks`.
- [ ] **Step 2: Run** `pnpm --filter @nexus/api test:db` → Expected: FAIL (sem RLS, B vê tudo).
- [ ] **Step 3: Write** `0002_rls.sql`.
- [ ] **Step 4: Run** `pnpm exec supabase db reset && pnpm --filter @nexus/api test:db` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): row level security with isolation tests`.

---

### Task 9: API em camadas, autenticação e rota da calculadora

**Files:**
- Create: `apps/api/src/{config,auth,app,server}.ts`, `apps/api/src/application/{ports,calculate-deadline}.ts`, `apps/api/src/infra/{supabase-auth,supabase-holiday-repository}.ts`
- Test: `apps/api/src/{config,app}.test.ts`, `apps/api/src/application/calculate-deadline.test.ts`

**Interfaces:**
- Consumes: `calculateDeadline`, `nationalHolidays`, `calculateDeadlineInputSchema`, `Holiday`.
- Produces:
  - `loadConfig(env: Record<string, string | undefined>): { supabaseUrl: string; serviceRoleKey: string; port: number }` (lança erro listando as variáveis ausentes).
  - `type AuthVerifier = (token: string) => Promise<{ userId: string } | null>`; `authMiddleware(verify: AuthVerifier): MiddlewareHandler` (lê `Authorization: Bearer`, define `userId` no contexto, senão `401 { error: 'nao_autenticado' }`).
  - `type HolidayRepository = { listByUser(userId: string, from: IsoDate, to: IsoDate): Promise<Holiday[]> }` (em `ports.ts`).
  - `type CalculateDeadlineOutput = { dueDate: IsoDate; prorrogado: boolean; feriadosDescontados: Holiday[] }`; `makeCalculateDeadline(deps: { holidays: HolidayRepository }): (userId: string, input: CalculateDeadlineInput) => Promise<CalculateDeadlineOutput>` — junta `nationalHolidays` dos anos que o prazo pode atravessar (do ano de `baseDate` até `ano + ceil(days / 200) + 1`) com os feriados do usuário.
  - `type AppDeps = { verifyToken: AuthVerifier; calculateDeadline: ReturnType<typeof makeCalculateDeadline> }`; `createApp(deps: AppDeps): Hono` com `GET /health` (público, `{ status: 'ok' }`), `GET /me` (`{ userId }`) e `POST /deadlines/calculate` (corpo validado por `calculateDeadlineInputSchema`; `400 { error: 'entrada_invalida', issues }` se inválido).
  - `createSupabaseAuthVerifier(client: SupabaseClient): AuthVerifier` (usa `client.auth.getUser(token)`); `createSupabaseHolidayRepository(client: SupabaseClient): HolidayRepository`.

- [ ] **Step 1: Write the failing tests** (com `app.request(...)`, repositório em memória e verificador falso que aceita só `'token-ok'` → `{userId:'u1'}`):
  - `loadConfig({})` lança citando `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
  - `GET /health` → 200 sem token; `GET /me` sem token → 401; com `Bearer token-ok` → `{ userId: 'u1' }`.
  - `POST /deadlines/calculate` com `{ baseDate:'2026-10-26', days:15, countType:'uteis' }` → 200 com `dueDate '2026-11-17'` e `feriadosDescontados` com Finados; `days: 0` → 400; `baseDate: '2026-02-31'` → 400.
  - Use case: feriado estadual do usuário (`2026-11-05`) entra na conta (15 úteis → `'2026-11-18'`); prazo de 5 úteis a partir de `2027-12-29` usa os feriados de 2028 (resultado `'2028-01-05'`); o repositório recebe `userId` da chamada, nunca de dentro da entrada.
- [ ] **Step 2: Run** `pnpm --filter @nexus/api test` → Expected: FAIL.
- [ ] **Step 3: Implement** as assinaturas. `server.ts` monta as dependências reais (cliente Supabase com service role) e sobe com `@hono/node-server`; adicionar script `dev` com `tsx watch src/server.ts`.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` → Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): layered Hono app with auth and deadline calculation`.

---

### Task 10: Integração com o Supabase local

**Files:**
- Test: `apps/api/src/infra/supabase.db.test.ts`

**Interfaces:**
- Consumes: `createSupabaseAuthVerifier`, `createSupabaseHolidayRepository`, `createApp`, `makeCalculateDeadline`.

- [ ] **Step 1: Write the failing test** (precisa do Supabase local ligado e `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` do `supabase status`): cria usuário pelo admin do Supabase, faz login e obtém o `access_token`; insere um feriado municipal do usuário em `holidays`. Espera: `createSupabaseAuthVerifier` devolve o `userId` para o token real e `null` para `'lixo'`; `listByUser` devolve só os feriados daquele usuário (não os de outro); `POST /deadlines/calculate` pela app montada com as peças reais, usando o token real, devolve o prazo descontando o feriado; sem token, 401.
- [ ] **Step 2: Run** `pnpm --filter @nexus/api test:db` → Expected: FAIL até as peças reais estarem ligadas corretamente.
- [ ] **Step 3: Fix** o que o teste apontar na infraestrutura (sem mudar as portas).
- [ ] **Step 4: Run** `pnpm --filter @nexus/api test:db && pnpm test` → Expected: PASS em ambos.
- [ ] **Step 5: Commit** `test(api): integration against local Supabase`.

---

## Resultado ao final do Plano 1

`pnpm dev` na API sobe um servidor onde um usuário autenticado chama `POST /deadlines/calculate` e recebe o vencimento em dias úteis com os feriados descontados. O banco tem o esquema completo da spec com RLS testada. O domínio (calendário, prazos, fuso, status, lembretes) está coberto por testes e pronto para os Planos 2 a 4.
