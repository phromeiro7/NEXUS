# Plano 5: decisões tomadas durante a execução

Registro das decisões (rulings) tomadas sem consulta ao usuário durante a execução do Plano 5, com o que
custa se estiverem erradas. A spec continua sendo a autoridade; estas decisões cobrem o que o plano deixou
aberto ou errado.

| # | Decisão | Custo se errada |
|---|---|---|
| 12 | `claim_briefing` continua booleana; novo `release_briefing(p_user_id, p_local_date)` desfaz a reserva só após falha transitória de envio | Ajustar a função SQL |
| 13 | Sem token do bot, o endpoint do agendador ainda recupera eventos presos, limpa e cancela lembretes velhos, mas não reserva nem envia | Baixo |
| 14 | O webhook acha o dono de um chat por `LinkCodeRepository.userForChat` | Mover para outro repositório |
| 15 | Erros do Telegram são classificados por `error_code` primeiro (403 permanente; 400 "chat not found" permanente; 429 transitório com `retry_after`; 5xx/rede transitório) | Reclassificar |
| 16 | Mensagens ao mesmo chat saem em sequência (~1/s por chat); sem pausa artificial além do `retry_after`; o `timeout_milliseconds` do `pg_net` é explícito | Throughput menor |
| 17 | `finish_reminder` recebe `p_attempts` e recusa se não bater (trava de arrendamento); o enviador trata "inexistente", "reservado por outro" e "estado inválido" como perda benigna do arrendamento | Possível reenvio duplicado raro |
| 18 | O canal só é pausado para `bot_bloqueado` e `chat_inexistente`; um 401 (token revogado) marca o lembrete como `falhou` e vira alerta de log, nunca pausa todos os canais | Pausa em massa silenciosa |
| 19 | O briefing só sai na janela [horário, horário + 4 h] do dia local; fora dela nada é reservado; briefing vazio reserva o dia e não é enviado | Ajustar a janela |
| 20 | A resposta do agendador é aninhada (reminders, briefings, eventsRecovered, purged), não plana como no texto do plano | Achatar depois |
| 21 | Ramos do webhook que não chamam o modelo (/start, /desvincular, chat não vinculado, texto não suportado, tarefa alvo sumida) usam o evento só para idempotência; reenvio após ~2 min pode repetir uma resposta inofensiva; `/desvincular` existe contra o login-CSRF do vínculo | `markHandled` em SQL depois |
| 22 | Tela de vínculo: o texto do briefing da Tarefa 9 é autoritativo; conta vinculada e pausada mostra o fluxo de código, o aviso e o botão Desvincular | Ajuste de texto |
| 23 | Ao concluir uma tarefa, os lembretes pendentes são apagados na hora (não viram `cancelado`); `cancelado` só aparece no envio para tarefa fechada depois da reserva | Nenhum |
| 24 | Rodada única de correções finais: timeout do `pg_net` de 60000 ms, erro 500 do webhook antes de registrar o evento, segredos com no mínimo 16 caracteres, ajustes do roteiro | Baixo |
| 25 | A ressincronização de lembretes depois do envio continua só quando a tarefa mudou; "sempre ressincronizar" apagaria lembretes irmãos atrasados e quebraria "pelo menos uma vez" | Janela de poucos segundos após mudar a configuração durante um envio |

Pendências menores que ficaram para o Plano 6 estão em `docs/archive/STATUS-2026-10.md` (seção do Plano 5).
