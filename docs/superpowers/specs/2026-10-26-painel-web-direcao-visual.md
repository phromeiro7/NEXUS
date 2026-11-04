# Direção visual do painel web

**Data:** 2026-10-26  
**Estado:** Protótipo para discussão; paleta ainda provisória  
**Escopo:** Primeira versão do painel para uso individual por advogado

## Objetivo

Apresentar com clareza o que precisa de atenção hoje e facilitar o registro e a conclusão de tarefas. O painel deve parecer atual e tecnológico, mas priorizar leitura rápida e reduzir distrações.

## Decisões registradas

- Não haverá aba/tela própria de **Processos** na primeira versão. Referências de processo podem continuar visíveis junto às tarefas; gestão e navegação da carteira ficam adiadas.
- A tela inicial será focada em **Meu dia**, com alternância entre dia, semana e mês.
- A ordem de atenção será: tarefas atrasadas, prazos fatais de hoje, compromissos com horário e demais tarefas do dia.
- Tarefas, prazos e audiências devem ter rótulos claros. A informação de horário deve ser distinguível de uma tarefa que só tem data.
- A adição rápida será um campo compacto integrado à interface, sem um card destacado. A criação completa continuará disponível por formulário.
- O resumo lateral pode destacar o prazo mais urgente, a próxima audiência e itens atrasados.
- As ações do protótipo são demonstrativas e ainda não estão ligadas à API.

## Paleta de cores

A paleta usada no protótipo atual é **temporária**. A escolha definitiva será feita em uma etapa posterior, após comparar referências e revisar a identidade visual desejada. Preservar o contraste e não depender apenas da cor para comunicar atraso, prazo fatal, audiência ou conclusão.

## Referências e padrões observados

- [Agenda da ADVBOX](https://guia.advbox.com.br/menu-agenda/funcoes-menu-agenda): navegação por dia, semana e mês, destaque de atividades jurídicas e acesso ao detalhe a partir da agenda.
- [Meu Painel da ADVBOX](https://guia.advbox.com.br/meu-painel-tarefas): organização de tarefas e compromissos em uma visão diária.
- [Agenda do Astrea](https://astrea.aurum.com.br/pt-BR/articles/827592-passo-7-organize-suas-atividades-no-astrea): distinção entre tarefa sem horário específico e evento que ocupa um horário.
- [Today e Upcoming do Todoist](https://www.todoist.com/help/todoist/integrations/use-the-calendar-integration-rCqwLCt3G): foco na rotina do dia com acesso ao planejamento futuro.
- [Gestão de tarefas do Clio](https://www.clio.com/features/task-management/): ênfase em datas de vencimento, trabalho atrasado e próximos passos.

Essas referências orientam padrões de navegação e hierarquia; não são modelos para copiar literalmente.

## Próximas decisões de design

1. Escolher a paleta definitiva e verificar contraste em estados normais, atrasados e concluídos.
2. Revisar o comportamento em telas pequenas, principalmente a alternância de agenda e a lista de prioridades.
3. Validar a hierarquia do resumo diário e o fluxo de criação rápida com o usuário.
4. Ao implementar o front, conectar os estados e formulários aos contratos de `packages/shared` e à API existente.
