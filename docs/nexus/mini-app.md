# Visão visual e funcional do Nexus Mini App

**Estado:** proposta de produto e interface; não corresponde a funcionalidades necessariamente implementadas.  
**Canal prioritário:** Telegram.  
**Superfície de apoio:** Mini App para acompanhar e editar; painel web para gestão mais completa.

## Princípio de experiência

O Mini App deve parecer uma extensão rápida da conversa, não um painel web comprimido. A pessoa abre, entende o que precisa de atenção e conclui ou ajusta uma tarefa sem navegar por uma estrutura complexa.

- O **bot** é a entrada mais rápida: recebe texto e envia lembretes.
- O **Mini App** é para ver o dia, localizar, editar, reagendar e concluir.
- O **painel web** concentra configurações e consultas detalhadas.

## Navegação inicial

Começar com uma tela principal **Hoje** e telas secundárias acessadas por busca, calendário e configurações. Manter a captura de tarefa visível. Evitar uma barra de navegação com muitas seções no primeiro uso.

### Tela Hoje

1. Cabeçalho compacto com símbolo Nexus, nome da tela e menu.
2. Data local e resumo escrito, por exemplo, “3 tarefas no total”.
3. Seção **Atrasadas**, com quantidade e texto que explique o atraso.
4. Seção **Hoje**, ordenada por horário; itens sem horário permanecem identificados como tal.
5. Próximos dias acessíveis sem disputar a atenção com o que vence hoje.
6. Ação persistente **Adicionar tarefa**.

Cada linha pode abrir detalhes. A conclusão deve ser um controle independente, nomeado para leitor de tela, e não depender de tocar num círculo minúsculo. O card inteiro não deve ser a única maneira de acessar suas ações.

### Detalhe de tarefa

Mostrar título, data/hora, estado e estado de entrega do lembrete. Ações primárias:

- **Concluir tarefa** (com opção de desfazer após a ação).
- **Adiar** (ex.: 1 hora, se fizer sentido para o lembrete).
- **Editar ou reagendar**.
- Cancelar tarefa como ação secundária, com confirmação quando necessário.

Não usar swipe ou cor como único meio para executar ou entender uma ação.

### Captura e confirmação

- Campo curto: “O que você precisa lembrar?”
- Data e horário opcionais, com linguagem natural e formulário simples para correção.
- Quando uma data/hora não foi informada, perguntar ou oferecer sugestão com confirmação explícita. Não agendar silenciosamente.
- Confirmar o texto interpretado e o horário local antes de finalizar quando houver ambiguidade.
- Estados compreensíveis: “Preciso confirmar”, “Agendado”, “Enviado pelo Telegram”, “Falhou”, “Concluído” e “Cancelado”.

## Funções por etapa

### Núcleo para primeira versão visual

- Ver tarefas atrasadas, de hoje e próximas.
- Adicionar tarefa por texto e definir ou ajustar data/hora.
- Abrir detalhe e editar título, data e hora.
- Concluir, adiar, reagendar ou cancelar.
- Consultar estado do lembrete.
- Pesquisar tarefas (pode ser etapa seguinte, se a lista inicial for pequena).

### Próxima etapa, sujeita a validação

- Busca e filtros simples por período/contexto.
- Recorrência básica e prioridade.
- Calendário de mês/semana.
- Preferências de horário, fuso e avisos.
- Despesas pessoais, categorias, meios de pagamento e parcelas. O documento de escopo anterior mantém finanças como hipótese; confirmar prioridade antes de incluí-las na navegação principal.

## Regras de hierarquia

- Atrasos primeiro, depois tarefas de hoje por horário, depois sem horário.
- Data/hora deve estar perto do título e ser legível sem abrir detalhe.
- Estado deve usar texto e, quando útil, ícone; a cor é reforço.
- Limitar densidade: mostrar o que requer atenção agora e permitir ver mais.
- Nomes longos quebram linha. Não truncar informação importante em telas estreitas.
- O app deve rolar; evitar CTA fixo cobrindo conteúdo ou foco.

## Acessibilidade — referência WCAG 2.2 AA

- Texto normal com contraste mínimo 4,5:1; elementos gráficos e limites de controles relevantes com pelo menos 3:1 contra cores adjacentes.
- Alvos de toque visíveis e funcionais preferencialmente com 44–48 CSS px; atender o mínimo WCAG aplicável e espaçamento sem sobreposição.
- Foco de teclado claramente visível e nunca cortado por cards, cabeçalhos ou CTA fixo.
- Nomes acessíveis nos botões e checkbox, por exemplo, “Marcar Buscar encomenda como concluída”.
- Comunicar carregamento, erro, conclusão e desfazer por texto e região de status acessível.
- Texto ampliado/zoom a 200% sem perda de conteúdo nem rolagem horizontal para tarefas comuns.
- Testar largura de 320 CSS px, orientação, tema claro/escuro do Telegram, safe areas e leitor de tela.
- Respeitar preferência de movimento reduzido. Não usar animação como único feedback.

As pranchas não provam conformidade do produto. Contraste deve ser recalculado para as cores efetivamente implementadas e testado em estados normais, foco, pressionado, erro e desabilitado.

## Requisitos visuais de implementação

- Usar tokens CSS em vez de repetir cores diretamente nos componentes.
- Se Telegram fornecer tema, mapear os tokens do produto para o tema e manter combinações com contraste suficiente; não forçar fundo que conflite com o host.
- Manter safe areas e controles do host sem simular status bar/header nativos como conteúdo do app.
- Projetar a partir de 320–360 px e depois expandir; a prancha é apenas proporção de apresentação.
- Controles essenciais devem continuar claros com zoom e sem hover.

## Critérios para revisar o próximo protótipo

1. Em poucos segundos, fica claro o que está atrasado e o que acontece hoje?
2. É possível concluir ou reagendar sem usar gesto escondido?
3. A pessoa consegue identificar se o lembrete foi agendado ou enviado?
4. Títulos, datas e ações continuam utilizáveis em 320 px e com texto ampliado?
5. O foco e os controles têm contraste suficiente em todos os estados?
6. A tela continua pessoal e simples, sem virar um produto jurídico ou financeiro visualmente?

## Arquivo visual

- `conceitos/mini-app-nexus-prancha.svg` — conceito da tela Hoje e detalhe de tarefa. Use como direção visual, não como captura exata do Telegram nem como especificação de medidas finais.
