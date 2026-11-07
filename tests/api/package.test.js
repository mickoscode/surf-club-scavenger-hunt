// The Lambda zip is built from build/backend/, which holds only api/ code plus the game file. This runs the packaged code
// from a folder where nothing else of the repository is reachable, so a hidden dependency (a require of a file outside
// api/, or a missing file) fails here instead of as a 502 on the live site. The AWS SDK is what the Lambda runtime
// provides, so it is borrowed from the repo's dev dependencies via NODE_PATH.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');

test('the packaged backend is self-contained: both handlers load and the game file is found and valid', () => {
  const built = spawnSync('bash', ['scripts/package-backend.sh'], { cwd: root, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);

  // Copy it somewhere else, so nothing from the repository can be reached by a relative path.
  const lambdaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'backend-'));
  fs.cpSync(path.join(root, 'build', 'backend'), lambdaRoot, { recursive: true });

  const script = `
    const { handler: publicHandler } = require('./handlers/public.js');
    const { handler: adminHandler } = require('./handlers/admin.js');
    const { loadGameData } = require('./app/game-file.js');
    const { validateGameData } = require('./lib/gamedata.js');
    const problems = validateGameData(loadGameData(), { checkMaps: false });
    if (typeof publicHandler !== 'function' || typeof adminHandler !== 'function') throw new Error('handlers missing');
    if (problems.length) throw new Error(problems.join('; '));
  `;
  const run = spawnSync(process.execPath, ['-e', script], {
    cwd: lambdaRoot, encoding: 'utf8', env: { ...process.env, NODE_PATH: path.join(root, 'node_modules') },
  });
  assert.equal(run.status, 0, run.stderr);
});

test('the package holds the runtime code and the game file, and nothing else', () => {
  const entries = fs.readdirSync(path.join(root, 'build', 'backend')).sort();
  assert.deepEqual(entries, ['app', 'game-questions.json', 'handlers', 'lib', 'store']);
  const files = fs.readdirSync(path.join(root, 'build', 'backend'), { recursive: true });
  assert.equal(files.filter((f) => /\.test\.js$|node_modules|package\.json/.test(f)).length, 0);
});
