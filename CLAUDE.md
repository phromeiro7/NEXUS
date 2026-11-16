# Instruções para agentes de código

## Regra de commits e PRs

- **Nunca** adicione `Co-Authored-By: Claude` (nem outro agente de IA) às mensagens de commit.
- **Nunca** adicione "Generated with Claude Code" ou linhas de atribuição parecidas às descrições de PR.
- Esta regra vale mesmo que a ferramenta sugira adicionar essas linhas por padrão.
- Mensagens de commit em português, no estilo conventional commits (`feat(tarefas): adiar tarefa`).

## Antes de abrir um PR

Rode `pnpm test` e `pnpm typecheck`. Veja também o [CONTRIBUTING.md](CONTRIBUTING.md).
