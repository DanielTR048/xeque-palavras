import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'vite';

const output = path.resolve('dist');
const files = {};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'server' || entry.name === '.openai') continue;
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else if (entry.isFile()) {
      const name = '/' + path.relative(output, filename).replaceAll('\\', '/');
      files[name] = { type: mime[path.extname(filename)] ?? 'application/octet-stream', data: (await readFile(filename)).toString('base64') };
    }
  }
}
await collect(output);
await mkdir('.sites-runtime', { recursive: true });
await writeFile('.sites-runtime/assets.json', JSON.stringify(files));
await build({ configFile: false, publicDir: false, build: { outDir: 'dist/server', emptyOutDir: true,
  target: 'es2022', minify: true, lib: { entry: 'server/worker.ts', formats: ['es'], fileName: () => 'index.js' },
} });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log(`Sites Worker prepared with ${Object.keys(files).length} bundled assets.`);
