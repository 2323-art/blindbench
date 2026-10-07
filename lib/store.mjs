import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
export async function openStore(directory) {
  await mkdir(directory, { recursive: true });
  const file = new URL('state.json', directory);
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') throw e; data = { jobs: {}, comparisons: {}, announced: false }; }
  let pending = Promise.resolve();
  return { data, save() {
    const snapshot = JSON.stringify(data, null, 2);
    pending = pending.then(async () => {
      const temp = new URL('state.tmp', directory);
      await writeFile(temp, snapshot, { mode: 0o600 });
      await rename(temp, file);
    });
    return pending;
  } };
}
