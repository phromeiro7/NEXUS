# Status do projeto e o que falta

Atualizado em 2026-10-29. Este documento é o ponto de partida para retomar o trabalho: o que está
pronto, o que falta, o que depende de decisão ou de conta externa e o que ainda não foi verificado.

Referências: especificação em `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md`;
planos de implementação em `docs/superpowers/plans/` (um por etapa, numerados de 1 a 6).

## Visão geral

| Plano | Escopo | Situação |
|---|---|---|
| 1 | Fundação e domínio (monorepo, banco, RLS, calculadora de prazos, lembretes) | Concluído |
| 2 | API de tarefas, processos, feriados, configurações, briefing | Concluído |
| 3 | Painel web (login, Dia/Semana/Mês, formulários, calculadora, histórico, configurações) | Concluído; **nunca visto num navegador real** |
| 4 | Assistente de IA (barra de comando) e briefing em texto | **Em andamento** (rascunho de PR; ver abaixo) |
| 5 | Telegram, envio de lembretes e agendador | Não iniciado (plano escrito) |
| 6 | Acabamento, avaliação da IA, segurança, publicação | Não iniciado (plano escrito) |

Os PRs formam uma pilha: o PR do Plano 1 aponta para `main`, o do Plano 2 para o ramo do Plano 1, e
assim por diante. Revise e integre na ordem.

## O que funciona hoje (Planos 1 a 3)

- **API** (Hono, porta 3001): tarefas, processos, feriados locais, configurações, briefing e cálculo de
  prazos em dias úteis/corridos, com isolamento por usuário (filtro explícito + RLS) e lembretes gravados
  na fila (`reminders`). Rotas e erros: README, seção "API".
- **Painel** (Next.js, porta 3000): entrar, criar conta, recuperar e redefinir senha; Painel com adição
  rápida e visões Dia, Semana e Mês; troca de status com um clique; criar, editar e excluir tarefas;
  calculadora de prazos; histórico; configurações e feriados locais. Como subir tudo localmente: README,
  seção "Painel".
- **Banco local** (Supabase, projeto `assistente-juridico`, portas 553xx): migrações 0001 a 0004.
- Testes: shared 63, API 312, painel 263 (unitários); suíte de banco com 106 testes.

## Plano 4 — assistente de IA (em andamento)

Ramo `feat/plano-4-assistente-ia`, aberto como rascunho. **Não integre como está.**

- **Task 1** (contratos compartilhados e `renderBriefing` em texto): concluída e revisada.
- **Task 2** (persistência de mensagens e eventos, migração 0005): implementada e revisada; a revisão
  apontou três pontos importantes e a correção está **incompleta** no último commit (`wip`): os testes
  unitários e o typecheck passam, mas a suíte de banco **não foi rodada de novo** depois da edição no lugar
  da migração 0005 e essa rodada não foi revisada. Decisões da correção:
  - filtrar por usuário e exigir pré-condição de estado em `markProcessed`, `markFailed` e `beginModelCall`;
  - contar **chamadas ao modelo** numa tabela `assistant_model_calls` (função SQL atômica
    `begin_model_call`), e não eventos recebidos, para o limite de 30 mensagens por hora;
  - blocos de raciocínio (`thinking`) do modelo passam adiante sem alteração no ciclo de ferramentas.
- **Tasks 3 a 8**: não começaram (ferramentas e executor, prompt e adaptador Anthropic, `processMessage`,
  rota `POST /assistant/message`, barra de comando no painel, roteiro manual e custos).
- Pontos a tratar na Task 5, vindos das revisões: empate de horário em `recent` (use horários distintos
  por mensagem ou uma sequência), evento preso em `recebido`/`processando` (responder "em processamento" e
  tratar `processando` com mais de 2 min como reprocessável) e descartar mensagem inicial do assistente no
  contexto.
- `max_tokens` do modelo é 4096 (não 1024): o raciocínio adaptativo do Haiku 5.5 conta no limite.

## Plano 5 — Telegram, lembretes e agendador (não iniciado)

Depende do Plano 4 (`processMessage`, repositórios de conversa e eventos, `renderBriefing`). Inclui: nota
de verificações obrigatórias da spec §12 (pg_cron/pg_net, pausa de projetos gratuitos, hospedagem, Bot API),
funções SQL de fila (reserva com `FOR UPDATE SKIP LOCKED`), enviador de lembretes com nova tentativa e
recuperação, envio do briefing pelo Telegram, endpoint interno do agendador, vínculo por código, webhook e
tela de vínculo no painel. Decisão já tomada: tarefa `fatal` com hora **mantém** só `antecipado` e
`no_horario`. O texto "Vínculo disponível em breve" em Configurações é um espaço reservado até lá.

## Plano 6 — acabamento e publicação (não iniciado)

Decisões do usuário, paleta definitiva, dívidas técnicas, limites de uso nas rotas, revisão de segurança,
avaliação da IA (~50 frases), testes de navegador, dados de demonstração e runbook de publicação.

## Depende de você (decisões e contas)

- **Chave da API da Anthropic** (console.anthropic.com, créditos pré-pagos): só para o roteiro manual do
  Plano 4 e a avaliação da IA do Plano 6; os testes automáticos usam modelo falso.
- **Bot do Telegram** (criar no BotFather): só para uso real; os testes usam Telegram falso.
- **Paleta e identidade visual definitivas** (hoje provisórias, em tokens CSS `apps/web/app/globals.css`).
- **Hospedagem** da API e do painel e **plano do Supabase** (spec §12: pausa por inatividade, `pg_cron`).
- **Retenção de dados e aviso de privacidade/LGPD** (spec §14); provedor de e-mail do Supabase Auth.
- **Validação por advogado** da regra de contagem de prazos (exclui o dia da publicação, inclui o do
  vencimento; úteis pulam fins de semana e feriados; corridos prorrogam para o próximo dia útil).
- Dados reais de clientes não devem entrar no repositório nem em fixtures.

## Ainda não verificado

- O painel **nunca foi aberto num navegador real**: só a API foi exercitada ponta a ponta. Falta conferir
  layout em 360, 768 e 1280 px, contraste medido, navegação por teclado/leitor de tela e os
  redirecionamentos do lado do cliente.
- Nada foi implantado; o runbook de publicação é do Plano 6.
- O comportamento real do modelo de IA e do Telegram ainda não foi exercitado (Planos 4 e 5).

## Dívidas técnicas conhecidas (backlog)

**Da API (Plano 2):** paginação de `GET /tasks`; regra para tarefa em processo arquivado; comportamento de
`{ deadline, dueDate: null }` no `update`; `p_drafts` nulo, duplicado e tarefa de outro usuário em
`replace_pending_reminders`; centralizar o regex de UUID e `UNIQUE_VIOLATION`; teste do argumento do
`console.error`; limite de requisições nas rotas; nota de produto: tarefa só com data criada depois das 08h do
próprio dia não ganha o lembrete `no_dia` (o briefing cobre).

**Do painel (Plano 3):** `minimum_password_length = 8` no `supabase/config.toml` (hoje 6 no servidor, 8 no
painel); verificação de recuperação de senha "fail-closed" e `AuthSession.user.id` obrigatório; mostrar
`configError` nas telas de login; trava contra duplo clique nas confirmações de exclusão; medir o contraste
com ferramenta; testes de mudança de fuso e de configurações que chegam tarde; extrair `DeadlineFields`
compartilhado e unificar `FIELD_MESSAGE`/`errorsFromIssues`; reavaliar o Turbopack (hoje `--webpack`, ver
`apps/web/next.config.ts`); teste de virada de meia-noite em `todayIn`; ampliar a visão Semana em telas
largas; teste que fixe o `cancelQueries` ao limpar o cache; varredura de `service_role` também fora de
`apps/web`.

## Como retomar

- Ramos: `pr/plano-1-…`, `pr/plano-2-…`, `pr/plano-3-…` (pilha de PRs, um por plano) e
  `feat/plano-4-assistente-ia` (rascunho). O processo seguido: um implementador por tarefa e uma revisão por
  tarefa, correções em rodadas e revisão final do ramo; cada decisão tomada fica registrada como "Ruling".
- O ledger do Plano 4 (decisões e pendências) ficava em `.superpowers/sdd/` (fora do Git); o essencial está
  neste documento.
- Banco local: `./apps/api/node_modules/.bin/supabase start --workdir .` (portas 553xx, projeto
  `assistente-juridico`). Nunca rode `db reset` nem outros comandos contra outra stack Supabase da máquina.
- Variáveis: nomes em `.env.example`; valores só em `apps/api/.env` e `apps/web/.env.local` (ignorados pelo Git).
