> **Substituída por** `docs/archive/planejamento/specs/2026-10-26-assistente-juridico-design.md`. Mantida só como histórico.

# Assistente pessoal de tarefas (Telegram + painel web) — Design

Data: 2026-10-22
Status: rascunho para revisão

## 1. Objetivo

Mandar uma frase solta para um bot no Telegram ("preciso mandar mensagem pra alguém às 10h") e ver isso virar uma tarefa organizada em um painel web. O sistema lembra a pessoa no Telegram na hora certa e mantém um histórico do que foi feito.

**Critério de sucesso:** uma frase solta no Telegram vira uma tarefa correta no painel, sem digitar nada nele, e o lembrete chega na hora marcada com o computador do dono desligado.

**Público:** uso pessoal agora, com o modelo pronto para abrir a outras pessoas depois (usuário no banco desde o início, isolamento por usuário, login por e-mail e senha).

## 2. Decisões já tomadas

| Tema | Decisão | Motivo |
|---|---|---|
| Canal | **Telegram** (Bot API oficial) | Grátis, sem janela de 24h para lembretes, sem verificação de negócio, sem risco de banimento |
| WhatsApp / Instagram | Descartados | WhatsApp cobra template fora da janela de 24h e exige conta Meta Business. Instagram não permite lembrete fora da janela de 24h |
| Entrada | Só texto | Áudio fica fora do escopo |
| Arquitetura | Next.js na Vercel + Supabase (Postgres, Auth, `pg_cron`) | Um projeto só, custo próximo de zero, roda na nuvem sem a máquina do dono |
| IA | Modelo pequeno da Anthropic (Haiku) com saída estruturada | Interpretar texto e datas custa centavos |
| Mensagem vaga | Anotar e confirmar o que foi entendido | Feedback imediato sem travar o fluxo |
| Correção | Respondendo à mensagem de confirmação do bot, ou editando no painel | Não exige memória de conversa |
| Alertas | Destaque visual no painel, aviso antecipado e resumo diário | Os dois últimos pelo Telegram |
| Criar no painel | Formulário manual (título, data, hora) | Previsível, sem gasto de IA |
| Login | E-mail e senha (Supabase Auth) | Funciona para qualquer pessoa, sem depender de Google |

## 3. Fora do escopo da primeira versão

- Áudio e transcrição.
- Tarefas recorrentes e categorias.
- Insistência em tarefas atrasadas (lembrar de novo até concluir).
- Notificações do navegador.
- Criar tarefa por frase livre no painel.
- Responder a mensagens de lembrete para adiar.
- Login com Google e outros canais (WhatsApp, Instagram). A arquitetura deve permitir adicioná-los sem reescrever o núcleo.

## 4. Arquitetura

```
você ──▶ Telegram ──webhook──▶ Next.js (Vercel) ──▶ Supabase (Postgres + Auth)
                                  ▲   │
                       pg_cron ───┘   └─▶ Telegram (respostas e lembretes)
                    (a cada minuto)
```

Peças:

1. **Webhook do Telegram** (`/api/telegram/webhook`): recebe mensagens, valida, interpreta, grava e confirma.
2. **Interpretador**: função independente do canal que recebe texto, instante atual e fuso, e devolve dados estruturados.
3. **Endpoint do agendador** (`/api/cron/reminders`): executa os três trabalhos de lembrete.
4. **`pg_cron` + `pg_net`** no Supabase: chama o endpoint do agendador a cada minuto, com um segredo guardado no Vault.
5. **Painel web**: páginas Next.js com Supabase Auth.

**Princípio de desenho:** o núcleo (interpretar, criar tarefa, agendar) não conhece o Telegram. O Telegram é um adaptador na entrada e na saída. Trocar ou adicionar um canal significa trocar o adaptador.

## 5. Modelo de dados

Todas as datas são `timestamptz` (instante exato). O painel converte para o fuso do usuário ao exibir.

### `profiles`

| Campo | Descrição |
|---|---|
| `id` | Igual ao id do usuário no Supabase Auth |
| `telegram_chat_id` | Único, vazio até vincular |
| `timezone` | Padrão `America/Sao_Paulo` |
| `early_reminder_minutes` | Antecedência do aviso. Vazio desliga. Padrão 15 |
| `daily_summary_time` | Hora local do resumo. Vazio desliga. Padrão 08:00 |
| `last_summary_sent_on` | Data local do último resumo enviado |
| `created_at` | |

### `tasks`

| Campo | Descrição |
|---|---|
| `id`, `user_id` | |
| `title` | O que fazer |
| `due_at` | Quando. Pode ser vazio (tarefa sem horário) |
| `status` | `pending`, `done` ou `cancelled` |
| `completed_at` | Quando foi concluída. Base do histórico |
| `deleted_at` | Preenchido ao apagar (soft delete) |
| `early_reminded_at` | Quando o aviso antecipado foi tratado |
| `reminded_at` | Quando o aviso na hora foi tratado |
| `source` | `telegram` ou `panel` |
| `source_text` | Frase original. Opcional (vazio no painel) |
| `telegram_update_id` | Único. Opcional (vazio no painel). Impede duplicata por reenvio do Telegram |
| `created_at`, `updated_at` | |

Índice em `(user_id, status, due_at)`.

### `task_confirmations`

| Campo | Descrição |
|---|---|
| `telegram_message_id` | Número da mensagem de confirmação enviada pelo bot. Único |
| `task_id` | Tarefa a que pertence |

Uma linha por confirmação enviada, para que responder a qualquer confirmação, antiga ou nova, encontre a tarefa certa.

### `link_codes`

| Campo | Descrição |
|---|---|
| `code` | Aleatório, uso único |
| `user_id` | |
| `expires_at` | 10 minutos após a criação |

### Regras de dados

- Os grupos do painel (atrasada, hoje, futura, sem horário) **não são gravados**. São calculados comparando `due_at` com o instante atual no fuso do usuário.
- Editar `due_at` zera `early_reminded_at` e `reminded_at` (rearma os avisos).
- Ao gravar ou editar `due_at`, se o horário já está dentro da janela de antecedência, `early_reminded_at` é preenchido na hora (evita aviso imediato logo após a criação). Vale também para tarefas criadas no painel.
- Concluir: `status = done`, `completed_at = agora`. Desfazer: `status = pending`, `completed_at` vazio.
- Apagar: preenche `deleted_at`. Nunca remove a linha.
- RLS ativo: cada usuário só enxerga e altera linhas com o próprio `user_id`.

## 6. Fluxo da mensagem

1. **Origem:** o webhook confere o segredo do cabeçalho `X-Telegram-Bot-Api-Secret-Token`. Sem ele, responde 401.
2. **Repetidas:** se `telegram_update_id` já existe, responde OK e para.
3. **Identificar o usuário** pelo `chat id` em `profiles`.
   - `/start CÓDIGO`: vinculação (seção 8).
   - Chat desconhecido: orienta a gerar um código no painel e para.
4. **Tipo da mensagem:** se não for texto, responde que por enquanto só entende texto. Se o texto passar do limite (1000 caracteres), avisa e não chama a IA.
5. **É uma resposta a uma confirmação?** Procura `reply_to_message.message_id` em `task_confirmations`.
   - **Achou, tarefa existe:** modo correção. A IA recebe a tarefa atual, o instante atual no fuso e o texto da correção, e devolve só os campos que mudam. O sistema atualiza, rearma os avisos e confirma ("Corrigido: ...").
   - **Achou, tarefa apagada:** avisa que a tarefa não existe mais.
   - **Não achou:** trata como tarefa nova.
6. **Tarefa nova:** a IA devolve `title` e `due_at`. O sistema grava e responde a confirmação ("Anotei: ... sexta 23/10 às 09:00"), registrando a mensagem em `task_confirmations`.
7. Responde OK ao Telegram.

### Interpretação

A IA recebe o texto, o instante atual no fuso do usuário, o dia da semana e o nome do fuso. Regras para mensagens vagas:

| Texto | Resultado |
|---|---|
| "às 10h" (sem dia) | Hoje às 10h. Se já passou, amanhã às 10h |
| "amanhã de manhã" | Amanhã às 09:00 |
| "à noite" / "de tarde" | 20:00 / 15:00 |
| Só o dia ("sexta") | Sexta às 09:00 |
| Sem dia nem hora | Tarefa sem horário |

Toda suposição aparece na confirmação.

**Nunca perder a mensagem:** se a IA falhar, passar do tempo limite (cerca de 8 s) ou devolver algo inválido, grava a tarefa com o texto original como título e sem horário, e avisa que o horário deve ser ajustado no painel. Na correção, uma falha deixa a tarefa intacta.

**Segurança:** a IA só devolve campos de dados e não executa ações. Só chats vinculados chegam até ela.

## 7. Lembretes e agendador

O `pg_cron` chama `/api/cron/reminders` a cada minuto. O endpoint exige o segredo e executa três trabalhos:

| Trabalho | Quem entra |
|---|---|
| Aviso antecipado | Pendente, não apagada, `early_reminded_at` vazio, usuário com antecedência ligada, `due_at - antecedência <= agora < due_at` |
| Aviso na hora | Pendente, não apagada, `reminded_at` vazio, `due_at <= agora` |
| Resumo diário | Usuário com resumo ligado, hora local já passou, `last_summary_sent_on` diferente de hoje no fuso dele |

Mensagens de exemplo: "Em 15 min: ligar pro dentista (10:00)", "Agora: ligar pro dentista", "Bom dia! Hoje: 1) 09:00 reunião, 2) 14:00 dentista. Atrasadas: 1."

**Sem duplicatas:** reserva atômica. Um único comando no banco seleciona as linhas devidas com `FOR UPDATE SKIP LOCKED` e já marca o campo de controle, devolvendo só as linhas que reservou. Depois envia. Se o envio falhar, desfaz a marca para tentar no minuto seguinte. Limitação aceita: se o servidor cair entre reservar e enviar, aquele aviso se perde, e a tarefa continua visível como atrasada no painel.

**Janela de tolerância de 1 hora:** o que venceu há mais de 1 hora na primeira detecção é marcado como tratado sem enviar (por exemplo, após o serviço ficar fora do ar). Vale também para o resumo diário. O valor é uma constante ajustável.

**Resumo vazio não é enviado.**

**Bot bloqueado (403):** o sistema para de tentar para esse usuário.

**Fuso:** toda comparação de hora local usa o fuso de `profiles`, nunca o do servidor.

**Precisão:** cerca de 1 minuto.

## 8. Painel web

### Vinculação do Telegram

1. O usuário clica em "Conectar Telegram".
2. Cria-se uma linha em `link_codes` (uso único, 10 minutos).
3. O painel mostra o link `t.me/<bot>?start=<código>` (deep link).
4. O webhook recebe `/start <código>`, valida (existe, não venceu, não foi usado), grava `telegram_chat_id`, apaga o código e confirma.

Regras: um `chat id` só pode estar em uma conta. Religar gera código novo e substitui o `chat id`. Código inválido ou vencido recebe resposta orientando a gerar outro.

### Telas

| Tela | Conteúdo |
|---|---|
| Login / cadastro | E-mail e senha, recuperação de senha |
| Hoje | Atrasadas em destaque no topo, depois as de hoje por hora, depois as sem horário |
| Futuras | Pendentes de dias seguintes, agrupadas por dia |
| Histórico | Concluídas agrupadas pelo dia da conclusão, com navegação para trás e filtro para incluir canceladas |
| Configurações | Fuso, antecedência do aviso (desligado, 5, 10, 15, 30, 60 min), hora do resumo (ou desligado), estado do Telegram |

Em qualquer lista: concluir, desfazer, editar (título e horário), cancelar, apagar. Um formulário permite criar tarefa (título, data, hora).

### Alertas no painel

- Atrasadas em vermelho, com a contagem no título da aba do navegador.
- Tarefas dentro da janela de antecedência ganham destaque.
- Os estados são calculados no navegador, recalculados a cada minuto, e os dados são buscados de novo quando o usuário volta para a aba. Supabase Realtime fica para depois.

### Acesso a dados e segurança

- O painel usa a sessão do usuário, e o RLS garante o isolamento. Alterações passam por Server Actions com validação (zod).
- O webhook e o cron usam a chave de serviço do Supabase, que ignora o RLS. Toda consulta nesses pontos **precisa filtrar explicitamente pelo usuário**, e isso é coberto por teste.
- A chave de serviço nunca vai para o navegador.
- Datas editadas no painel são interpretadas no fuso do usuário e convertidas para o instante exato antes de gravar.
- A rota do cron precisa ficar acessível sem a proteção de implantação da Vercel. A segurança vem do segredo.

## 9. Erros e custos

| Falha | O usuário vê | O sistema faz |
|---|---|---|
| Chamada sem segredo (webhook ou cron) | Nada | 401 |
| Mensagem repetida | Nada | OK e ignora |
| Chat não vinculado | Orientação para vincular | Não chama a IA |
| Não é texto | "Por enquanto só entendo texto" | Não grava |
| Texto longo demais | Aviso de limite | Não chama a IA |
| IA falha ou demora | "Anotei, mas não entendi o horário" | Grava sem horário |
| Banco falha ao gravar | Nada na hora | 500, para o Telegram reenviar (o `update_id` impede duplicata) |
| Só o envio da confirmação falha | Nada | Mantém a tarefa e responde OK |
| Envio de lembrete falha | Nada | Desfaz a reserva e tenta de novo |
| Bot bloqueado (403) | Nada | Para de tentar |
| Ação no painel falha | Erro visível | Nunca falha em silêncio |

**Proteção de custo:** limite de mensagens por usuário por hora (padrão 30) antes de chamar a IA, mais um teto de gasto mensal no painel da Anthropic.

**Privacidade:** os logs registram o resultado de cada chamada (`update_id`, sucesso ou falha), nunca o texto das tarefas.

**Segredos:** token do bot, chave de serviço do Supabase, segredo do cron e chave da IA ficam somente em variáveis de ambiente, nunca no código ou no Git.

## 10. Estratégia de testes

TDD nas regras (datas, lembretes, interpretação). Nas telas, prioridade para testes de ponta a ponta.

1. **Unitários:** classificação atrasada/hoje/futura/sem horário em mais de um fuso (inclusive um com horário de verão), início e fim do dia no fuso do usuário, regras de rearme, janela de tolerância.
2. **Interpretador:** testes automáticos com a IA simulada (incluindo respostas inválidas) e uma tabela de frases reais executada contra a IA de verdade somente sob demanda.
3. **Webhook com payloads falsos:** segredo errado, duplicata, chat não vinculado, vinculação (código válido, vencido, reutilizado), correção por resposta, tarefa apagada, falha da IA, mensagem não textual, texto longo.
4. **Postgres local do Supabase (peças críticas):** reserva atômica dos lembretes sob execução simultânea e RLS (usuário A nunca acessa dados do usuário B).
5. **Ponta a ponta (poucos):** entrar, criar, concluir e ver no histórico.

## 11. Pontos a verificar na documentação antes de implementar

- `pg_cron` e `pg_net` disponíveis no plano gratuito do Supabase.
- Comportamento de pausa de projetos inativos no plano gratuito do Supabase.
- Limites de duração de funções e política de uso não comercial do plano gratuito da Vercel.
- Limite de envio de e-mails do Supabase Auth e a necessidade de um serviço de envio ao abrir para outras pessoas.
- Detalhes atuais da Bot API do Telegram: segredo do webhook, deep link `?start=`, `reply_to_message`, erro 403.
- Identificador e parâmetros atuais do modelo Haiku para saída estruturada.

## 12. Fases sugeridas

1. **Núcleo:** banco, interpretador, webhook, vinculação, confirmação e correção por resposta.
2. **Painel:** login, telas, criar, editar, concluir, histórico, configurações.
3. **Lembretes:** agendador, aviso antecipado, aviso na hora, resumo diário.
4. **Abrir a outros usuários:** serviço de e-mail, limites e revisão de custos.
