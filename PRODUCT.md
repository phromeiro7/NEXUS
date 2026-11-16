# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

O responsável pelo projeto e pessoas com rotina semelhante (piloto). Registram tarefas e lembretes por mensagem no Telegram e abrem o painel web para ver o dia, concluir, adiar e corrigir. A advocacia é um contexto possível de uso, não a definição do produto; o público de mercado segue em aberto.

## Product Purpose

Nexus é um assistente pessoal de tarefas e lembretes: a conversa registra rápido, o painel web consulta, ajusta e conclui. Sucesso é a pessoa registrar com pouco esforço e receber o aviso no momento certo, com dados confiáveis.

## Positioning

Intenção vira ação: registrar pelo Telegram e organizar o dia no Nexus ("Sua rotina, conectada" é assinatura exploratória). O produto mostra o estado real do aviso (agendado, enviado, falhou, concluído) em vez de prometer entrega perfeita.

## Operating Context

Registro por mensagem no Telegram (canal prioritário, ainda não implementado); painel web como apoio e como lugar onde o lembrete aparece se o Telegram falhar. Multiusuário com dados privados por usuário (RLS no Supabase). Painel em Next.js (`apps/web`), API em Hono, contratos em `packages/shared`.

## Capabilities and Constraints

- Implementado no painel: entrar, cadastro e recuperação de senha; visões Dia, Semana e Mês; adição rápida; criação, edição, exclusão e troca de status de tarefas (tipos tarefa, prazo e audiência); configurações (fuso, antecedência do lembrete, horário do resumo).
- Não implementado: barra de comando e IA, Telegram (espaço reservado no cabeçalho).
- Painel não acessa o banco; usa só `supabase.auth` e a API.
- Tela inicial é "Meu dia". Ordem de atenção: atrasadas, prazos fatais de hoje, compromissos com horário, demais tarefas.
- Tarefa, prazo e audiência têm rótulos claros; horário se distingue de tarefa só com data.
- Em aberto: despesas e finanças pessoais são hipótese, não função confirmada; público de mercado; Telegram como canal preferido da maioria.

## Brand Commitments

Nome Nexus. Símbolo "N contínuo" com ponto terracota. Paleta confirmada como vinculante: azul petróleo `#142D3A` e terracota `#C05640` (docs em `docs/nexus/identidade-visual.md`; a paleta do painel em `apps/web/app/globals.css` ainda é provisória e deve migrar para esta). Voz calma, prática, próxima e sem julgamento; frases curtas com ação e horário explícitos; confirmar antes de assumir data ou hora; sem broncas sobre atraso.

## Evidence on Hand

Docs de identidade, Mini App e Instagram em `docs/nexus/`; conceitos SVG em `docs/nexus/conceitos/`; direção do painel em `docs/archive/planejamento/specs/2026-10-26-painel-web-direcao-visual.md`. Não há usuários, depoimentos, métricas nem validação de mercado: não inventar.

## Product Principles

1. Captura rápida: poucos passos e pouca digitação.
2. Confirmar antes de adivinhar data ou hora.
3. Aviso transparente: mostrar o estado real; "enviado" não é "lido".
4. Ação depois do aviso: concluir, adiar ou reagendar sem refazer a tarefa.
5. Pessoal primeiro, especializado depois: não exigir classificar como jurídica; privacidade por padrão.

## Accessibility & Inclusion

Segundo a spec do painel: manter contraste e não depender só da cor para atraso, prazo fatal, audiência ou conclusão. Contrastes da paleta estão medidos em `docs/nexus/identidade-visual.md` (ex.: terracota sobre fundo névoa não serve para texto pequeno).
