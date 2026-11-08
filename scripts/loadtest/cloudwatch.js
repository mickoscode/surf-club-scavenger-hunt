'use strict';
// The server's own view of a load test run, from CloudWatch (what API Gateway, Lambda and DynamoDB saw), plus the configured limits.
// Read-only. It uses the AWS command line (already on the GitHub runner) with the deploy role's credentials. Every part can fail on
// its own (no credentials, no permission, metrics not there yet): that only leaves a gap in the report, never a failed run.
const { execFile } = require('node:child_process');

const REGION = 'ap-southeast-2';
const API_NAME = 'scavenger-hunt';
const PERIOD = 60;

function defaultRunAws(args) {
  return new Promise((resolve, reject) => {
    execFile('aws', [...args, '--output', 'json'], { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error((stderr || error.message).trim().split('\n').pop()));
      try { resolve(stdout.trim() ? JSON.parse(stdout) : {}); } catch (e) { reject(e); }
    });
  });
}

// One metric as a GetMetricData query.
const query = (id, namespace, metricName, dimensions, stat) => ({
  Id: id, ReturnData: true,
  MetricStat: { Metric: { Namespace: namespace, MetricName: metricName, Dimensions: dimensions.map(([Name, Value]) => ({ Name, Value })) }, Period: PERIOD, Stat: stat },
});

function queriesFor({ apiId, functionNames, tableName }) {
  const api = [['ApiId', apiId]];
  const list = [
    query('api_count', 'AWS/ApiGateway', 'Count', api, 'Sum'),
    query('api_4xx', 'AWS/ApiGateway', '4xx', api, 'Sum'),
    query('api_5xx', 'AWS/ApiGateway', '5xx', api, 'Sum'),
    query('api_latency', 'AWS/ApiGateway', 'Latency', api, 'p95'),
    query('api_integration', 'AWS/ApiGateway', 'IntegrationLatency', api, 'p95'),
    query('db_read_throttles', 'AWS/DynamoDB', 'ReadThrottleEvents', [['TableName', tableName]], 'Sum'),
    query('db_write_throttles', 'AWS/DynamoDB', 'WriteThrottleEvents', [['TableName', tableName]], 'Sum'),
    query('db_read_units', 'AWS/DynamoDB', 'ConsumedReadCapacityUnits', [['TableName', tableName]], 'Sum'),
    query('db_write_units', 'AWS/DynamoDB', 'ConsumedWriteCapacityUnits', [['TableName', tableName]], 'Sum'),
  ];
  for (const [role, name] of Object.entries(functionNames)) {
    const fn = [['FunctionName', name]];
    list.push(
      query(`fn_${role}_invocations`, 'AWS/Lambda', 'Invocations', fn, 'Sum'),
      query(`fn_${role}_errors`, 'AWS/Lambda', 'Errors', fn, 'Sum'),
      query(`fn_${role}_throttles`, 'AWS/Lambda', 'Throttles', fn, 'Sum'),
      query(`fn_${role}_concurrency`, 'AWS/Lambda', 'ConcurrentExecutions', fn, 'Maximum'),
      query(`fn_${role}_duration`, 'AWS/Lambda', 'Duration', fn, 'p95'),
    );
  }
  return list;
}

const sum = (values) => values.reduce((a, b) => a + b, 0);
const peak = (values) => (values.length ? Math.max(...values) : 0);
const round = (n) => Math.round(n * 10) / 10;

// Turns GetMetricData results into plain numbers (totals and peaks) and per-minute series for charts.
function summarise(results) {
  const by = Object.fromEntries((results ?? []).map((r) => [r.Id, r.Values ?? []]));
  const get = (id) => by[id] ?? [];
  const lambda = {};
  for (const id of Object.keys(by)) {
    const match = /^fn_(\w+)_invocations$/.exec(id);
    if (!match) continue;
    const role = match[1];
    lambda[role] = {
      invocations: sum(get(id)), errors: sum(get(`fn_${role}_errors`)), throttles: sum(get(`fn_${role}_throttles`)),
      peakConcurrency: peak(get(`fn_${role}_concurrency`)), durationP95Ms: round(peak(get(`fn_${role}_duration`))),
    };
  }
  return {
    apiGateway: {
      requests: sum(get('api_count')), clientErrors: sum(get('api_4xx')), serverErrors: sum(get('api_5xx')),
      latencyP95Ms: round(peak(get('api_latency'))), integrationLatencyP95Ms: round(peak(get('api_integration'))),
    },
    lambda,
    dynamodb: {
      readThrottles: sum(get('db_read_throttles')), writeThrottles: sum(get('db_write_throttles')),
      readUnits: round(sum(get('db_read_units'))), writeUnits: round(sum(get('db_write_units'))),
    },
    series: { apiRequestsPerMinute: [...get('api_count')] }, // oldest first (the query asks for that)
  };
}

// -> { available, errors, stage, lambdaAccount, apiGateway, lambda, dynamodb, series }.
async function fetchServerMetrics({ runAws = defaultRunAws, startMs, endMs, region = REGION, functionNames = { public: 'scavenger-hunt-public', admin: 'scavenger-hunt-admin' }, tableName = 'scavenger-hunt' }) {
  const errors = [];
  const attempt = async (what, fn) => {
    try { return await fn(); } catch (e) { errors.push(`${what}: ${e.message}`); return null; }
  };

  const apiId = await attempt('finding the API', async () => {
    const found = (await runAws(['apigatewayv2', 'get-apis', '--region', region])).Items?.find((a) => a.Name === API_NAME);
    if (!found) throw new Error(`no API named ${API_NAME}`);
    return found.ApiId;
  });

  const stage = apiId && await attempt('reading the API limits', async () => {
    const s = await runAws(['apigatewayv2', 'get-stage', '--region', region, '--api-id', apiId, '--stage-name', '$default']);
    return { rateLimit: s.DefaultRouteSettings?.ThrottlingRateLimit ?? null, burstLimit: s.DefaultRouteSettings?.ThrottlingBurstLimit ?? null };
  });

  const lambdaAccount = await attempt('reading the Lambda account limits', async () => {
    const s = await runAws(['lambda', 'get-account-settings', '--region', region]);
    return { concurrentExecutions: s.AccountLimit?.ConcurrentExecutions ?? null, unreserved: s.AccountLimit?.UnreservedConcurrentExecutions ?? null };
  });

  const metrics = apiId && await attempt('reading the CloudWatch metrics', async () => {
    const result = await runAws([
      'cloudwatch', 'get-metric-data', '--region', region,
      '--start-time', new Date(startMs - PERIOD * 1000).toISOString(), '--end-time', new Date(endMs + 2 * PERIOD * 1000).toISOString(),
      '--scan-by', 'TimestampAscending', '--metric-data-queries', JSON.stringify(queriesFor({ apiId, functionNames, tableName })),
    ]);
    return summarise(result.MetricDataResults);
  });

  return {
    available: Boolean(metrics || stage || lambdaAccount),
    errors, stage: stage ?? null, lambdaAccount: lambdaAccount ?? null,
    apiGateway: metrics?.apiGateway ?? null, lambda: metrics?.lambda ?? null, dynamodb: metrics?.dynamodb ?? null, series: metrics?.series ?? null,
  };
}

module.exports = { fetchServerMetrics, queriesFor, summarise, defaultRunAws, REGION };
