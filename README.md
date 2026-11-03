# assistente_juridico

Assistente de prazos e tarefas para advogados, multiusuário. Os dados dos
clientes são confidenciais: cada usuário só enxerga o que é seu (RLS no banco).

Situação do projeto, o que falta e as decisões em aberto: [docs/STATUS.md](docs/STATUS.md).

## Estrutura

- `apps/api`: API em Hono (`domain/` e `application/` sem dependência de framework; `infra/` fala com o Supabase).
- `packages/shared`: tipos e schemas zod compartilhados (`@aj/shared`).
- `supabase/`: `config.toml` e migrations do banco.
- `docs/`: especificação e planos.

## Comandos

```sh
pnpm install
pnpm test        # testes unitários, sem Docker
pnpm typecheck
```

## API

A API escuta na porta **3001** por padrão (`PORT`); o painel Next.js usará a 3000.
`WEB_ORIGIN` define a única origem de navegador autorizada por CORS (padrão
`http://localhost:3000`; vazio usa o padrão). O valor é normalizado para a origem
(`https://painel.example.com/` vira `https://painel.example.com`; caminho é
descartado) e a API não sobe se ele não for uma URL absoluta. Todas as rotas, exceto `/health`,
exigem `Authorization: Bearer <token>`. Corpos acima de 64 KB são recusados antes da
autenticação. Veja `.env.example` para as variáveis.

| Rota | Descrição |
| --- | --- |
| `GET /health` | Verificação de saúde (pública) |
| `GET /me` | Usuário autenticado |
| `POST /deadlines/calculate` | Calcula um prazo |
| `GET/POST /tasks`, `GET/PATCH/DELETE /tasks/:id` | Tarefas |
| `GET/POST /cases`, `GET/PATCH /cases/:id` | Processos (`GET /cases?status=ativo\|arquivado`) |
| `GET/POST /holidays`, `DELETE /holidays/:id` | Feriados do usuário |
| `GET/PATCH /settings` | Configurações (o `PATCH` reconstrói lembretes quando preciso) |
| `GET /briefing` | Briefing diário |
| `POST /assistant/message` | Mensagem ao assistente de IA (painel) |

Erros respondem JSON `{ error: <código>, ... }`:

| Código | Status | Quando |
| --- | --- | --- |
| `entrada_invalida` | 400 | Corpo, query ou parâmetro inválido (inclui mensagem vazia ou acima de 1.000 caracteres) |
| `nao_autenticado` | 401 | Token ausente ou inválido |
| `nao_encontrado` | 404 | Recurso inexistente ou de outro usuário |
| `numero_ja_cadastrado`, `feriado_ja_cadastrado`, `tarefa_encerrada`, `transicao_invalida` | 409 | Conflito |
| `em_processamento` | 409 | O mesmo `clientMessageId` ainda está sendo processado; tente de novo em instantes |
| `conflito_de_evento` | 409 | O `clientMessageId` já foi usado em outra conta (não revela de quem) |
| `corpo_muito_grande` | 413 | Corpo da requisição acima de 64 KB (verificado antes da autenticação) |
| `hora_invalida` | 422 | Hora local inexistente ou ambígua no fuso do usuário (`reason`) |
| `limite_de_mensagens` | 429 | Mais de 30 chamadas ao assistente na última hora (por usuário); traz `retryAfterSeconds` e o header `Retry-After` |
| `erro_interno` | 500 | Erro inesperado (detalhes só no log do servidor; nunca o texto do usuário) |
| `assistente_indisponivel` | 503 | O assistente não pôde responder e nada foi gravado; `reason`: `timeout`, `rede`, `limite`, `servico` ou `configuracao` |

### Assistente de IA

`POST /assistant/message` (autenticado) recebe `{ "text": string, "clientMessageId": uuid }`
(`text` de 1 a 1.000 caracteres, após remover espaços nas pontas) e responde `200` com
`{ "reply": string, "affectedTasks": TaskDto[] }`: o texto para o usuário e as tarefas criadas,
alteradas ou concluídas nesse pedido. O usuário vem só do token, nunca do corpo.

- `clientMessageId` é a chave de idempotência: reenviar o mesmo id devolve a mesma resposta
  sem executar nada de novo (gere um id novo a cada mensagem; reuse-o só ao reenviar após falha
  de rede).
- Se a falha acontece **depois** de o assistente já ter gravado algo, a resposta continua `200`
  com um texto verdadeiro do que foi feito (`affectedTasks` traz só o que foi gravado) e pede
  para reenviar apenas o que faltou. O `503` só ocorre quando nada foi gravado, e então o mesmo
  `clientMessageId` pode ser reenviado.
- Configuração: `ANTHROPIC_API_KEY` (chave da API da Anthropic; só no servidor) e
  `ASSISTANT_MODEL` (opcional; o padrão é o modelo Haiku configurado em `config.ts`). Sem
  `ANTHROPIC_API_KEY` a API sobe normalmente, todas as outras rotas funcionam e esta rota
  responde `503` com `{ "error": "assistente_indisponivel", "reason": "configuracao" }`.

**Assistente (custos e roteiro com o modelo real).** O assistente gasta dinheiro a cada mensagem
(chamadas ao modelo da Anthropic). A nota `docs/superpowers/notes/2026-assistente-custos.md` explica
como criar a chave com teto mensal, as premissas de preço e o que reduz o custo. O roteiro manual
`pnpm --filter @aj/api smoke:assistant` roda ~10 frases fictícias sobre repositórios em memória; sem
`--yes` só mostra o máximo de chamadas e a estimativa de custo e não chama nada. Ele nunca imprime a
chave. Os testes automáticos usam modelo falso e não gastam nada.

`PATCH /settings` responde `{ settings, remindersRebuilt, remindersSkipped, skipped }`
(`UpdateSettingsResultDto` em `@aj/shared`). Sempre que o corpo traz `timezone` ou
`earlyReminderMinutes`, os lembretes de todas as tarefas abertas com data são refeitos,
mesmo que o valor não tenha mudado (reenviar o mesmo valor completa uma reconstrução
que falhou). `skipped` lista as tarefas (`id`, `title`, `reason`: `hora_inexistente` ou
`hora_ambigua`) cuja hora não existe ou é ambígua no novo fuso: essas tarefas **mantêm
os lembretes calculados com o fuso/antecedência anteriores**, e o painel deve avisar o
usuário usando `skipped`. `remindersSkipped` é `skipped.length`.

A API só grava a fila de lembretes; o envio é do Plano 5. As regras que o enviador
precisa cumprir (tarefa ainda viva, reagendamento durante o envio, lembretes vencidos,
tarefa criada no próprio dia, `fatal` com hora) estão em "Contrato do enviador de
lembretes (Plano 5)", §7 de `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md`.

## Painel

`apps/web` é o painel Next.js (porta **3000**): `pnpm --filter @aj/web dev`. Ele não
acessa o banco; usa só `supabase.auth` e a API (um teste de contrato varre `apps/web`
contra `.from(`/`.rpc(` e `service_role`). Nunca use a service role no painel.

**Variáveis** (só nomes; os valores ficam fora do Git, em `apps/web/.env.local`, que o
Next lê a partir da pasta do app; `.env.example` na raiz lista os nomes):

- `NEXT_PUBLIC_API_URL`: URL da API (padrão `http://localhost:3001`).
- `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`: obrigatórias; se faltarem,
  a criação do cliente lança um erro que nomeia a variável, sem imprimir valores (a validação
  é feita ao criar o cliente, não na importação, para `next build` e os testes funcionarem
  sem ambiente).

**Ordem para subir tudo localmente** (três terminais, na raiz):

1. Supabase local (projeto `assistente-juridico`, portas 553xx):
   `./apps/api/node_modules/.bin/supabase start --workdir .` (veja "Banco local"). Copie a URL
   da API (`http://127.0.0.1:55321`) e a anon key que o comando imprime para
   `apps/web/.env.local`.
2. API, na porta 3001, autorizando o painel por CORS:
   `WEB_ORIGIN=http://localhost:3000 pnpm --filter @aj/api exec tsx watch --env-file=.env src/server.ts`.
   O `tsx watch` (e portanto `pnpm --filter @aj/api dev`) não lê `.env` sozinho: o
   `--env-file=.env` carrega `apps/api/.env` (crie-o a partir do `.env.example` da raiz; o
   arquivo precisa existir) e uma variável já definida no ambiente, como `WEB_ORIGIN` acima,
   tem precedência sobre o arquivo.
3. Painel: `pnpm --filter @aj/web dev` e abra `http://localhost:3000`.

Reabrir uma tarefa concluída ou cancelada (status volta para pendente) é permitido por
projeto: é o botão "Reabrir" do Histórico.

`dev` e `build` usam `--webpack`: o Turbopack não resolve os imports `./x.js` que apontam para
`.ts` dentro de `@aj/shared`. O motivo e como reverter estão em `apps/web/next.config.ts`.

**Auth local.** Em `supabase/config.toml`, `[auth.email]` está com `enable_confirmations = false`:
o cadastro entra direto, sem confirmar e-mail. Se você ligar a confirmação, o painel avisa para
confirmar e os e-mails de teste aparecem na interface web do servidor de e-mail local (porta 55324). A recuperação de senha envia o
link para `/nova-senha`; essa URL está em `additional_redirect_urls` do mesmo arquivo (reinicie
o Supabase local depois de alterar o `config.toml`).

**O que está implementado:** entrar, cadastro, recuperação e redefinição de senha; Painel com
adição rápida e visões Dia, Semana e Mês (hoje no fuso das configurações), resumo lateral,
troca de status otimista, criação, edição e exclusão de tarefas (prazo, audiência, vínculo a
processo existente); calculadora de prazos com criação de tarefa a partir do resultado;
histórico de tarefas concluídas (com canceladas opcionais); configurações (fuso, UF, cidade,
antecedência do lembrete, horário do resumo, aviso de tarefas que mantiveram lembretes antigos
quando a API devolve `skipped`) e feriados locais.

**O que não está:** barra de comando e IA (Plano 4; há um espaço reservado no cabeçalho),
vínculo e envio pelo Telegram (Plano 5; a tela mostra "Vínculo disponível em breve"), tela de
Processos (fora do escopo; o processo só aparece como referência na tarefa). A paleta de cores
é provisória e está isolada em tokens CSS em `apps/web/app/globals.css` para troca posterior.

## Banco local (testes de banco)

O Supabase CLI é devDependency de `apps/api`. Na raiz do repositório:

```sh
./apps/api/node_modules/.bin/supabase start --workdir .
pnpm --filter @aj/api test:db
./apps/api/node_modules/.bin/supabase db reset --workdir .   # reaplica as migrations
```

Este projeto usa `project_id` `assistente-juridico` e portas 553xx (API 55321,
Postgres 55322), para não colidir com outras stacks locais do Supabase nas
portas 543xx. Os testes de banco usam por padrão
`postgresql://postgres:postgres@127.0.0.1:55322/postgres` (sobrescreva com
`DATABASE_URL`). Variáveis da API: veja `.env.example`.

`apps/api/src/compose.ts` exporta `buildApp(config, { clock?, assistantModel? })` (o modelo falso só é usado em testes), que monta a API real (usada por `server.ts`); `apps/api/test/db/api.db.test.ts` a exercita ponta a ponta com usuários e tokens reais e relógio fixo (`pnpm --filter @aj/api test:db`).

> Atenção: nunca rode `db reset` contra uma stack que não é sua; ele apaga o banco.
