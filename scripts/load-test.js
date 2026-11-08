#!/usr/bin/env node
'use strict';
// Run a load test against the live site: node scripts/load-test.js --site https://... [--mode full|spectators-only] [--teams N]
// [--spectators N] [--duration SECONDS] [--ramp SECONDS] [--answers-per-minute N] [--cloudwatch] [--out DIR]. See docs/runbook.md.
require('./loadtest/cli.js').main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(2); });
