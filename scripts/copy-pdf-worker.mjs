/**
 * pdfjs runs its parsing in a web worker, and the worker has to be served as
 * a plain file. Bundling it through `new URL(..., import.meta.url)` does not
 * survive Next's build, so it is copied into public/ instead and loaded from
 * there. Run before every build; public/pdf.worker.min.mjs is generated and
 * not committed.
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
const destination = join(root, 'public/pdf.worker.min.mjs');

if (!existsSync(source)) {
  console.error(`pdf worker not found at ${source} — is pdfjs-dist installed?`);
  process.exit(1);
}

mkdirSync(dirname(destination), { recursive: true });
copyFileSync(source, destination);
console.log('Copied pdf.worker.min.mjs into public/');
