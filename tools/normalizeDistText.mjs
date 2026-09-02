import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const textExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.map',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    if (entry.isFile()) files.push(absolute);
  }

  return files;
}

let normalized = 0;
for (const file of await walk(root)) {
  if (!textExtensions.has(path.extname(file).toLowerCase())) continue;

  const before = await readFile(file, 'utf8');
  const after = before.replace(/\r\n?/g, '\n');
  if (after === before) continue;

  await writeFile(file, after, 'utf8');
  normalized += 1;
}

console.log(`Normalized line endings in ${normalized} dist file(s).`);
