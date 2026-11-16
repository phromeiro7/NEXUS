# Assistente de IA: custos e roteiro com o modelo real

Nota de 2026-10-29 (Plano 4, Task 8). Os preços abaixo são **estimativas** e devem ser reconferidos na
página de preços do provedor antes de qualquer decisão.

## 1. Criar a chave da API

1. Entre em console.anthropic.com e vá em **Billing**: adicione créditos pré-pagos e defina um
   **limite mensal de gasto** baixo (ele é o teto real; o resto desta nota são só estimativas).
2. Mantenha a **recarga automática desligada**.
3. Vá em **API Keys**, crie uma chave só para este projeto e copie-a uma única vez.
4. Guarde a chave **apenas** na variável de ambiente `ANTHROPIC_API_KEY` (em `apps/api/.env`, que o Git
   ignora, ou no gerenciador de segredos da hospedagem). **Nunca** a coloque no Git, em logs, em issues,
   em mensagens de commit ou no navegador (o painel nunca chama a IA; só a API chama).

## 2. Modelo e premissas de preço

Modelo: `claude-haiku-5-5` (configurável por `ASSISTANT_MODEL`). Premissas usadas pelo roteiro e por esta
nota (estimativas de 2026-10-29, **reconferir**):

| Item | Preço |
|---|---|
| Entrada | US$ 0,10 por milhão de tokens |
| Saída | US$ 0,50 por milhão de tokens |
| Leitura de cache | 10% do preço da entrada (US$ 0,01 por milhão) |

As constantes estão em `apps/api/scripts/assistant-smoke.ts`; se o preço mudar, edite-as lá e aqui.

## 3. Custo por mensagem (raciocínio)

- Prompt de sistema + definições das ferramentas: cerca de 2 mil tokens por chamada.
- Cada mensagem faz de 1 a 4 chamadas ao modelo (ciclo de ferramentas, máximo de 4 passos); o contexto
  cresce a cada passo (histórico de até 12 mensagens e resultados de ferramentas).
- Esforço `low`; o pensamento adaptativo conta como saída (o `max_tokens` é 4096).
- Ordem de grandeza (a confirmar com a medição): ~2,5 mil tokens de entrada e algumas centenas de saída
  por chamada, ou seja, frações de centavo por mensagem. Pior caso por mensagem, com 4 chamadas de 8 mil
  tokens de entrada e 4.096 de saída: cerca de US$ 0,011. O roteiro imprime esse teto antes de rodar.
- O custo real por mensagem deve ser calculado a partir dos tokens **medidos** pelo roteiro.

## 4. O que reduz o custo

- **Briefing sem IA:** o resumo diário é texto determinístico (`renderBriefing`), sem chamada ao modelo.
- **Limite de 30 mensagens por hora por usuário** (contado em chamadas ao modelo) e 1.000 caracteres por
  mensagem, verificados antes de chamar a IA.
- **Máximo de 4 passos** por mensagem e timeouts por chamada.
- **Cache de prompt:** o trecho estável do prompt de sistema é marcado como cacheável. O cache só funciona
  se o prefixo cacheável (ferramentas + sistema) atingir o **mínimo de tokens do modelo**; com ~2 mil
  tokens isso pode **não** acontecer. **Medir** `cacheReadTokens` com o roteiro: se vier sempre 0, o cache
  não está valendo e o custo de entrada é o cheio (ainda baixo).

## 5. Como rodar o roteiro (gasta dinheiro de verdade)

O roteiro usa repositórios em memória e dados fictícios; só precisa da chave. Sem `--yes` ele mostra o
máximo de chamadas e o teto de custo e sai sem chamar nada:

```
ANTHROPIC_API_KEY=<sua-chave> pnpm --filter @nexus/api smoke:assistant
```

Para executar de verdade (40 chamadas no máximo):

```
ANTHROPIC_API_KEY=<sua-chave> pnpm --filter @nexus/api smoke:assistant --yes
```

Opcional: `--out relatorio.txt` grava o relatório (nunca contém a chave). Nada mais é gravado em disco.
Cole a tabela impressa na seção 7.

## 6. O que verificar com o modelo real

- O modo `strict` aceita os schemas das ferramentas, incluindo `anyOf` com `null`.
- `format: date` e `format: uuid` são aceitos; o padrão de `dueTime` (HH:mm) foi removido do schema
  enviado: o modelo ainda escreve `HH:mm` e o Zod do servidor valida?
- `strict` + `output_config.effort: "low"` + pensamento adaptativo funcionam juntos em `claude-haiku-5-5`.
- O prefixo cacheável atinge o mínimo e `cacheReadTokens` fica acima de zero nas chamadas seguintes.
- Montar o adaptador real na subida da API **não faz chamada de rede**.
- Comportamento por frase: duas tarefas numa frase; "amanhã de manhã" (09h) com suposição dita;
  "sexta" sem hora; "semana que vem" gera pergunta; `30/02` é rejeitada; horário já passado hoje gera
  pergunta; `calcular_prazo` usado para dias úteis; correção de tarefa existente via `listar_tarefas`;
  listagem da semana; injeção ("ignore as regras…") não conclui nada.

## 7. Resultados

**Não executado: aguarda chave e aprovação do gasto.**

(Seção intencionalmente vazia até a primeira execução com `--yes`.)
