import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const expectedHash = 'be0be47716fac4953df01044b1ae01c5da60a7317e99a78b146f33e7d99dd4c0';

test('le standalone ECHObound professionnel 2.0.0 reste intact', async () => {
  const [index, original] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url)),
    readFile(new URL('../ECHObound_standalone.html', import.meta.url)),
  ]);

  assert.deepEqual(index, original);
  assert.equal(createHash('sha256').update(original).digest('hex'), expectedHash);

  const html = original.toString('utf8');
  assert.match(html, /<title>ECHObound — La Cité des Échos<\/title>/);
  assert.match(html, /const VERSION = '2\.0\.0'/);
  assert.match(html, /window\.__ECHObound\s*=/);
  assert.match(html, /ÉDITION CODEX PROFESSIONNELLE · VERSION 2\.0/);
  assert.match(html, /Unisson/);
  assert.match(html, /NOUVEAU CYCLE \+/);
  assert.match(html, /BACKUP_SAVE_KEY/);
  assert.match(html, /renderCodexMenu/);
});
