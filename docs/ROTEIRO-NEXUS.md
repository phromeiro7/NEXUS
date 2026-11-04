# Roteiro do Nexus: onde estamos, o que falta e o que vai mudar

Data: 2026-11-03. Documento de decisão. Complementa `docs/STATUS.md` (estado técnico) e o desenho do Mini App
(`docs/superpowers/specs/2026-11-03-mini-app-telegram-design.md`). O pacote de marca recebido está em
`docs/nexus/` na pasta principal do projeto (ainda sem commit; ver §6).

## 1. A mudança de rumo que precisa ser decidida

O projeto nasceu como **assistente jurídico** (spec de 2026-10-26): processos, prazos fatais, audiências,
calculadora de prazos em dias úteis. O pacote `docs/nexus/` descreve outro produto: **Nexus, assistente
pessoal de tarefas e lembretes**, com Telegram como canal principal, Mini App para consultar e agir e painel
web como apoio. O usuário também pediu, na conversa, um tom genérico e não jurídico.

O código atual é jurídico por dentro, não só por fora: tarefas têm tipo (Prazo, Audiência, Tarefa), `fatal`,
vínculo com processo, calculadora e feriados. Trocar só os textos não basta, e remover tudo é caro.

**Decisões do usuário (2026-11-03): todas aceitas, com um ajuste em D4.**

| # | Decisão | Resultado |
|---|---|---|
| D1 | Domínio jurídico | **Interface genérica**; motor jurídico (processos, fatal, calculadora, feriados) mantido como recurso opcional escondido, não removido |
| D2 | Tarefa sem data/hora | **Perguntar sempre**; permitir tarefa sem data quando a pessoa disser que não quer lembrete |
| D3 | Despesas pessoais | **Fora** do produto por enquanto |
| D4 | Escopo do Mini App | **O mais completo possível**, para as pessoas não precisarem entrar no painel web com frequência. Mudou em relação à recomendação (que era Hoje + detalhe + captura + IA). Ver §5 |
| D5 | Paleta | **Adotar a do pacote** (azul petróleo e terracota) |
| D6 | Nome | **Nexus** como nome do produto; ainda checar disponibilidade e marca antes de divulgar |

Nada disso foi aplicado ao código. Até a rodada Nexus (§3, item 5), o produto continua jurídico por dentro.

## 2. Estado hoje

**Código (Planos 1 a 5)**
- Planos 1 a 4: concluídos e revisados; PRs #1 a #4 abertos e empilhados, ainda não integrados à `main`.
- Plano 5 (Telegram, lembretes, agendador): tarefas 1 a 9 implementadas (commit `c5112c1`, não enviado ao
  GitHub). Faltam: revisão da Tarefa 9, Tarefa 10 (teste de ponta a ponta com Telegram falso e roteiro de
  publicação), revisão final do ramo, uma rodada de correções e o PR #5.
- Verificado só com testes automáticos e Telegram/IA falsos. **O painel nunca foi aberto num navegador real;
  a API da Anthropic e o Telegram real nunca foram chamados.**

**Contas e infraestrutura (feito em 2026-11-03)**
- Supabase: projeto **NEXUS** (`jowqlwoiwiiboxykixss`, região São Paulo, plano gratuito). As 6 migrações foram
  aplicadas e conferidas: 10 tabelas com RLS ligada, `anon` sem acesso, `authenticated` só nas tabelas do
  painel, `service_role` com acesso. Banco vazio.
- Telegram: bot **@NexusAssistant_bot** criado no BotFather, com descrição, texto de perfil e comandos
  `/start` e `/desvincular`. Token guardado só pelo usuário. Webhook **não** registrado.
- Vercel: conta Hobby criada e GitHub conectado. Nenhum projeto importado.
- Ainda não ativados: `pg_cron` e `pg_net` (disponíveis no plano gratuito; só falta ativar).

## 3. O que falta, em ordem

1. **Fechar o Plano 5** (revisão da Tarefa 9, Tarefa 10, revisão final, correções, PR #5).
2. **Adaptador da API para a Vercel.** A API é um servidor Node (`@hono/node-server`); a Vercel precisa de um
   ponto de entrada de função. Trabalho novo, pequeno.
3. **Integrar os PRs #1 a #5 na `main`**, na ordem, com commit de merge (não squash).
4. **Publicar:** dois projetos na Vercel (painel em `apps/web`, API em `apps/api`), variáveis de ambiente
   (Supabase, token do bot, segredo do webhook, `TELEGRAM_BOT_USERNAME=NexusAssistant_bot`), ativar
   `pg_cron`/`pg_net`, registrar o webhook com `secret_token`, testar `/start` ponta a ponta.
5. **Rodada Nexus (generalização e marca):** decisões D1 a D6 aplicadas (ver §4).
6. **Plano 6:** acabamento (avaliação da IA, revisão de segurança, testes em navegador, dados de demonstração,
   limites nas rotas, dívidas técnicas).
7. **Plano 7a e 7b:** Mini App do Telegram completo e convites (ver §5; depende do bot e da hospedagem).
8. **Execução real com o modelo de IA** (chave da Anthropic e aprovação de gasto, ver nota de custos).

Itens 5 e 6 podem trocar de ordem. Recomendo fazer a rodada Nexus **antes** do Plano 6, para a avaliação da IA
e os testes de navegador já valerem para o produto final, e **antes** do Mini App, para ele nascer com a marca
e o vocabulário novos.

## 4. Alterações que a rodada Nexus implica (com D1 = A)

**Vocabulário e textos**
- Briefing do Telegram: seções "Atrasadas / Fatais de hoje / Audiências de hoje / Próximas 48 horas" viram
  "Atrasadas / Hoje / Próximas" (`renderBriefing` em `@aj/shared` e `briefing-sender`).
- Lembretes (`reminder-message.ts`): sem "Prazo fatal" e "Audiência"; frases curtas com ação e horário.
- Estados com palavras, como pede o pacote: "Agendado", "Enviado pelo Telegram", "Falhou", "Concluído".
  "Enviado" não significa "lido". Hoje existem estados internos de lembrete (pendente, enviado, falhou...) que
  precisam de rótulos de interface.
- Prompt e ferramentas do assistente (`prompt.ts`, `tools.ts`): linguagem e exemplos pessoais; manter as
  regras de segurança e a regra de horário no passado.
- Telas e mensagens do painel (`messages.ts`, componentes com termos jurídicos): rever uma a uma.
- Voz do pacote: confirmar antes de assumir data ou hora; não passar bronca por atraso.

**Modelo de dados e interface (conforme D1)**
- Tarefa: `kind` (Prazo/Audiência/Tarefa) e `fatal` deixam de aparecer por padrão; `Processo` (cases) e a
  calculadora ficam escondidos atrás de uma opção, não removidos.
- Sem mudança de esquema obrigatória nesta rodada; qualquer mudança vira migração 0007 em diante.

**Marca e visual**
- Paleta do pacote: azul petróleo `#142D3A`, terracota `#C05640`, fundo `#F5F6F2`, texto secundário
  `#52616A`, terracota escura `#8C4D3D`, contorno `#6F7E78`. Aplicar nos tokens CSS
  (`apps/web/app/globals.css`), sem repetir cor nos componentes.
- Atenção a contraste: terracota `#C05640` só passa AA como texto sobre branco (4,52:1); **não usar como texto
  pequeno sobre `#F5F6F2` (4,16:1)** nem sobre o azul petróleo (3,17:1). Recalcular com as cores realmente
  implementadas.
- Logo ("N contínuo"), avatar do bot e wordmark: os SVGs do pacote são conceitos. Falta desenho final,
  fonte com licença e exportações. O avatar do bot ainda não foi definido no BotFather.
- Nome na interface: "Assistente Jurídico" vira "Nexus" (título, cabeçalho, e-mails de autenticação).
- Protótipos do artefato (azul `#1d4ed8`, termos jurídicos) ficam desatualizados e precisam ser refeitos.

**Acessibilidade (referência WCAG 2.2 AA, do pacote)**
- Alvos de toque de 44 a 48 px, foco visível, ações com nome acessível ("Marcar X como concluída"),
  desfazer após concluir, estados comunicados por texto, 320 px e zoom de 200% sem rolagem horizontal.
- Nada disso foi verificado num navegador real; entra no Plano 6.

## 5. Como o Mini App muda (D4: o mais completo possível)

O Mini App deixa de ser um complemento e vira a **superfície principal**. O painel web passa a ser apoio e
porta de reserva do administrador.

**Telas do Mini App (alvo)**
- **Hoje** (inicial): atrasadas, hoje por horário, sem horário, próximos dias; "Adicionar tarefa" sempre
  visível; conclusão como controle independente e nomeado, com desfazer.
- **Detalhe da tarefa:** concluir, adiar, editar ou reagendar, cancelar com confirmação, estado do lembrete
  ("Agendado", "Enviado pelo Telegram", "Falhou", "Concluído").
- **Captura:** por texto, pela barra de comando com IA ou por formulário simples; se faltar data ou hora,
  perguntar, nunca agendar em silêncio (D2).
- **Calendário:** visões Dia, Semana e Mês (já existem no painel).
- **Histórico e busca** de tarefas.
- **Configurações:** fuso, antecedência do lembrete, horário do resumo, canal do Telegram (pausar, desvincular).
  Como contas criadas por convite não têm e-mail, as configurações precisam existir aqui.
- **Recursos opcionais jurídicos** (processos, calculadora de prazos, feriados locais): atrás de uma opção
  de perfil (D1).
- Sem barra de navegação cheia no primeiro uso; navegação por abas curtas, com poucas seções.

**Consequências**
- O Plano 7 cresce. Proposta: **7a** (convite, `POST /auth/telegram`, Hoje, detalhe, captura e IA) e **7b**
  (calendário, histórico, busca, configurações, opcionais). O 7a já é utilizável; o 7b conclui a paridade.
- Reaproveitar as regras e a API existentes; as telas do painel são desktop-first e precisam ser refeitas
  para 320 a 390 px. A decisão técnica a tomar no plano é se o Mini App vive no mesmo app Next.js (rotas
  próprias, mobile-first) ou num app separado. Recomendação inicial: mesmo app, para compartilhar API,
  contratos e componentes de domínio.
- O painel web deixa de receber telas novas: só correções, a marca nova e o que o administrador precisa.
- Mais telas no Telegram significa mais superfície para testar em Android, iOS e desktop. O teste real só
  é possível com o bot e a hospedagem no ar.
- O protótipo atual do artefato (lista do dia + barra de comando) não cobre isso e será refeito.

## 6. Pendências de organização

- `docs/nexus/` está na pasta principal, sem commit. Decidir em qual branch entra (sugestão: a da rodada
  Nexus). Esta conversa não mexeu nesses arquivos.
- Os documentos `README.md` de `docs/nexus/` e o `handoff-para-outra-ia.md` citam um "documento de escopo
  anterior" com despesas; ele não está neste repositório. Confirmar onde está antes de usá-lo.
- `docs/STATUS.md` precisa receber o estado da seção 2 quando o Plano 5 fechar.
- O pacote lista "decisões em aberto" próprias (hierarquia do produto, sem data/hora, busca inicial, marca
  final, reaproveitamento do painel). As quatro primeiras estão tratadas em D1 a D4.

## 7. Riscos

- **Mudar de produto no meio do caminho** pode virar retrabalho se D1 não for decidida antes. Por isso a
  rodada Nexus vem antes de novas telas.
- **Marca:** nome e identidade ainda não foram checados quanto a uso público ou registro.
- **Custos:** hospedagem grátis (Vercel Hobby é uso não comercial) e IA paga por uso; ver
  `docs/superpowers/notes/2026-verificacoes-infra.md` e `2026-assistente-custos.md`.
- **Dados de terceiros:** convidados são dados pessoais; retenção e aviso de privacidade seguem em aberto.
