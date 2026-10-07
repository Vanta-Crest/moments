import { build } from 'esbuild';
await build({ entryPoints: ['app.jsx'], bundle: true, outdir: 'public', format: 'esm', sourcemap: true, minify: false });
