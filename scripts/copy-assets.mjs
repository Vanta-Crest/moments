import { copyFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

await copyFile(new URL('../src/react/moments.css', import.meta.url), new URL('../dist/react/moments.css', import.meta.url));
await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
// The Moments Director page: the panel and React in one self-contained module, so consumers need no React at runtime.
await build({
    entryPoints: [fileURLToPath(new URL('../dist/director/main.js', import.meta.url))], bundle: true, format: 'esm', platform: 'browser',
    target: 'chrome120', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
    outfile: fileURLToPath(new URL('../dist/director/director.js', import.meta.url)), logLevel: 'warning'
});
