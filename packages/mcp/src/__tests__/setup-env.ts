import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Keep every test hermetic: loadConfig() reads the developer's ~/.wraps/config.json through os.homedir(),
// so a machine with a `wraps auth login` session would otherwise register the API tools (and could leak a
// token into test output). Tests that need a credential set it explicitly.
process.env.HOME = mkdtempSync(join(tmpdir(), 'wraps-mcp-test-home-'));
for (const name of ['WRAPS_API_KEY', 'WRAPS_API_URL', 'WRAPS_ORG_ID']) {
  delete process.env[name];
}
