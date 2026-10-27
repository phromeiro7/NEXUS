import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@aj/shared"],
  // @aj/shared usa imports "./x.js" que apontam para arquivos .ts (ESM/NodeNext);
  // o Turbopack não faz esse mapeamento, então dev e build usam webpack.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
