import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', cli: 'src/cli.ts' },
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: false,
  // Keep dependencies external (native better-sqlite3, pdf.js workers, etc.)
  skipNodeModulesBundle: true,
});
