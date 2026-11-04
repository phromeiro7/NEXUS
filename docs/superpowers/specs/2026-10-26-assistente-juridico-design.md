# Assistente Jurídico Pessoal — Especificação de Design

**Data:** 2026-10-26
**Estado:** Visão jurídica original; posicionamento do produto em revisão no escopo `2026-10-26-escopo-assistente-pessoal.md`
**Origem:** brainstorming conduzido com o responsável + documento de contexto de outra IA (escopo V2.0, "Assistente Pessoal Inteligente")

---

## 1. Objetivo e contexto

Plataforma de **prazos e tarefas do dia a dia** para advocacia, com comportamento de **assistente pessoal**: o usuário conversa em linguagem natural (painel web ou Telegram), o sistema cria, consulta e altera tarefas, calcula prazos em dias úteis e avisa antes do vencimento.

- **Usuário final:** o cliente do responsável (advogado). Hoje ele controla tudo em planilha Google Sheets.
- **Objetivo da primeira entrega:** produto funcional e convincente que sirva de base e mostre a qualidade do trabalho. **Não há prazo fixo**; a construção é em camadas, cada uma demonstrável sozinha.
- **Critério principal de sucesso:** uma mensagem enviada pelo Telegram ou pela barra de comando vira corretamente uma tarefa, aparece no painel e gera lembrete no momento certo, com o computador do usuário desligado.

### Premissas (a confirmar com o cliente)
- Contexto jurídico: prazos processuais, processos, audiências.
- Um usuário por conta, dados isolados por usuário; **sem equipe** nesta versão.
- O formato real da planilha do cliente é desconhecido; Sheets fica no roadmap.

---

## 2. Escopo da primeira versão

### Entra
1. Conta própria por usuário (e-mail e senha), com dados isolados.
2. Tarefas com status, tipo e prazo; processos.
3. Visões de **dia, semana e mês**.
4. **Criar e editar por comando** em linguagem natural (várias tarefas por mensagem permitidas).
5. **Consultar por comando** ("o que vence essa semana?").
6. **Briefing do dia** (painel e Telegram).
7. **Lembretes proativos** pelo Telegram.
8. **Calculadora de prazos** em dias úteis, com feriados.
9. Telegram como canal de entrada e de lembrete.
10. Criação manual de tarefas por formulário (sem IA).

### Fica no roadmap
Google Agenda; Google Sheets (importação com mapeamento de colunas); alertas de sobrecarga e conflito; sugestão de prioridade; resumo semanal; equipe e compartilhamento; WhatsApp; áudio; recorrência; Kanban arrastável.

### Fora de escopo (decisão explícita)
**Leitura de documentos por IA** (PDF de intimações etc.).

---

## 3. Registro de decisões

| # | Decisão | Origem |
|---|---|---|
| R1 | Foco jurídico: prazos, processos, audiências | Conversa |
| R2 | Híbrido: painel com briefing + barra de comando sempre disponível | Conversa |
| R3 | Nuvem agora; arquitetura preparada para modo local no futuro | Conversa |
| R4 | Sem leitura de documentos | Conversa |
| R5 | Usuário único por conta, com isolamento (RLS) para outros usuários depois | Conversa |
| R6 | Telegram entra na primeira versão | Conversa |
| R7 | Abordagem A (Next.js + Supabase), com **front e back separados em monorepo** e arquitetura em camadas | Conversa |
| R8 | IA por **ciclo de ferramentas** (criar, listar, alterar, concluir, calcular prazo), não extração única | Diverge do documento |
| R9 | **Várias tarefas por mensagem permitidas** | Diverge de D02/D04 do documento |
| R10 | Prazo como `due_date` + `due_time` opcional, não `timestamptz` único | Diverge do documento |
| R11 | Status: pendente, em andamento, concluída, cancelada | Estende o documento |
| R12 | Sem `pending_interactions`; contexto curto em `chat_messages` | Simplifica o documento |
| R13 | Falha da IA **não cria tarefa**; avisa o usuário | Diverge do documento |
| R14 | Lembretes atrasados enviados até 24h depois, marcados "(atrasado)" | Diverge da tolerância de 1h do documento |
| R15 | Briefing por modelo de texto fixo, sem IA | Decisão de projeto |
| R16 | Responder à confirmação do bot identifica a tarefa-alvo (`task_confirmations`), somado ao contexto da conversa | Mantido da spec de 22/10 |

**Aproveitado do documento:** núcleo independente de canal; IA nunca executa ações diretamente; esclarecer só em ambiguidade real; idempotência de eventos; RLS; vínculo do Telegram por código de uso único; fuso configurável (`America/Sao_Paulo` por padrão); limite de 1.000 caracteres e 30 mensagens/hora por usuário.

---

## 4. Arquitetura

### 4.1 Estrutura do repositório (monorepo, TypeScript)

```
assistente_juridico/
├── apps/
│   ├── web/        Next.js: apenas interface, sem regra de negócio
│   └── api/        Servidor HTTP (Hono) em camadas
├── packages/
│   └── shared/     Schemas Zod e tipos compartilhados (contrato front/back)
├── supabase/       Migrações e políticas RLS
└── docs/
```

### 4.2 Comunicação
- O **front** autentica pelo Supabase Auth e chama a **API** com o token. Não lê nem escreve no banco diretamente.
- A **API** valida o token, identifica o usuário e executa tudo.
- O **Telegram** chama um webhook na API. O **agendador** (pg_cron) chama um endpoint interno protegido por segredo.
- O banco mantém RLS como segunda barreira.

### 4.3 Camadas do back (cada camada só depende da inferior)

1. **Interface:** rotas HTTP, webhook do Telegram, endpoint do agendador. Validam o formato e chamam um caso de uso.
2. **Aplicação:** casos de uso (`CriarTarefa`, `ListarTarefas`, `AlterarTarefa`, `ConcluirTarefa`, `ProcessarMensagem`, `EnviarLembretes`, `GerarBriefing`). O agente de IA vive aqui e chama os mesmos casos de uso como ferramentas.
3. **Domínio:** entidades, regras de status e **calculadora de prazos**. Sem dependência de banco, IA ou Telegram.
4. **Infraestrutura:** repositórios Supabase, cliente Anthropic, cliente Telegram, provedor de feriados. Acessados por interfaces (portas), permitindo trocar fornecedores.

O Telegram e o painel são duas portas de entrada para os mesmos casos de uso.

---

## 5. Modelo de dados

Todas as tabelas de usuário têm `user_id` e RLS.

| Tabela | Finalidade | Campos principais |
|---|---|---|
| `profiles` | Dados e preferências | fuso, UF, cidade, antecedência dos lembretes, hora do briefing, `telegram_chat_id` (único), `last_briefing_sent_on`, `channel_paused` |
| `cases` | Processos | número, cliente (texto), descrição, status |
| `tasks` | Prazos e tarefas | título, tipo (`prazo`, `tarefa`, `audiencia`), status, `due_date`, `due_time` (nulo), fatal, `case_id` (nulo), origem, regra de cálculo (data base, dias, úteis/corridos), `completed_at`, `deleted_at` |
| `reminders` | Fila de lembretes | `task_id`, tipo, `scheduled_at` (timestamptz), status, tentativas, último erro, enviado em |
| `holidays` | Feriados locais cadastrados pelo usuário | `user_id`, data, escopo (estadual/municipal), nome |
| `inbound_events` | Idempotência | canal, id externo, status; único `(canal, id externo)` |
| `chat_messages` | Contexto curto | usuário, canal, papel, texto, `expires_at` (24h) |
| `link_codes` | Vínculo Telegram | código de uso único, `user_id`, validade de 10 min |
| `task_confirmations` | Liga cada confirmação enviada pelo bot às tarefas criadas ou alteradas | `channel`, `chat_id`, `message_id`, `task_id`; chave `(channel, chat_id, message_id, task_id)`, pois uma confirmação pode cobrir várias tarefas |

**Estados de tarefa:** `pendente`, `em_andamento`, `concluida`, `cancelada`. Exclusão é lógica (`deleted_at`).
**Estados de lembrete:** `pendente`, `enviando`, `enviado`, `falhou`, `cancelado`.

**Datas:** prazos jurídicos são datas ("até o dia X"), por isso `due_date` + `due_time` opcional, evitando erros de fuso e horário de verão. Lembretes guardam o instante absoluto, calculado a partir do fuso do usuário. Se uma hora local não existir ou ocorrer duas vezes, o sistema pergunta e não converte silenciosamente.

**Feriados:** os nacionais são **calculados no código** (alguns, como a Sexta-feira Santa, dependem da Páscoa) e não ficam na tabela; a tabela guarda só os estaduais e municipais que o usuário cadastra. Carnaval e Corpus Christi são ponto facultativo e entram como feriado local quando o tribunal os adota.

---

## 6. Fluxo de uma mensagem

Vale para Telegram e para a barra de comando.

1. **Entrada.** Webhook do Telegram (segredo validado no cabeçalho) ou `POST /assistant/message` com token do usuário.
2. **Identificação.** `chat_id` → usuário. Chat não vinculado: só orienta o vínculo, nada é criado. Mensagem que não é texto (áudio, foto, documento): responde que por enquanto só entende texto e não chama a IA.
3. **Idempotência.** Registra em `inbound_events`; evento repetido é ignorado.
4. **Limites.** 1.000 caracteres e 30 mensagens/hora por usuário, antes de chamar a IA.
5. **Contexto.** Salva a mensagem em `chat_messages`, carrega as últimas mensagens e injeta data e hora atuais no fuso do usuário. Datas relativas partem do momento em que a mensagem chegou. **Se a mensagem é uma resposta (`reply_to_message`) a uma confirmação do bot**, o app localiza as tarefas em `task_confirmations` e as injeta no contexto como a tarefa-alvo, o que identifica a tarefa de forma determinística ("muda para 16h" altera aquela tarefa). Confirmação de tarefa já apagada: avisa que ela não existe mais. Cada confirmação enviada grava uma linha em `task_confirmations`.
6. **Ciclo de ferramentas.** A IA escolhe entre `criar_tarefa`, `listar_tarefas`, `alterar_tarefa`, `concluir_tarefa`, `calcular_prazo` ou responde em texto. Para cada chamada: o app valida os argumentos com Zod, executa o caso de uso com `user_id` injetado pelo servidor e devolve o resultado à IA. Limite de 4 passos.
7. **Regras determinísticas fora da IA.** Data inexistente é rejeitada. Horário explícito no passado devolve erro que leva a IA a perguntar; o app nunca move a data sozinho. Dias úteis só saem de `calcular_prazo`.
8. **IDs reais.** Para alterar ou concluir, o ID vem de `listar_tarefas`; o app confere propriedade e que a tarefa não está apagada.
9. **Resposta.** Informa o que foi entendido e as suposições ("manhã = 09h"). No painel, a API devolve também as tarefas afetadas para atualizar a tela.
10. **Várias tarefas.** Permitido; confirmação por item. Item ambíguo gera pergunta só sobre ele.
11. **Falhas.** IA indisponível: evento preservado, nenhuma tarefa criada, usuário avisado. Resposta inválida da IA não é aplicada. Falha do banco não gera confirmação falsa. Tentativa de prompt injection não executa comandos nem ultrapassa permissões.
12. **Tempo.** O Telegram reenvia o webhook se a resposta demorar, então o processamento tem orçamento de tempo total (alvo de cerca de 20 s para todo o ciclo, com timeout por chamada à IA). Estourou o orçamento: nenhuma ação parcial é confirmada e o usuário recebe aviso. A idempotência do passo 3 impede duplicatas se o Telegram reenviar. Se a hospedagem escolhida encerrar a função ao responder, o processamento precisa terminar antes da resposta; ver verificação 3 na seção 12.

### Horários-padrão (a validar)
Amanhã de manhã = 09:00; à tarde = 15:00; à noite = 20:00; dia da semana sem hora = 09:00; "semana que vem" sem dia = perguntar; sem data = tarefa sem prazo.

---

## 7. Lembretes, briefing e Telegram

### Geração
Ao criar, editar ou alterar o prazo, o caso de uso apaga os lembretes pendentes da tarefa e gera novos. Concluir ou cancelar cancela os pendentes.
- **Prazo só com data:** 1 dia antes e no dia às 08h; se `fatal`, também 3 dias antes.
- **Tarefa com hora:** aviso antecipado (padrão 15 min, configurável) e aviso no horário.
- Se a tarefa é criada já dentro da janela de um aviso, esse aviso é pulado.

### Envio
- `pg_cron` (com `pg_net`) chama `POST /internal/reminders/run` a cada minuto, com segredo guardado no Vault do Supabase.
- A API reserva lembretes vencidos com `FOR UPDATE SKIP LOCKED`, marca `enviando`, envia e marca `enviado`.
- Falha temporária: nova tentativa com espera crescente, até 5 vezes. Erro permanente (bot bloqueado): registra e pausa o canal do usuário.
- `enviando` há mais de 5 minutos volta a `pendente`.
- **Garantia:** pelo menos uma vez; duplicata rara é possível. Não se promete "exatamente uma vez".
- **Atraso:** enviado até 24h após o horário previsto, com marca "(atrasado)". Precisão alvo de cerca de um minuto, sem prometer segundos.

### Contrato do enviador de lembretes (Plano 5)
Regras que o enviador precisa cumprir, porque a API do Plano 2 depende delas:
1. **Tarefa ainda viva:** antes de enviar, o enviador junta `tasks` e só envia se `deleted_at is null` e o status é `pendente` ou `em_andamento`; caso contrário, marca o lembrete como `cancelado`.
2. **Reagendamento durante o envio:** ao terminar um lembrete `enviando`, se a data, a hora ou o `fatal` da tarefa mudaram desde a reserva, o enviador roda de novo a substituição dos lembretes dessa tarefa. `replace_pending_reminders` pula o rascunho cujo tipo está `enviando`; sem esse passo, uma remarcação feita durante o envio deixaria a tarefa sem lembrete para o novo horário.
3. **Passado não é recriado:** a reconstrução nunca recria lembretes cujo instante já passou. Um lembrete `pendente` vencido (enviador fora do ar) é responsabilidade do enviador: envia atrasado, com a marca "(atrasado)", dentro da regra de 24h acima.
4. **Tarefa só com data criada no próprio dia:** criada depois das 08h do dia do prazo, não ganha lembrete `no_dia` (o instante já passou); quem a cobre é o briefing.
5. **Questão de produto em aberto (decidir antes do Plano 5):** hoje uma tarefa `fatal` COM hora recebe só `antecipado` e `no_horario` (sem 3 dias antes nem dia anterior). Confirmar se é o comportamento desejado.

### Briefing
- **Painel:** no topo, calculado ao abrir, sem custo de IA.
- **Telegram:** na hora configurada (padrão 08h, fuso do usuário), uma vez por dia local, não enviado se vazio.
- Conteúdo por modelo fixo: atrasadas, prazos fatais de hoje, audiências, próximas 48 horas.

### Vínculo com o Telegram
Painel gera código de uso único (10 min) e link; `/start CODIGO` chega ao webhook, vincula o chat e invalida o código. Um chat não pode ter duas contas. Religar segue fluxo seguro.

---

## 8. Painel web

**Telas:** login/cadastro/recuperação; Painel (briefing + barra de comando + seletor Dia/Semana/Mês); Histórico (concluídas agrupadas pelo dia da conclusão, filtro para incluir canceladas); Configurações (fuso, UF e cidade, feriados locais, lembretes, briefing, Telegram). **Decisão para a primeira versão do painel:** não exibir uma aba/tela de Processos; referências a processo podem aparecer no contexto de uma tarefa, mas o cadastro e a navegação própria de processos ficam adiados. Ver `docs/superpowers/specs/2026-10-26-painel-web-direcao-visual.md` para a direção do protótipo e decisões visuais pendentes.

- **Dia:** atrasadas em destaque, depois hoje por horário e sem data.
- **Semana:** colunas por dia, fatais marcados.
- **Mês:** calendário com contagem por dia; clicar abre o dia.
- **Interações:** chip de status com um clique; editar; apagar (lógico); criação manual por formulário; calculadora de prazos por formulário (mostra feriados descontados).
- **Barra de comando** (`Ctrl/Cmd+K`): resposta do assistente em painel curto, tarefas afetadas destacadas.
- **Alertas visuais:** atrasadas em vermelho, contagem no título da aba, destaque do que está próximo, recálculo a cada minuto e recarga ao voltar ao foco. Sem Realtime.
- **Técnica:** Next.js (App Router), Tailwind + shadcn/ui, TanStack Query, cliente tipado via `packages/shared`. Responsivo desde o início. Acabamento visual com a skill de design de interface.

---

## 9. Segurança e privacidade

- Isolamento em duas camadas: filtro por `user_id` na API e RLS no banco. Service role apenas na API, nunca no navegador, sempre com filtro explícito.
- Segredos em variáveis de ambiente; `.env.example` sem valores; nada no Git.
- Webhook e agendador exigem segredo.
- Texto do usuário é dado; a IA só tem as ferramentas definidas; `user_id` nunca vem da IA; todo argumento é validado.
- Logs operacionais não guardam texto de tarefas. `chat_messages` expira em 24h e é limpo por job.
- Dados de processo e cliente são sensíveis: conversar com o cliente sobre LGPD e sigilo profissional antes de uso com dados reais.

---

## 10. Estratégia de testes

- **Domínio (TDD, maior cobertura):** calculadora de prazos (dias úteis, feriados, fim de semana, virada de mês), regras de status, geração de lembretes.
- **Casos de uso e API:** isolamento entre usuários, idempotência, vínculo do Telegram.
- **Lembretes:** concorrência, reenvio após falha, recuperação de `enviando` preso.
- **Postgres local do Supabase** para as peças críticas: reserva atômica dos lembretes sob execução simultânea e RLS (usuário A nunca acessa dados do usuário B). Esses dois pontos não se validam bem com banco simulado.
- **Webhook com payloads falsos:** segredo errado, duplicata, chat não vinculado, vínculo (código válido, vencido, reutilizado), resposta a confirmação, tarefa apagada, falha da IA, mensagem não textual, texto longo.
- **IA:** conjunto de cerca de 50 frases reais em português do Brasil (abreviações, erros de digitação, datas ambíguas, várias tarefas, tentativas de injeção). Meta: zero datas inválidas gravadas e poucas perguntas desnecessárias.
- **Ponta a ponta:** criar conta, conectar Telegram, criar tarefa por comando, concluir, receber lembrete.

### Critérios de aceitação
- Mensagem clara cria a(s) tarefa(s) esperada(s); sem data cria tarefa sem prazo.
- Horários-padrão são aplicados e informados.
- Data inválida nunca é gravada; data ambígua gera pergunta sem criar tarefa definitiva.
- Evento duplicado não repete efeitos.
- Falha da IA não cria tarefa nem inventa prazo.
- Correção altera só os campos solicitados e só na tarefa identificada, do próprio usuário, não apagada.
- Mensagem sem relação com tarefas não cria nada.
- Usuário A nunca lê nem altera dados do usuário B.
- Lembrete não é enviado em duplicidade em condições normais e é recuperado após queda.

---

## 11. Ordem de construção

Cada etapa funciona sozinha e pode ser demonstrada.

1. **Fundação:** monorepo, banco com migrações e RLS, login.
2. **Domínio:** tarefas, status e calculadora de prazos, com testes.
3. **API e painel básico:** CRUD de tarefas e processos; visões de dia, semana e mês. Produto já usável, sem IA.
4. **Assistente:** barra de comando com ciclo de ferramentas; briefing no painel.
5. **Telegram:** vínculo, mensagens e confirmações.
6. **Lembretes e briefing no Telegram:** fila, agendador, recuperação de falhas.
7. **Acabamento:** design, avaliação da IA, ajustes de custo, revisão de segurança.

**Divisão em planos de implementação.** As etapas acima viram seis planos: 1) fundação e domínio (concluído); 2) API de tarefas, processos e configurações; 3) painel Next.js (login, visões, formulários); 4) assistente de IA e briefing em texto; 5) Telegram, envio de lembretes e agendador; 6) acabamento e avaliação da IA. O painel só conversa com a API (§4.2), por isso a API de tarefas precede o painel.

---

## 12. Verificações obrigatórias antes de implementar

Nenhum item abaixo deve ser tratado como confirmado sem consultar a documentação atual:

1. `pg_cron` e `pg_net` disponíveis no plano gratuito do Supabase.
2. **Pausa de projetos gratuitos por inatividade** (derrubaria os lembretes; o piloto real provavelmente exige plano pago).
3. Onde hospedar a API para suportar uma chamada por minuto e processar mensagens dentro do orçamento de tempo (Vercel como projeto separado ou serviço como Render/Fly). Se for Vercel, o endpoint do agendador precisa ficar acessível sem a proteção de implantação; a segurança vem do segredo.
4. Limites e política de uso da Vercel.
5. Preço, limites e suporte a saída estruturada e a ferramentas do modelo de IA escolhido.
6. Limites de envio de e-mail do Supabase Auth.
7. Detalhes atuais da Telegram Bot API.
8. Custo estimado por volume de mensagens.

---

## 13. Custos (ordem de grandeza, a confirmar)

APIs do Google: sem custo. Hospedagem e banco: gratuito na demo, até cerca de R$ 150/mês num piloto real. IA: custo variável por uso (de poucos reais a algumas dezenas por usuário/mês), reduzido pelo briefing sem IA e pelos limites de mensagens; configurar também um teto de gasto mensal no painel do provedor da IA. WhatsApp: evitado por cobrar por conversa.

---

## 14. Questões em aberto

1. Formato real da planilha do cliente e como ele trabalha hoje (levar à reunião).
2. Política de retenção e exclusão de mensagens originais, antes de abrir para outros usuários.
3. Tipos de prazo processual e regras de contagem a suportar na calculadora (CPC, prazos em dobro, suspensões, recesso forense).
4. Chats privados versus grupos no Telegram (assumido: apenas privado).
5. Identidade visual e layout definitivo do painel.
6. Estratégia de publicação e custos de infraestrutura para outros usuários, incluindo serviço de envio de e-mail (o do Supabase Auth tem limite baixo).
