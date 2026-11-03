import { createFetchHandler } from './handler.js';

// Entrada da função da Vercel: o build (scripts/build-vercel.ts) empacota este arquivo em api/index.js.
export default { fetch: createFetchHandler(process.env) };
