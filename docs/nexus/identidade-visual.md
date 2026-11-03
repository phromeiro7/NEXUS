# Identidade visual do Nexus

**Estado:** direção conceitual registrada; validar com o responsável antes de publicação.  
**Produto:** assistente pessoal de tarefas e lembretes, com Telegram como canal prioritário.

## Essência

O Nexus ajuda a transformar uma intenção em algo organizado e fácil de acompanhar. A conversa é a forma rápida de registrar; o Mini App ajuda a consultar, ajustar e concluir; o painel web oferece controle mais completo.

**Ideia central:** conexão entre intenção e ação.  
**Assinatura exploratória:** “Sua rotina, conectada.”  
**Promessa de produto exploratória:** “Registre pelo Telegram. Organize o seu dia no Nexus.”

Usar linguagem pessoal, simples e confiável. Não prometer que todo lembrete será visto, que o sistema nunca falhará ou que o produto já faz gestão financeira completa.

## Personalidade e voz

- Calma, prática, próxima e sem julgamento.
- Frases curtas, com ação e horário explícitos.
- Pedir confirmação antes de assumir uma data ou hora que a pessoa não informou.
- Diferenciar estados com palavras: “Agendado”, “Enviado pelo Telegram”, “Falhou” e “Concluído”. “Enviado” não quer dizer “lido”.
- Evitar broncas sobre atraso, linguagem jurídica institucional e vocabulário de fintech.

Exemplos de voz:

- “Anotei: comprar ração. Quando você quer ser lembrado?”
- “Agendado: buscar encomenda hoje às 14h.”
- “O lembrete não foi enviado. Você pode tentar novamente ou reagendar.”
- “Tarefa concluída. Desfazer.”

## Símbolo e wordmark

O símbolo explorado é um **N contínuo**: hastes firmes, diagonal fluida e um ponto terracota separado que sugere um destino. O N deve ser reconhecível sem ponto, sem wordmark e em tamanho pequeno. O ponto é um acento opcional; a versão monocromática continua válida.

### Construção sugerida

- Terminais arredondados e espessura consistente.
- Diagonal limpa, sem parecer um check.
- Respiro generoso em volta do N e do ponto.
- Avatar quadrado com cantos arredondados e margem interna para recortes.
- Wordmark em minúsculas, “nexus”, com sans-serif legível e peso médio.
- Usar o ponto colorido como único acento no lockup principal.

Não usar balança, martelo, cifrão, cérebro, robô ou balão de conversa literal. Evitar nós demais, gradientes necessários para distinguir o desenho e detalhes finos que desapareçam em 24–48 px.

## Paleta exploratória

| Função | Cor | Uso |
|---|---|---|
| Azul petróleo | `#142D3A` | Marca, texto principal, botões primários e fundo escuro |
| Terracota | `#C05640` | Ponto do símbolo, acentos e foco visual |
| Fundo névoa | `#F5F6F2` | Fundo claro |
| Branco | `#FFFFFF` | Superfícies e texto em azul petróleo |
| Texto secundário | `#52616A` | Metadados e explicações |
| Terracota escura | `#8C4D3D` | Texto de alerta sobre branco |
| Contorno de controle | `#6F7E78` | Controles e bordas que precisam ser percebidos |

Contrastes medidos para pares usados nas pranchas (razão aproximada WCAG):

- `#142D3A` sobre branco: **14,32:1**.
- `#142D3A` sobre `#F5F6F2`: **13,20:1**.
- `#52616A` sobre branco: **6,41:1**.
- `#52616A` sobre `#F5F6F2`: **5,90:1**.
- `#C05640` sobre branco: **4,52:1** — passa AA para texto normal por margem pequena.
- `#C05640` sobre `#F5F6F2`: **4,16:1** — não usar como texto pequeno nesse fundo.
- `#C05640` contra `#142D3A`: **3,17:1** — adequado como elemento gráfico; não usar como texto pequeno nessa combinação.
- `#6F7E78` sobre branco: **4,26:1**; sobre fundo névoa: **3,92:1**.

WCAG exige em geral 4,5:1 para texto normal e 3:1 para texto grande e componentes/elementos gráficos relevantes. O wordmark como parte de logo é uma exceção de contraste textual, mas a legibilidade continua sendo boa prática. Ver [WCAG 2.2 — Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) e [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## Tipografia e forma

Usar sans-serif de interface legível, como Inter, Geist ou equivalente já disponível no produto. Preferir números tabulares em datas e valores. Evitar pesos muito leves, texto cinza claro e fontes decorativas em componentes funcionais. Cantos moderadamente arredondados (12–16 px) e sombra discreta; contraste e hierarquia vêm antes de decoração.

## Adaptação de marca

- **Bot do Telegram:** avatar apenas com símbolo; validar em 48, 40, 32 e 24 px.
- **Mini App:** símbolo pequeno no cabeçalho, paleta adaptada ao tema claro/escuro do Telegram e áreas seguras respeitadas.
- **Painel web:** wordmark e sistema visual completo, mantendo foco em leitura e tarefas.
- **Monocromático:** N legível sem o ponto ou com o ponto na mesma cor.

## Arquivos

- `assets/nexus-logo.svg` — lockup horizontal conceitual.
- `assets/nexus-avatar.svg` — avatar conceitual.
- `assets/nexus-instagram.png` — imagem quadrada 1080 × 1080 para foto de perfil.
- `assets/nexus-instagram.svg` — original vetorial da imagem de perfil.
- `conceitos/logo-nexus-prancha.svg` — estudos comparativos do logo.

SVGs usam fontes do sistema como aproximação. Antes de publicação, revisar desenho vetorial, espaçamentos, licença da fonte escolhida, versões claro/escuro e exportações de produção.
