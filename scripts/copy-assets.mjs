import { copyFile, chmod } from 'node:fs/promises';

await copyFile(new URL('../src/react/moments.css', import.meta.url), new URL('../dist/react/moments.css', import.meta.url));
await chmod(new URL('../dist/cli.js', import.meta.url), 0o755);
