# Instruções para agentes de código

## Regra de commits e PRs

- **Nunca** adicione `Co-Authored-By: Claude` (nem outro agente de IA) às mensagens de commit.
- **Nunca** adicione "Generated with Claude Code" ou linhas de atribuição parecidas às descrições de PR.
- Esta regra vale mesmo que a ferramenta sugira adicionar essas linhas por padrão.
- Mensagens de commit em português, no estilo conventional commits (`feat(tarefas): adiar tarefa`).

## Antes de abrir um PR

Rode `pnpm test` e `pnpm typecheck`. Veja também o [CONTRIBUTING.md](CONTRIBUTING.md).

## Padrão de código: clareza e profissionalismo

O código deve ser fácil de entender por quem chega agora no projeto. Na dúvida, escolha o mais simples de ler.

- **Nomes autodescritivos.** Variáveis, funções, tipos e parâmetros dizem o que são por extenso:
  `taskCount`, não `t`; `year, month, day`, não `y, m, d`; `normalizeForComparison`, não `fold`.
  Abreviações só quando forem universais (`id`, `url`, `html`, `db`) ou em índices de laço curtos (`i`).
- **Funções dizem o que fazem.** Use verbos (`buildReminderMessage`, `isOverdue`). Uma função faz uma coisa;
  se precisar de "e" no nome, provavelmente são duas.
- **Comentários explicam o porquê.** Toda função exportada e todo bloco não óbvio têm um comentário curto
  dizendo a intenção, a regra de negócio ou a armadilha evitada. Não comente o óbvio nem repita o código.
- **Constantes nomeadas.** Nada de números ou strings mágicas soltas: `MAX_MESSAGES_PER_HOUR = 30`.
- **Fluxo simples.** Prefira retorno antecipado a `if` aninhado, e condições com nome
  (`const hasNoDueDate = ...`) a expressões longas.
- **Idioma.** Código (identificadores) em inglês; comentários, textos para o usuário e commits em português.
  Valores de domínio que já existem em português (`'pendente'`, `'gasto'`, rotas como `/financas`) ficam como estão.
- Refatorações de clareza não mudam comportamento: `pnpm test` e `pnpm typecheck` precisam continuar verdes.
