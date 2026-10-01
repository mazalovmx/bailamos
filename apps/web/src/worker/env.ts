import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {config} from 'dotenv';
// Imported first by the worker entrypoint: several modules (mail transport, Prisma, auth) read the environment
// while they load. Variables that are already set (Railway, Docker) win; the repository .env only fills the gaps locally.
function findEnvFile() {
  let directory = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const file = join(directory, '.env');
    if (existsSync(file)) return file;
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) return null;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}
const file = findEnvFile();
if (file) config({path: file, quiet: true});
export const envFile = file;
