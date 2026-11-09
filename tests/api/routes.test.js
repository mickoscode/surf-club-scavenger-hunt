// Only the routes listed in terraform/api-gateway.tf exist in production (anything else is answered by API Gateway without
// running any code), so a route added to the app but not to Terraform would work in every test and fail on the live site.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../../api/app/app.js');
const { createMemoryStore } = require('../../api/store/memory.js');

test('the routes of each function are exactly the ones API Gateway is given in terraform/api-gateway.tf', () => {
  const tf = fs.readFileSync(path.join(__dirname, '..', '..', 'terraform', 'api-gateway.tf'), 'utf8');
  const block = (name) => {
    const body = new RegExp(`\\b${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`).exec(tf)?.[1] ?? '';
    return [...body.matchAll(/"((?:GET|POST|PUT|DELETE) [^"]+)"/g)].map((m) => m[1].replace(/\{(\w+)\}/g, ':$1')).sort();
  };
  for (const role of ['public', 'admin']) {
    const app = createApp({ store: createMemoryStore(), role });
    assert.deepEqual([...app.routes].sort(), block(role), `the ${role} function's routes differ from terraform/api-gateway.tf`);
  }
});
