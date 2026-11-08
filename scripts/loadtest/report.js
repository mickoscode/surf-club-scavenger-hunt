'use strict';
// Turns a finished load test (a "report" object, see cli.js) into the two things the admin reads: a self-contained HTML page with
// charts (nothing is loaded from the internet) and a short Markdown summary for the job log. Pure functions; every value is escaped.

const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => (n === null || n === undefined ? 'n/a' : Number(n).toLocaleString('en-AU'));
const ms = (n) => (n === null || n === undefined ? 'n/a' : `${num(n)} ms`);
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`);
const usd = (n) => `$${n.toFixed(n < 0.1 ? 3 : 2)}`;
const rps = (n) => (n === null || n === undefined ? 'n/a' : `${(Math.round(n * 10) / 10).toLocaleString('en-AU')}/s`);
const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const LEVEL_TEXT = { good: 'Handled it', limits: 'A limit was reached', problem: 'Problems found', inconclusive: 'Inconclusive' };

// ---------------------------------------------------------------------------------------------- charts (inline SVG)

const W = 760;
const H = 190;
const PAD = { l: 48, r: 12, t: 10, b: 24 };

function frame(max, slices, unit) {
  const ticks = [0, 0.5, 1].map((f) => max * f);
  const y = (v) => PAD.t + (H - PAD.t - PAD.b) * (1 - (max ? v / max : 0));
  const grid = ticks.map((v) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${PAD.l - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${esc(Math.round(v * 10) / 10)}${unit}</text>`).join('');
  const every = Math.max(1, Math.ceil(slices.length / 8));
  const labels = slices.map((s, i) => (i % every === 0 ? `<text x="${PAD.l + ((W - PAD.l - PAD.r) * (i + 0.5)) / slices.length}" y="${H - 6}" text-anchor="middle" class="axis">${clock(s.t / 1000)}</text>` : '')).join('');
  return { grid, labels, y, x: (i) => PAD.l + ((W - PAD.l - PAD.r) * (i + 0.5)) / slices.length };
}

function stackedBars(slices, series, label) {
  const max = Math.max(1, ...slices.map((s) => series.reduce((n, { key }) => n + (s[key] ?? 0), 0))) / 5; // requests per second
  const f = frame(max, slices, '');
  const bar = Math.max(1, ((W - PAD.l - PAD.r) / slices.length) * 0.8);
  const bars = slices.map((s, i) => {
    let base = 0;
    return series.map(({ key, cls }) => {
      const value = (s[key] ?? 0) / 5;
      if (!value) return '';
      const rect = `<rect x="${f.x(i) - bar / 2}" y="${f.y(base + value)}" width="${bar}" height="${f.y(base) - f.y(base + value)}" class="${cls}"/>`;
      base += value;
      return rect;
    }).join('');
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${f.grid}${bars}${f.labels}</svg>`;
}

function lineChart(slices, series, label, unit = '', extra = null) {
  const values = slices.flatMap((s) => series.map(({ key }) => s[key]).filter((v) => v !== null && v !== undefined));
  const max = Math.max(1, ...values, extra?.value ?? 0) * 1.1;
  const f = frame(max, slices, unit);
  const paths = series.map(({ key, cls }) => {
    const points = slices.map((s, i) => (s[key] === null || s[key] === undefined ? null : `${f.x(i)},${f.y(s[key])}`)).filter(Boolean);
    return points.length ? `<polyline points="${points.join(' ')}" class="line ${cls}"/>` : '';
  }).join('');
  const limit = extra ? `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${f.y(extra.value)}" y2="${f.y(extra.value)}" class="limit"/><text x="${W - PAD.r}" y="${f.y(extra.value) - 4}" text-anchor="end" class="axis">${esc(extra.label)}</text>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${f.grid}${paths}${limit}${f.labels}</svg>`;
}

const legend = (items) => `<p class="legend">${items.map(({ cls, label }) => `<span><i class="swatch ${cls}"></i>${esc(label)}</span>`).join('')}</p>`;
const table = (head, rows) => `<div class="scroll"><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

// ---------------------------------------------------------------------------------------------- shared tables of facts

function keyNumbers(report) {
  const { totals, cache, generator } = report;
  return [
    ['Requests sent', num(totals.requests)],
    ['Succeeded', `${num(totals.ok)} (${pct(totals.requests ? totals.ok / totals.requests : 0)})`],
    ['Throttled (429)', num(totals.throttled)],
    ['Server errors (5xx)', num(totals.serverError)],
    ['Never completed', num(totals.network)],
    ['Other statuses', num(totals.other)],
    ['Busiest moment', `${rps(totals.peakRps)} in total, ${rps(totals.peakOriginRps)} reaching the API`],
    ['Response time', `typical ${ms(totals.latency.p50)}, 95% under ${ms(totals.latency.p95)}, 99% under ${ms(totals.latency.p99)}, slowest ${ms(totals.latency.max)}`],
    ['Answered by CloudFront\'s cache', cache.hitRate === null ? 'n/a' : `${pct(cache.hitRate)} of cacheable requests (${num(cache.hit)} hits, ${num(cache.miss)} reached the API)`],
    ['Test machine', `${generator.saturated ? 'OVERLOADED' : 'fine'}: event loop up to ${ms(Math.round(generator.maxLagP99Ms))} late, CPU up to ${pct(generator.maxCpu)} of a core`],
  ];
}

function serverRows(server) {
  if (!server?.available) return null;
  const rows = [];
  if (server.stage) rows.push(['API request limit (configured)', `${num(server.stage.rateLimit)} a second sustained, burst ${num(server.stage.burstLimit)}`]);
  if (server.lambdaAccount) rows.push(['Lambda concurrency limit (account)', `${num(server.lambdaAccount.concurrentExecutions)} (${num(server.lambdaAccount.unreserved)} unreserved)`]);
  if (server.apiGateway) rows.push(['API Gateway saw', `${num(server.apiGateway.requests)} requests, ${num(server.apiGateway.clientErrors)} client errors (4xx, includes throttling), ${num(server.apiGateway.serverErrors)} server errors; 95th percentile ${ms(server.apiGateway.latencyP95Ms)}, of which the Lambda part ${ms(server.apiGateway.integrationLatencyP95Ms)}`]);
  for (const [role, f] of Object.entries(server.lambda ?? {})) rows.push([`Lambda: ${role}`, `${num(f.invocations)} calls, ${num(f.errors)} errors, ${num(f.throttles)} throttled, up to ${num(f.peakConcurrency)} at once, 95th percentile ${ms(f.durationP95Ms)}`]);
  if (server.dynamodb) rows.push(['DynamoDB', `${num(server.dynamodb.readThrottles)} read and ${num(server.dynamodb.writeThrottles)} write throttles; ${num(server.dynamodb.readUnits)} read and ${num(server.dynamodb.writeUnits)} write units used`]);
  return rows;
}

const cleanupText = (cleanup) => {
  if (!cleanup) return 'not run';
  if (cleanup.skipped) return cleanup.skipped;
  return `${num(cleanup.removed)} test teams removed${cleanup.failed ? `, ${num(cleanup.failed)} could not be removed` : ''}${cleanup.remaining ? `, ${num(cleanup.remaining)} still on the site` : ''}`;
};

// ---------------------------------------------------------------------------------------------- the HTML page

function renderHtml(report) {
  const { meta, verdict, endpoints, timeline, totals, cost, cleanup, server } = report;
  const limit = server?.stage?.rateLimit ? { value: server.stage.rateLimit, label: `limit ${server.stage.rateLimit}/s` } : null;
  const serverTable = serverRows(server);
  const statuses = Object.entries(totals.byStatus).sort(([a], [b]) => Number(a) - Number(b)).map(([s, n]) => [s === '0' ? '0 (never completed)' : s, num(n)]);

  return `<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Load test report - ${esc(meta.finishedAt)}</title>
<style>
:root { --bg:#fff; --fg:#1b1f23; --muted:#5b636b; --line:#d8dde2; --card:#f6f8fa; --ok:#2e8b57; --throttle:#d98a00; --fail:#c0392b; --other:#7d5ba6; --p50:#1f77b4; --p95:#d62728; --good:#e6f4ea; --limits:#fff3d6; --problem:#fde7e5; --inconclusive:#e8eaf0; }
@media (prefers-color-scheme: dark) { :root { --bg:#14181c; --fg:#e6e8ea; --muted:#9aa3ab; --line:#2d343b; --card:#1c2228; --ok:#4cb782; --throttle:#f0a830; --fail:#ef6b5b; --other:#a98bd0; --p50:#5ca9e0; --p95:#ff7b7b; --good:#17301f; --limits:#3a2f12; --problem:#3b1b18; --inconclusive:#232830; } }
body { margin:0; padding:1rem; background:var(--bg); color:var(--fg); font:15px/1.5 system-ui,sans-serif; } main { max-width:860px; margin:0 auto; }
h1 { font-size:1.5rem; margin:0 0 .25rem; } h2 { font-size:1.1rem; margin:1.6rem 0 .4rem; } .muted { color:var(--muted); }
.verdict { padding:.8rem 1rem; border-radius:8px; margin:1rem 0; background:var(--card); border-left:6px solid var(--line); } .verdict.good { background:var(--good); border-color:var(--ok); } .verdict.limits { background:var(--limits); border-color:var(--throttle); } .verdict.problem { background:var(--problem); border-color:var(--fail); } .verdict.inconclusive { background:var(--inconclusive); }
.verdict strong { display:block; font-size:1.05rem; } .verdict ul { margin:.4rem 0 0 1.1rem; padding:0; }
.scroll { overflow-x:auto; } table { border-collapse:collapse; width:100%; font-size:.9rem; } th, td { text-align:left; padding:.3rem .5rem; border-bottom:1px solid var(--line); vertical-align:top; } th.n, td.n { text-align:right; } td:first-child { white-space:nowrap; }
svg { width:100%; height:auto; background:var(--card); border-radius:6px; } .grid { stroke:var(--line); stroke-width:1; } .axis { fill:var(--muted); font-size:10px; } .limit { stroke:var(--fail); stroke-dasharray:5 4; stroke-width:1.5; }
.ok { fill:var(--ok); } .throttled { fill:var(--throttle); } .failed { fill:var(--fail); } .other { fill:var(--other); } .line { fill:none; stroke-width:2; } .line.p50 { stroke:var(--p50); } .line.p95 { stroke:var(--p95); } .line.origin { stroke:var(--ok); } .line.total { stroke:var(--p50); stroke-dasharray:4 3; }
.legend { display:flex; flex-wrap:wrap; gap:.8rem; font-size:.8rem; color:var(--muted); margin:.2rem 0 .8rem; } .swatch { display:inline-block; width:.8rem; height:.8rem; border-radius:2px; margin-right:.3rem; vertical-align:-1px; } .swatch.ok { background:var(--ok); } .swatch.throttled { background:var(--throttle); } .swatch.failed { background:var(--fail); } .swatch.other { background:var(--other); } .swatch.p50 { background:var(--p50); } .swatch.p95 { background:var(--p95); } .swatch.origin { background:var(--ok); } .swatch.total { background:var(--p50); }
.foot { font-size:.8rem; color:var(--muted); margin-top:2rem; }
</style></head><body><main>
<h1>Load test report</h1>
<p class="muted">${esc(meta.site)} &middot; ${esc(meta.startedAt)} to ${esc(meta.finishedAt)}${meta.runUrl ? ` &middot; <a href="${esc(meta.runUrl)}">workflow run</a>` : ''}${meta.commit ? ` &middot; commit ${esc(String(meta.commit).slice(0, 7))}` : ''}</p>
<div class="verdict ${esc(verdict.level)}"><strong>${esc(LEVEL_TEXT[verdict.level])}: ${esc(verdict.headline)}</strong><ul>${verdict.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></div>

<h2>What was run</h2>
${table(['Setting', 'Value'], [['Mode', meta.params.mode], ['Teams', num(meta.params.teams)], ['Spectators', num(meta.params.spectators)], ['Duration', `${meta.params.durationSeconds} s (users arrive over the first ${meta.params.rampSeconds} s)`], ['Answers per team per minute', num(meta.params.answersPerMinute)]])}

<h2>Key numbers</h2>
${table(['', ''], keyNumbers(report))}

<h2>Requests per second</h2>
${stackedBars(timeline, [{ key: 'ok', cls: 'ok' }, { key: 'throttled', cls: 'throttled' }, { key: 'serverError', cls: 'failed' }, { key: 'network', cls: 'failed' }, { key: 'other', cls: 'other' }], 'Requests per second, by outcome')}
${legend([{ cls: 'ok', label: 'succeeded' }, { cls: 'throttled', label: 'throttled (429)' }, { cls: 'failed', label: 'server error or never completed' }, { cls: 'other', label: 'other status' }])}

<h2>Requests reaching the API, and users</h2>
<p class="muted">Only these count against the API's request limit${limit ? ' (the dashed line)' : ''}; the rest are served from CloudFront's cache.</p>
${lineChart(timeline, [{ key: 'originRps', cls: 'origin' }, { key: 'rps', cls: 'total' }], 'Requests per second: all, and those reaching the API', '', limit)}
${legend([{ cls: 'origin', label: 'reaching the API' }, { cls: 'total', label: 'all requests' }])}

<h2>Response time</h2>
${lineChart(timeline, [{ key: 'p50', cls: 'p50' }, { key: 'p95', cls: 'p95' }], 'Response time, typical and 95th percentile', ' ms')}
${legend([{ cls: 'p50', label: 'typical (50th percentile)' }, { cls: 'p95', label: '95th percentile' }])}
<p class="muted">These times include the network between the GitHub machine and the site, so they are higher than a player in Perth would see.</p>

<h2>By kind of request</h2>
${table(['Request', 'Count', 'Succeeded', 'Failed', 'Typical', '95th %ile', '99th %ile', 'Slowest'], endpoints.map((e) => [e.label, num(e.requests), num(e.ok), num(e.failures), ms(e.latency.p50), ms(e.latency.p95), ms(e.latency.p99), ms(e.latency.max)]))}

<h2>Status codes</h2>
${table(['Status', 'Count'], statuses)}

<h2>What the servers saw</h2>
${serverTable ? table(['', ''], serverTable) : `<p class="muted">Not available${server?.errors?.length ? `: ${esc(server.errors.join('; '))}` : ' (the test did not read CloudWatch).'}</p>`}
${serverTable && server.errors?.length ? `<p class="muted">Some parts could not be read: ${esc(server.errors.join('; '))}</p>` : ''}
<p class="muted">CloudWatch reports once a minute and a little late, so these figures are rounded to the minute.</p>

<h2>Estimated cost of this run</h2>
${table(['What', 'Count', 'Estimate'], [...cost.lines.map((l) => [l.name, num(l.count), usd(l.usd)]), ['Total', '', usd(cost.totalUsd)]])}
<p class="muted">${esc(cost.note)}</p>

<h2>Clean up</h2>
<p>${esc(cleanupText(cleanup))}</p>

<p class="foot">Made by scripts/load-test.js. The test never changes the game configuration; its teams are named loadtest-001 and so on.</p>
</main></body></html>
`;
}

// ---------------------------------------------------------------------------------------------- the Markdown summary

function renderMarkdown(report) {
  const { meta, verdict, endpoints, totals, cost, cleanup, server, firstEvents } = report;
  const md = (rows) => rows.map(([a, b]) => `| ${a} | ${b} |`).join('\n');
  const lines = [
    `## Load test: ${LEVEL_TEXT[verdict.level]}`,
    '',
    `**${verdict.headline}**`,
    '',
    ...verdict.details.map((d) => `- ${d}`),
    '',
    `Run: ${meta.params.mode}, ${meta.params.teams} teams, ${meta.params.spectators} spectators, ${meta.params.durationSeconds} s (ramp ${meta.params.rampSeconds} s), ${meta.params.answersPerMinute} answers per team per minute. The full report with charts is the downloadable artifact of this run.`,
    '',
    '| Key number | |', '|---|---|', md(keyNumbers(report)),
    '',
    '| Request | Count | Failed | Typical | 95th %ile | Slowest |', '|---|--:|--:|--:|--:|--:|',
    ...endpoints.map((e) => `| ${e.label} | ${num(e.requests)} | ${num(e.failures)} | ${ms(e.latency.p50)} | ${ms(e.latency.p95)} | ${ms(e.latency.max)} |`),
    '',
  ];
  const moments = [['throttled', 'First throttled'], ['serverError', 'First error'], ['slow', 'First slow stretch']].filter(([k]) => firstEvents[k]);
  if (moments.length) lines.push('| Moment | When | Rate at the API | Users |', '|---|--:|--:|--:|', ...moments.map(([k, label]) => `| ${label} | ${clock(firstEvents[k].atSeconds)} | ${rps(firstEvents[k].originRps)} | ${firstEvents[k].activeUsers} |`), '');
  const rows = serverRows(server);
  lines.push('**What the servers saw**', '', rows ? `| | |\n|---|---|\n${md(rows)}` : `Not available${server?.errors?.length ? `: ${server.errors.join('; ')}` : ''}.`, '');
  lines.push(`**Estimated cost of this run:** ${usd(cost.totalUsd)} (${cost.note})`, '', `**Clean up:** ${cleanupText(cleanup)}`, '');
  return lines.join('\n');
}

module.exports = { renderHtml, renderMarkdown, esc };
