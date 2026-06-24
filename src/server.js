import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateDashboard } from './scorecard.js';
import { getDaxMarketData, getDaxIntradayData, getDaxSeasonality, getIntermarketIndicators, getSentimentIndicators, getTechnicalIndicators, getFundamentalIndicators } from './marketData.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = normalize(join(__dirname, '..'));
const publicDir = join(projectRoot, 'public');
const port = Number(process.env.PORT ?? 4173);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function serveStatic(requestUrl, response) {
  const urlPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname;
  const safePath = normalize(join(publicDir, decodeURIComponent(urlPath)));
  if (!safePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(safePath);
    response.writeHead(200, {
      'content-type': contentTypes[extname(safePath)] ?? 'application/octet-stream'
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

const OVERRIDE_KEYS = [];

function parseOverrides(searchParams) {
  const overrides = {};
  for (const key of OVERRIDE_KEYS) {
    const value = searchParams.get('override_' + key);
    if (value && ['positive', 'negative', 'neutral'].includes(value)) {
      overrides[key] = value;
    }
  }
  return overrides;
}

async function handleDashboard(requestUrl, response) {
  const date = requestUrl.searchParams.get('date') || todayIso();
  const overrides = parseOverrides(requestUrl.searchParams);
  const [market, intraday, seasonality, intermarket, technical, fundamental] = await Promise.all([
    getDaxMarketData({ date }),
    getDaxIntradayData({ date }),
    getDaxSeasonality(),
    getIntermarketIndicators(),
    getTechnicalIndicators(),
    getFundamentalIndicators()
  ]);
  const sentiment = await getSentimentIndicators({ market });
  const dashboard = evaluateDashboard({ date, market, overrides, intraday, seasonality, intermarket, sentiment, technical, fundamental });
  sendJson(response, 200, dashboard);
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (requestUrl.pathname === '/api/health') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (requestUrl.pathname === '/api/dashboard') {
      await handleDashboard(requestUrl, response);
      return;
    }
    await serveStatic(requestUrl, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message });
  }
}

const server = http.createServer(handleRequest);
server.listen(port, () => {
  console.log(`DAX Live Scorecard Dashboard: http://localhost:${port}`);
});
