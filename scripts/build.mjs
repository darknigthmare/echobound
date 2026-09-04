import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePwa } from './validate-pwa.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(root, 'dist');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const sourceValidation = await validatePwa(root);

await rm(outputDirectory, { recursive: true, force: true });

for (const relativePath of sourceValidation.runtimeFilePaths) {
  const sourcePath = resolve(root, relativePath);
  const outputPath = resolve(outputDirectory, relativePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await copyFile(sourcePath, outputPath);

  const [sourceBytes, outputBytes] = await Promise.all([
    readFile(sourcePath),
    readFile(outputPath),
  ]);
  assert.equal(sha256(outputBytes), sha256(sourceBytes), `Copie de build invalide: ${relativePath}`);
}

const outputValidation = await validatePwa(outputDirectory, {
  verifyStandalone: false,
  expectedStandaloneHash: sourceValidation.standaloneHash,
});
assert.equal(outputValidation.version, sourceValidation.version);
assert.equal(outputValidation.standaloneHash, sourceValidation.standaloneHash);

console.log(`Build PWA ECHObound ${outputValidation.version}: ${outputValidation.runtimeFiles} fichiers dans dist/.`);
