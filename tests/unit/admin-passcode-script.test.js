// scripts/admin-passcode.js is what the admin runs on their own computer. Its hash must work with the backend, and must be
// accepted by the Terraform variable that stores it: a mismatch would only show up when the admin tries to switch the passcode on.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { verifyPasscode, HASH_FORMAT } = require('../../api/lib/passcode.js');

const root = path.join(__dirname, '..', '..');
const script = path.join(root, 'scripts', 'admin-passcode.js');
const run = (args, input) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', input });

test('the script makes a passcode and a hash that the backend accepts, and nothing else leaks', async () => {
  const out = run(['--json']);
  assert.equal(out.status, 0, out.stderr);
  const { passcode, hash } = JSON.parse(out.stdout);
  assert.match(passcode, /^[a-hjkmnp-z2-9]{5}(-[a-hjkmnp-z2-9]{5}){3}$/);
  assert.equal(await verifyPasscode(passcode, hash), true);
  assert.equal(await verifyPasscode('another-passcode', hash), false);
  assert.ok(!hash.includes(passcode.replace(/-/g, '')));
});

test('the hash it makes is accepted by the pattern in the Terraform variable', () => {
  const { hash } = JSON.parse(run(['--json']).stdout);
  const tf = fs.readFileSync(path.join(root, 'terraform', 'variables.tf'), 'utf8');
  const literal = /can\(regex\("(.+?)", var\.admin_passcode_hash\)\)/.exec(tf)?.[1];
  assert.ok(literal, 'the validation pattern was not found in terraform/variables.tf');
  const pattern = new RegExp(literal.replace(/\\\\/g, '\\')); // the HCL string escapes each backslash
  assert.match(hash, pattern);
  assert.match(hash, HASH_FORMAT);
  assert.doesNotMatch('plain-text-passcode', pattern); // and a plain passcode pasted by mistake is refused by Terraform
  assert.doesNotMatch('scrypt$1$2$3', pattern);
});

test('a chosen passphrase can be hashed from standard input, and a short one is refused', async () => {
  const good = run(['--hash-stdin'], 'a long chosen passphrase for the admin\n');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(await verifyPasscode('A Long Chosen-Passphrase for the admin', good.stdout.trim()), true); // case, spaces and dashes are ignored
  const short = run(['--hash-stdin'], 'too short\n');
  assert.notEqual(short.status, 0);
  assert.equal(short.stdout.trim(), ''); // no hash is printed for a weak passphrase
});

test('without options it prints the passcode and the hash for a person to copy', () => {
  const out = run([]);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /[a-hjkmnp-z2-9]{5}(-[a-hjkmnp-z2-9]{5}){3}/);
  assert.match(out.stdout, /scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+/);
});
