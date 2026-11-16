import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nexus/shared"],
  // @nexus/shared usa imports "./x.js" que apontam para arquivos .ts (ESM/NodeNext);
  // o Turbopack não faz esse mapeamento, então dev e build usam webpack.
  // Reavaliar quando o Turbopack suportar extension aliasing ou quando o shared deixar de usar
  // o sufixo .js. Para reverter: remover este `webpack` (extensionAlias) e as flags --webpack
  // dos scripts dev/build em apps/web/package.json.
  // O painel antigo (calculadora de prazos e histórico) saiu: os endereços velhos levam a Hoje.
  async redirects() {
    return [
      { source: "/calculadora", destination: "/", permanent: false },
      { source: "/historico", destination: "/", permanent: false },
    ];
  },
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
