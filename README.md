# assistente_juridico

Assistente de prazos e tarefas para advogados, multiusuário. Os dados dos
clientes são confidenciais: cada usuário só enxerga o que é seu (RLS no banco).

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

Erros respondem JSON `{ error: <código>, ... }`:

| Código | Status | Quando |
| --- | --- | --- |
| `entrada_invalida` | 400 | Corpo, query ou parâmetro inválido |
| `nao_autenticado` | 401 | Token ausente ou inválido |
| `nao_encontrado` | 404 | Recurso inexistente ou de outro usuário |
| `numero_ja_cadastrado`, `feriado_ja_cadastrado`, `tarefa_encerrada`, `transicao_invalida` | 409 | Conflito |
| `corpo_muito_grande` | 413 | Corpo da requisição acima de 64 KB (verificado antes da autenticação) |
| `hora_invalida` | 422 | Hora local inexistente ou ambígua no fuso do usuário (`reason`) |
| `erro_interno` | 500 | Erro inesperado (detalhes só no log do servidor) |

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

`apps/api/src/compose.ts` exporta `buildApp(config, { clock? })`, que monta a API real (usada por `server.ts`); `apps/api/test/db/api.db.test.ts` a exercita ponta a ponta com usuários e tokens reais e relógio fixo (`pnpm --filter @aj/api test:db`).

> Atenção: nunca rode `db reset` contra uma stack que não é sua; ele apaga o banco.
