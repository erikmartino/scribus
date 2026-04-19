/**
 * Playwright globalSetup — creates a disposable test user directory under
 * store/ so E2E tests that write (save, upload, clone) never modify
 * tracked files.
 *
 * Directory name: e2e-{pid}.tmp  (*.tmp is gitignored)
 *
 * Tests clone seed documents from demo/typography-sampler via the
 * existing POST copy endpoint — no file-level copying needed here.
 *
 * The user name is passed to workers via process.env.E2E_STORE_USER.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const storeDir = path.join(path.resolve(__dirname, '..'), 'store');

export default async function globalSetup() {
  // Remove stale dirs from previous crashed runs.
  for (const entry of fs.readdirSync(storeDir)) {
    if (entry.endsWith('.tmp')) {
      fs.rmSync(path.join(storeDir, entry), { recursive: true, force: true });
    }
  }

  const user = `e2e-${process.pid}.tmp`;
  fs.mkdirSync(path.join(storeDir, user), { recursive: true });

  process.env.E2E_STORE_USER = user;
  console.log(`[globalSetup] Test user: store/${user}/`);
}
