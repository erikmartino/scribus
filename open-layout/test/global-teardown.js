/**
 * Playwright globalTeardown — removes all *.tmp user directories from
 * store/ to clean up after the E2E run (and any stale leftovers from
 * previous crashed runs).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storeDir = path.join(path.resolve(__dirname, '..'), 'store');

export default async function globalTeardown() {
  for (const entry of fs.readdirSync(storeDir)) {
    if (entry.endsWith('.tmp')) {
      const dir = path.join(storeDir, entry);
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[globalTeardown] Removed store/${entry}/`);
    }
  }
}
