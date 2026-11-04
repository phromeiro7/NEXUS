# Handoff para outra IA de desenvolvimento

Use este texto como contexto inicial ao continuar o projeto.

> Estamos evoluindo este repositório de um assistente originalmente jurídico para o **Nexus**, um assistente pessoal com foco em tarefas/lembretes e Telegram como canal prioritário. O Mini App deve ser rápido para consultar e agir; o bot continua sendo o caminho de captura por mensagem; o painel web oferece controle mais completo. Leia `docs/nexus/README.md`, `identidade-visual.md` e `mini-app.md`, além das especificações de produto existentes, antes de propor mudanças.
>
> A direção visual aprovada para explorar é o símbolo de **N contínuo**, azul petróleo `#142D3A`, fundo `#F5F6F2` e acento terracota `#C05640`. Os SVGs em `docs/nexus/assets/` e `docs/nexus/conceitos/` são conceitos de referência, não produção final.
>
> Trate funções e imagens como propostas, confirme o que já está implementado no código e evite reescrever contratos ou schema sem necessidade. O documento de escopo existente inclui despesas como hipótese; não as transforme em prioridade central sem validar. Para interface, siga WCAG 2.2 AA: contraste, foco visível, ações nomeadas, alvos de toque confortáveis, estados comunicados por texto e testes de largura estreita, zoom e leitor de tela. Não declare conformidade apenas pela prancha.
>
> Antes de editar, inspecione `AGENTS.md`/instruções locais, a estrutura das telas e os componentes atuais. Faça as alterações necessárias na implementação e documente qualquer decisão ainda aberta. Preserve dados e alterações de trabalho que não pertencem a esta tarefa.

## Decisões em aberto

- Confirmar a hierarquia do produto: tarefas/lembretes primeiro; decidir quando e como despesas entram.
- Definir comportamento de mensagens sem data/hora e se uma tarefa pode ficar sem agendamento.
- Definir se a tela inicial terá busca imediata ou se ela entra depois.
- Revisar a marca final (geometria, tipografia, exportações, disponibilidade do nome e uso público).
- Confirmar quais capacidades do painel atual serão reaproveitadas ou simplificadas para o Mini App.
