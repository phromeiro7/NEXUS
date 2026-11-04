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
| `POST /telegram/link-codes` | Gera o código de vínculo do Telegram (`{ code, deepLink, expiresAt }`) |
| `DELETE /telegram/link` | Desvincula o Telegram da conta (`204`) |
| `POST /telegram/webhook` | Webhook do bot (sem token de usuário; exige `X-Telegram-Bot-Api-Secret-Token`) |
| `POST /internal/reminders/run` | Passada do agendador (interna, sem token de usuário; exige `X-Internal-Secret`) |

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
| `agendador_desabilitado` | 503 | `INTERNAL_SECRET` ausente: a rota interna do agendador fica desabilitada |
| `telegram_nao_configurado` | 503 | `TELEGRAM_BOT_USERNAME` ausente: não há link de vínculo |
| `webhook_desabilitado` | 503 | `TELEGRAM_WEBHOOK_SECRET` (ou o bot) ausente: o webhook fica desabilitado |
| `assistente_indisponivel` | 503 | O assistente não pôde responder e nada foi gravado; `reason`: `timeout`, `rede`, `limite`, `servico` ou `configuracao` |

### Agendador interno (lembretes, briefing e limpezas)

`POST /internal/reminders/run` não usa o token de usuário: exige o cabeçalho `X-Internal-Secret`,
comparado em tempo constante com `INTERNAL_SECRET`. O corpo é ignorado e só `POST` é aceito.

- `503` `{ "error": "agendador_desabilitado" }`: `INTERNAL_SECRET` não está configurado (falha fechada;
  a checagem vem antes de olhar o cabeçalho).
- `401` `{ "error": "nao_autenticado" }`: cabeçalho ausente ou errado (sem nenhum detalhe).
- `200`: só contagens, `{ reminders, briefings, eventsRecovered, purged }`. Cada etapa (recuperar eventos
  presos, lembretes, briefings, três limpezas) é isolada: se uma falha, o erro é registrado só pelo nome e ela
  conta zero. Sem `TELEGRAM_BOT_TOKEN` a rota ainda recupera, cancela e limpa, mas não envia nada.

Variáveis (só os nomes; valores ficam no ambiente): `INTERNAL_SECRET`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.

Para disparar uma passada localmente (a API precisa estar no ar):
`pnpm --filter @aj/api reminders:tick`. O script lê `INTERNAL_SECRET` do ambiente ou do arquivo
`apps/api/.env` (ignorado pelo Git), então o segredo não precisa ser digitado no shell. `REMINDERS_URL`
(padrão `http://localhost:3001`) aponta para outra API; `http:` só é aceito para localhost, e qualquer outro
destino precisa de `https:`. O script não segue redirecionamentos, imprime só o status HTTP e as contagens
(em erro, só o código conhecido da API) e sai com código diferente de zero se o status não for 200. Em produção, um agendador externo deve chamar a rota a
cada minuto (veja "Telegram e lembretes: runbook", abaixo).

**Laço local provisório.** `pnpm --filter @aj/api reminders:loop` repete o `reminders:tick` a cada 60 s
(`REMINDERS_LOOP_SECONDS`, de 5 a 3600) até Ctrl+C ou SIGTERM; uma passada que falha vira só a linha
`tick falhou` e o laço segue. Com a API em outra porta: `REMINDERS_URL=http://localhost:3201 pnpm --filter @aj/api reminders:loop`.
Serve para testar em desenvolvimento; em produção troque pelo `pg_cron` do runbook (passo 6) ou por um Cron
da hospedagem (por exemplo, o Vercel Cron chamando `POST /internal/reminders/run` com o cabeçalho
`X-Internal-Secret`) e não deixe o laço rodando num notebook.

### Telegram (vínculo e webhook)

- `POST /telegram/link-codes` (autenticado) gera um código de 8 caracteres (alfabeto sem ambíguos,
  `crypto` com amostragem por rejeição), de uso único, válido por 10 minutos; um código novo invalida os
  anteriores do usuário. Resposta: `{ code, deepLink: "https://t.me/<bot>?start=<code>", expiresAt }`.
  Sem `TELEGRAM_BOT_USERNAME` responde `503` `telegram_nao_configurado`.
- `DELETE /telegram/link` (autenticado) desvincula o chat (`204`); a fila de lembretes é mantida, mas nada é
  reservado enquanto não houver chat.
- `POST /telegram/webhook` não usa token de usuário: exige o cabeçalho `X-Telegram-Bot-Api-Secret-Token`
  igual a `TELEGRAM_WEBHOOK_SECRET` (o mesmo valor do `secret_token` do `setWebhook`), comparado em tempo
  constante. Sem o segredo (ou sem o bot) configurado: `503` `webhook_desabilitado`, antes de olhar o
  cabeçalho; cabeçalho ausente ou errado: `401` `nao_autenticado`. Depois disso a resposta é sempre `200`
  (corpo inválido, chat que não é privado, mensagem editada e erros internos são ignorados ou registrados só
  pelo nome do erro). O processamento termina antes do `200` e a idempotência é por `update_id`.

Comandos do bot (só em chat privado): `/start CÓDIGO` vincula o chat à conta que gerou o código;
`/desvincular` remove o vínculo. Mensagens de texto vão ao assistente (resposta em texto simples; responder a
uma confirmação do bot edita aquela tarefa); outros tipos de mensagem recebem "Por enquanto só entendo
texto.". Falhas de `/start` são limitadas a 5 em 10 minutos por chat (em memória, por instância).

Nota de segurança: um código de vínculo é um token ao portador. Quem o enviar ao bot liga o próprio Telegram
à conta que o gerou, e quem o enviar a uma vítima (login CSRF) a induz a ligar o chat dela à conta do
atacante. Por isso a confirmação diz QUAL conta foi ligada, com o e-mail mascarado (`Conta vinculada: p***@dominio. ...
Se você não reconhece esta conta, envie /desvincular agora.`; sem e-mail disponível, o texto genérico
"Conta vinculada!" manda enviar `/desvincular` se o código não foi gerado pelo usuário). O e-mail inteiro nunca
aparece em respostas nem em logs. `/comando@outro_bot` só é comando se o sufixo for o nome do nosso bot
(`TELEGRAM_BOT_USERNAME`, sem distinguir maiúsculas); os comandos também não distinguem maiúsculas. Um chat só pode estar ligado a uma conta (`Este Telegram já está ligado a outra conta.`).

Variáveis (só os nomes): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`.

### Telegram e lembretes: runbook

Fatos verificados de infraestrutura (limites do `pg_net`, Vault, Vercel, Bot API):
[docs/superpowers/notes/2026-verificacoes-infra.md](docs/superpowers/notes/2026-verificacoes-infra.md).

**1. Criar o bot.** No Telegram, abra o @BotFather, envie `/newbot` e escolha nome e username (termina em
`bot`). O BotFather devolve o token: ele vai **só** para variável de ambiente, nunca para o repositório,
logs, issues ou mensagens. Se vazar, use `/revoke` no BotFather e gere outro.

**2. Variáveis de ambiente** (só os nomes; valores ficam fora do Git):

- `TELEGRAM_BOT_TOKEN`: token do BotFather.
- `TELEGRAM_BOT_USERNAME`: username do bot **sem** `@` (monta o link `https://t.me/<bot>?start=<código>`).
- `TELEGRAM_WEBHOOK_SECRET`: segredo que você inventa (16 a 256 caracteres de `A-Z a-z 0-9 _ -`; gere com
  `openssl rand -hex 32`). Sem ele o webhook responde `503`.
- `INTERNAL_SECRET`: segredo do agendador (mínimo de 16 caracteres; também `openssl rand -hex 32`). Sem ele a rota interna responde `503`.

**3. Registrar o webhook** (depois que a API estiver no ar em HTTPS, no domínio de produção). Com o token e o
segredo nas variáveis do shell e `<API>` o endereço público:

```sh
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=<API>/telegram/webhook" \
  -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
  -d 'allowed_updates=["message"]'

curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Antes de vincular qualquer conta, confira com `getWebhookInfo` que `url` é o endereço esperado, que
`last_error_message` está ausente e que `pending_update_count` não cresce. `deleteWebhook` desfaz. Com `secret_token`, o Telegram
envia `X-Telegram-Bot-Api-Secret-Token` em cada chamada, e a API compara com `TELEGRAM_WEBHOOK_SECRET`.

**4. Testar sem bot real.** Os testes usam Telegram falso (`apps/api/test/fakes.ts`) e modelo falso: nada sai
para a internet e nada gasta dinheiro. A jornada completa (código, `/start`, mensagem que cria tarefa, resposta
que a altera, lembrete enviado uma vez, conclusão) é o teste `apps/api/test/db/telegram-e2e.db.test.ts`, contra o
Supabase local e com relógio fixo: `pnpm --filter @aj/api test:db`.

**5. Rodar uma passada do agendador localmente.** Com a API no ar e `INTERNAL_SECRET` em `apps/api/.env`:
`pnpm --filter @aj/api reminders:tick` (veja "Agendador interno").

**6. Apontar o agendador em produção** (uma chamada por minuto). Opção A, preferida: `pg_cron` + `pg_net` + Vault
no Supabase. Guarde o segredo e a URL no Vault (os valores reais só no SQL Editor do projeto, nunca no Git):

```sql
select vault.create_secret('<INTERNAL_SECRET>', 'internal_secret');
select vault.create_secret('https://<dominio-de-producao-da-api>', 'api_base_url');

select cron.schedule('reminders-tick', '* * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'api_base_url')
           || '/internal/reminders/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'internal_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
```

`timeout_milliseconds` precisa ser explícito: o padrão do `pg_net` é 2000 ms. O pior caso real do endpoint é de
cerca de 45 s: o orçamento de 15 s dos lembretes é verificado antes de cada item, então o último pode começar
perto dos 15 s e levar um envio (até 10 s) mais a ressincronização; o orçamento de 8 s dos briefings também é
verificado por destinatário; e ainda há a recuperação e as limpezas. Como a chamada é de minuto em minuto,
60000 ms cobre esse pior caso sem esconder uma travada de verdade (um `timed_out` em `net._http_response`
passa a significar problema real). Se a resposta for descartada ou a execução for cortada, o resultado parcial
é seguro: lembretes que ficaram `enviando` voltam a `pendente` depois de 5 minutos e são reenviados (garantia
"pelo menos uma vez"). O briefing é "no máximo uma vez" só para queda de processo depois de reservar o dia:
nesse caso o briefing daquele dia se perde. Uma falha transitória de envio (inclusive o corte de 10 s do
cliente) libera a reserva, e o minuto seguinte pode enviar de novo, dentro da janela de 4 h; por isso um
briefing repetido é possível. Confirme que `pg_cron` e `pg_net` estão habilitados no projeto (a documentação
oficial não confirma a disponibilidade no plano gratuito).

**Rotação do segredo.** `vault.create_secret(..., 'internal_secret')` falha se o nome já existe. Para trocar o
valor: `select vault.update_secret((select id from vault.secrets where name = 'internal_secret'), '<novo valor>');`
e atualize `INTERNAL_SECRET` na API. O `cron.schedule` com o mesmo nome (`reminders-tick`) é idempotente.

**Acesso ao schema `net`.** O `pg_net` grava a requisição, com o cabeçalho `X-Internal-Secret` já decifrado, em
`net.http_request_queue` até enviá-la. Restrinja quem pode ler o schema `net` (e a view
`vault.decrypted_secrets`) a papéis de administração; não os exponha ao `anon`/`authenticated`.

Opção B: um cron externo (qualquer serviço) que faça o mesmo `POST <dominio-de-producao>/internal/reminders/run`
a cada minuto com o cabeçalho `X-Internal-Secret: <INTERNAL_SECRET>`; o código não muda.

Em qualquer opção, o agendador deve apontar para o **domínio de produção**, nunca para URLs de preview (a
proteção de implantação da Vercel as bloqueia; o domínio de produção fica de fora da proteção padrão).

**Hospedagem.** O alvo é a Vercel (domínio gratuito `*.vercel.app`; o plano Hobby é só para uso não comercial).
A função precisará de `maxDuration` de pelo menos 60 s (o padrão do plano Hobby é menor), porque a execução
não é abortada no meio de um envio. **Ainda falta** o adaptador que expõe a API Hono como função da Vercel (um entrypoint de função): ele **não foi
construído**. Hoje a API só sobe como servidor Node (`src/server.ts`); sem o adaptador, o webhook e o agendador
não têm onde receber chamadas em produção.

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

A API grava a fila de lembretes e o agendador interno os envia pelo Telegram (veja "Telegram e
lembretes: runbook"). As regras que o enviador cumpre (tarefa ainda viva, reagendamento durante o
envio, lembretes vencidos, tarefa criada no próprio dia, `fatal` com hora) estão em "Contrato do
enviador de lembretes", §7 de `docs/superpowers/specs/2026-10-26-assistente-juridico-design.md`.

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
quando a API devolve `skipped`), vínculo com o Telegram por código (gerar, desvincular, aviso de canal
pausado; o envio dos lembretes e do resumo pelo Telegram existe) e feriados locais.

**O que não está:** barra de comando e IA (Plano 4; há um espaço reservado no cabeçalho),
tela de Processos (fora do escopo; o processo só aparece como referência na tarefa). A paleta de cores
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
