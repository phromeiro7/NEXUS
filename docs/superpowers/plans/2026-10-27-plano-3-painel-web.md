# Painel Web (Plano 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel Next.js que usa a API do Plano 2: login, visões Dia/Semana/Mês, status com um clique, criação/edição/exclusão de tarefas, calculadora de prazos, histórico e configurações (com feriados locais). Produto já usável sem IA.

**Architecture:** `apps/web` só tem interface; toda regra de negócio fica na API. O front autentica no Supabase Auth (somente login) e chama a API com o token, usando um cliente tipado sobre `@aj/shared`. Lógica de datas e de agrupamento de tarefas vive em funções puras (`lib/`) testadas com Vitest; telas são finas e usam TanStack Query. A autenticação é do lado do cliente (sem SSR de dados).

**Tech Stack:** Next.js (App Router, última versão estável), React, TypeScript strict, Tailwind CSS, TanStack Query, `@supabase/supabase-js`, Vitest + Testing Library + jsdom. Sem shadcn/ui nesta etapa (Ruling P3-1).

**Spec:** `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md` (§4.2, §8) e `docs/superpowers/specs/2026-10-26-painel-web-direcao-visual.md`. API: README e `packages/shared`.

## Global Constraints

- O front **não lê nem escreve no banco**; só `supabase.auth.*` e a API (`NEXT_PUBLIC_API_URL`, padrão `http://localhost:3001`). Painel na porta **3000**.
- Variáveis públicas (nomes apenas, sem valores no Git): `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **Nunca** a service role no front.
- Datas são `YYYY-MM-DD` e horas `HH:mm`; "hoje" é a data **no fuso das configurações do usuário**, não a do navegador.
- Textos da interface em português do Brasil. Contratos vêm só de `@aj/shared` (nenhum tipo duplicado no front).
- Estados nunca dependem só de cor: atraso, fatal, audiência e concluída têm texto ou ícone com rótulo acessível.
- Sem aba/tela de Processos (spec §8). Processo pode aparecer como referência na tarefa; o formulário permite escolher o processo existente.
- Paleta provisória, isolada em tokens CSS (`app/globals.css`) para troca posterior; contraste mínimo AA.
- Sem Realtime: recálculo a cada minuto e recarga ao voltar ao foco; contagem de pendências no título da aba.
- Responsivo desde o início (largura mínima 360 px, sem rolagem horizontal da página).
- Pacotes de terceiros: versões exatas gravadas no lockfile; nada de `latest` sem lockfile.

## Review Focus

1. "Hoje" calculado no fuso das configurações (usuário em outro fuso que o navegador; virada de dia com a aba aberta).
2. Tarefa só com data (sem hora) visualmente distinta da que tem hora; ordenação por hora com as sem hora depois.
3. Troca de status otimista: falha da API (409 `transicao_invalida`, 404, rede) desfaz a tela e mostra a mensagem; duplo clique não envia duas vezes.
4. Token expirado ou 401: volta ao login uma vez, sem laço de redirecionamentos, e preserva o destino.
5. Grades de semana e mês corretas na virada de ano, fevereiro bissexto e mês que começa no domingo.
6. Salvar configurações com `skipped` não vazio avisa quais tarefas mantiveram os lembretes antigos.
7. Erros 400/422 da API (`entrada_invalida`, `hora_invalida`) aparecem junto ao campo/formulário, sem perder o que o usuário digitou.

---

## File Structure

```
apps/web/
  package.json, tsconfig.json, next.config.ts, vitest.config.ts, postcss.config.mjs
  app/layout.tsx, app/globals.css, app/providers.tsx
  app/(auth)/entrar/page.tsx, cadastro/page.tsx, recuperar/page.tsx
  app/(app)/layout.tsx          # guarda de autenticação + casca (navegação)
  app/(app)/page.tsx            # Painel (Dia/Semana/Mês)
  app/(app)/historico/page.tsx
  app/(app)/configuracoes/page.tsx
  lib/dates.ts, lib/tasks-view.ts, lib/api.ts, lib/supabase.ts, lib/messages.ts
  hooks/queries.ts, hooks/use-today.ts, hooks/use-tab-title.ts
  components/…                  # TaskRow, StatusChip, DayView, WeekView, MonthView, TaskForm, DeadlineCalculator, SettingsForm, HolidaysList, AuthGuard, ViewSwitcher
packages/shared/src/task-status.ts   # canTransition movido da API (Task 3)
```

---

### Task 1: Scaffold de `apps/web`

**Files:**
- Create: `apps/web/{package.json,tsconfig.json,next.config.ts,vitest.config.ts,postcss.config.mjs}`, `apps/web/app/{layout.tsx,page.tsx,globals.css}`, `apps/web/test/setup.ts`, `apps/web/app/smoke.test.tsx`
- Modify: `.env.example` (nomes `NEXT_PUBLIC_*`, sem valores), `README.md` (seção Painel), `package.json` raiz (sem mudança de scripts: `pnpm -r` já cobre)

**Interfaces:**
- Produces: workspace `@aj/web` com scripts `dev` (porta 3000), `build`, `test`, `typecheck`; `transpilePackages: ['@aj/shared']`; tokens CSS `--color-*` em `globals.css`; ambiente de teste jsdom com Testing Library e `@testing-library/jest-dom`.

- [ ] **Step 1: Write the failing test** — `app/smoke.test.tsx` renderiza `<Home />` e espera o texto "Assistente Jurídico" (RED: pacote e página não existem).
- [ ] **Step 2: Run** `pnpm --filter @aj/web test` → falha por módulo ausente.
- [ ] **Step 3: Scaffold** manualmente (sem `create-next-app` interativo): dependências `next react react-dom @aj/shared@workspace:* @tanstack/react-query @supabase/supabase-js zod`; dev `tailwindcss @tailwindcss/postcss typescript vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @vitejs/plugin-react @types/react @types/react-dom`. `tsconfig` estende `../../tsconfig.base.json` com `jsx: preserve`, `lib: [dom, dom.iterable, es2022]`, `types: [node, vitest/globals]`, alias `@/*` → raiz do app. Tokens: fundo, superfície, texto, borda, destaque, atraso, fatal, sucesso, cada um com versão clara e escura via `prefers-color-scheme`.
- [ ] **Step 4: Run** `pnpm --filter @aj/web test` e `pnpm typecheck` e `pnpm --filter @aj/web build` → verdes.
- [ ] **Step 5: Commit** `feat(web): scaffold Next.js app with Tailwind and Vitest`

---

### Task 2: Datas e grades de calendário (`lib/dates.ts`, puro)

**Files:**
- Create: `apps/web/lib/dates.ts`, `apps/web/lib/dates.test.ts`

**Interfaces:**
- Produces (todas puras, sem `Date` local do navegador para decidir o dia):
  - `todayIn(timeZone: string, now: Date): IsoDate`
  - `addDays(date: IsoDate, n: number): IsoDate`
  - `weekRange(date: IsoDate): { from: IsoDate; to: IsoDate }` (segunda a domingo)
  - `monthGrid(year: number, month: number): IsoDate[][]` (semanas segunda→domingo, só as necessárias, 4–6 linhas; dias fora do mês incluídos)
  - `monthRange(year: number, month: number): { from: IsoDate; to: IsoDate }` (primeiro e último dia do mês)
  - `formatLongDate(date: IsoDate): string` (ex.: "segunda-feira, 26 de outubro de 2026"), `formatShort(date)` ("26/10")
  - `daysBetween(a: IsoDate, b: IsoDate): number`

- [ ] **Step 1: Write the failing tests** (nomes e asserções exatas):
  - `todayIn('America/Sao_Paulo', new Date('2026-10-27T02:30:00Z')) === '2026-10-26'`; `todayIn('Asia/Tokyo', same) === '2026-10-27'`; fuso inválido lança erro.
  - `addDays('2026-12-31', 1) === '2027-01-01'`; `addDays('2028-02-28', 1) === '2028-02-29'`; `addDays('2026-03-01', -1) === '2026-02-28'`.
  - `weekRange('2026-10-25')` (domingo) → `{ from: '2026-10-19', to: '2026-10-25' }`; `weekRange('2026-12-30')` → `{ from: '2026-12-28', to: '2027-01-03' }`.
  - `monthGrid(2026, 2)` (fev/2026 começa no domingo) → 5 linhas, primeira linha começa em `2026-01-26`, última termina em `2026-03-01`; `monthGrid(2028, 2)` contém `2028-02-29`; todas as linhas têm 7 dias consecutivos.
  - `daysBetween('2026-10-26','2026-10-29') === 3`, negativo quando inverte.
- [ ] **Step 2: Run** `pnpm --filter @aj/web test lib/dates` → FAIL.
- [ ] **Step 3: Implement** em UTC puro sobre `Date.UTC`; `todayIn` com `Intl.DateTimeFormat('en-CA', { timeZone })`.
- [ ] **Step 4: Run** → PASS; `pnpm typecheck`.
- [ ] **Step 5: Commit** `feat(web): calendar and time-zone date helpers`

---

### Task 3: Agrupamento e apresentação de tarefas (`lib/tasks-view.ts`, puro) e `canTransition` no shared

**Files:**
- Create: `packages/shared/src/task-status.ts` (+ teste), `apps/web/lib/tasks-view.ts`, `apps/web/lib/tasks-view.test.ts`
- Modify: `packages/shared/src/index.ts` (exporta), `apps/api/src/domain/task-status.ts` (importa `canTransition` e a tabela do shared, mantendo `applyStatusChange` e `InvalidTransitionError` na API; testes da API continuam verdes)

**Interfaces:**
- Produces em `@aj/shared`: `canTransition(from: TaskStatus, to: TaskStatus): boolean`, `nextStatuses(from: TaskStatus): readonly TaskStatus[]` (mesma tabela da API).
- Produces em `lib/tasks-view.ts`:
  - `groupDay(tasks: TaskDto[], today: IsoDate): { overdue: TaskDto[]; fatalToday: TaskDto[]; timed: TaskDto[]; dateOnly: TaskDto[]; undated: TaskDto[] }` — considera só abertas (`pendente`/`em_andamento`); `overdue` ordenada por data e hora; `fatalToday` = vence hoje e `fatal`; `timed` = vence hoje com hora, por hora, sem repetir fatais; `dateOnly` = vence hoje sem hora, sem repetir fatais.
  - `groupWeek(tasks, from: IsoDate): Array<{ date: IsoDate; tasks: TaskDto[] }>` (7 colunas, cada uma ordenada: com hora por hora, depois sem hora; fatais marcadas pelo `fatal` da tarefa).
  - `countByDay(tasks): Record<IsoDate, { total: number; fatal: number }>` (só abertas).
  - `urgencyLabel(task, today): string` — `"atrasada há 2 dias"`, `"vence hoje"`, `"vence amanhã"`, `"em 5 dias"`, `"sem data"`, `"concluída"`, `"cancelada"`.
  - `pendingCount(tasks, today): number` = abertas com `dueDate <= today` (atrasadas + hoje), usada no título da aba.
  - `groupHistory(tasks): Array<{ day: IsoDate; tasks: TaskDto[] }>` — concluídas agrupadas pelo dia de `completedAt` convertido para o fuso informado (parâmetro `timeZone`), dias do mais recente ao mais antigo; canceladas incluídas só com `includeCancelled`.

- [ ] **Step 1: Write the failing tests** (exatos): atrasada de ontem em `overdue`; fatal de hoje aparece em `fatalToday` e **não** em `timed`/`dateOnly`; hoje 09:00 antes de 14:00; sem hora depois das com hora no semanal; tarefa concluída de hoje fora de todos os grupos; `urgencyLabel` para -2, 0, +1, +5, `null`, concluída; `groupHistory` com `completedAt: '2026-10-27T02:30:00Z'` e fuso `America/Sao_Paulo` cai em `2026-10-26`; `canTransition('concluida','em_andamento') === false`, `canTransition('concluida','pendente') === true`; teste da API de transições segue passando.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Mover a tabela `ALLOWED` para o shared; a API importa de lá.
- [ ] **Step 4: Run** `pnpm test` (todos os pacotes) e `pnpm typecheck` → verdes.
- [ ] **Step 5: Commit** `feat(web): task grouping helpers; share status transitions`

---

### Task 4: Cliente tipado da API (`lib/api.ts`)

**Files:**
- Create: `apps/web/lib/api.ts`, `apps/web/lib/api.test.ts`, `apps/web/lib/messages.ts`, `apps/web/lib/messages.test.ts`

**Interfaces:**
- Produces:
  - `class ApiError extends Error { status: number; code: string; body: unknown }`
  - `createApiClient(opts: { baseUrl: string; getToken: () => Promise<string | null>; onUnauthorized: () => void; fetch?: typeof fetch })` com métodos: `me()`, `listTasks(query: ListTasksQuery)`, `getTask(id)`, `createTask(input: CreateTaskInput)`, `updateTask(id, input: UpdateTaskInput)`, `deleteTask(id)`, `listCases(status?)`, `calculateDeadline(input: DeadlineRule)`, `getSettings()`, `updateSettings(input): Promise<UpdateSettingsResultDto>`, `listHolidays()`, `createHoliday(input)`, `deleteHoliday(id)`, `getBriefing()`. Tipos de retorno vêm de `@aj/shared`.
  - Serializa `ListTasksQuery` na query string (`status` como lista separada por vírgula, `withoutDate=true`).
  - `messageFor(error: unknown): string` em `messages.ts`: mapeia `entrada_invalida` → "Confira os campos destacados.", `nao_encontrado` → "Não encontramos este item. Atualize a página.", `transicao_invalida` → "Esta mudança de status não é permitida.", `tarefa_encerrada` → "A tarefa já está encerrada.", `numero_ja_cadastrado`, `feriado_ja_cadastrado` → "Este feriado já está cadastrado.", `hora_invalida` com `reason` `hora_inexistente`/`hora_ambigua` → mensagens distintas, `corpo_muito_grande`, falha de rede → "Sem conexão com o servidor.", desconhecido → "Algo deu errado. Tente novamente."

- [ ] **Step 1: Write the failing tests** com `fetch` falso: envia `Authorization: Bearer <token>` e `Content-Type: application/json` só quando há corpo; `listTasks({ status: ['pendente','em_andamento'], withoutDate: true })` chama `/tasks?status=pendente%2Cem_andamento&withoutDate=true` (ordem estável); 204 do `deleteTask` não tenta ler JSON; resposta 4xx vira `ApiError` com `status` e `code` de `{ error }`; 401 chama `onUnauthorized` **uma vez** e lança `ApiError`; token nulo chama `onUnauthorized` sem fazer a requisição; falha de rede vira `ApiError` com `status: 0` e `code: 'rede'`; `messageFor` para cada código acima (asserção exata do texto).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Um único helper `request<T>(method, path, body?)`; sem retry automático.
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(web): typed API client and error messages`

---

### Task 5: Autenticação (Supabase Auth) e guarda de rota

**Files:**
- Create: `apps/web/lib/supabase.ts`, `apps/web/components/auth-provider.tsx`, `apps/web/components/auth-guard.tsx`, `apps/web/app/(auth)/{entrar,cadastro,recuperar}/page.tsx`, `apps/web/app/(app)/layout.tsx`, `apps/web/app/providers.tsx`; testes `auth-guard.test.tsx`, `entrar.test.tsx`

**Interfaces:**
- Consumes: `createApiClient` (Task 4).
- Produces: `useAuth(): { status: 'loading' | 'signedIn' | 'signedOut'; signIn(email, password); signUp(email, password); sendReset(email); signOut(); getToken(): Promise<string|null> }`; `useApi()` devolve o cliente já ligado a `getToken` e a `onUnauthorized` (que faz `signOut` local e redireciona para `/entrar?next=<rota>` **uma vez**). `AuthGuard` mostra carregando, redireciona se `signedOut`, renderiza filhos se `signedIn`. Falta de variável `NEXT_PUBLIC_*` gera erro claro na inicialização, nunca chave embutida.

- [ ] **Step 1: Write the failing tests** (Supabase mockado por injeção, sem rede): guarda com `signedOut` → `router.replace('/entrar?next=%2F')`; `loading` não redireciona nem renderiza filhos; `signedIn` renderiza; login com credenciais erradas mostra "E-mail ou senha incorretos." e mantém o e-mail digitado; cadastro valida senha mínima de 8 caracteres antes de chamar o Supabase; `onUnauthorized` chamado duas vezes seguidas redireciona uma só vez; `next` só aceita caminho interno iniciado por `/` (rejeita `//evil.com` e `https://…`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Sessão do `supabase-js` no navegador; sem `@supabase/ssr`. Páginas de auth em português, rótulos e `autocomplete` corretos, botão desabilitado durante o envio.
- [ ] **Step 4: Run** testes e `pnpm --filter @aj/web build`.
- [ ] **Step 5: Commit** `feat(web): Supabase Auth screens and route guard`

---

### Task 6: Casca do app, consultas e relógio ("hoje")

**Files:**
- Create: `apps/web/hooks/queries.ts`, `use-today.ts`, `use-tab-title.ts`, `apps/web/components/app-shell.tsx`; testes `use-today.test.tsx`, `use-tab-title.test.tsx`, `queries.test.tsx`

**Interfaces:**
- Produces: chaves de consulta estáveis (`['tasks', query]`, `['settings']`, `['briefing']`, `['holidays']`, `['cases']`); hooks `useSettings()`, `useTasks(query)`, `useBriefing()`, `useUpdateTask()`, `useCreateTask()`, `useDeleteTask()` (mutações invalidam `['tasks']` e `['briefing']`); `useToday(): IsoDate` usa o fuso de `useSettings()` e atualiza a cada 60 s e quando a aba volta ao foco; `useTabTitle(count: number)` define `document.title` como `"(3) Assistente Jurídico"` (sem prefixo quando 0). `AppShell`: navegação Painel / Histórico / Configurações, botão sair, área reservada para a barra de comando (Plano 4); `QueryClient` com `refetchOnWindowFocus` e `staleTime` de 30 s.

- [ ] **Step 1: Write the failing tests** (timers falsos): `useToday` troca de `2026-10-26` para `2026-10-27` quando o relógio passa da meia-noite **no fuso configurado** (usar `America/Sao_Paulo` com instante `2026-10-27T02:59:00Z` → `03:00:00Z`) sem recarregar; volta ao foco recalcula; `useTabTitle(3)` → `"(3) Assistente Jurídico"`, `useTabTitle(0)` → `"Assistente Jurídico"` e restaura ao desmontar; mutação bem-sucedida invalida `['tasks']` e `['briefing']`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(web): app shell, query hooks and zone-aware clock`

---

### Task 7: Painel — visão Dia, linha de tarefa e chip de status

**Files:**
- Create: `apps/web/components/{task-row.tsx,status-chip.tsx,day-view.tsx,summary-aside.tsx,view-switcher.tsx}`, `apps/web/app/(app)/page.tsx`; testes `status-chip.test.tsx`, `task-row.test.tsx`, `day-view.test.tsx`

**Interfaces:**
- Consumes: `groupDay`, `urgencyLabel`, `nextStatuses`, `useUpdateTask`, `useToday`.
- Produces: `StatusChip({ task, onChange })` — um clique abre as próximas opções válidas (`nextStatuses`) e, para o fluxo mais comum, há ação direta "Concluir"; `TaskRow({ task, today })` mostra título, rótulo de tipo ("Prazo", "Tarefa", "Audiência"), **horário `HH:mm` quando existe e "Dia inteiro" quando não**, marca "Fatal" com texto, rótulo de urgência e referência do processo quando houver; `DayView` com seções na ordem: Atrasadas, Fatais de hoje, Com horário, Demais de hoje, Sem data; `SummaryAside` destaca prazo mais urgente, próxima audiência e quantidade atrasada (dados de `GET /briefing`); `ViewSwitcher` Dia/Semana/Mês (estado na URL `?v=`).

- [ ] **Step 1: Write the failing tests:** seções aparecem na ordem especificada e seção vazia some; `TaskRow` com `dueTime: '14:30'` mostra "14:30" e sem hora mostra "Dia inteiro"; fatal mostra o texto "Fatal"; clique em "Concluir" chama `updateTask(id, { status: 'concluida' })` e a linha sai de "Atrasadas" **antes** da resposta (otimista); resposta 409 restaura a linha e mostra `messageFor`; dois cliques rápidos geram **uma** chamada; chip não oferece `concluida → em_andamento`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** a mutação otimista com `onMutate` (snapshot), `onError` (restaura), `onSettled` (invalida). Botões com `aria-label` descritivo.
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(web): day view with status chip`

---

### Task 8: Visões Semana e Mês

**Files:**
- Create: `apps/web/components/{week-view.tsx,month-view.tsx}`; testes `week-view.test.tsx`, `month-view.test.tsx`; modify `app/(app)/page.tsx` e `view-switcher.tsx`

**Interfaces:**
- Consumes: `weekRange`, `monthGrid`, `monthRange`, `groupWeek`, `countByDay`, `useTasks({ from, to, status })`.
- Produces: `WeekView({ anchor: IsoDate })` com 7 colunas (em tela pequena, lista empilhada por dia), fatais marcadas com texto; `MonthView({ year, month })` com contagem total e de fatais por dia (texto "3 tarefas, 1 fatal", não só cor), dias fora do mês esmaecidos, hoje destacado; clicar em um dia navega para `?v=dia&d=YYYY-MM-DD`; setas e "Hoje" para navegar entre períodos.

- [ ] **Step 1: Write the failing tests:** semana de `2026-12-28` mostra 7 colunas terminando em `2027-01-03` e posiciona uma tarefa de `2027-01-01` na coluna certa; mês fev/2026 renderiza 5 linhas e a contagem "2 tarefas, 1 fatal" em `2026-02-10`; clicar no dia chama navegação com a data; "Hoje" volta ao período que contém `today`; consulta usa `from`/`to` do período e só status abertos.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(web): week and month views`

---

### Task 9: Criar, editar e excluir tarefas (formulário e adição rápida)

**Files:**
- Create: `apps/web/components/{task-form.tsx,quick-add.tsx,confirm-dialog.tsx}`; testes `task-form.test.tsx`, `quick-add.test.tsx`

**Interfaces:**
- Consumes: `createTaskInputSchema`/`updateTaskInputSchema` (validação do mesmo schema da API), `useCreateTask`, `useUpdateTask`, `useDeleteTask`, `listCases`.
- Produces: `TaskForm({ task?: TaskDto; onDone })` com título, tipo, data, hora (desabilitada sem data), fatal, processo (select dos ativos, opcional) e **modo "calcular prazo"**: data base + dias + úteis/corridos, que envia `deadline` em vez de `dueDate` e mostra a data resultante e os feriados descontados via `calculateDeadline` antes de salvar; `QuickAdd` — campo compacto no topo do Painel: título + (opcional) data, cria `tarefa` e mantém o foco; excluir exige confirmação (diálogo nativo `<dialog>` acessível).

- [ ] **Step 1: Write the failing tests:** título vazio bloqueia o envio e mostra o erro no campo; hora sem data mantém o campo desabilitado; erro 422 `hora_invalida` mostra a mensagem **sem limpar** os campos; modo prazo envia `deadline` e **não** `dueDate`; editar envia só os campos alterados; excluir só chama a API após confirmar; `QuickAdd` limpa o campo e devolve o foco após sucesso, mantém o texto em caso de erro; envio duplo bloqueado enquanto pendente.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `feat(web): task form, quick add and delete`

---

### Task 10: Calculadora de prazos

**Files:**
- Create: `apps/web/components/deadline-calculator.tsx`, `apps/web/app/(app)/calculadora/page.tsx`; teste `deadline-calculator.test.tsx`; modify `app-shell.tsx` (link)

**Interfaces:**
- Consumes: `calculateDeadline`, `CalculateDeadlineResultDto`.
- Produces: formulário (data da publicação, dias 1–365, úteis/corridos) que mostra a data final, se houve prorrogação para o próximo dia útil e a lista de feriados descontados (nome ou data); botão "Criar tarefa com este prazo" abre o `TaskForm` já preenchido em modo prazo. Aviso fixo: "Confira sempre a contagem no tribunal; feriados locais dependem do seu cadastro."

- [ ] **Step 1: Write the failing tests:** envia `{ baseDate, days, countType }` exatos; mostra `feriadosDescontados` do resultado; "prorrogado" exibe o texto correspondente; dias 0 ou 366 bloqueiam o envio; erro da API aparece sem apagar o formulário.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): deadline calculator`

---

### Task 11: Histórico

**Files:**
- Create: `apps/web/app/(app)/historico/page.tsx`, `apps/web/components/history-view.tsx`; teste `history-view.test.tsx`

**Interfaces:**
- Consumes: `groupHistory`, `useTasks({ status: ['concluida'] })` (e `cancelada` com o filtro).
- Produces: concluídas agrupadas pelo dia da conclusão no fuso do usuário, mais recentes primeiro; caixa "Incluir canceladas"; "Reabrir" volta a `pendente` (usa `nextStatuses`); lista vazia com mensagem amigável.

- [ ] **Step 1: Write the failing tests:** agrupamento por dia no fuso (instante `2026-10-27T02:30:00Z` cai em 26/10 em São Paulo); canceladas só com o filtro ligado; reabrir envia `{ status: 'pendente' }` e remove o item da lista; estado vazio.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): history view`

---

### Task 12: Configurações e feriados locais

**Files:**
- Create: `apps/web/app/(app)/configuracoes/page.tsx`, `apps/web/components/{settings-form.tsx,holidays-list.tsx}`; testes `settings-form.test.tsx`, `holidays-list.test.tsx`

**Interfaces:**
- Consumes: `updateSettingsInputSchema`, `UpdateSettingsResultDto`, `HolidayDto`, `createHolidayInputSchema`.
- Produces: formulário de fuso (lista de fusos de `Intl.supportedValuesOf('timeZone')`, padrão `America/Sao_Paulo`), UF (lista das 27), cidade, antecedência dos lembretes (minutos 0–1440) e hora do briefing; envia **somente os campos alterados**; resposta com `skipped` não vazio mostra aviso listando título e motivo ("a hora não existe neste fuso" / "a hora é ambígua") e que essas tarefas mantiveram os lembretes anteriores; sucesso mostra quantos lembretes foram refeitos; `HolidaysList` lista, cadastra (data, escopo estadual/municipal, nome) e remove, com erro `feriado_ja_cadastrado` junto ao formulário; seção Telegram mostra o estado (`telegramLinked`) e "Vínculo disponível em breve" (Plano 5).

- [ ] **Step 1: Write the failing tests:** alterar só a cidade envia `{ city }` e nada mais; mudar o fuso envia `{ timezone }`; resposta com `skipped: [{ id, title: 'Audiência X', reason: 'hora_inexistente' }]` exibe "Audiência X" e o aviso; fuso inválido bloqueia o envio; cadastro de feriado com data e nome; duplicado (409) mostra "Este feriado já está cadastrado."; remover pede confirmação.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): settings and local holidays`

---

### Task 13: Responsividade, acessibilidade, documentação e verificação ponta a ponta

**Files:**
- Modify: `apps/web/**` (ajustes de layout), `README.md` (seção "Painel": variáveis, `pnpm --filter @aj/web dev`, ordem para subir Supabase + API + painel), `docs/superpowers/specs/2026-10-26-painel-web-direcao-visual.md` (registrar paleta ainda provisória e o que foi implementado)

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Write the failing tests:** teste de contrato "nenhum arquivo de `apps/web` importa `supabase.from(`/`.rpc(`" (varredura de texto: front não acessa o banco); teste de que o app falha com mensagem clara se `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_SUPABASE_*` faltarem; varredura de que nenhum arquivo versionado contém `service_role`.
- [ ] **Step 2: Run** → FAIL (exceto o que já existir). **Step 3: Implement** os ajustes; revisão manual em 360 px, 768 px e 1280 px (sem rolagem horizontal; alvos de toque ≥ 40 px; foco visível; rótulos em campos e botões).
- [ ] **Step 4: Verificação ponta a ponta manual**, registrada no relatório da tarefa: subir Supabase local (portas 553xx), API (3001) e painel (3000); criar conta, entrar, criar tarefa com e sem hora, concluir, ver nas três visões, calcular prazo, cadastrar feriado, mudar o fuso e ver o aviso `skipped` quando houver. Confirmar CORS (`WEB_ORIGIN=http://localhost:3000`).
- [ ] **Step 5: Run** `pnpm test`, `pnpm typecheck`, `pnpm --filter @aj/web build` → verdes. **Commit** `docs(web): panel setup and final checks`

---

## Rulings deste plano (decididos aqui; contestáveis)

- **P3-1:** sem shadcn/ui agora (o CLI é interativo e a paleta é provisória); componentes próprios com Tailwind e `<dialog>` nativo. Custo se errado: trocar por shadcn depois na etapa de acabamento (Plano 6), componente a componente.
- **P3-2:** autenticação só no cliente (`supabase-js`), sem `@supabase/ssr`/middleware, pois o painel não renderiza dados no servidor. Custo se errado: adicionar middleware depois sem mudar a API.
- **P3-3:** barra de comando (Ctrl/Cmd+K) e briefing em texto ficam no Plano 4; a casca só reserva o espaço.
- **P3-4:** histórico filtra no cliente (sem paginação na API ainda; item já adiado). Aceitável para um usuário; revisar se o volume crescer.
- **P3-5:** testes de componentes com Testing Library; navegador real/E2E automatizado fica no Plano 6.
