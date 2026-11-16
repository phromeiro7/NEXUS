# Política de segurança

## Como reportar uma vulnerabilidade

Não abra uma issue pública. Use o relato privado do GitHub: aba **Security** do repositório, depois
**Report a vulnerability**. Descreva o que encontrou, como reproduzir e o impacto.

Respondo assim que possível. É um projeto pessoal, sem prazo garantido de correção.

## Escopo

- Acesso a dados de outro usuário (isolamento por usuário e RLS).
- Falhas na autenticação: login pelo Telegram, QR code e convites.
- Rotas internas e o webhook do Telegram sem o segredo.

## Dados e segredos

O repositório não guarda segredos: as chaves ficam em variáveis de ambiente (veja `.env.example`). Se você
encontrar uma chave real no histórico, avise pelo relato privado para eu revogá-la.
