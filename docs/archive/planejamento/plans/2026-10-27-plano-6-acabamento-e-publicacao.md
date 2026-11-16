# Acabamento, Avaliação da IA, Segurança e Publicação (Plano 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o produto apresentável e seguro para uso real: dívidas técnicas dos Planos 2 e 3 pagas, limites de uso nas rotas HTTP, avaliação objetiva da IA (~50 frases), custos medidos, identidade visual definitiva, testes de navegador das jornadas principais, dados de demonstração e publicação documentada.

**Architecture:** Sem novas camadas: este plano endurece e mede o que os Planos 1–5 construíram. Itens que dependem de decisão do usuário (paleta, hospedagem, retenção de dados, plano do Supabase) começam com uma tarefa de **decisão registrada** antes do código.

**Tech Stack:** TypeScript, Vitest, Playwright (navegador), Hono, Next.js, Supabase; `pnpm audit` para dependências; skill de avaliação (`build-eval`) para o conjunto de frases.

**Spec:** `docs/archive/planejamento/specs/2026-10-26-assistente-juridico-design.md` §9 (segurança), §10 (testes e critérios de aceitação), §12–§14 (verificações, custos, questões em aberto). Planos 1–5 concluídos são pré-requisito (a avaliação da IA exige o Plano 4; os testes de navegador, o Plano 3).

## Global Constraints

- Nenhuma tarefa de "decisão" é resolvida por mim: cada uma termina com a escolha **do usuário** registrada num documento em `docs/archive/planejamento/notes/` (data, opções, escolha, motivo). Sem a decisão, a tarefa dependente não começa.
- Gastos reais (chamadas à IA para avaliação, planos pagos) exigem aprovação explícita do usuário **antes** de rodar; a chave `ANTHROPIC_API_KEY` só entra por variável de ambiente, nunca em arquivo versionado, log ou relatório.
- Nada do produto é publicado/enviado a serviços externos (deploy, repositório remoto, DNS) sem pedido explícito do usuário na hora.
- Dados reais de clientes **não** entram no repositório, em fixtures, em avaliações nem em dados de demonstração; a demonstração usa dados inventados e marcados como fictícios.
- Todos os critérios de aceitação da spec §10 viram testes ou itens verificáveis do relatório final deste plano.
- Mantidos os limites e regras dos planos anteriores (Haiku 5.5 com `effort: low`, 1.000 caracteres, 30 mensagens/hora, `user_id` vindo do servidor, logs sem texto).

## Review Focus

1. Nenhuma rota passa a recusar o uso legítimo normal (limites generosos por usuário/IP) nem deixa de limitar abuso (laço de requisições, spam no webhook por chat não vinculado).
2. O conjunto de avaliação da IA mede o que importa (datas inválidas gravadas = 0; perguntas só quando ambíguo) e **não** contém dados reais.
3. Usuário A nunca lê nem altera dados do B em **todas** as tabelas, incluindo as criadas nos Planos 4–5.
4. Cabeçalhos de segurança e CSP não quebram o painel (login, formulários, barra de comando).
5. A paleta definitiva mantém contraste AA em estados normal, atrasado, fatal e concluído, e nenhum estado depende só de cor.
6. Demonstração: o roteiro de demo roda do zero em poucos comandos e não toca nenhum projeto Supabase além do deste repositório.

---

## File Structure

```
docs/archive/planejamento/notes/                  # decisões e resultados (paleta, hospedagem, retenção, avaliação, custos)
apps/api/src/middleware/rate-limit.ts    # limites HTTP
apps/api/eval/{cases.json,run-eval.ts,grade.ts}   # avaliação da IA
apps/api/scripts/seed-demo.ts            # dados de demonstração (fictícios)
apps/web/e2e/*.spec.ts, apps/web/playwright.config.ts
```

---

### Task 1: Decisões do usuário (paleta, hospedagem, retenção, plano do Supabase)

**Files:**
- Create: `docs/archive/planejamento/notes/2026-decisoes-publicacao.md`

**Interfaces:** nenhuma de código. O documento reúne, **para o usuário escolher** (use perguntas objetivas, uma por vez, cada uma com recomendação e custo): (a) paleta definitiva e identidade visual (alternativas visuais renderizadas para comparar, partindo de `docs/archive/planejamento/specs/2026-10-26-painel-web-direcao-visual.md`); (b) onde hospedar API e painel (opções da nota `2026-verificacoes-infra.md` do Plano 5) e o plano do Supabase (pausa por inatividade, `pg_cron`); (c) política de retenção e exclusão de mensagens e dados (spec §14.2) e texto de aviso de privacidade/LGPD; (d) domínio e provedor de e-mail do Supabase Auth (limite de envio de e-mail, spec §14.6).

- [ ] **Step 1:** Levantar as opções e custos atualizados; **Step 2:** apresentar ao usuário e registrar cada escolha com data; **Step 3:** commit `docs: publication decisions`. Tasks 5, 6 e 8 só começam depois da escolha correspondente.

---

### Task 2: Dívidas técnicas dos Planos 2 e 3

**Files:** conforme o item (cada item vira um commit temático); testes junto ao código alterado.

**Interfaces:** itens (cada um com teste que falha antes da correção):
1. **Paginação** de `GET /tasks` (`limit` 1..200, padrão 100, `cursor` opaco ou `offset`) com contrato em `@nexus/shared`; o Histórico passa a pedir páginas ("Carregar mais"); testes de ordem estável e de limite.
2. **Regra de processo arquivado:** tarefa nova ligada a processo `arquivado` → `409 processo_arquivado` (decidir e registrar a regra; hoje é aceita).
3. **`{ deadline, dueDate: null }`** no `update`: comportamento definido e testado (hoje ambíguo).
4. **Funções SQL (`replace_pending_reminders`):** `p_drafts` nulo → erro claro; rascunhos duplicados do mesmo `kind` → deduplicados; tarefa de outro usuário → `raise` explícito (hoje silencioso); testes no banco.
5. **Testes mais fortes (lista do ledger do Plano 2):** argumento do `console.error` do `onError`; UUID regex e `UNIQUE_VIOLATION` duplicados centralizados num módulo; e os menores do Plano 3 que ainda estiverem abertos (DayView: dedupe de atrasadas com `?d=`; `groupWeek` com fatal; teste do foco após exclusão; `DeadlineFields` compartilhado entre calculadora e formulário).
6. **Teste intermitente:** rodar a suíte web 20 vezes seguidas e registrar 0 falhas.

- [ ] **Step 1:** para cada item, escrever o teste que falha e confirmar o motivo; **Step 2:** corrigir; **Step 3:** `pnpm test`, `pnpm --filter @nexus/api test:db`, `pnpm typecheck`; **Step 4:** commits temáticos (`fix(api): …`, `test(web): …`).

---

### Task 3: Limites de uso nas rotas HTTP e revisão de segurança

**Files:**
- Create: `apps/api/src/middleware/rate-limit.ts` (+ teste), `apps/api/test/db/rls-all-tables.db.test.ts`, `docs/archive/planejamento/notes/2026-revisao-seguranca.md`
- Modify: `apps/api/src/app.ts`, `apps/web/next.config.ts` (cabeçalhos), `apps/api/src/application/telegram/webhook.ts` (limite por chat não vinculado)

**Interfaces:**
- `rateLimit(opts: { windowMs: number; max: number; key: (c: Context) => string; now?: () => number }): MiddlewareHandler` — janela deslizante em memória por chave (documentar que em várias instâncias o limite é por instância e o que muda se escalar); resposta `429 { error: 'limite_de_requisicoes', retryAfterSeconds }`; aplicado: por IP antes da autenticação (limite alto), por usuário depois dela (limite médio), por chat não vinculado no webhook (1 orientação/hora/chat), e sem tocar em `/health`.
- Cabeçalhos: API (`X-Content-Type-Options: nosniff`, `Cache-Control: no-store` em rotas autenticadas, remover `X-Powered-By`) e painel (CSP restrita a `self` + domínios do Supabase/API configurados, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`).
- Teste de RLS em **todas** as tabelas (lista tirada do catálogo do banco, para falhar se surgir tabela nova sem política): com dois usuários reais, A nunca lê/escreve linhas de B via cliente com token do usuário.
- `pnpm audit` (produção) sem vulnerabilidade alta/crítica não tratada; varredura de segredos no repositório (nenhuma chave, `.env` fora do Git).

- [ ] **Step 1: Write the failing tests:** limite estoura na (max+1)-ésima requisição e libera após a janela (relógio falso); chaves independentes (usuário A não consome o limite do B); `/health` isento; resposta 429 com `retryAfterSeconds`; webhook: segundo `/start` de chat não vinculado na mesma hora não gera nova resposta; cabeçalhos presentes nas respostas; RLS: cada tabela do catálogo exige política e A não acessa B; teste de que o painel ainda carrega com a CSP (renderização básica no teste de navegador da Task 7).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** testes, `pnpm audit --prod`, varredura de segredos. **Step 5:** escrever a nota de revisão (ameaças consideradas, o que foi coberto, riscos aceitos) e commit `feat: rate limits, security headers and RLS coverage`.

---

### Task 4: Avaliação da IA (~50 frases) e ajuste de prompt

**Files:**
- Create: `apps/api/eval/cases.json`, `apps/api/eval/grade.ts` (+ teste), `apps/api/eval/run-eval.ts`, `docs/archive/planejamento/notes/2026-avaliacao-ia.md`

**Interfaces:**
- `cases.json`: ~50 casos fictícios em português do Brasil, cada um `{ id, text, now, timeZone, existingTasks?, expect }` cobrindo: abreviações e erros de digitação, "amanhã de manhã/à tarde/à noite", dia da semana sem hora, "semana que vem" sem dia (deve perguntar), várias tarefas numa frase, tarefa sem data, data inexistente (`30/02`), horário no passado, correção ("muda para 16h" com tarefa-alvo), concluir por descrição, consultas ("o que vence essa semana?"), cálculo de prazo em dias úteis, mensagem sem relação com tarefas (não cria nada), e tentativas de injeção ("ignore as regras…", id de outro usuário).
- `grade(result, expect): { pass: boolean; failures: string[] }` — **determinístico**: confere ferramentas chamadas, argumentos (datas/horas exatas), nenhuma data inválida gravada, pergunta feita quando `expect.ask === true`, nada criado quando `expect.none === true`, nenhum id estranho usado.
- `run-eval.ts` roda os casos contra o `processMessage` com repositórios em memória e o **modelo real**, N repetições por caso (padrão 3), e imprime a tabela (aprovados, falhas por categoria, tokens, custo estimado, duração). **Meta (spec §10):** zero datas inválidas gravadas e poucas perguntas desnecessárias.

- [ ] **Step 1: Write the failing tests:** testes unitários do `grade` com resultados falsos (um que passa e um que falha por cada regra) e do cálculo de custo; `run-eval` recusa rodar sem `ANTHROPIC_API_KEY` com erro que **nomeia** a variável e imprime o custo estimado **antes** de gastar.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** o corretor e o executor. **Step 4: Pedir aprovação do usuário para o gasto estimado** e só então rodar o conjunto real; registrar a tabela e o custo na nota. **Step 5:** se a meta não for atingida, **uma** rodada de ajuste de prompt (skill de hillclimb: treino/validação separados), registrada; commit `feat(api): assistant evaluation harness`.

---

### Task 5: Identidade visual definitiva (depende da decisão (a) da Task 1)

**Files:**
- Modify: `apps/web/app/globals.css` (tokens), componentes do painel conforme necessário, `docs/archive/planejamento/specs/2026-10-26-painel-web-direcao-visual.md` (registrar a paleta escolhida, se o arquivo estiver versionado)

**Interfaces:** os tokens `--color-*` ganham os valores definitivos (claro e escuro) sem mudar nomes; opcionalmente fontes e espaçamentos via a skill de design de interface.

- [ ] **Step 1: Write the failing test:** teste de contraste que lê os tokens do CSS e falha se qualquer par texto/fundo dos estados normal, atrasado, fatal, concluído, link e foco ficar abaixo de 4,5:1 (3:1 para elementos grandes) nos modos claro e escuro.
- [ ] **Step 2: Run** → FAIL com a paleta nova aplicada parcialmente. **Step 3: Aplicar** a paleta e o acabamento visual (skill `frontend-design`), revisar em 360 / 768 / 1280 px com capturas e comparar com a direção visual. **Step 4: Run** testes e build. **Step 5: Commit** `feat(web): final visual identity`.

---

### Task 6: Testes de navegador das jornadas principais

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/{auth,tasks,views,settings,assistant}.spec.ts`
- Modify: `apps/web/package.json` (script `e2e`), `README.md`

**Interfaces:** os testes sobem Supabase local (553xx), API (3001, com modelo **falso** do assistente ativado por variável de teste) e painel (3000) e percorrem: cadastro/login/saída (e rota protegida redirecionando), criar tarefa por formulário e por adição rápida, concluir com um clique e ver em Dia/Semana/Mês, calcular prazo e criar tarefa a partir dele, mudar fuso em Configurações com aviso de `skipped`, cadastrar/remover feriado, barra de comando (Ctrl/Cmd+K) criando tarefa com o modelo falso, Histórico e reabrir. Rodam em Chromium; capturas de tela em falha.

- [ ] **Step 1: Write the failing e2e specs** (uma jornada por arquivo, cada asserção sobre o que o usuário vê). **Step 2: Run** `pnpm --filter @nexus/web e2e` → FAIL onde faltar cola. **Step 3: Implement** o que faltar (seeds de teste, variáveis, limpeza entre testes — dados isolados por usuário criado no teste). **Step 4: Run** 3 vezes seguidas, **0 falhas**. **Step 5: Commit** `test(web): browser journeys`.

---

### Task 7: Dados de demonstração e roteiro para o cliente

**Files:**
- Create: `apps/api/scripts/seed-demo.ts` (+ teste), `docs/archive/planejamento/notes/2026-roteiro-demo.md`

**Interfaces:** `seed-demo` cria (ou recria) **um** usuário de demonstração **somente no Supabase local deste projeto (553xx)**, com ~25 tarefas fictícias realistas (prazos fatais, audiências com hora, atrasadas, concluídas, feriados locais) distribuídas em torno da data atual; recusa rodar se a URL do Supabase não for a local deste projeto; marca tudo como fictício. O roteiro de demo (1 página) lista a sequência de 10 minutos: briefing, visões, status, calculadora, barra de comando, Telegram, lembrete.

- [ ] **Step 1: Write the failing tests:** o script recusa URL que não seja `127.0.0.1:55321`; é idempotente (rodar duas vezes não duplica); cria exatamente os tipos de tarefa esperados e nenhuma linha de outro usuário; datas relativas ao relógio injetado.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** testes e executar o script uma vez no ambiente local, descrevendo o resultado. **Step 5: Commit** `feat: demo data seed and demo script`.

---

### Task 8: Publicação, observabilidade e operação (depende das decisões (b), (c), (d) da Task 1)

**Files:**
- Create: `docs/archive/planejamento/notes/2026-runbook-publicacao.md`, arquivos de build/implantação conforme a hospedagem escolhida (por exemplo `Dockerfile` da API ou configuração do provedor), `apps/api/src/observability.ts` (+ teste)
- Modify: `README.md`, `.env.example`

**Interfaces:** runbook com passo a passo e **comandos que o usuário executa** (criar o projeto Supabase, aplicar migrações — `supabase db push` só contra o projeto do usuário —, configurar Auth/e-mail, variáveis de ambiente por serviço **sem valores no Git**, registrar o webhook do Telegram, registrar o agendador, DNS/domínio, backups e restauração, rotação de segredos); `observability.ts` padroniza o log estruturado (nível, evento, ids, duração, **sem** texto de usuário) e o relato de erros (gancho para um serviço escolhido na Task 1; padrão: log estruturado) com teste de que nenhum campo proibido (`text`, `title`, `token`, `authorization`) chega ao log; health checks (`/health` e um `/health/deep` interno que testa banco e, opcionalmente, IA sem gastar tokens).

- [ ] **Step 1: Write the failing tests:** o logger remove/recusa campos proibidos (teste com objeto contendo `text`, `title`, `authorization`); `/health/deep` exige o segredo interno e devolve estado do banco sem detalhes sensíveis.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** código e runbook. **Step 4: Run** testes e revisar o runbook linha a linha com o usuário. **Step 5: Commit** `docs: publication runbook and observability`.
- **Nenhum deploy é executado por este plano**: só o preparo; o ato de publicar é do usuário (ou de pedido explícito dele).

---

### Task 9: Relatório final de aceitação

**Files:**
- Create: `docs/archive/planejamento/notes/2026-relatorio-aceitacao.md`

**Interfaces:** tabela dos **critérios de aceitação da spec §10** (um por linha) com a evidência: teste automatizado (arquivo e nome), resultado da avaliação da IA, ou verificação manual; riscos residuais; pendências de decisão do usuário.

- [ ] **Step 1:** montar a tabela com evidências reais (rodar `pnpm test`, `pnpm --filter @nexus/api test:db`, `pnpm --filter @nexus/web e2e`, `pnpm typecheck`, `pnpm --filter @nexus/web build` e colar as saídas). **Step 2:** qualquer critério sem evidência vira item aberto, **não** é marcado como atendido. **Step 3: Commit** `docs: acceptance report`.

---

## Rulings deste plano (decididos aqui; contestáveis)

- **P6-1:** limite de requisições em memória por instância (sem Redis) para a primeira publicação de um usuário; se a API rodar em várias instâncias, trocar por limite compartilhado (decisão registrada na Task 3). Custo se errado: adicionar armazenamento compartilhado.
- **P6-2:** a avaliação da IA roda contra repositórios em memória (não contra o banco) para isolar o comportamento do modelo; o banco já é coberto pelos testes dos Planos 2 e 4. Custo se errado: repetir um subconjunto contra o banco local.
- **P6-3:** Playwright roda localmente (e em CI se o usuário publicar o repositório); **sem** dados reais e com o modelo falso do assistente, para não gastar tokens nem depender de rede.
- **P6-4:** nenhuma publicação automática: o plano entrega o runbook e o preparo; executar o deploy é decisão do usuário.
