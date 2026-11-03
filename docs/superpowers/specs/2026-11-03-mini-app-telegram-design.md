# Mini App do Telegram e entrada por convite — desenho

Data: 2026-11-03. Estado: **desenho aprovado pelo usuário em conversa; nada construído**. Vira o Plano 7
(depois do Plano 6). Complementa a spec principal (`2026-10-26-assistente-juridico-design.md`).

## 1. Decisão

O produto é de **uso pessoal e de poucos convidados conhecidos**. Por isso:

1. O **Telegram é a entrada principal**: o painel abre como Mini App dentro do Telegram, sem pedir senha.
2. O **painel web com e-mail e senha continua**, mas como **porta de reserva do administrador** (o dono),
   sem divulgação aos convidados. Já está construído e revisado; mantê-lo não custa nada.
3. **Convidados entram por convite**, não por cadastro aberto.

Alternativa descartada: remover o painel web. Motivo: perder ou trocar a conta do Telegram trancaria os
prazos de quem não tem outro acesso, e o administrador precisa de um caminho de recuperação. Dá para
remover depois sem desfazer nada, porque o Mini App usa a mesma conta.

## 2. Fluxos

**Convite.** O administrador gera um código de convite (uso único, com validade). O convidado envia
`/start CONVITE` ao bot; o servidor valida o código, cria a conta ligada àquele `telegram_user_id` e
responde confirmando. Nenhum e-mail é pedido ao convidado.

**Uso diário.** No bot, `/painel` (ou o botão de menu "Painel") mostra o botão "Abrir painel". O Mini App
abre dentro do Telegram, mostra o dia (fatal, atrasadas, agenda) e a barra de comando com a IA.

**Administrador.** Continua usando e-mail e senha no painel web (computador, configurações, calculadora,
histórico) e pode abrir também o Mini App. A conta do administrador é vinculada ao Telegram pelo fluxo
`/start CÓDIGO` que já existe (Plano 5).

**Convidado que perde o Telegram.** O administrador vincula o novo `telegram_user_id` à conta existente
(ação de administração). Não há recuperação por conta própria.

## 3. Autenticação do Mini App

- A página lê `window.Telegram.WebApp.initData` e envia à API (`POST /auth/telegram`).
- A API valida a assinatura HMAC-SHA256 com o token do bot (chave derivada de `WebAppData`), compara em
  tempo constante, exige `auth_date` recente (janela curta, a definir no plano) e rejeita reuso.
- O `telegram_user_id` assinado identifica o usuário. Nenhum identificador vindo do corpo da requisição é
  confiável; o `user_id` da sessão vem só do servidor.
- A sessão é presa a **um único `user_id`**. A chave de serviço ignora RLS, então toda consulta continua
  filtrando por `user_id` (regra já vigente; foreign/missing → 404).
- `initData` e token do bot nunca aparecem em logs.

## 4. Contas criadas pelo bot

- Conta criada por convite não tem e-mail. **A verificar no plano:** se o Supabase Auth admite usuário sem
  e-mail; senão, usar um e-mail sintético não entregável, sem expô-lo ao usuário.
- Convite: código aleatório de uso único, expiração, limite de tentativas inválidas (mesmo padrão do
  código de vínculo do Plano 5), revogável pelo administrador.
- Um `telegram_user_id` só pode estar ligado a uma conta (já garantido pelo vínculo atual).

## 5. Telas (protótipo)

Artefato de design: <https://claude.ai/artifact/A1CgdKGrCH1Ld7umW8B92p>, quadros "1. No bot: botão Painel"
e "2. Mini App aberto dentro do Telegram" (dados fictícios; maquete estática). Falta desenhar: barra de
comando com IA no Mini App, tela de convite aceito e tela de erro "convite inválido ou expirado".

## 6. Escopo do Plano 7

Decisão de 2026-11-03: o Mini App deve ser **o mais completo possível**, para que as pessoas quase não
precisem do painel web. Lista de telas e consequências em `docs/ROTEIRO-NEXUS.md` §5. Divisão proposta:

**7a: utilizável**
1. Convite e conta pelo bot: geração (administrador), `/start CONVITE`, criação de conta, revogação,
   vínculo de novo Telegram pelo administrador.
2. Validação da assinatura e sessão do Mini App: `POST /auth/telegram`, anti-replay, sessão curta.
3. Telas para celular: Hoje, detalhe da tarefa, captura e barra de comando com IA; tema do Telegram
   (`themeParams`), botão principal e voltar; `/painel` e botão de menu no bot.

**7b: paridade com o painel**
4. Calendário (Dia, Semana, Mês), histórico e busca.
5. Configurações (fuso, antecedência, horário do resumo, Telegram) e recursos opcionais (processos,
   calculadora, feriados).

## 7. Dependências e riscos

- Precisa do **bot criado** (BotFather) e do **painel em HTTPS público**; sem isso só há testes
  automatizados com Telegram falso. Domínio do Mini App é configurado no BotFather.
- O Mini App abre num navegador embutido: testar em Android, iOS e Telegram Desktop.
- Convidados são dados pessoais de terceiros: entram na decisão de retenção/LGPD (spec §14).
- Cada convidado consome a cota de IA do dono da chave: manter o limite por usuário (30/hora) e decidir um
  teto de gasto total.
- Perda de acesso do administrador: manter o login por e-mail e senha testado.

## 8. Perguntas em aberto

- Janela de validade do `auth_date` e duração da sessão do Mini App.
- Usuário sem e-mail no Supabase Auth (ver §4).
- Quantos convidados, e se haverá perfis de administrador além do dono.
- Mini App no mesmo app Next.js (rotas mobile-first) ou app separado? Recomendação inicial: mesmo app.
- (Resolvido em 2026-11-03) Escopo do Mini App: o mais completo possível; ver §6.

## 10. Decisão do usuário (2026-11-03, terceira rodada): login com Telegram também no painel web

Os convidados podem usar o painel web, **sempre entrando pelo Telegram** (sem e-mail nem senha). Substitui
"o painel só atende ao administrador" da §1 e a parte "só Mini App" da §9: convidados usam o Mini App e o
painel web, com a mesma conta.

- **Botão "Entrar com Telegram"** na tela de login do painel (Telegram Login Widget): o Telegram assina os
  dados; a API confere a assinatura (chave derivada do token do bot, comparação em tempo constante,
  `auth_date` recente, sem reuso) e abre a sessão da conta ligada àquele `telegram_user_id`. A validação é
  parente da do Mini App (`initData` usa outra derivação de chave): mesmo módulo, duas funções.
- **Primeiro login só com convite:** se o `telegram_user_id` não tem conta nem convite válido, nada é criado
  (senão qualquer pessoa com Telegram entraria). O convite é o do §2; no widget, o código de convite precisa ser
  informado antes ou o convidado aceita o convite pelo bot (`/start CONVITE`) e só depois entra no painel.
- **Mesma conta** no Mini App e no painel web.
- Exige `/setdomain` no BotFather apontando para o endereço do painel (funciona com `*.vercel.app`) e o painel
  em HTTPS.
- Entra no Plano 7a, compartilhando a sessão e a validação com o Mini App.
- O administrador mantém e-mail e senha; o cadastro por e-mail continua removido.
