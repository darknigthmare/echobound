import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), '..');
export const EXPECTED_STANDALONE_HASH = 'be0be47716fac4953df01044b1ae01c5da60a7317e99a78b146f33e7d99dd4c0';

export const RUNTIME_FILES = Object.freeze([
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'assets/icon.svg',
  'src/styles.css',
  'src/platform.js',
  'src/game.js',
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const escapeRegex = (value) => value.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
const toPosix = (value) => value.split(sep).join('/');

const resolveInside = (baseDirectory, relativePath) => {
  assert.equal(isAbsolute(relativePath), false, 'Chemin absolu interdit: ' + relativePath);
  const resolvedPath = resolve(baseDirectory, relativePath);
  const pathFromBase = relative(baseDirectory, resolvedPath);
  assert.ok(pathFromBase && !pathFromBase.startsWith('..') && !isAbsolute(pathFromBase), 'Chemin hors projet: ' + relativePath);
  return resolvedPath;
};

const readRuntimeText = async (baseDirectory, relativePath) => {
  const resolvedPath = resolveInside(baseDirectory, relativePath);
  await access(resolvedPath);
  return readFile(resolvedPath, 'utf8');
};

const listFilesRecursively = async (baseDirectory, relativeDirectory) => {
  const directory = resolveInside(baseDirectory, relativeDirectory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const relativePath = toPosix(relative(baseDirectory, resolve(directory, entry.name)));
    assert.equal(entry.isSymbolicLink(), false, 'Lien symbolique runtime interdit: ' + relativePath);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursively(baseDirectory, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
};

export async function discoverRuntimeFiles(baseDirectory = projectRoot) {
  const root = resolve(baseDirectory);
  const discovered = [
    ...RUNTIME_FILES,
    ...await listFilesRecursively(root, 'assets'),
    ...await listFilesRecursively(root, 'src'),
  ];
  return Object.freeze([...new Set(discovered)].sort());
}

const relativeModuleSpecifiers = (source) => {
  const values = [];
  const expression = /(?:\bimport\s*(?:[^'"]*?\sfrom\s*)?|\bexport\s+[^'"]*?\sfrom\s*)['"](\.[^'"]+)['"]/g;
  for (const match of source.matchAll(expression)) values.push(match[1]);
  return values;
};

const validateModuleGraph = async (root, runtimeFiles) => {
  const runtimeSet = new Set(runtimeFiles);
  const scripts = runtimeFiles.filter((path) => path.endsWith('.js') && path !== 'sw.js');

  for (const script of scripts) {
    const source = await readRuntimeText(root, script);
    for (const specifier of relativeModuleSpecifiers(source)) {
      const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
      const resolvedDependency = resolve(dirname(resolveInside(root, script)), cleanSpecifier);
      const dependency = toPosix(relative(root, resolvedDependency));
      assert.equal(dependency.startsWith('..'), false, 'Import hors projet depuis ' + script + ': ' + specifier);
      assert.ok(runtimeSet.has(dependency), 'Module local absent du build: ' + dependency + ' (importé par ' + script + ')');
      await access(resolvedDependency);
    }
  }
};

export async function validatePwa(baseDirectory = projectRoot, options = {}) {
  const root = resolve(baseDirectory);
  const runtimeFiles = await discoverRuntimeFiles(root);
  const [index, manifestRaw, serviceWorker, icon, platform] = await Promise.all([
    readRuntimeText(root, 'index.html'),
    readRuntimeText(root, 'manifest.webmanifest'),
    readRuntimeText(root, 'sw.js'),
    readRuntimeText(root, 'assets/icon.svg'),
    readRuntimeText(root, 'src/platform.js'),
    ...runtimeFiles.map((path) => access(resolveInside(root, path))),
  ]);

  let standaloneHash = options.expectedStandaloneHash || EXPECTED_STANDALONE_HASH;
  if (options.verifyStandalone !== false) {
    const standaloneBytes = await readFile(resolveInside(root, 'ECHObound_standalone.html'));
    const standaloneText = standaloneBytes.toString('utf8');
    assert.equal(standaloneText.includes('\r'), false, 'Le standalone doit employer exclusivement des fins de ligne LF.');
    standaloneHash = sha256(standaloneBytes);
    assert.equal(
      standaloneHash,
      EXPECTED_STANDALONE_HASH,
      'Le standalone professionnel a changé; la PWA doit rester une couche séparée.',
    );
    assert.notEqual(index, standaloneText, 'L’index PWA doit rester modularisé et distinct du standalone canonique.');
  } else {
    assert.equal(standaloneHash, EXPECTED_STANDALONE_HASH, 'L’empreinte canonique transmise au build est invalide.');
  }

  assert.match(index, /<link rel="manifest" href="manifest\.webmanifest"\s*\/?>/);
  assert.match(index, /<link rel="icon" href="assets\/icon\.svg" type="image\/svg\+xml"\s*\/?>/);
  assert.match(index, /<script src="src\/platform\.js" defer><\/script>/);
  assert.match(index, /<script type="module" src="src\/game\.js"><\/script>/);

  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#070912');
  assert.equal(manifest.background_color, '#070912');
  assert.ok(manifest.display_override?.includes('standalone'));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'Le manifeste doit déclarer une icône.');

  for (const manifestIcon of manifest.icons) {
    assert.equal(manifestIcon.type, 'image/svg+xml');
    assert.equal(manifestIcon.sizes, 'any');
    assert.ok(manifestIcon.purpose.split(/\s+/).includes('maskable'));
    await access(resolveInside(root, manifestIcon.src));
  }

  assert.match(icon, /^<svg\b/);
  assert.match(icon, /viewBox="0 0 512 512"/);
  assert.match(icon, /<title\b/);
  assert.match(icon, /<desc\b/);

  const workerVersion = serviceWorker.match(/const CACHE_VERSION = '([^']+)'/)?.[1];
  const platformVersion = platform.match(/const PLATFORM_VERSION = '([^']+)'/)?.[1];
  assert.match(workerVersion || '', /^2\.0\.0-pwa\.\d+$/);
  assert.equal(platformVersion, workerVersion, 'La couche plateforme et le cache doivent partager la même version.');
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
  assert.match(serviceWorker, /requestUrl\.origin !== self\.location\.origin/);
  assert.match(platform, /serviceWorker\.register\('\.\/sw\.js'/);
  assert.match(platform, /updateViaCache: 'none'/);

  await validateModuleGraph(root, runtimeFiles);

  for (const runtimePath of runtimeFiles.filter((path) => path !== 'sw.js')) {
    const workerPath = runtimePath === 'index.html' ? './index.html' : './' + runtimePath;
    const quotedPath = new RegExp('(?:\\x27|")' + escapeRegex(workerPath) + '(?:\\x27|")');
    assert.ok(
      quotedPath.test(serviceWorker),
      runtimePath + ' n’est pas préchargé par le service worker.',
    );
  }

  return Object.freeze({
    root,
    version: workerVersion,
    runtimeFiles: runtimeFiles.length,
    runtimeFilePaths: runtimeFiles,
    standaloneHash,
  });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === scriptPath;
if (invokedDirectly) {
  const requestedRoot = process.argv[2] ? resolve(process.argv[2]) : projectRoot;
  const result = await validatePwa(requestedRoot);
  console.log('PWA ECHObound ' + result.version + ' validée: ' + result.runtimeFiles + ' fichiers, standalone LF intact.');
}
