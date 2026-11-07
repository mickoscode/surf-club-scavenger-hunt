#!/usr/bin/env bash
# Assembles the deployable site into dist/ (exactly the layout of the S3 bucket): everything in web/
# plus the one Bootstrap CSS file from node_modules. Needs `npm ci` first.
set -euo pipefail
cd "$(dirname "$0")/.."

bootstrap_css=node_modules/bootstrap/dist/css/bootstrap.min.css
[ -f "$bootstrap_css" ] || { echo "::error::$bootstrap_css not found - run 'npm ci' first" >&2; exit 1; }

rm -rf dist
mkdir -p dist/vendor/bootstrap
cp -R web/. dist/
rm -f dist/js/package.json # only marks web/js as ES modules for the tests; the browser does not need it
cp node_modules/bootstrap/LICENSE dist/vendor/bootstrap/LICENSE
# Drop the source-map comment: the .map file is not deployed, so browsers would log a 404 for it.
sed '/sourceMappingURL/d' "$bootstrap_css" > dist/vendor/bootstrap/bootstrap.min.css

echo "Built dist/ ($(find dist -type f | wc -l) files)"
