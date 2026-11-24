import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

/** Limite de execução da função na Vercel, em segundos (o agendador pode levar ~45 s). */
const FUNCTION_MAX_DURATION_SECONDS = 60;
/** Região da função (gru1 = São Paulo). */
const FUNCTION_REGIONS = ['gru1'];
const NODE_RUNTIME = 'nodejs22.x';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Gera `.vercel/output` (Build Output API v3) com uma única função Node em `functions/api.func`, atendendo a
 * todos os caminhos. O handler é um bundle CommonJS autocontido (inclui @nexus/shared e todas as dependências):
 * não há TypeScript nem resolução de workspace em tempo de execução. Devolve o caminho do bundle.
 */
export async function buildVercelOutput(): Promise<string> {
  const outputDir = resolve(appRoot, '.vercel/output');
  const functionDir = resolve(outputDir, 'functions/api.func');
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(functionDir, { recursive: true });
  mkdirSync(resolve(outputDir, 'static'), { recursive: true });

  const bundlePath = resolve(functionDir, 'index.js');
  await build({
    entryPoints: [resolve(appRoot, 'src/vercel.ts')],
    outfile: bundlePath,
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
    resolve(functionDir, '.vc-config.json'),
    `${JSON.stringify(
      {
        runtime: NODE_RUNTIME,
        handler: 'index.js',
        launcherType: 'Nodejs',
        maxDuration: FUNCTION_MAX_DURATION_SECONDS,
        regions: FUNCTION_REGIONS,
      },
      null,
      2,
    )}\n`,
  );
  // Marca o bundle como CommonJS (o package.json do app é "type": "module").
  writeFileSync(resolve(functionDir, 'package.json'), '{ "type": "commonjs" }\n');
  // Rotas: arquivos estáticos primeiro; todo o resto cai na função `/api`.
  writeFileSync(
    resolve(outputDir, 'config.json'),
    `${JSON.stringify(
      { version: 3, routes: [{ handle: 'filesystem' }, { src: '/(.*)', dest: '/api' }] },
      null,
      2,
    )}\n`,
  );
  return bundlePath;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundlePath = await buildVercelOutput();
  console.log(`saída gerada: ${bundlePath}`);
}
