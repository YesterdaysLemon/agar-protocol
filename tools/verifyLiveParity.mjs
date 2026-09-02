import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const base = new URL(process.argv[3] ?? 'https://fluoddity.com/');
const concurrency = 8;

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function compare(file) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  const local = await readFile(file);
  const response = await fetch(new URL(relative, base), {
    headers: { 'accept-encoding': 'identity' },
  });

  if (!response.ok) {
    return {
      relative,
      error: `${response.status} ${response.statusText}`,
    };
  }

  const remote = Buffer.from(await response.arrayBuffer());
  const localHash = sha256(local);
  const remoteHash = sha256(remote);
  return {
    relative,
    exact: localHash === remoteHash,
    localBytes: local.length,
    remoteBytes: remote.length,
    localHash,
    remoteHash,
  };
}

const files = (await walk(root)).sort();
const results = [];

for (let i = 0; i < files.length; i += concurrency) {
  results.push(...(await Promise.all(files.slice(i, i + concurrency).map(compare))));
}

const mismatches = results.filter((result) => result.error || !result.exact);
if (mismatches.length > 0) {
  console.error(`Mismatch in ${mismatches.length} of ${results.length} file(s):`);
  for (const mismatch of mismatches) {
    if (mismatch.error) {
      console.error(`  ${mismatch.relative}: ${mismatch.error}`);
      continue;
    }
    console.error(
      `  ${mismatch.relative}: ` +
        `${mismatch.localBytes} B ${mismatch.localHash} != ` +
        `${mismatch.remoteBytes} B ${mismatch.remoteHash}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(`Exact byte match: ${results.length}/${results.length} dist files.`);
}
