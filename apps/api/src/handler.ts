import { buildApp } from './compose.js';
import { loadConfig } from './config.js';

export type FetchHandler = (request: Request) => Promise<Response> | Response;

/**
 * Adaptador fino para plataformas serverless (Vercel): lê a configuração do ambiente uma vez por instância
 * e responde com o `fetch` do Hono. Configuração inválida vira um 500 que nomeia a variável (as mensagens de
 * `loadConfig` nunca contêm valores) em vez de derrubar a função sem explicação.
 */
export function createFetchHandler(env: Record<string, string | undefined>): FetchHandler {
  let app: ReturnType<typeof buildApp> | undefined;
  let failure: string | undefined;

  return (request) => {
    if (app === undefined && failure === undefined) {
      try {
        app = buildApp(loadConfig(env));
      } catch (error) {
        failure = error instanceof Error ? error.message : 'configuração inválida';
        console.error(JSON.stringify({ level: 'error', msg: 'configuracao_invalida', detail: failure }));
      }
    }
    if (app === undefined) {
      return Response.json({ error: 'configuracao_invalida', message: failure }, { status: 500 });
    }
    return app.fetch(request);
  };
}
