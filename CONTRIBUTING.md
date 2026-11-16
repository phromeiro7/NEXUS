# Contribuindo

Este é um projeto pessoal de portfólio, mas sugestões e correções são bem-vindas.

## Como rodar

```sh
pnpm install
pnpm test        # unitários (API, web e shared), sem Docker
pnpm typecheck
```

A suíte de banco (`pnpm --filter @nexus/api test:db`) exige o Supabase local, que roda em Docker. O passo a
passo completo está em [docs/DESENVOLVIMENTO.md](docs/DESENVOLVIMENTO.md).

## Fluxo

1. Abra uma issue descrevendo a mudança, ou vá direto para um PR se for pequena.
2. Crie uma branch a partir da `main` (`feat/...`, `fix/...`, `docs/...`).
3. Faça commits curtos, no estilo conventional commits, em português: `feat(tarefas): adiar tarefa`.
4. Antes de abrir o PR, rode `pnpm test` e `pnpm typecheck`. O CI roda os dois.

## Convenções

- `domain/` e `application/` na API não dependem de framework; o acesso a Supabase, Telegram e Anthropic
  fica em `infra/`.
- Contratos entre API e web ficam em `packages/shared`, com schemas zod.
- Toda função nova de domínio vem com teste. Mudanças no banco entram como uma nova migration em
  `supabase/migrations/`, nunca editando as antigas.
- Não commite segredos nem arquivos `.env`.
