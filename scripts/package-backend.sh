#!/usr/bin/env bash
# Assembles the backend into build/backend/: exactly what goes into the Lambda zip. Only the runtime code is copied
# (not tests, not dev dependencies: the AWS SDK comes with the Lambda runtime), plus a copy of the game file, which
# the backend loads when the admin saves the game config. deploy.yml zips this folder and updates both functions.
# tests/api/package.test.js checks that the folder is self-contained.
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf build/backend
mkdir -p build/backend
cp -R api/app api/handlers api/lib api/store build/backend/
cp docs/game-questions.json build/backend/game-questions.json

echo "Packaged build/backend ($(find build/backend -type f | wc -l) files)"
