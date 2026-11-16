# Escopo do produto — Assistente Pessoal

**Data:** 2026-10-26  
**Estado:** Rascunho de produto para validação com o responsável  
**Origem:** revisão de escopo e brainstorming nesta conversa  
**Documento anterior:** `2026-10-26-assistente-juridico-design.md` (visão jurídica original e requisitos técnicos já explorados)

> Este documento propõe um reposicionamento do produto. Ele não apaga nem invalida a base jurídica já construída; registra uma visão mais ampla que ainda precisa ser validada antes de replanejar a implementação.

## 1. Resumo

**Hipótese de posicionamento:** um assistente pessoal que reúne lembretes do cotidiano e organização financeira pessoal. A pessoa pode registrar tarefas e gastos por conversa e consultar compromissos e despesas num painel. A advocacia é um possível contexto, não uma definição confirmada do produto.

**Hipótese de proposta de valor:** “Registre por mensagem o que você precisa lembrar e o que gastou; acompanhe lembretes, contas e despesas num só painel.” É uma formulação para validar, não uma promessa já aprovada para o mercado.

O primeiro canal considerado é o Telegram. Um painel web organiza lembretes e registros financeiros, permitindo consultar, corrigir e acompanhar despesas e compromissos. Para avisos, continua valendo que um item visível no painel **não garante que a pessoa veja o aviso** sem abrir o painel. O produto deve provar captura simples e dados confiáveis antes de ampliar para automações ou aconselhamento financeiro.

## 2. Evidências da descoberta

### Fatos expressos pelo responsável

- A intenção inicial parece mais próxima de um assistente pessoal do que de uma agenda exclusivamente jurídica.
- O assistente deve ajudar a lembrar coisas fora do escritório, além de tarefas de trabalho.
- O caso concreto citado foi lembrar de comprar coisas no mercado; a pessoa só lembrou porque alguém ligou para avisar.
- Para esse caso, o aviso ideal seria em um dia e horário específicos.
- O canal mais natural para registrar o lembrete é enviar uma mensagem no Telegram.
- Se a mensagem não trouxer data ou hora, o assistente deve sugerir uma opção e pedir confirmação.
- Se o Telegram estiver indisponível no momento do aviso, o lembrete também deve aparecer no painel web.
- O módulo financeiro deve registrar compras e despesas, incluindo valor e meio de pagamento (por exemplo, R$ 42 no crédito no mercado; dinheiro, Pix ou cartão).
- Compras parceladas, como um tênis em 10 vezes, devem aparecer no painel com o parcelamento e seus efeitos ao longo dos meses.
- O painel deve organizar despesas fixas, recorrentes e variáveis, além de mostrar o que foi pago em dinheiro, Pix e outras formas.
- A paleta de cores do protótipo atual é provisória e será revisada depois.

### Hipóteses ainda não validadas

- Outras pessoas têm a mesma dor e usariam o produto regularmente.
- Telegram será o canal preferido da maioria dos usuários, além do responsável.
- A sugestão de horário poderá se basear em preferências pessoais simples.
- Um painel web é a melhor superfície de consulta, conclusão e recuperação de avisos falhos.
- Categorias como casa, pessoal, trabalho e jurídico ajudam a organizar, sem tornar o registro mais lento.

O exemplo do mercado é uma evidência útil para a descoberta, mas não valida sozinho o mercado, o público ou a necessidade de listas de compras, localização ou recorrência.

## 3. Problema e público inicial

### Problema

Informações pessoais ficam espalhadas: tarefas dependem da memória e os gastos acabam esquecidos ou anotados sem contexto. A pessoa quer registrar o que precisa fazer e o que comprou com pouco esforço, e depois entender o que vence, o que se repete e como pagou.

### Público inicial

O primeiro piloto deve ser centrado no próprio responsável e em pessoas com rotina semelhante, para testar o comportamento do assistente em situações reais. A definição de público de mercado — advogados, profissionais autônomos ou pessoas em geral — continua em aberto.

### Trabalho a realizar (job-to-be-done)

> Quando eu fizer uma compra ou lembrar de algo que preciso fazer, quero registrar isso rapidamente por mensagem e encontrar no painel os gastos, parcelas, recorrências e lembretes organizados, para ter uma visão confiável do meu cotidiano e do meu dinheiro.

## 4. Princípios do produto

1. **Captura rápida:** registrar uma intenção deve exigir pouca digitação e poucos passos.
2. **Confirmação antes de adivinhar:** horário ou data sugeridos pelo assistente não são aplicados sem confirmação.
3. **Aviso confiável e transparente:** mostrar se o lembrete foi agendado, enviado, atrasou ou falhou; não prometer entrega perfeita por um canal externo.
4. **Ação depois do aviso:** permitir concluir, adiar ou reagendar sem reconstruir a tarefa.
5. **Organização financeira sem julgamento:** mostrar registros e totais de forma clara; não apresentar estimativas como fatos nem dar aconselhamento financeiro sem escopo próprio.
6. **Pessoal primeiro, especializado quando necessário:** não exigir que a pessoa classifique a tarefa como jurídica para poder registrá-la.
7. **Privacidade por padrão:** tratar gastos, títulos e detalhes de tarefas como informação privada e limitar seu uso e retenção.

## 5. Escopo do primeiro produto testável (MVP)

O piloto deve testar dois ciclos: captura de despesas → confirmação → organização no painel; e criação de lembretes → confirmação → aviso → ação. Ele não tenta responder qualquer pergunta, movimentar dinheiro ou executar ações externas em nome do usuário. Login, autorização, isolamento de dados e recuperação operacional continuam requisitos da aplicação; não são a hipótese de valor que o piloto precisa provar.

### 5.1 Telegram — captura e avisos

- Vincular uma conta do Telegram a uma conta do produto por um fluxo iniciado no painel web.
- Receber mensagens de texto do usuário autenticado.
- Interpretar uma tarefa ou lembrete simples e a data/hora quando forem explícitas.
- Se não houver data nem hora, sugerir uma opção e pedir confirmação antes de agendar.
- Se houver só data ou só hora, ou a expressão for ambígua, pedir esclarecimento ou propor alternativas; nunca completar em silêncio.
- Confirmar em linguagem simples o conteúdo, o dia e o horário que foram registrados.
- Permitir corrigir o texto, cancelar, concluir ou reagendar por resposta ao assistente.
- Enviar o aviso no horário confirmado, no fuso configurado pelo usuário.
- Retentar falhas temporárias e registrar no painel se o aviso foi enviado pelo Telegram ou continua pendente/falhou após tentativas.
- Evitar duplicar ações quando a plataforma repetir a entrega de uma mensagem recebida.

### 5.2 Painel web — controle e recuperação

- Visão “Meu dia” e lista de próximos lembretes.
- Consultar um lembrete, marcar como concluído e ajustar/reagendar.
- Mostrar um item cujo envio pelo Telegram falhou ou ainda está pendente de retentativa.
- Criar e editar lembretes por formulário simples como caminho de apoio ao Telegram.
- Cadastro e autenticação seguros para contas de produto; recuperação de acesso antes de abrir o serviço a usuários externos.
- Configurar fuso horário e, depois de validar, preferências de horário sugerido.

Estados mínimos a distinguir no painel: **agendado**, **enviado pelo Telegram**, **pendente de nova tentativa/falha**, **concluído** e **cancelado**. “Enviado” não significa “lido”. O painel não deve ser descrito como notificação alternativa enquanto não houver um mecanismo ativo que avise a pessoa para abri-lo.

### 5.3 Modelo inicial de lembrete

Cada lembrete contém, no mínimo:

- texto curto do que precisa ser lembrado;
- data e horário locais confirmados, ou indicação explícita de que ainda não há agendamento;
- fuso horário do usuário;
- estado (aberto, concluído ou cancelado);
- estado de entrega do aviso;
- datas de criação e atualização.

Contexto (casa, pessoal, trabalho ou jurídico), prioridade, recorrência e múltiplos avisos são hipóteses de evolução. Só entram no MVP se os testes mostrarem que são necessários para o ciclo principal.

### 5.4 Financeiro pessoal — hipótese de MVP

- Registrar uma despesa por mensagem, por exemplo: “Gastei R$ 42 no mercado no crédito”.
- Extrair e confirmar valor, descrição/categoria e meio de pagamento. Se um dado essencial estiver ausente ou ambíguo, perguntar; não inventar valor, cartão ou categoria.
- Suportar pelo menos dinheiro, Pix e cartão como meios de pagamento, com possibilidade de corrigir o registro.
- Registrar uma compra parcelada, por exemplo: “Comprei um tênis por R$ 600 em 10 vezes no cartão”, mostrando o valor total, quantidade e valor das parcelas e a sequência mensal prevista.
- Registrar despesas fixas e recorrentes e apresentá-las separadas das despesas variáveis. A periodicidade e a edição da série precisam ser definidas antes da implementação.
- Painel com lista de lançamentos, filtros por período/categoria/meio, totais por mês, visão de parcelas futuras e despesas recorrentes.
- Permitir corrigir e excluir um lançamento, com totais recalculados.
- Distinguir valores informados manualmente de dados importados; neste piloto, os registros são manuais e não existe conexão bancária.

**Exemplo de confirmação:** “Registrei R$ 42,00 em Mercado, pago no crédito, hoje. Está certo?” Para parcelamento: “Tênis: R$ 600,00 em 10 parcelas de R$ 60,00. Primeira parcela em [mês/data a confirmar]. Confirmar?” A data da primeira parcela não deve ser presumida quando não foi informada.

**Limite da hipótese:** o painel oferece organização e visibilidade dos dados registrados, não conciliação bancária, saldo real, previsão garantida de fatura ou recomendação sobre como gastar.

## 6. Fluxos centrais

### Criar com data e hora

1. Usuário envia: “Me lembra de comprar no mercado amanhã às 17h”.
2. Assistente interpreta texto, data, hora e fuso.
3. Assistente confirma: “Vou te lembrar amanhã, às 17h, de comprar no mercado. Está certo?”
4. Após confirmação, registra e responde que ficou agendado.
5. No horário definido, envia o aviso e permite concluir ou reagendar.

### Criar sem data e hora

1. Usuário envia: “Comprar coisas no mercado”.
2. Assistente propõe uma data/hora e explica a proposta.
3. Usuário confirma ou ajusta.
4. Só então o lembrete é agendado.

**Em aberto:** como selecionar a sugestão — preferência de horário configurada, escolha contextual simples ou pergunta direta. Nenhuma sugestão deve ser tratada como decisão silenciosa.

**Data ou hora parcial/ambígua:** comportamento a validar. A hipótese segura é perguntar ou propor alternativas e exigir confirmação antes de agendar.

### Recuperar aviso não entregue

1. O envio pelo Telegram falha ou o serviço está indisponível.
2. O lembrete continua salvo e aparece no painel com o estado de entrega correspondente.
3. O usuário pode concluir ou reagendar.

**Em aberto:** política e duração de retentativas, quando classificar uma falha como definitiva e se o painel precisa de um aviso ativo para chamar a atenção. Não depender de confirmação de leitura se o Telegram não fornecer esse sinal.

## 7. Fora do MVP

- Assistente de propósito geral que responde qualquer tema ou executa ações não relacionadas a lembretes.
- Lembretes baseados em localização ou geofencing.
- Compartilhamento de listas ou colaboração familiar/equipe.
- Recorrência avançada e rotinas automáticas complexas.
- Sincronização com Google Agenda, Outlook, WhatsApp, e-mail, voz ou outros canais.
- Conexão com bancos/cartões, importação automática de transações, conciliação, saldo bancário real, controle contábil, emissão de notas, impostos ou aconselhamento financeiro.
- CRM, gestão completa de processos, documentos jurídicos e colaboração entre escritórios.
- Leitura ou interpretação de documentos jurídicos por IA.

Lembrar de pagar uma conta ou cobrar um honorário pode ser registrado como um lembrete comum. Isso não equivale a um módulo financeiro.

## 8. Evolução possível (sujeita à validação)

### Etapa A — confiabilidade do ciclo

Comprovar que a captura, confirmação e entrega de lembretes funcionam no cotidiano e que o painel ajuda a recuperar ou ajustar avisos.

### Etapa B — organização pessoal

Avaliar contextos, listas simples, recorrência básica, preferências de lembrete, orçamento e formas melhores de consultar o que está pendente ou gasto.

### Etapa C — contexto profissional/jurídico

Decidir se vale reativar como experiência visível as capacidades já exploradas no repositório: prazos fatais, cálculo em dias úteis, feriados e referências a processos. A especialização jurídica pode ser um modo/categoria, sem impedir lembretes pessoais.

### Limites e módulos em validação

- Organização de despesas pessoais, parcelas, despesas fixas e recorrentes passa a ser uma hipótese central do produto a validar, não apenas uma oportunidade estacionada.
- Integração bancária, fluxo de caixa automatizado, contas a receber, orçamento avançado ou contabilidade requerem discovery e escopo próprios.
- A especialização jurídica existente no repositório é uma capacidade a avaliar; não é requisito escondido do MVP personal-first.

## 9. Critérios de sucesso do piloto

No piloto, observar primeiro e definir metas numéricas depois de obter uma linha de base:

- tempo e passos para registrar um lembrete pelo Telegram;
- proporção de interpretações de data/hora aceitas sem correção;
- lembretes entregues no horário confirmado, atrasados, falhos ou duplicados;
- quantos lembretes são concluídos, reagendados ou ignorados;
- uso do painel para recuperar avisos que falharam;
- retorno semanal ao produto e relatos de tarefas que deixaram de depender de memória/telefonema;
- tempo e correções necessárias para registrar um gasto por mensagem;
- proporção de lançamentos com valor, categoria, meio de pagamento e parcelamento interpretados corretamente;
- discrepâncias encontradas entre painel e anotações/faturas do usuário (sem presumir acesso automático a estas);
- uso dos filtros e da visão de despesas recorrentes e parcelas futuras.

O critério de confiança é mais importante que a quantidade de funcionalidades: um aviso errado, duplicado ou omitido pode prejudicar a promessa central.

## 10. Riscos e cuidados

- **Sugestões inadequadas:** sem preferências ou contexto suficiente, o horário sugerido pode ser inútil. Pedir confirmação e permitir corrigir é obrigatório.
- **Dependência do Telegram:** uma cópia no painel melhora a visibilidade, mas não garante que o usuário veja o aviso se não abrir o painel. A promessa precisa refletir os canais realmente disponíveis.
- **Falsa sensação de garantia:** usar “enviado” para significar “entregue e lido” seria enganoso; estados precisam distinguir envio e confirmação de leitura quando a plataforma fornecer essa informação.
- **Privacidade:** mensagens podem conter assuntos pessoais, familiares ou profissionais. Minimizar dados enviados à IA, evitar conteúdo sensível nos logs, proteger contas e definir retenção.
- **Escopo excessivo:** “tudo que eu preciso lembrar” pode virar um assistente genérico antes de o ciclo de lembretes estar confiável.
- **Transição técnica:** o modelo e a API atuais são orientados a tarefas jurídicas. Antes de ampliar, avaliar como generalizar campos e rotas sem quebrar o isolamento por usuário e os testes já existentes.

## 11. Decisões ainda em aberto

1. Qual é a regra de sugestão de data/hora quando o usuário não informa uma: usar preferência pessoal configurada, sugerir uma opção padrão ou perguntar?
2. Um lembrete sem data/hora deve permanecer em uma lista de pendências ou o assistente deve sempre buscar um agendamento confirmado?
3. O MVP precisa suportar várias tarefas numa única mensagem ou apenas um lembrete por mensagem?
4. Qual é a política de retentativa, quando a falha se torna definitiva e como chamar atenção para um item pendente?
5. Para cartão de crédito, o gasto entra no mês da compra, no mês de cada parcela ou o painel deve oferecer as duas visões (compra e compromissos futuros)?
6. Em parcelamentos, quando a primeira parcela vence se a pessoa não disser a data? Como tratar juros, entrada e parcelas com valores diferentes?
7. Como definir categorias: escolha manual, sugestão automática confirmada ou uma combinação? Quais categorias iniciais fazem sentido?
8. O usuário quer apenas registrar despesas ou também receitas, orçamento mensal e fechamento de fatura? O que fica no primeiro piloto?
9. Como representar uma despesa recorrente: lançamentos futuros previstos ou apenas uma regra recorrente? Como editar/cancelar uma ocorrência sem alterar toda a série?
10. Qual público além do responsável deve participar do piloto e qual problema recorrente será usado para avaliar aderência?
11. A funcionalidade jurídica deve aparecer já no produto personal-first ou ser avaliada depois?
12. Que retenção e controles de privacidade são aceitáveis para mensagens, gastos e lembretes, e como a mensagem será interpretada?

## 12. Relação com o repositório atual

A especificação e o código existentes foram iniciados para uma solução jurídica. Já há uma fundação de API para tarefas, processos, prazos, feriados, configurações, briefing, autenticação e isolamento por usuário. Ainda precisam ser construídos o painel web e os fluxos de assistente/Telegram e entrega de lembretes descritos neste documento.

O documento jurídico anterior inclui regras que entram em tensão com esta hipótese, como permitir tarefas sem prazo e aplicar horário-padrão a certas expressões vagas. Para o novo piloto, essas regras **não devem ser herdadas automaticamente**: data/hora ausentes ou parciais devem seguir o fluxo de sugestão/pergunta e confirmação descrito aqui. Antes de iniciar o front, revisar os contratos compartilhados, a semântica de estados de entrega e quais campos jurídicos permanecem extensões opcionais. A paleta de cores do protótipo continua provisória e fora deste escopo.
