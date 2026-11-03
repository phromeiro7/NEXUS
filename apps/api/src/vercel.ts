import { getRequestListener } from '@hono/node-server';
import { createFetchHandler } from './handler.js';

// Entrada da função da Vercel (Build Output API, runtime Node): um request listener clássico (req, res).
// O build (scripts/build-vercel.ts) empacota este arquivo em .vercel/output/functions/api.func/index.js.
export default getRequestListener(createFetchHandler(process.env));
