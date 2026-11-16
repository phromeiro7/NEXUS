# Verificações de infraestrutura (spec §12, itens 1, 2, 3, 4 e 7)

Data da consulta: **2026-10-30**. Todas as URLs abaixo foram lidas nessa data. Onde a documentação oficial não diz algo, está escrito "não confirmado"; nada foi respondido de memória.

## Divergências em relação ao plano

Nenhuma contradição direta com os pressupostos do plano (nome do cabeçalho do segredo, alfabeto do código, 429 com `retry_after`, limite de 4.096). Há três pontos de atenção que o controlador deve decidir antes das Tasks 3, 4, 5 e 11:

1. **Timeout do `pg_net` (padrão 2000 ms).** O plano (linha 7, `docs/archive/planejamento/plans/2026-10-27-plano-5-telegram-e-lembretes.md`) e o runbook (linha 215) falam em "pg_cron+pg_net faz um `POST`" sem mencionar timeout. O padrão de `net.http_post` é 2 s; o endpoint `/internal/reminders/run` (linha 161) pode levar mais. O `cron.schedule` do runbook deve passar `timeout_milliseconds` explícito (60000: o pior caso do endpoint é ~45 s) e o endpoint deve ser seguro se a resposta for descartada (já é: reserva com `SKIP LOCKED`, "pelo menos uma vez").
2. **Descrições de erro do Telegram não são documentadas oficialmente.** Linhas 100 e 102 do plano fixam `403 "Forbidden: bot was blocked by the user"` e `400 "chat not found"`. A Bot API oficial só documenta `ok`, `error_code`, `description` e `parameters.retry_after`; as frases exatas vêm de fontes não oficiais (ver §4). Recomendação: classificar por `error_code` (403 → permanente, qualquer descrição, o que também cobre "user is deactivated" e "bot can't initiate conversation"), e usar a descrição só para distinguir `bot_bloqueado` / `chat_inexistente` com comparação por substring e fallback `outro`. O caso "user is deactivated" (403) não aparece no plano.
3. **Limite de 1 mensagem/s por chat** (linha 135 e `runReminders`): o plano não espaça envios para o mesmo chat. Vários lembretes do mesmo usuário no mesmo minuto podem gerar 429; o tratamento por `retry_after` já cobre, mas convém enviar sequencialmente por chat (sem paralelismo) na Task 5.

Confirmados sem divergência: cabeçalho `X-Telegram-Bot-Api-Secret-Token` (constraints/plano linha 16); `secret_token` 1-256 caracteres `A-Z a-z 0-9 _ -`; `chat.type` `private`; limite 4.096 (linha 19 e 115); `retry_after` em segundos dentro de `parameters` (linha 100: `retryAfterMs = retry_after*1000`); alfabeto do código `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (linha 175) é subconjunto do charset permitido no deep link, com 8 caracteres ≤ 64; timeout de 10 s do `fetch` (linha 115) é escolha nossa, a Telegram não documenta timeout de cliente.

## Resumo

| # | Pergunta | Status | Resposta em uma linha | Fonte |
|---|---|---|---|---|
| 1a | `pg_cron` e `pg_net` no plano gratuito | não confirmado (documentação oficial silenciosa) | Os guias oficiais mandam habilitar em Integrations > Cron sem citar restrição de plano; nenhuma página oficial lida afirma "disponível no gratuito". Fontes de terceiros dizem que sim. Confirmar habilitando no projeto. | https://supabase.com/docs/guides/cron/install |
| 1b | Agendar HTTP por minuto com segredo no Vault | confirmado | `cron.schedule` + `net.http_post` lendo `vault.decrypted_secrets`; `* * * * *` serve. | https://supabase.com/docs/guides/functions/schedule-functions |
| 1c | Granularidade mínima | confirmado | 1 segundo (`'N seconds'`, 1-59, Postgres 15.1.1.61+); cron padrão de 5 campos = 1 minuto. | https://supabase.com/docs/guides/cron/quickstart |
| 1d | Limites do `pg_net` | confirmado | Timeout padrão 2000 ms; ~200 req/s; só POST com JSON (e GET/DELETE); respostas guardadas 6 h; API beta. | https://supabase.com/docs/guides/database/extensions/pg_net |
| 2 | Pausa do plano gratuito | confirmado | Pausa após 7 dias de baixa atividade; planos pagos nunca pausam; restaurável por até 1 ano. | https://supabase.com/docs/guides/platform/free-project-pausing |
| 3 | Hospedagem da API | depende do plano | Vercel Hobby (300 s, mas uso não comercial) ou Pro; Render/Fly/Railway pagos de ~US$ 2-7/mês; ver §3. | https://vercel.com/docs/functions/configuring-functions/duration |
| 4a | `setWebhook` + `secret_token` + cabeçalho | confirmado | `X-Telegram-Bot-Api-Secret-Token`; 1-256 caracteres `A-Z a-z 0-9 _ -`. | https://core.telegram.org/bots/api |
| 4b | `Update`/`Message`, `sendMessage`, 4096 | confirmado | Campos usados existem; `text` 1-4096 após parse de entidades; só `chat_id` e `text` obrigatórios. | https://core.telegram.org/bots/api |
| 4c | Limites de taxa e `retry_after` | confirmado | ~1 msg/s por chat, 20/min em grupo, ~30/s em massa; 429 traz `parameters.retry_after` (segundos). | https://core.telegram.org/bots/faq |
| 4d | Erros bloqueado / chat não encontrado / desativado | não confirmado (oficial) | Documentação oficial não lista as descrições; comunidade: 403 "bot was blocked by the user", 400 "chat not found", 403 "user is deactivated". | https://github.com/vrumger/telegram-errors |
| 4e | Retentativa do webhook | confirmado em parte | Resposta não 2xx = falha; Telegram tenta de novo e desiste "após um número razoável"; contagem/prazo não documentados. | https://core.telegram.org/bots/api#setwebhook |
| 4f | Deep link `/start <payload>` | confirmado | `A-Z a-z 0-9 _ -`, até 64; chega como texto `/start payload`. | https://core.telegram.org/bots/features |
| 4g | Chats privados | confirmado | `chat.type` ∈ private/group/supergroup/channel; filtrar `private` é suficiente. | https://core.telegram.org/bots/api |

## 1. Supabase: `pg_cron`, `pg_net` e Vault

Consultado em 2026-10-30.

- **Disponibilidade por plano: não confirmado.** `https://supabase.com/docs/guides/cron/install`, `https://supabase.com/docs/guides/cron`, `https://supabase.com/docs/guides/database/extensions/pg_net`, `https://supabase.com/docs/guides/database/extensions` e `https://supabase.com/blog/supabase-cron` não afirmam nem negam disponibilidade por plano. A instalação é "Integrations > Cron > habilitar `pg_cron`" ou `create extension pg_cron with schema pg_catalog;` (mesma página de install). Duas fontes de terceiros (tutorial RapidDev e post no DEV Community, achados por busca) dizem que está em todos os planos, mas não são oficiais. Ação: habilitar no projeto Supabase real antes de depender (custo: 1 minuto).
- **Agendamento por minuto com segredo no Vault** (https://supabase.com/docs/guides/functions/schedule-functions e https://supabase.com/docs/guides/database/vault). Forma documentada (adaptada ao nosso endpoint e cabeçalho `X-Internal-Secret`; o guia usa `apikey`):

```sql
select vault.create_secret('<valor-do-INTERNAL_SECRET>', 'internal_secret');
select vault.create_secret('https://<host-da-api>', 'api_base_url');

select cron.schedule(
  'reminders-tick',
  '* * * * *',
  $job$
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
  $job$
);
```

  O valor acima entre `<...>` é marcador, nunca um segredo real. Notas do guia: "qualquer papel que consegue logar no banco pode ler a chave enquanto a requisição espera", porque o `pg_net` grava o valor decifrado em `net.http_request_queue` até enviar; restringir acesso ao banco. Vault: `vault.create_secret(valor, nome, descrição)`, leitura pela view `vault.decrypted_secrets`; quem consulta a view lê o segredo (https://supabase.com/docs/guides/database/vault).
- **Granularidade mínima:** 1 s com sintaxe `'30 seconds'` (1-59 s; Postgres 15.1.1.61+); minuto com `* * * * *` (https://supabase.com/docs/guides/cron/quickstart; "de a cada segundo até uma vez por ano" em https://supabase.com/docs/guides/cron).
- **Limites do cron:** recomendação (não limite rígido) de no máximo 8 jobs simultâneos; cada job até 10 minutos (https://supabase.com/docs/guides/cron). `cron.job_run_details` não é limpo automaticamente: agendar limpeza (https://supabase.com/docs/guides/cron/quickstart).
- **Limites do `pg_net`** (https://supabase.com/docs/guides/database/extensions/pg_net): `timeout_milliseconds` padrão 2000; "configurada para executar de forma confiável até 200 requisições por segundo"; respostas em `net._http_response` por 6 h (`pg_net.ttl`); só GET, POST com JSON e DELETE (sem PUT/PATCH); tabelas não registradas em log (perdem-se em crash); assinatura "pode mudar" (beta); a requisição só é enviada após o commit da transação. O tamanho máximo de payload não é especificado.

## 2. Supabase: pausa de projetos gratuitos

Consultado em 2026-10-30 (https://supabase.com/docs/guides/platform/free-project-pausing e https://supabase.com/pricing). Confirmado:
- "Supabase pauses Free Plan projects that show low activity over a 7-day period." A página de preços diz: "Free projects are paused after 1 week of inactivity."
- O que evita a pausa: "tipicamente algumas requisições de usuário ao banco por dia na semana anterior"; abrir o projeto no Dashboard, chamadas de API ou requisições da aplicação contam como atividade.
- Aviso por e-mail cerca de uma semana antes e confirmação depois.
- Restauração: até 1 ano após a pausa, pelo Studio (a captura de tela da página diz "90 days remaining", inconsistência na própria documentação; https://supabase.com/docs/guides/platform/upgrading também cita 1 ano). Passado o prazo, só backup para download.
- Planos pagos não são pausados por inatividade; Pro a partir de US$ 25/mês (https://supabase.com/pricing).

Implicação para lembretes: o cron do próprio projeto roda dentro do banco, mas a pausa desliga o banco por inteiro, então nenhum lembrete sai enquanto pausado. Não está documentado se tarefas do `pg_cron` contam como "atividade de usuário"; não contar com isso. Para demo com uso diário (login, painel) a pausa não ocorre; para um piloto real com usuários que somem por dias, plano Pro. Atualizar para Pro enquanto pausado pode exigir restauração manual (relatos em discussões do GitHub, não oficial).

## 3. Hospedagem da API Hono (Node)

Consultado em 2026-10-30. Requisitos: (a) endpoint do agendador acessível sem proteção de implantação; (b) webhook do Telegram responde em ~20 s com chamada lenta de IA; (c) processo/função viva o suficiente.

| Opção | Duração/limites | Preço | Observações | Fonte |
|---|---|---|---|---|
| Vercel Hobby | função até 300 s (padrão e máximo, Fluid Compute) | grátis | **Uso não comercial apenas** ("restricts users to non-commercial, personal use only"); 1M invocações, 4 CPU-h ativos/mês | https://vercel.com/docs/plans/hobby ; https://vercel.com/docs/functions/configuring-functions/duration |
| Vercel Pro | 300 s padrão, até 800 s (30 min beta) | a partir de US$ 20 por usuário de desenvolvedor/mês (assento) + uso | exige ajuste de `maxDuration` | mesmas |
| Render | processo Node sempre ligado no plano pago; Free hiberna após 15 min sem tráfego e leva ~1 min para voltar, 750 h/mês | Starter 0,5 CPU/512 MB (US$ 7/mês segundo páginas de marketing da Render; a página de planos oficial não lista o preço) | Free é inadequado: hiberna e perde a chamada por minuto/webhook | https://render.com/docs/free ; https://render.com/docs/compute-plans |
| Fly.io | Máquina contínua; pode parar/religar automaticamente | shared-cpu-1x 256 MB: US$ 2,19 por 30 dias; sem franquia grátis para novas organizações (trial de 2 h de uso ou 7 dias) | exige Dockerfile/`fly.toml` | https://docs.fly.io/about/pricing |
| Railway | serviço contínuo | Hobby US$ 5/mês com US$ 5 de uso incluso; RAM US$ 10/GB/mês, CPU US$ 20/vCPU/mês; Free: US$ 1 de crédito/mês | cobra por uso | https://docs.railway.com/reference/pricing/plans |

- **Proteção de implantação na Vercel** (https://vercel.com/docs/deployment-protection, atualizada em 2026-09-15): "Standard Protection" (todos os planos) protege tudo **exceto domínios de produção**; "All Deployments" protege inclusive produção. Logo, o endpoint do agendador funciona em produção com Standard Protection, e deve apontar para o domínio de produção, nunca para URLs de preview/implantação (protegidas). A segurança fica no `X-Internal-Secret`, como na spec. Existe também "Protection Bypass for Automation" (segredo em cabeçalho), não necessário se usar o domínio de produção.
- **Duração:** o orçamento de ~20 s por mensagem cabe em qualquer opção acima (Vercel Hobby 300 s). O requisito (b) não restringe a escolha; o que restringe é uso comercial (Vercel Hobby), hibernação (Render Free) e custo.
- Vercel Hobby também seria suficiente tecnicamente para a demo, pois o agendador é o `pg_cron` do Supabase (sem Vercel Cron).

## 4. Telegram Bot API

Consultado em 2026-10-30.

**`setWebhook`** (https://core.telegram.org/bots/api, https://core.telegram.org/bots/api#setwebhook): parâmetros `url` (HTTPS), `certificate`, `ip_address`, `max_connections` (1-100, padrão 40), `allowed_updates`, `drop_pending_updates`, `secret_token`. Com `secret_token` (1-256 caracteres, só `A-Z a-z 0-9 _ -`), cada requisição leva o cabeçalho `X-Telegram-Bot-Api-Secret-Token` com o valor. Portas aceitas: 443, 80, 88, 8443 (https://core.telegram.org/bots/webhooks). `getWebhookInfo` (sem parâmetros, devolve `WebhookInfo`; `url` vazio se usa `getUpdates`) e `deleteWebhook` (`drop_pending_updates` opcional, devolve `True`).

**`Update` e `Message`:** `update_id` sempre presente; no máximo um dos ~28 campos opcionais (`message`, `edited_message`, `my_chat_member`...). `Message`: `message_id` (único no chat), `from` (opcional), `chat`, `text` (opcional), `reply_to_message` (opcional, sem aninhamento adicional). `Chat.type`: `private`, `group`, `supergroup` ou `channel`. Todos os campos que usamos existem. Não foi lido o texto completo de `User` (`from.id`, `from.is_bot`) nesta consulta; é de uso trivial e o plano só precisa de `chat.id`.

**`sendMessage`:** só `chat_id` e `text` obrigatórios; `text` "1-4096 characters after entities parsing"; `parse_mode` opcional (omitir = texto simples).

**Formato de erro:** `{ "ok": false, "error_code": <int>, "description": <string>, "parameters"?: { "retry_after"?: <int> } }`; `retry_after`: "em caso de exceder o controle de flood, o número de segundos restantes de espera". Métodos HTTP GET/POST; JSON aceito.

**Limites de taxa** (https://core.telegram.org/bots/faq): evitar mais de 1 mensagem por segundo no mesmo chat (rajadas curtas toleradas); grupos: 20 mensagens/min; difusão em massa: ~30 mensagens/s, acima gera 429; difusão paga até 1.000/s (exige saldo de 100.000 Stars e 100.000 usuários ativos, irrelevante para nós). A FAQ não descreve `retry_after`; ele está na API.

**Erros de bloqueio (não confirmado oficialmente):** a documentação oficial não lista as frases. Fontes não oficiais (https://github.com/vrumger/telegram-errors, https://www.conferbot.com/errors/telegram, https://github.com/botman/driver-telegram/issues/89): 403 `Forbidden: bot was blocked by the user` (permanente); 400 `Bad Request: chat not found` (chat inexistente/inacessível ou usuário nunca falou com o bot); 403 `Forbidden: user is deactivated` (usuário apagado). Tratar por `error_code` e usar substring na descrição (ver divergência 2).

**Retentativa do webhook:** resposta com código diferente de 2xx é falha; o Telegram repete e depois desiste "após um número razoável de tentativas" (https://core.telegram.org/bots/api#setwebhook). Contagem, intervalo e timeout de espera da nossa resposta não são documentados nas páginas oficiais lidas (api, faq, webhooks, features); a premissa "reenvia se demorar" é plausível mas não confirmada. A idempotência por `update_id` do plano continua necessária. Nota: o plano responde 401 para segredo errado, o que é falha para o Telegram (só afeta falsificadores ou configuração errada).

**Deep link** (https://core.telegram.org/bots/features): `https://t.me/<bot_username>?start=<payload>`; payload com `A-Z a-z 0-9 _ -`, até 64 caracteres; em chat privado o bot recebe o texto `/start <payload>`. Em grupos, `startgroup` gera `/start@bot payload` (não usamos). O código do plano (8 caracteres, 31 símbolos) cabe.

**Uso restrito a chats privados:** não existe configuração que impeça o bot de ser adicionado a grupos pelo lado do Telegram nesta consulta (não verificado em `setMyDefaultAdministratorRights`/BotFather); o filtro `chat.type === 'private'` no webhook, que o plano já prevê, é o controle efetivo.

## Recomendação

1. **Agendador:** `pg_cron` + `pg_net` + Vault do Supabase, como na spec §7, com `timeout_milliseconds` explícito (60000), a cada minuto, apontando para o domínio de produção da API. Habilitar as extensões no projeto real como primeira validação, pois a disponibilidade no plano gratuito não está confirmada em documentação oficial. Plano B: qualquer cron externo fazendo o mesmo `POST` (o código não muda).
2. **Hospedagem:** para a demo, Vercel Hobby (grátis, 300 s, domínio de produção fora da proteção com Standard Protection) é suficiente; para o piloto real com cliente pagante, Vercel Pro ou um serviço de processo contínuo barato (Render Starter ~US$ 7/mês, Fly ~US$ 2-5/mês, Railway Hobby US$ 5/mês), porque Hobby é restrito a uso não comercial. Descartar Render Free (hiberna após 15 min).
3. **Banco:** Supabase Pro (US$ 25/mês) no piloto real, para evitar a pausa de 7 dias.
4. **Telegram:** manter o plano; ajustar (divergências 1 a 3): classificar por `error_code`, tratar 403 como permanente em geral, enviar sequencialmente por chat.

## Depende de decisão do usuário

- **Plano do Supabase** para o piloto: gratuito (pausa em 7 dias sem atividade) ou Pro (US$ 25/mês).
- **Provedor e plano de hospedagem da API:** Vercel Hobby (somente demo, uso não comercial) vs Vercel Pro (assento a partir de US$ 20/mês) vs Render/Fly/Railway (US$ 2-7/mês, ver §3).
- **Aceitar o risco de a disponibilidade de `pg_cron`/`pg_net` no gratuito não estar confirmada** ou habilitá-las agora no projeto para confirmar.
- **Domínio de produção** (para o `pg_cron` apontar e para a Vercel não proteger o endpoint) e criação do bot no BotFather (nome de usuário do bot) com `setWebhook` e `secret_token`.
