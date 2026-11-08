#!/usr/bin/env node
// Makes the admin passcode, on YOUR computer. It prints a random passcode (keep it in your password manager) and its one-way
// hash. Only the hash is stored: as the sensitive HCP Terraform variable admin_passcode_hash. Nothing is sent anywhere.
//
//   node scripts/admin-passcode.js                 a new random passcode and its hash
//   node scripts/admin-passcode.js --hash-stdin    the hash of a passphrase you type (one line on standard input)
//   node scripts/admin-passcode.js --json          the same as the first, as JSON (for the tests)
//
// Case, spaces and dashes do not matter when the passcode is typed, so a chosen passphrase is lower-cased and loses its
// spaces and dashes before it is hashed (and needs at least 16 characters left).
const { hashPasscode, generatePasscode, normalise } = require('../api/lib/passcode');

const MIN_CHOSEN_LENGTH = 16;

async function readLine() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text.split(/\r?\n/)[0];
}

async function main(args) {
  if (args.includes('--hash-stdin')) {
    const passphrase = await readLine();
    if (normalise(passphrase).length < MIN_CHOSEN_LENGTH) {
      console.error(`A chosen passphrase needs at least ${MIN_CHOSEN_LENGTH} characters (ignoring spaces and dashes). Better still, let this script generate one: run it with no options.`);
      process.exit(1);
    }
    console.log(await hashPasscode(passphrase));
    return;
  }

  const passcode = generatePasscode();
  const hash = await hashPasscode(passcode);
  if (args.includes('--json')) {
    console.log(JSON.stringify({ passcode, hash }));
    return;
  }
  console.log(`
Your admin passcode (shown only now: save it in your password manager):

    ${passcode}

Its hash (the only thing that is stored: this goes into the sensitive variable admin_passcode_hash):

    ${hash}
`);
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
