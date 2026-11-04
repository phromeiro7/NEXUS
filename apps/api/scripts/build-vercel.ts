import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Gera `.vercel/output` (Build Output API v3) com uma única função Node em `functions/api.func`, atendendo a
 * todos os caminhos. O handler é um bundle CommonJS autocontido (inclui @aj/shared e todas as dependências):
 * não há TypeScript nem resolução de workspace em tempo de execução. Devolve o caminho do bundle.
 */
export async function buildVercelOutput(): Promise<string> {
  const output = resolve(root, '.vercel/output');
  const func = resolve(output, 'functions/api.func');
  rmSync(output, { recursive: true, force: true });
  mkdirSync(func, { recursive: true });
  mkdirSync(resolve(output, 'static'), { recursive: true });

  const bundle = resolve(func, 'index.js');
  await build({
    entryPoints: [resolve(root, 'src/vercel.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: false,
    logLevel: 'warning',
    // `export default listener` vira `module.exports = listener` (o launcher da Vercel faz require do handler).
    footer: { js: 'module.exports = module.exports.default;' },
  });

  writeFileSync(
    resolve(func, '.vc-config.json'),
    `${JSON.stringify(
      {
        runtime: 'nodejs22.x',
        handler: 'index.js',
        launcherType: 'Nodejs',
        maxDuration: 60,
        regions: ['gru1'],
      },
      null,
      2,
    )}\n`,
  );
  // Marca o bundle como CommonJS (o package.json do app é "type": "module").
  writeFileSync(resolve(func, 'package.json'), '{ "type": "commonjs" }\n');
  writeFileSync(
    resolve(output, 'config.json'),
    `${JSON.stringify(
      { version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/api' }] },
      null,
      2,
    )}\n`,
  );
  return bundle;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = await buildVercelOutput();
  console.log(`saída gerada: ${out}`);
}
