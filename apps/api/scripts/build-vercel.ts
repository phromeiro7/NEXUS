import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Empacota src/vercel.ts (com @aj/shared e todas as dependências) em um único api/index.js ESM, que a Vercel serve
 * como função Node. Assim não há TypeScript nem resolução de workspace em tempo de execução.
 */
export async function buildVercelBundle(): Promise<string> {
  const outfile = resolve(root, 'api/index.js');
  await build({
    entryPoints: [resolve(root, 'src/vercel.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: false,
    logLevel: 'warning',
    // Dependências CommonJS empacotadas podem chamar require(); ESM puro não o define.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
  // O projeto da Vercel exige um diretório de saída; a API não serve arquivos estáticos.
  mkdirSync(resolve(root, 'public'), { recursive: true });
  writeFileSync(resolve(root, 'public/.gitkeep'), '');
  return outfile;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildVercelBundle();
  console.log(`bundle gerado: ${out}`);
}
