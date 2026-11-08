'use strict';
// A rough cost of a load test run, from the number of requests, so it can be seen against the monthly budget. The prices are
// approximate public prices for ap-southeast-2 (Sydney) and CloudFront, in US dollars, and are an ESTIMATE: they ignore the free
// tiers (which usually make the real cost lower) and the exact duration of each call. Pure function.
const PRICES_PER_MILLION = {
  apiGateway: 1.25, // HTTP API requests
  lambda: 0.3, // requests plus about 30 ms of compute at 256 MB on arm64
  dynamoRead: 0.29, // on-demand read request units
  dynamoWrite: 1.43, // on-demand write request units
  cloudFront: 1.2, // HTTPS requests (the first 10 million a month are free)
};

// requests that reached the API (not CloudFront's cache), and how many of those wrote data.
function estimateCost({ totalRequests, originRequests, writes }) {
  const perMillion = (count, price) => (count / 1e6) * price;
  const lines = [
    { name: 'CloudFront requests', count: totalRequests, usd: perMillion(totalRequests, PRICES_PER_MILLION.cloudFront) },
    { name: 'API Gateway requests', count: originRequests, usd: perMillion(originRequests, PRICES_PER_MILLION.apiGateway) },
    { name: 'Lambda (requests and compute)', count: originRequests, usd: perMillion(originRequests, PRICES_PER_MILLION.lambda) },
    { name: 'DynamoDB reads', count: originRequests, usd: perMillion(originRequests, PRICES_PER_MILLION.dynamoRead) },
    { name: 'DynamoDB writes', count: writes, usd: perMillion(writes, PRICES_PER_MILLION.dynamoWrite) },
  ];
  const totalUsd = lines.reduce((sum, line) => sum + line.usd, 0);
  return {
    lines, totalUsd,
    note: 'An estimate before free tiers (usually lower in reality), from approximate public prices. The account\'s monthly budget alert is the real safety net.',
  };
}

module.exports = { estimateCost, PRICES_PER_MILLION };
