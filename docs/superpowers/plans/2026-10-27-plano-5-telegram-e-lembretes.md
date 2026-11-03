# Telegram, Envio de Lembretes e Agendador (Plano 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular a conta ao Telegram, conversar com o assistente pelo bot (mesmo `processMessage` do Plano 4), enviar lembretes e o briefing do dia pelo Telegram com reserva atômica, nova tentativa e recuperação de falhas, e um endpoint interno chamado a cada minuto por um agendador.

**Architecture:** O envio é um caso de uso (`runReminders`) atrás de portas (`ReminderQueue`, `TelegramClient`); a reserva dos lembretes vencidos é uma função SQL com `FOR UPDATE SKIP LOCKED` (testada com concorrência real no Postgres local). O webhook do Telegram e o endpoint do agendador são rotas finas que validam segredo e chamam casos de uso. O agendador (pg_cron+pg_net ou qualquer cron externo) só faz um `POST` protegido por segredo.

**Tech Stack:** TypeScript, Hono, Zod 4, Postgres (funções SQL), Telegram Bot API via `fetch`, Vitest; painel Next.js para o fluxo de vínculo.

**Spec:** `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md` §5 (modelo de dados), §6 (fluxo, passos 2–3 e 5), §7 (lembretes, envio, **Contrato do enviador**, briefing, vínculo), §9, §10, §12 (verificações obrigatórias). Plano 4 (`processMessage`, `ChatRepository`, `InboundEventRepository`) é pré-requisito.

## Global Constraints

- Segredos só em variáveis de ambiente (nomes apenas no Git): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `INTERNAL_SECRET`. Nunca em logs, respostas de erro ou testes.
- Webhook exige o cabeçalho `X-Telegram-Bot-Api-Secret-Token` igual a `TELEGRAM_WEBHOOK_SECRET`; o endpoint do agendador exige `X-Internal-Secret` igual a `INTERNAL_SECRET`. **Comparação em tempo constante** e falha fechada: segredo ausente na configuração desabilita a rota (503), nunca a deixa aberta.
- Só chats **privados** (`chat.type === 'private'`); grupos, canais e mensagens editadas são ignorados com 200. Mensagem que não é texto → resposta fixa "por enquanto só entendo texto" sem chamar a IA.
- O Telegram reenvia o webhook se a resposta demorar: o processamento termina dentro do orçamento do Plano 4 (~20 s) **antes** de responder 200; a idempotência por `update_id` (`inbound_events`, canal `telegram`) impede duplicatas. Segredo errado → 401; qualquer outra coisa tratada → 200.
- Mensagens para o usuário em **texto simples** (sem `parse_mode`, para não haver injeção de formatação), no máximo 4.096 caracteres (truncar com "…").
- Lembretes — contrato do enviador (spec §7): só enviar se a tarefa está viva (`deleted_at is null`) e aberta (`pendente`/`em_andamento`), senão marcar `cancelado`; depois de um envio, se data/hora/`fatal` da tarefa mudaram desde a reserva, refazer a substituição dos lembretes da tarefa; lembrete vencido é enviado atrasado com a marca "(atrasado)" até **24 h** após `scheduled_at` (depois disso `cancelado`); `enviando` há mais de 5 min volta a `pendente`; falha temporária → nova tentativa com espera crescente (1 min, 5 min, 15 min, 1 h, 3 h), no máximo **5 tentativas** e então `falhou`; erro permanente (bot bloqueado, chat inexistente) → `channel_paused = true` e lembretes do usuário deixam de ser reservados; garantia "pelo menos uma vez".
- Briefing no Telegram: na hora configurada (`briefing_time`, fuso do usuário), **uma vez por dia local** (`last_briefing_sent_on`), não enviado se vazio (`renderBriefing` devolve `''`); texto fixo, sem IA.
- Código de vínculo: 8 caracteres de alfabeto sem ambíguos, gerado com `crypto.randomBytes`, uso único, validade de **10 min**; um chat não pode ter duas contas (`telegram_chat_id` é único); vincular zera `channel_paused`.
- Logs operacionais: ids, contagens, códigos de erro e durações; **nunca** texto de mensagem/tarefa, chat id junto a texto, token ou segredo.
- A decisão de produto "tarefa `fatal` com hora" está tomada: **manter como está** (só `antecipado` e `no_horario`); registrar na spec §7 (Task 12). Não alterar `buildReminders`.

## Review Focus

1. Duas execuções simultâneas do enviador nunca enviam o mesmo lembrete duas vezes em condições normais; um lembrete preso em `enviando` é recuperado.
2. Tarefa concluída/cancelada/apagada entre a criação do lembrete e o envio não gera mensagem.
3. Reagendar a tarefa durante o envio não deixa a tarefa sem lembrete para o novo horário.
4. Bot bloqueado pelo usuário pausa o canal sem laço de novas tentativas; erro temporário reaparece com espera crescente e para na 5ª tentativa.
5. Código de vínculo vencido, reutilizado ou de outra conta nunca vincula; chat já ligado a outra conta é recusado com mensagem clara.
6. Webhook com segredo errado, duplicata, chat não vinculado, mensagem não textual, texto longo, resposta a confirmação de tarefa apagada: nenhum efeito indevido e resposta adequada.
7. Briefing não duplica no mesmo dia local, respeita o fuso e não sai quando vazio.

---

## File Structure

```
supabase/migrations/0006_reminder_sender.sql      # funções SQL de fila, vínculo, limpeza
apps/api/src/domain/reminder-message.ts           # texto do lembrete, backoff, classificação de erro
apps/api/src/application/ports.ts                 # + ReminderQueue, TelegramClient, LinkCodeRepository, ConfirmationRepository
apps/api/src/application/telegram/{link.ts,webhook.ts,briefing-sender.ts}
apps/api/src/application/run-reminders.ts
apps/api/src/infra/{telegram-client.ts,supabase-reminder-queue.ts,supabase-link-repository.ts,supabase-confirmation-repository.ts}
apps/api/src/routes/{telegram.ts,internal.ts}
apps/api/scripts/reminders-tick.ts                # dispara o endpoint localmente
docs/superpowers/notes/2026-verificacoes-infra.md # Task 1
apps/web/components/telegram-link.tsx
```

---

### Task 1: Verificações obrigatórias (spec §12) e decisão de infraestrutura

**Files:**
- Create: `docs/superpowers/notes/2026-verificacoes-infra.md`
- Modify: `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md` (§12: resultados e links)

**Interfaces:** nenhuma de código. Produz uma nota com data e **fontes oficiais citadas** (URLs) respondendo, com "confirmado", "não confirmado" ou "depende do plano": (1) `pg_cron` e `pg_net` disponíveis no plano gratuito do Supabase e como guardar o segredo no Vault; (2) política de pausa de projetos gratuitos por inatividade; (3) onde hospedar a API para suportar uma chamada por minuto e o orçamento de ~20 s por mensagem (Vercel como projeto separado vs. serviço de processo longo), com o requisito de o endpoint do agendador ficar fora da proteção de implantação; (7) Telegram Bot API atual: `setWebhook` com `secret_token`, formato do `Update`, `sendMessage`, limites de taxa e códigos de erro de bot bloqueado e de limite (`retry_after`). Termina com **recomendação** e o que depende de decisão do usuário (custos, plano do Supabase, provedor).

- [ ] **Step 1:** Consultar a documentação **atual** (WebFetch/WebSearch) — não responder de memória; cada afirmação leva a URL consultada.
- [ ] **Step 2:** Escrever a nota; se algo contradisser os pressupostos deste plano (ex.: `X-Telegram-Bot-Api-Secret-Token`, códigos 403/429), **listar a divergência no topo** para o controlador decidir antes das Tasks 3–9.
- [ ] **Step 3:** Commit `docs: infrastructure verification notes`

---

### Task 2: Funções SQL da fila, do vínculo e da limpeza

**Files:**
- Create: `supabase/migrations/0006_reminder_sender.sql`, `apps/api/test/db/reminder-queue.db.test.ts`

**Interfaces:**
- Migração: `reminders.next_attempt_at timestamptz null`; índice parcial `reminders (coalesce(next_attempt_at, scheduled_at)) where status = 'pendente'`; `chat_messages` e `inbound_events` sem mudança. Funções (`security invoker`, `EXECUTE` só para `service_role`):
  - `claim_due_reminders(p_now timestamptz, p_limit int) returns table(reminder_id uuid, user_id uuid, task_id uuid, kind text, scheduled_at timestamptz, attempts int, title text, task_type text, due_date date, due_time time, fatal boolean, telegram_chat_id bigint, timezone text)` — reserva (`FOR UPDATE SKIP LOCKED`) lembretes `pendente` com `coalesce(next_attempt_at, scheduled_at) <= p_now`, **da tarefa viva e aberta**, de perfil com `telegram_chat_id is not null and not channel_paused`; marca `enviando`, `locked_at = p_now`, `attempts = attempts + 1`;
  - `cancel_dead_reminders(p_now)` — `cancelado` para `pendente` cuja tarefa foi apagada/encerrada e para `pendente` com `scheduled_at < p_now - interval '24 hours'`; devolve a quantidade;
  - `recover_stuck_reminders(p_now)` — `enviando` com `locked_at < p_now - interval '5 minutes'` volta a `pendente` (sem mexer em `attempts`); devolve a quantidade;
  - `finish_reminder(p_id uuid, p_status text, p_error text, p_next_attempt_at timestamptz, p_now timestamptz)` — grava `enviado`/`pendente`(retry)/`falhou`/`cancelado`, `sent_at`, `last_error` (truncado a 200 caracteres), limpa `locked_at`;
  - `consume_link_code(p_code text, p_chat_id bigint, p_now timestamptz) returns table(status text, user_id uuid)` — numa transação: apaga o código válido e não vencido (`status = 'ok'`), grava `telegram_chat_id` e zera `channel_paused`; códigos inexistentes/vencidos → `'invalido'`; chat já ligado a **outra** conta → `'chat_em_uso'` (o código **não** é consumido);
  - `claim_briefing(p_user_id uuid, p_local_date date) returns boolean` — `update profiles set last_briefing_sent_on = p_local_date where id = p_user_id and (last_briefing_sent_on is null or last_briefing_sent_on < p_local_date)`; `true` só se atualizou;
  - `purge_expired_chat_messages(p_now)` e `purge_expired_link_codes(p_now)`.

- [ ] **Step 1: Write the failing DB tests** (Postgres local 553xx; **nunca** a stack 543xx): reserva sob concorrência — 20 lembretes vencidos e 4 chamadas simultâneas a `claim_due_reminders(…, 10)` (`Promise.all`, conexões distintas) devolvem 20 ids **sem repetição** e deixam `enviando`; tarefa apagada/concluída não é reservada e `cancel_dead_reminders` a cancela; perfil sem Telegram ou com canal pausado não é reservado; lembrete com 25 h de atraso → `cancelado`; recuperação de `enviando` preso (6 min) e não de 2 min; `finish_reminder` com retry grava `next_attempt_at` e o lembrete só é reservado depois dele; `consume_link_code`: válido vincula e zera pausa, segundo uso → `invalido`, vencido → `invalido`, chat de outra conta → `chat_em_uso` **sem** apagar o código; `claim_briefing` duas chamadas simultâneas no mesmo dia → exatamente uma `true`; usuário B nunca é afetado por operação sobre o usuário A.
- [ ] **Step 2: Run** `pnpm --filter @aj/api test:db` → FAIL. **Step 3: Implement** a migração (escreva as funções com `set search_path = public` e sem SQL dinâmico). **Step 4: Run** → PASS (`supabase db reset` só na stack deste projeto). **Step 5: Commit** `feat(db): reminder queue, link and cleanup functions`

---

### Task 3: Domínio — texto do lembrete, espera crescente e classificação de erro

**Files:**
- Create: `apps/api/src/domain/reminder-message.ts`, `apps/api/src/domain/reminder-message.test.ts`

**Interfaces:**
- Produces (puras):
  - `renderReminder(input: { kind: ReminderKind; title: string; taskType: TaskType; dueDate: IsoDate; dueTime: string | null; fatal: boolean; late: boolean }): string` — ex.: `"⏰ Prazo fatal amanhã: Contestação — Proc. 123 (venc. 27/10)"`; `no_horario`/`antecipado` incluem a hora `HH:mm`; `late` acrescenta o sufixo ` (atrasado)`; texto simples.
  - `isLate(scheduledAt: Date, now: Date): boolean` — atraso maior que **5 minutos**.
  - `retryDelayMs(attempt: number): number | null` — tentativa 1→1 min, 2→5 min, 3→15 min, 4→1 h, 5→`null` (esgotou).
  - `classifyTelegramError(status: number, body: { error_code?: number; description?: string; parameters?: { retry_after?: number } }): { kind: 'transient'; retryAfterMs?: number } | { kind: 'permanent'; reason: 'bot_bloqueado' | 'chat_inexistente' | 'outro' }` — 403 (bot bloqueado/expulso) e 400 "chat not found" → permanente; 429 → transitório com `retry_after`; 5xx e rede → transitório; 400 com `can't parse`/mensagem inválida → permanente `outro`.

- [ ] **Step 1: Write the failing tests** (valores exatos): cada `kind` com e sem hora; `late` só com atraso > 5 min (borda 5:00 e 5:01); backoff 60 000/300 000/900 000/3 600 000/`null`; classificação de 403 "Forbidden: bot was blocked by the user" → `bot_bloqueado`; 429 com `retry_after: 7` → `retryAfterMs: 7000`; 502 → transitório; descrição desconhecida com 400 → `outro`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(api): reminder message and retry domain rules`

---

### Task 4: Cliente do Telegram e repositórios da fila

**Files:**
- Create: `apps/api/src/infra/telegram-client.ts` (+ teste), `apps/api/src/infra/supabase-reminder-queue.ts`, `apps/api/src/infra/supabase-link-repository.ts`, `apps/api/src/infra/supabase-confirmation-repository.ts`, `apps/api/test/db/telegram-repos.db.test.ts`
- Modify: `apps/api/src/application/ports.ts`, `apps/api/test/fakes.ts`, `apps/api/src/config.ts` (+ teste), `.env.example`

**Interfaces:**
- Produces:
  - `TelegramClient { sendMessage(chatId: number, text: string): Promise<{ ok: true; messageId: number } | { ok: false; error: ReturnType<typeof classifyTelegramError> }> }` — `fetch` para `https://api.telegram.org/bot<TOKEN>/sendMessage` com `{ chat_id, text }`, timeout 10 s, **sem** `parse_mode`, truncando a 4.096; o token nunca aparece em mensagens de erro/logs.
  - `ReminderQueue { claimDue(now, limit): Promise<ClaimedReminder[]>; cancelDead(now): Promise<number>; recoverStuck(now): Promise<number>; finish(id, outcome, now): Promise<void>; pauseChannel(userId): Promise<void> }`.
  - `LinkCodeRepository { create(userId, code, expiresAt): Promise<void> /* apaga códigos anteriores do usuário */; consume(code, chatId, now): Promise<{ status: 'ok'; userId: string } | { status: 'invalido' } | { status: 'chat_em_uso' }>; unlink(userId): Promise<void> }`.
  - `ConfirmationRepository { record(chatId, messageId, taskIds: string[]): Promise<void>; tasksFor(userId, chatId, messageId): Promise<{ alive: string[]; deletedCount: number }> }` (filtra por `user_id` via `tasks`).
  - Config: `telegramBotToken`, `telegramBotUsername`, `telegramWebhookSecret`, `internalSecret` — **cada um opcional**; quando ausentes, a rota correspondente fica desabilitada (503), e a API sobe normalmente.

- [ ] **Step 1: Write the failing tests:** cliente com `fetch` falso — URL e corpo exatos (sem `parse_mode`), truncamento a 4.096, 200 → `{ ok: true, messageId }`, 403/429/502/falha de rede → classificação certa, token ausente de qualquer mensagem de erro; repositórios no banco local — `claimDue` chama a função e mapeia colunas; `record`/`tasksFor` isolam por usuário (usuário B não vê confirmação do A) e contam tarefas apagadas; `LinkCodeRepository.create` substitui o código anterior; `config` lê os quatro nomes e nunca os devolve em mensagem de erro.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test` e `test:db` → verdes. **Step 5: Commit** `feat(api): Telegram client and sender repositories`

---

### Task 5: Caso de uso `runReminders` (enviador)

**Files:**
- Create: `apps/api/src/application/run-reminders.ts`, `apps/api/src/application/run-reminders.test.ts`

**Interfaces:**
- Consumes: `ReminderQueue`, `TelegramClient`, `TaskRepository.get`, `makeSyncReminders` (Plano 2), `renderReminder`, `isLate`, `retryDelayMs`, `Clock`.
- Produces: `makeRunReminders(deps) → (opts?: { maxBatches?: number; batchSize?: number }) => Promise<{ sent: number; retried: number; failed: number; cancelled: number; recovered: number; paused: number }>` — algoritmo: `recoverStuck` → `cancelDead` → laço de lotes (padrão 5 lotes de 20) com `claimDue`; para cada lembrete: **reconferir a tarefa** (`tasks.get`; apagada/encerrada → `finish(cancelado)`), montar texto (`late` por `isLate`), `sendMessage`; sucesso → `finish(enviado)` e, se `dueDate`/`dueTime`/`fatal` atuais diferem do snapshot reservado, `syncReminders` da tarefa (contrato 2); falha transitória → `finish(retry)` com `next_attempt_at = now + max(retryDelayMs, retryAfterMs)` ou `falhou` quando `retryDelayMs(attempts)` é `null`; falha permanente → `finish(falhou, motivo)` e `pauseChannel(userId)` (lembretes restantes do usuário no mesmo lote são devolvidos a `pendente`, sem contar tentativa); um lembrete com erro inesperado **não** interrompe o lote (registra código de erro e segue).

- [ ] **Step 1: Write the failing tests** (portas falsas e relógio falso; asserções exatas): envio normal marca `enviado` e usa o texto de `renderReminder`; tarefa concluída entre a reserva e o envio → `cancelado` e `sendMessage` **não** chamado; atraso de 2 h → texto com "(atrasado)"; remarcação durante o envio (snapshot ≠ atual) → `syncReminders` chamado com a tarefa; sem mudança → **não** chamado; 403 → `falhou` + `pauseChannel` + demais lembretes do usuário devolvidos sem custo de tentativa; 429 `retry_after: 120` → próxima tentativa em ≥ 120 s; tentativa 5 com falha transitória → `falhou`; exceção inesperada num item não impede os seguintes; contadores do retorno corretos; `maxBatches` respeitado; logger nunca recebe título/texto.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; typecheck. **Step 5: Commit** `feat(api): reminder sender use case`

---

### Task 6: Envio do briefing diário pelo Telegram

**Files:**
- Create: `apps/api/src/application/telegram/briefing-sender.ts` (+ teste)
- Modify: `apps/api/src/application/ports.ts` (`BriefingRecipientRepository { dueFor(now): Promise<Array<{ userId: string; chatId: number; timezone: string; localDate: IsoDate }>> }` e `claimBriefing(userId, localDate)`/`unclaimBriefing` via `ProfileRepository` ou porta dedicada), `apps/api/src/infra` (implementação sobre `profiles` + `claim_briefing`)

**Interfaces:**
- Produces: `makeSendDailyBriefings(deps) → () => Promise<{ sent: number; skippedEmpty: number; failed: number }>` — para cada usuário vinculado e não pausado cujo horário local já passou de `briefing_time` e `last_briefing_sent_on < localDate`: `claim_briefing` (atômico); `getBriefing` → `renderBriefing`; texto vazio → conta `skippedEmpty` (o dia já foi marcado); senão `sendMessage`; falha **transitória** → desfaz o claim (`last_briefing_sent_on` volta ao valor anterior) para tentar no próximo minuto; permanente → pausa o canal.

- [ ] **Step 1: Write the failing tests:** antes da hora não envia; depois da hora envia uma vez e uma segunda execução no mesmo dia local não repete; virada de dia no fuso `Pacific/Auckland` (usuário já no dia seguinte) usa a data **local**; briefing vazio não envia mas marca o dia; falha transitória desfaz o claim e o próximo minuto tenta de novo; bot bloqueado pausa o canal; duas execuções simultâneas (fake com claim atômico) → um envio.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat(api): daily briefing sender`

---

### Task 7: Endpoint interno do agendador

**Files:**
- Create: `apps/api/src/routes/internal.ts` (+ teste), `apps/api/scripts/reminders-tick.ts`, `apps/api/test/db/internal.db.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/compose.ts`, `apps/api/package.json` (script `reminders:tick`), `README.md`

**Interfaces:**
- Produces: `POST /internal/reminders/run` — **sem** `Authorization` de usuário; exige `X-Internal-Secret` (tempo constante); `INTERNAL_SECRET` ausente → 503; segredo errado/ausente → 401 **sem** corpo informativo; executa `runReminders`, `sendDailyBriefings` e as limpezas (`purge_expired_chat_messages`, `purge_expired_link_codes`) e devolve `{ sent, retried, failed, cancelled, recovered, paused, briefings }` (só contagens). Falha de uma etapa não impede as outras (cada uma em `try`, erro registrado por código). O script `reminders-tick` chama o endpoint local com o segredo do ambiente.

- [ ] **Step 1: Write the failing tests:** 401 sem cabeçalho, com segredo errado e com segredo de tamanho diferente (sem exceção no compare); 503 quando a configuração não tem segredo; 200 com contagens; uma etapa que lança erro não impede as demais; resposta nunca contém ids/títulos; teste de banco: 2 requisições simultâneas ao endpoint com lembretes vencidos e Telegram falso → cada lembrete enviado **uma** vez.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test`, `test:db`, typecheck. **Step 5: Commit** `feat(api): internal scheduler endpoint`

---

### Task 8: Vínculo com o Telegram (API) e webhook

**Files:**
- Create: `apps/api/src/application/telegram/{link.ts,webhook.ts}` (+ testes), `apps/api/src/routes/telegram.ts` (+ teste), `apps/api/test/db/telegram.db.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/compose.ts`, `packages/shared/src/{settings-api.ts,responses.ts}` (`SettingsDto.channelPaused: boolean`; `LinkCodeDto = { code: string; deepLink: string; expiresAt: string }`), `apps/api/src/infra/supabase-profile-repository.ts` (+ `channelPaused`), `README.md`

**Interfaces:**
- Produces (rotas): `POST /telegram/link-codes` (auth) → `LinkCodeDto` (código de 8 caracteres do alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, `deepLink = https://t.me/<BOT_USERNAME>?start=<code>`); `DELETE /telegram/link` (auth) → 204 (desvincula e cancela lembretes pendentes de envio? **não**: mantém a fila, só impede reserva por falta de chat); `POST /telegram/webhook` (segredo do webhook).
- `makeHandleTelegramUpdate(deps) → (update: unknown) => Promise<void>` — fluxo por `Update` (tolerante: schema Zod só dos campos usados; formato inesperado → ignora com 200):
  1. ignora o que não é `message` de chat privado;
  2. idempotência: `register('telegram', String(update_id))`; repetido já `processado` → nada;
  3. `/start CODIGO` → `consume`; `ok` → responde "Conta vinculada!…" ; `invalido` → "Código inválido ou vencido. Gere outro no painel."; `chat_em_uso` → "Este Telegram já está ligado a outra conta."; `/start` sem código → orientação;
  4. chat **não vinculado** (nenhum perfil com esse `telegram_chat_id`) → só orienta o vínculo, **nada** é criado nem a IA é chamada;
  5. sem `text` → "Por enquanto só entendo texto.";
  6. `reply_to_message` a uma confirmação do bot → `tasksFor(...)`: `alive` vira `targetTaskIds` de `processMessage`; todas apagadas → "Essa tarefa não existe mais." sem chamar a IA;
  7. texto → `processMessage({ channel: 'telegram', externalId: String(update_id), source: 'telegram', ... })`; a resposta é enviada com `sendMessage` e **cada tarefa afetada é gravada em `task_confirmations` com o `message_id` da resposta enviada**;
  8. `RateLimitedError` → "Limite de 30 mensagens por hora atingido."; `AssistantUnavailableError` → "O assistente está indisponível agora. Nada foi alterado." (ou com as tarefas realmente gravadas, quando `partial`).
- O webhook sempre responde **200** depois de tratar (inclusive respostas de erro ao usuário); só segredo errado é 401.

- [ ] **Step 1: Write the failing tests** com payloads falsos de `Update` (use casos reais da Bot API da nota da Task 1): segredo errado → 401 e nada acontece; mesmo `update_id` duas vezes → um efeito; chat não vinculado → orientação, IA **não** chamada, nenhuma tarefa; `/start` com código válido vincula, vencido/reutilizado/inexistente recusa, de outra conta (chat em uso) recusa e o código segue válido; mensagem de foto/áudio → resposta fixa; grupo (`chat.type: 'group'`) → ignorado; texto de 1.001 caracteres → mensagem de limite sem chamar a IA; resposta a confirmação de tarefa **apagada** → "não existe mais", sem IA; resposta a confirmação viva injeta `targetTaskIds` (modelo falso recebe a tarefa-alvo e a altera); tarefa criada grava `task_confirmations` com o `message_id` do envio; IA indisponível → aviso ao usuário e 200; `POST /telegram/link-codes` gera código no formato certo, o anterior deixa de valer, exige auth; `DELETE /telegram/link` remove o vínculo; nenhum log contém texto da mensagem.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm test`, `test:db`, typecheck. **Step 5: Commit** `feat(api): Telegram link flow and webhook`

---

### Task 9: Vínculo no painel

**Files:**
- Create: `apps/web/components/telegram-link.tsx` (+ teste)
- Modify: `apps/web/components/settings-form.tsx` (troca o texto "Vínculo disponível em breve" pelo componente), `apps/web/lib/api.ts` (`createLinkCode`, `unlinkTelegram`), `apps/web/lib/messages.ts`

**Interfaces:**
- Produces: `TelegramLink({ linked: boolean; paused: boolean })` — não vinculado: botão "Gerar código" mostra o código, o link "Abrir no Telegram" (`deepLink`, `rel="noopener noreferrer"`), contagem regressiva de 10 min e atualização automática das configurações a cada 5 s enquanto o código é válido; vinculado: texto "Telegram vinculado" e botão "Desvincular" (com confirmação); `paused` mostra aviso "O envio está pausado (bot bloqueado). Gere um novo código para retomar."

- [ ] **Step 1: Write the failing tests:** gerar código mostra o código e o link; código vencido (relógio falso +10 min) some e pede novo; ao detectar `linked: true` nas configurações o componente muda de estado; desvincular só chama a API após confirmar; `paused` mostra o aviso; erro da API aparece em `role="alert"` sem perder o estado.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `pnpm --filter @aj/web test`, typecheck, build. **Step 5: Commit** `feat(web): Telegram link flow in settings`

---

### Task 10: Ponta a ponta com Telegram falso e agendador local

**Files:**
- Create: `apps/api/test/db/telegram-e2e.db.test.ts`
- Modify: `README.md` (runbook), `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md` (§7 item 5: decisão "manter como está"; §12: ponteiro para a nota)

**Interfaces:** nenhuma nova. Teste de banco com usuário real, modelo falso, Telegram falso e relógio fixo percorrendo a jornada completa: gerar código → `/start CODIGO` no webhook → mensagem "reunião amanhã às 14h" cria tarefa e lembretes → resposta ao bot com "muda para 16h" altera **aquela** tarefa (via `task_confirmations`) e refaz lembretes → avançar o relógio até o lembrete `antecipado` e chamar o endpoint interno → o Telegram falso recebe o lembrete com a hora nova, uma vez → segunda chamada concorrente não duplica → concluir a tarefa → lembrete seguinte `cancelado`.

- [ ] **Step 1: Write the failing e2e test** (jornada acima, com asserções exatas sobre o que o Telegram falso recebeu e o estado do banco).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** o que faltar de cola/documentação: runbook (criar o bot no BotFather, variáveis, `setWebhook` com `secret_token`, como apontar o agendador — pg_cron+pg_net **ou** cron externo, conforme a nota da Task 1 —, como rodar `reminders:tick` localmente, como testar sem bot real). **Step 4: Run** `pnpm test`, `pnpm --filter @aj/api test:db`, `pnpm typecheck`, `pnpm --filter @aj/web build` → verdes. **Step 5: Commit** `test(api): Telegram and reminder end-to-end journey; runbook`

---

## Rulings deste plano (decididos aqui; contestáveis)

- **P5-1:** sem `parse_mode` (texto simples) em todas as mensagens do bot — evita injeção de formatação e erros de escape. Custo se errado: adicionar formatação depois, com escape.
- **P5-2:** "(atrasado)" aparece quando o atraso passa de **5 minutos** (tolerância do próprio agendador); acima de 24 h o lembrete é `cancelado`. Custo se errado: ajustar a constante.
- **P5-3:** `next_attempt_at` separado de `scheduled_at` para a espera crescente, para que a regra das 24 h continue contando do horário original. Custo se errado: migração pequena.
- **P5-4:** o registro do agendador (pg_cron + pg_net + Vault) é **passo operacional documentado**, não migração automática, porque depende do plano do Supabase e da nota da Task 1; o código só expõe o endpoint e o script local. Custo se errado: escrever a migração depois.
- **P5-5:** religar com código novo substitui o chat vinculado (o código nasce de uma sessão autenticada no painel); chat já ligado a **outra** conta é sempre recusado. Custo se errado: exigir desvincular antes.
- **P5-6:** chats não vinculados recebem só a orientação de vínculo; proteção contra spam nesse caminho (limite por chat) fica no Plano 6 (revisão de segurança). Custo se errado: adicionar limite por chat.
