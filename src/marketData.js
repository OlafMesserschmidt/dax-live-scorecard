import { formatIndex } from './scorecard.js';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DAX_2025_CLOSE = 24422.49;

const SNAPSHOT_FALLBACK = {
  close: 25166,
  previousYearClose: DAX_2025_CLOSE,
  sma200: 24208.79,
  sma34: 24989.25,
  firstFiveDaysPositive: true,
  asOf: '2026-06-19',
  source: 'screenshot',
  sourceLabel: 'Screenshot-Fallback',
  status: 'snapshot-fallback',
  warning: 'Fallback aktiv: freie Live-Quelle nicht verfuegbar, Screenshot-Wert wird als Bewertungsbeispiel genutzt.'
};

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = normalize(join(__dirname, '..'));
const DEFAULT_CSV_PATH = process.env.DAX_CSV_PATH
  || join(projectRoot, 'data', 'dax-history.csv');

function withFormattedValues(market) {
  return {
    ...market,
    closeFormatted: formatIndex(market.close),
    previousYearCloseFormatted: formatIndex(market.previousYearClose),
    sma200Formatted: formatIndex(market.sma200),
    sma34Formatted: formatIndex(market.sma34)
  };
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/* ─────────────────────────────────────────────────────────────
 *  CSV-Parser (Stooq-Format: Date,Open,High,Low,Close,Volume)
 *  Unterstützt auch reduzierte CSVs mit nur Date,Close.
 * ───────────────────────────────────────────────────────────── */

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map(h => h.trim());
  const dateIdx = header.findIndex(h => h.toLowerCase() === 'date');
  const closeIdx = header.findIndex(h => h.toLowerCase() === 'close');

  if (dateIdx === -1 || closeIdx === -1) {
    throw new Error('CSV header missing Date or Close column');
  }

  return lines.slice(1).map(line => {
    const cols = line.split(',');
    return {
      date: (cols[dateIdx] ?? '').trim(),
      close: parseFloat(cols[closeIdx])
    };
  }).filter(row =>
    /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    typeof row.close === 'number' && !Number.isNaN(row.close)
  );
}

/* ─────────────────────────────────────────────────────────────
 *  selectMarketPointForDate
 *
 *  Wählt aus einer Provider-Historie den Close zum gewünschten
 *  Datum.  Falls das Datum kein Handelstag ist (Wochenende,
 *  Feiertag), wird der letzte verfügbare Close davor geliefert.
 * ───────────────────────────────────────────────────────────── */

export function selectMarketPointForDate({ targetDate, rows }) {
  if (!rows || !rows.length) {
    throw new Error('selectMarketPointForDate: rows array is empty');
  }

  // 1. Exaktes Datum gefunden
  const exact = rows.find(row => row.date === targetDate);
  if (exact) {
    return { asOf: exact.date, close: exact.close };
  }

  // 2. Letzter Handelstag vor dem targetDate
  const before = rows.filter(row => row.date < targetDate).at(-1);
  if (before) {
    return { asOf: before.date, close: before.close };
  }

  // 3. Falls targetDate vor der Historie liegt → erster Eintrag
  const first = rows[0];
  return { asOf: first.date, close: first.close };
}

/* ─────────────────────────────────────────────────────────────
 *  previousYearClose aus Historie extrahieren
 * ───────────────────────────────────────────────────────────── */

function extractPreviousYearClose(rows) {
  if (!rows.length) return DAX_2025_CLOSE;

  const lastDate = rows.at(-1).date;
  const lastYear = parseInt(lastDate.slice(0, 4), 10);
  const prevYearStr = String(lastYear - 1);

  const prevYearRows = rows.filter(row => row.date.startsWith(prevYearStr));
  if (prevYearRows.length) {
    return prevYearRows.at(-1).close;
  }

  return DAX_2025_CLOSE;
}

/* ─────────────────────────────────────────────────────────────
 *  buildMarketForDate
 *
 *  Erzeugt ein Market-Objekt für ein konkretes Datum:
 *    1. selectMarketPointForDate → Close + asOf für das Datum
 *    2. Historie bis zu diesem Datum slicen
 *    3. SMA200/SMA34 aus dem Slice berechnen
 *    4. previousYearClose aus dem Slice extrahieren
 *
 *  Ohne targetDate → letzter available Stand (wie bisher).
 * ───────────────────────────────────────────────────────────── */

function buildMarketForDate(rows, targetDate, source, sourceLabel, status) {
  if (!rows || rows.length < 34) {
    return null;
  }

  // Ohne Datum: letzte verfügbare Daten
  if (!targetDate) {
    const closes = rows.map(r => r.close);
    const lastRow = rows.at(-1);
    return {
      close: lastRow.close,
      previousYearClose: extractPreviousYearClose(rows),
      sma200: average(closes.slice(-200)),
      sma34: average(closes.slice(-34)),
      asOf: lastRow.date,
      source,
      sourceLabel,
      status,
      warning: ''
    };
  }

  // Mit Datum: Punkt in der Historie finden
  const point = selectMarketPointForDate({ targetDate, rows });

  // Historie bis zu diesem Punkt slicen (inklusive)
  const sliceIdx = rows.findIndex(r => r.date === point.asOf);
  if (sliceIdx === -1) return null;

  const historyUpToDate = rows.slice(0, sliceIdx + 1);
  const closes = historyUpToDate.map(r => r.close);

  return {
    close: point.close,
    previousYearClose: extractPreviousYearClose(historyUpToDate),
    sma200: average(closes.slice(-200)),
    sma34: average(closes.slice(-34)),
    asOf: point.asOf,
    source,
    sourceLabel,
    status,
    warning: targetDate !== point.asOf
      ? `Kein Handelstag am ${targetDate} — verwendet Close vom ${point.asOf}.`
      : ''
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Provider 1: Yahoo Chart API — query1 (Primary)
 *
 *  Liefert { rows, source, sourceLabel, status } — die rohe
 *  Close-Historie.  getDaxMarketData schneidet per buildMarketForDate
 *  auf das gewählte Datum zu.
 * ───────────────────────────────────────────────────────────── */

export async function yahooDaxProvider() {
  return yahooDaxProviderHost('query1');
}

/* ─────────────────────────────────────────────────────────────
 *  Provider 2: Yahoo Chart API — query2 (Secondary)
 *  Anderer Yahoo-Server, gleiche API — entlastet bei IP-Blocks.
 * ───────────────────────────────────────────────────────────── */

export async function yahooDaxProviderQuery2() {
  return yahooDaxProviderHost('query2');
}

async function yahooDaxProviderHost(host) {
  const response = await fetch(
    `https://${host}.finance.yahoo.com/v8/finance/chart/%5EGDAXI?range=1y&interval=1d`,
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Yahoo ${host} failed with ${response.status}`);
  }

  const body = await response.json();
  const result = body?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const rawCloses = quote?.close ?? [];
  const timestamps = result?.timestamp ?? [];

  // Timestamps und Closes zu Rows zusammenführen, nulls filtern
  const rows = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: rawCloses[i]
    }))
    .filter(r =>
      /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
      typeof r.close === 'number' && !Number.isNaN(r.close)
    );

  if (rows.length < 200) {
    throw new Error(`Yahoo ${host} returned insufficient history (${rows.length} rows)`);
  }

  return {
    rows,
    source: `yahoo-chart-${host}`,
    sourceLabel: `Yahoo Chart API (${host})`,
    status: 'delayed'
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Provider 3: Lokale CSV-Datei
 *
 *  Liest eine DAX-Historie aus einer CSV-Datei (Stooq-Format:
 *  Date,Open,High,Low,Close,Volume oder reduziert Date,Close).
 *
 *  Pfad: {csvPath} oder Standardpfad ../Input/dax-history.csv
 *  Bezugsquelle: Broker-Export, Stooq-Browser-Download, etc.
 * ───────────────────────────────────────────────────────────── */

export async function localCsvProvider({ csvPath = DEFAULT_CSV_PATH } = {}) {
  let csv;
  try {
    csv = await readFile(csvPath, 'utf-8');
  } catch {
    throw new Error(`Local CSV not found at ${csvPath}`);
  }

  const rows = parseCsv(csv);
  if (rows.length < 200) {
    throw new Error(`Local CSV has insufficient history (${rows.length} rows)`);
  }

  return {
    rows,
    source: 'local-csv',
    sourceLabel: 'Lokale CSV-Datei',
    status: 'local'
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Provider-Kette mit automatischem Fallback
 *
 *  Reihenfolge:
 *    1. Yahoo query1  (verzögert, 15 Min)
 *    2. Yahoo query2  (Alternative, anderer Server)
 *    3. Lokale CSV    (falls Datei vorhanden)
 *    4. Screenshot    (hartkodierter Fallback)
 *
 *  Provider-Interface (neu): { rows, source, sourceLabel, status }
 *  Provider-Interface (legacy): { close, sma200, ... } — wird
 *  ohne Datums-Bezug direkt durchgereicht (Test-Kompatibilität).
 * ───────────────────────────────────────────────────────────── */

export async function getDaxMarketData({
  date,
  providers = [yahooDaxProvider, yahooDaxProviderQuery2, localCsvProvider]
} = {}) {
  const errors = [];
  for (const provider of providers) {
    try {
      const result = await provider();

      // Neu: Provider liefert rows → datumsspezifische Auswahl
      if (result.rows && result.rows.length >= 34) {
        const market = buildMarketForDate(
          result.rows, date, result.source, result.sourceLabel, result.status
        );
        if (market && typeof market.close === 'number' && market.close > 0) {
          return withFormattedValues(market);
        }
        errors.push(`${provider.name}: buildMarketForDate returned no valid close`);
        continue;
      }

      // Legacy: Provider liefert fertiges Market-Objekt
      if (typeof result.close === 'number' && result.close > 0) {
        return withFormattedValues({
          ...result,
          warning: result.warning ?? ''
        });
      }

      errors.push(`${provider.name}: no valid close`);
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }

  return withFormattedValues({
    ...SNAPSHOT_FALLBACK,
    providerErrors: errors
  });
}

/* ─────────────────────────────────────────────────────────────
 *  Intraday-Provider: Yahoo Chart API — 5-Minuten-Bars
 *
 *  Liefert Intraday-Daten (High, Low, Close) für den aktuellen
 *  Handelstag.  Wird für die Morning-Break-Out-Strategie
 *  (Timing-Gruppe) benötigt.
 *
 *  Hinweis: 15-Min-Verzögerung — der 9-10 Uhr-Range ist ab
 *  ca. 10:15 CET vollständig auswertbar.
 * ───────────────────────────────────────────────────────────── */

async function yahooIntradayProviderHost(host) {
  const response = await fetch(
    `https://${host}.finance.yahoo.com/v8/finance/chart/%5EGDAXI?range=1d&interval=5m`,
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Yahoo ${host} intraday failed with ${response.status}`);
  }

  const body = await response.json();
  const result = body?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];

  const bars = timestamps
    .map((ts, i) => ({
      timestamp: ts,
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      high: quote?.high?.[i],
      low: quote?.low?.[i],
      close: quote?.close?.[i]
    }))
    .filter(bar =>
      typeof bar.high === 'number' && !Number.isNaN(bar.high) &&
      typeof bar.low === 'number' && !Number.isNaN(bar.low) &&
      typeof bar.close === 'number' && !Number.isNaN(bar.close)
    );

  if (bars.length === 0) {
    throw new Error(`Yahoo ${host} intraday returned no valid bars`);
  }

  return { bars, source: `yahoo-intraday-${host}` };
}

/* ─────────────────────────────────────────────────────────────
 *  getDaxIntradayData
 *
 *  Orchestriert den Intraday-Fetch mit query1 → query2 Fallback.
 *  Yahoo liefert nur Daten für den aktuellen/most-recent Handelstag
 *  — historische Intraday-Daten sind nicht verfügbar.
 * ───────────────────────────────────────────────────────────── */

export async function getDaxIntradayData({ date } = {}) {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  if (targetDate < today) {
    return { bars: [], source: 'none', reason: 'Intraday-Daten nur für den aktuellen Handelstag verfügbar' };
  }

  const errors = [];
  for (const host of ['query1', 'query2']) {
    try {
      const result = await yahooIntradayProviderHost(host);
      const dayBars = result.bars.filter(bar => bar.date === targetDate);
      if (dayBars.length > 0) {
        return { bars: dayBars, source: result.source };
      }
      return {
        bars: [],
        source: result.source,
        reason: 'Keine Intraday-Bars für dieses Datum (Wochenende/Feiertag oder Markt noch nicht offen)'
      };
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }

  return { bars: [], source: 'none', errors, reason: 'Intraday-Provider nicht verfügbar' };
}

/* ─────────────────────────────────────────────────────────────
 *  Saisonalitäts-Provider: Yahoo Chart API — 20 Jahre Daily
 *
 *  Lädt ~20 Jahre Tages-Closes und berechnet monatliche
 *  Renditen, Win-Raten und mittlere Renditen pro Kalendermonat.
 *  Ergebnis wird 24h im Modul-Scope gecacht (ändert sich nur
 *  1× jährlich beim Jahreswechsel).
 * ───────────────────────────────────────────────────────────── */

let seasonalityCache = { stats: null, timestamp: 0 };
const SEASONALITY_TTL = 24 * 60 * 60 * 1000;

async function yahooSeasonalityProviderHost(host) {
  const response = await fetch(
    `https://${host}.finance.yahoo.com/v8/finance/chart/%5EGDAXI?range=20y&interval=1d`,
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Yahoo ${host} seasonality failed with ${response.status}`);
  }

  const body = await response.json();
  const result = body?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];

  const rows = timestamps
    .map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      close: quote?.close?.[i]
    }))
    .filter(r =>
      /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
      typeof r.close === 'number' && !Number.isNaN(r.close)
    );

  if (rows.length < 250) {
    throw new Error(`Yahoo ${host} seasonality returned insufficient history (${rows.length} rows)`);
  }

  return { rows, source: `yahoo-seasonality-${host}` };
}

function computeMonthlyReturns(rows) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

  // Letzten Close pro Jahr-Monat erfassen
  const monthCloses = new Map();
  for (const row of sorted) {
    const ym = row.date.slice(0, 7);
    monthCloses.set(ym, row.close);
  }

  const months = [...monthCloses.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  // Monat-über-Monat Renditen berechnen
  const monthlyReturns = new Map();
  for (let i = 1; i < months.length; i++) {
    const [, prevClose] = months[i - 1];
    const [currYM, currClose] = months[i];
    const month = parseInt(currYM.slice(5, 7), 10);

    const ret = ((currClose / prevClose) - 1) * 100;

    if (!monthlyReturns.has(month)) {
      monthlyReturns.set(month, []);
    }
    monthlyReturns.get(month).push(ret);
  }

  return monthlyReturns;
}

function computeSeasonalityStats(monthlyReturns) {
  const stats = {};
  for (let m = 1; m <= 12; m++) {
    const returns = monthlyReturns.get(m) ?? [];
    if (returns.length === 0) continue;

    const wins = returns.filter(r => r > 0).length;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const sorted = [...returns].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    stats[m] = { winRate: wins / returns.length, mean, median, count: returns.length, wins };
  }
  return stats;
}

export async function getDaxSeasonality() {
  const now = Date.now();
  if (seasonalityCache.stats && (now - seasonalityCache.timestamp) < SEASONALITY_TTL) {
    return { stats: seasonalityCache.stats, source: 'cache' };
  }

  for (const host of ['query1', 'query2']) {
    try {
      const result = await yahooSeasonalityProviderHost(host);
      const monthlyReturns = computeMonthlyReturns(result.rows);
      const stats = computeSeasonalityStats(monthlyReturns);
      seasonalityCache = { stats, timestamp: now };
      return { stats, source: result.source };
    } catch {
      // versuche nächsten Host
    }
  }

  return { stats: null, source: 'none' };
}

/* ─────────────────────────────────────────────────────────────
 *  Intermarket-Provider: Yahoo Chart API — 5 Indikatoren
 *
 *  Fetcht 5 Assetklassen-Ticker (5d-Historie) und berechnet
 *  einen Risk-On/Risk-Off Composite-Score:
 *    EURUSD=X   — 5d-Return (schwacher EUR = Exportvorteil = Risk-On)
 *    ^TNX       — 5d-Δ in bp (rising yields = Risk-On)
 *    ^VIX       — absolutes Level (< 18 = Risk-On, > 25 = Risk-Off)
 *    ^GSPC      — 5d-Return (S&P 500, > +1% = Risk-On)
 *    GC=F       — 5d-Return (Gold, fallend = Risk-On)
 *
 *  15-Min-Cache (Intraday-relevant).
 * ───────────────────────────────────────────────────────────── */

const INTERMARKET_TICKERS = [
  { id: 'eurusd',   symbol: 'EURUSD=X', label: 'EURUSD',  type: 'return' },
  { id: 'ust10y',   symbol: '^TNX',     label: 'UST10Y',  type: 'yield' },
  { id: 'vix',      symbol: '^VIX',     label: 'VIX',     type: 'level' },
  { id: 'spx',      symbol: '^GSPC',    label: 'S&P 500', type: 'return' },
  { id: 'gold',     symbol: 'GC=F',     label: 'Gold',    type: 'return' }
];

let intermarketCache = { data: null, timestamp: 0 };
const INTERMARKET_TTL = 15 * 60 * 1000;

async function fetchYahooTicker(symbol, host, range = '5d') {
  const response = await fetch(
    `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`,
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Yahoo ${host} ${symbol} failed with ${response.status}`);
  }

  const body = await response.json();
  const result = body?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];

  const closes = timestamps
    .map((ts, i) => quote?.close?.[i])
    .filter(c => typeof c === 'number' && !Number.isNaN(c));

  if (closes.length < 2) {
    throw new Error(`Yahoo ${host} ${symbol} returned insufficient data (${closes.length} closes)`);
  }

  return { closes, lastClose: closes.at(-1), firstClose: closes[0] };
}

function computeIntermarketSubSignal(ticker, data) {
  if (!data) return { id: ticker.id, label: ticker.label, subSignal: 0, detail: 'nicht verfügbar' };

  if (ticker.type === 'return') {
    const ret = ((data.lastClose / data.firstClose) - 1) * 100;
    if (ticker.id === 'eurusd') {
      // Schwacher EUR = Risk-On für DAX-Exporteure
      if (ret < -0.3) return { id: ticker.id, label: ticker.label, subSignal: 1, detail: `${ret.toFixed(1)}% (5d)` };
      if (ret > 0.3)  return { id: ticker.id, label: ticker.label, subSignal: -1, detail: `${ret.toFixed(1)}% (5d)` };
      return { id: ticker.id, label: ticker.label, subSignal: 0, detail: `${ret.toFixed(1)}% (5d)` };
    }
    if (ticker.id === 'spx') {
      if (ret > 1.0)  return { id: ticker.id, label: ticker.label, subSignal: 1, detail: `+${ret.toFixed(1)}% (5d)` };
      if (ret < -1.0) return { id: ticker.id, label: ticker.label, subSignal: -1, detail: `${ret.toFixed(1)}% (5d)` };
      return { id: ticker.id, label: ticker.label, subSignal: 0, detail: `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}% (5d)` };
    }
    if (ticker.id === 'gold') {
      // Fallendes Gold = Risk-On (keine Safe-Haven-Nachfrage)
      if (ret < -0.5) return { id: ticker.id, label: ticker.label, subSignal: 1, detail: `${ret.toFixed(1)}% (5d)` };
      if (ret > 0.5)  return { id: ticker.id, label: ticker.label, subSignal: -1, detail: `${ret.toFixed(1)}% (5d)` };
      return { id: ticker.id, label: ticker.label, subSignal: 0, detail: `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}% (5d)` };
    }
  }

  if (ticker.type === 'yield') {
    // ^TNX liefert Yield in Prozent (z.B. 4.25 = 4,25%)
    const deltaBp = (data.lastClose - data.firstClose) * 100;
    if (deltaBp > 5)  return { id: ticker.id, label: ticker.label, subSignal: 1, detail: `+${deltaBp.toFixed(0)} bp (5d)` };
    if (deltaBp < -5) return { id: ticker.id, label: ticker.label, subSignal: -1, detail: `${deltaBp.toFixed(0)} bp (5d)` };
    return { id: ticker.id, label: ticker.label, subSignal: 0, detail: `${deltaBp >= 0 ? '+' : ''}${deltaBp.toFixed(0)} bp (5d)` };
  }

  if (ticker.type === 'level') {
    const level = data.lastClose;
    if (level < 18) return { id: ticker.id, label: ticker.label, subSignal: 1, detail: `${level.toFixed(1)}` };
    if (level > 25) return { id: ticker.id, label: ticker.label, subSignal: -1, detail: `${level.toFixed(1)}` };
    return { id: ticker.id, label: ticker.label, subSignal: 0, detail: `${level.toFixed(1)}` };
  }

  return { id: ticker.id, label: ticker.label, subSignal: 0, detail: 'unbekannter Typ' };
}

export async function getIntermarketIndicators() {
  const now = Date.now();
  if (intermarketCache.data && (now - intermarketCache.timestamp) < INTERMARKET_TTL) {
    return intermarketCache.data;
  }

  const indicators = [];
  for (const ticker of INTERMARKET_TICKERS) {
    let data = null;
    for (const host of ['query1', 'query2']) {
      try {
        data = await fetchYahooTicker(ticker.symbol, host);
        break;
      } catch {
        // versuche nächsten Host
      }
    }
    indicators.push(computeIntermarketSubSignal(ticker, data));
  }

  const composite = indicators.reduce((sum, ind) => sum + ind.subSignal, 0);
  const riskOn = indicators.filter(i => i.subSignal > 0).length;
  const riskOff = indicators.filter(i => i.subSignal < 0).length;
  const neutralCount = indicators.filter(i => i.subSignal === 0).length;

  const result = { indicators, composite, riskOn, riskOff, neutralCount };
  intermarketCache = { data: result, timestamp: now };
  return result;
}

/* ─────────────────────────────────────────────────────────────
 *  Sentiment-Provider: 5 Contrarian-Indikatoren
 *
 *  1. VIX Level (Contrarian: > 30 = Extreme Fear = Kaufsignal)
 *  2. DAX RSI(14) (< 30 = Oversold = Kaufsignal)
 *  3. DAX Distance from SMA200 (< -8% = Oversold)
 *  4. DAX Bollinger %B (< 0 = unter unterem Band)
 *  5. Fear & Greed Index (api.alternative.me, Crypto, ≤ 25 = Extreme Fear)
 *
 *  Composite ≥ +3 → positive (Contrarian-Kaufsignal)
 *  Composite ≤ −3 → negative (Contrarian-Vorsicht)
 *  sonst → neutral
 *
 *  15-Min-Cache.
 * ───────────────────────────────────────────────────────────── */

let sentimentCache = { data: null, timestamp: 0 };
const SENTIMENT_TTL = 15 * 60 * 1000;

async function fetchFearGreedIndex() {
  const response = await fetch('https://api.alternative.me/fng/?limit=1', {
    headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
  });
  if (!response.ok) {
    throw new Error(`Fear & Greed API failed: ${response.status}`);
  }
  const body = await response.json();
  const entry = body?.data?.[0];
  if (!entry) throw new Error('Fear & Greed API: no data');
  return { value: parseInt(entry.value, 10), classification: entry.value_classification };
}

function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeBollingerPctB(closes, period = 20, numStdDev = 2) {
  if (closes.length < period) return null;

  const slice = closes.slice(-period);
  const sma = slice.reduce((s, c) => s + c, 0) / period;
  const variance = slice.reduce((s, c) => s + (c - sma) ** 2, 0) / period;
  const stdDev = Math.sqrt(variance);

  const upperBand = sma + numStdDev * stdDev;
  const lowerBand = sma - numStdDev * stdDev;
  const lastClose = closes.at(-1);

  const bandRange = upperBand - lowerBand;
  if (bandRange === 0) return 0.5;
  return (lastClose - lowerBand) / bandRange;
}

export async function getSentimentIndicators({ market } = {}) {
  const now = Date.now();
  if (sentimentCache.data && (now - sentimentCache.timestamp) < SENTIMENT_TTL) {
    return sentimentCache.data;
  }

  const [vixData, daxData, fngData] = await Promise.all([
    (async () => {
      for (const host of ['query1', 'query2']) {
        try { return await fetchYahooTicker('^VIX', host); } catch { /* next */ }
      }
      return null;
    })(),
    (async () => {
      for (const host of ['query1', 'query2']) {
        try { return await fetchYahooTicker('^GDAXI', host, '3mo'); } catch { /* next */ }
      }
      return null;
    })(),
    fetchFearGreedIndex().catch(() => null)
  ]);

  const indicators = [];

  // 1. VIX Contrarian
  if (vixData) {
    const vix = vixData.lastClose;
    if (vix > 30) indicators.push({ id: 'vix_sent', label: 'VIX', subSignal: 1, detail: `${vix.toFixed(1)} (Extreme Fear)` });
    else if (vix < 13) indicators.push({ id: 'vix_sent', label: 'VIX', subSignal: -1, detail: `${vix.toFixed(1)} (Complacency)` });
    else indicators.push({ id: 'vix_sent', label: 'VIX', subSignal: 0, detail: `${vix.toFixed(1)}` });
  } else {
    indicators.push({ id: 'vix_sent', label: 'VIX', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 2. RSI(14)
  if (daxData && daxData.closes.length >= 15) {
    const rsi = computeRSI(daxData.closes);
    if (rsi !== null) {
      if (rsi < 30) indicators.push({ id: 'rsi', label: 'RSI(14)', subSignal: 1, detail: `${rsi.toFixed(1)} (Oversold)` });
      else if (rsi > 70) indicators.push({ id: 'rsi', label: 'RSI(14)', subSignal: -1, detail: `${rsi.toFixed(1)} (Overbought)` });
      else indicators.push({ id: 'rsi', label: 'RSI(14)', subSignal: 0, detail: `${rsi.toFixed(1)}` });
    } else {
      indicators.push({ id: 'rsi', label: 'RSI(14)', subSignal: 0, detail: 'unzureichende Daten' });
    }
  } else {
    indicators.push({ id: 'rsi', label: 'RSI(14)', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 3. SMA200 Distance
  if (market?.close && market?.sma200) {
    const distPct = ((market.close / market.sma200) - 1) * 100;
    if (distPct < -8) indicators.push({ id: 'sma200_dist', label: 'ΔSMA200', subSignal: 1, detail: `${distPct.toFixed(1)}% (Oversold)` });
    else if (distPct > 8) indicators.push({ id: 'sma200_dist', label: 'ΔSMA200', subSignal: -1, detail: `+${distPct.toFixed(1)}% (Overbought)` });
    else indicators.push({ id: 'sma200_dist', label: 'ΔSMA200', subSignal: 0, detail: `${distPct >= 0 ? '+' : ''}${distPct.toFixed(1)}%` });
  } else {
    indicators.push({ id: 'sma200_dist', label: 'ΔSMA200', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 4. Bollinger %B
  if (daxData && daxData.closes.length >= 20) {
    const pctB = computeBollingerPctB(daxData.closes);
    if (pctB !== null) {
      if (pctB < 0) indicators.push({ id: 'bollinger', label: 'Bollinger %B', subSignal: 1, detail: `${pctB.toFixed(2)} (unter Band)` });
      else if (pctB > 1) indicators.push({ id: 'bollinger', label: 'Bollinger %B', subSignal: -1, detail: `${pctB.toFixed(2)} (über Band)` });
      else indicators.push({ id: 'bollinger', label: 'Bollinger %B', subSignal: 0, detail: pctB.toFixed(2) });
    } else {
      indicators.push({ id: 'bollinger', label: 'Bollinger %B', subSignal: 0, detail: 'unzureichende Daten' });
    }
  } else {
    indicators.push({ id: 'bollinger', label: 'Bollinger %B', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 5. Fear & Greed Index (Crypto, Contrarian)
  if (fngData) {
    const { value, classification } = fngData;
    if (value <= 25) indicators.push({ id: 'fng', label: 'F&G', subSignal: 1, detail: `${value} (${classification})` });
    else if (value >= 75) indicators.push({ id: 'fng', label: 'F&G', subSignal: -1, detail: `${value} (${classification})` });
    else indicators.push({ id: 'fng', label: 'F&G', subSignal: 0, detail: `${value} (${classification})` });
  } else {
    indicators.push({ id: 'fng', label: 'F&G', subSignal: 0, detail: 'nicht verfügbar' });
  }

  const composite = indicators.reduce((sum, ind) => sum + ind.subSignal, 0);
  const buySignals = indicators.filter(i => i.subSignal > 0).length;
  const cautionSignals = indicators.filter(i => i.subSignal < 0).length;
  const neutralCount = indicators.filter(i => i.subSignal === 0).length;

  const result = { indicators, composite, buySignals, cautionSignals, neutralCount };
  sentimentCache = { data: result, timestamp: now };
  return result;
}

/* ─────────────────────────────────────────────────────────────
 *  Technische-Analyse-Provider: 4 Trend/Momentum-Indikatoren
 *
 *  1. MACD (12,26,9)         — Momentum-Trend (MACD > Signal = bullish)
 *  2. SMA50 vs SMA200        — Golden/Death Cross
 *  3. ROC(20)               — 20-day Rate of Change (> +2% = bullish)
 *  4. ATR(14) Volatility     — Volatilitäts-Expansion bestätigt Trend
 *                              (ATR expanding + Close > SMA50 = bullish)
 *
 *  Composite ≥ +3 → positive (Trend-Bestätigung)
 *  Composite ≤ −3 → negative (Trend-Warnung)
 *  sonst → neutral
 *
 *  15-Min-Cache. Braucht OHLC-Daten (range=1y).
 * ───────────────────────────────────────────────────────────── */

let technicalCache = { data: null, timestamp: 0 };
const TECHNICAL_TTL = 15 * 60 * 1000;

async function fetchYahooDaxOHLC(host, range = '1y') {
  const response = await fetch(
    `https://${host}.finance.yahoo.com/v8/finance/chart/%5EGDAXI?range=${range}&interval=1d`,
    {
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Yahoo ${host} DAX OHLC failed with ${response.status}`);
  }

  const body = await response.json();
  const result = body?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const timestamps = result?.timestamp ?? [];

  const rows = timestamps
    .map((ts, i) => ({
      high: quote?.high?.[i],
      low: quote?.low?.[i],
      close: quote?.close?.[i]
    }))
    .filter(r =>
      typeof r.high === 'number' && !Number.isNaN(r.high) &&
      typeof r.low === 'number' && !Number.isNaN(r.low) &&
      typeof r.close === 'number' && !Number.isNaN(r.close)
    );

  if (rows.length < 200) {
    throw new Error(`Yahoo ${host} DAX OHLC insufficient (${rows.length} rows)`);
  }

  return {
    highs: rows.map(r => r.high),
    lows: rows.map(r => r.low),
    closes: rows.map(r => r.close),
    lastClose: rows.at(-1).close
  };
}

function computeEMA(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  const ema = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function computeSMASimple(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

function computeMACD(closes) {
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  if (!ema12 || !ema26) return null;

  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = computeEMA(macdLine, 9);
  if (!signalLine) return null;

  return { macd: macdLine.at(-1), signal: signalLine.at(-1) };
}

function computeROC(closes, period = 20) {
  if (closes.length < period + 1) return null;
  return ((closes.at(-1) / closes.at(-1 - period)) - 1) * 100;
}

function computeTRSeries(highs, lows, closes) {
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }
  return trs;
}

function computeATRAt(trs, offset, period = 14) {
  if (trs.length < period + offset) return null;
  const slice = trs.slice(trs.length - period - offset, trs.length - offset);
  return slice.reduce((s, v) => s + v, 0) / period;
}

export async function getTechnicalIndicators() {
  const now = Date.now();
  if (technicalCache.data && (now - technicalCache.timestamp) < TECHNICAL_TTL) {
    return technicalCache.data;
  }

  let ohlc = null;
  for (const host of ['query1', 'query2']) {
    try {
      ohlc = await fetchYahooDaxOHLC(host, '1y');
      break;
    } catch {
      // versuche nächsten Host
    }
  }

  const indicators = [];

  if (!ohlc) {
    for (const id of ['macd', 'sma_cross', 'roc', 'atr_vol']) {
      indicators.push({ id, label: id, subSignal: 0, detail: 'nicht verfügbar' });
    }
    const result = { indicators, composite: 0, bullish: 0, bearish: 0, neutralCount: 4 };
    technicalCache = { data: result, timestamp: now };
    return result;
  }

  const { closes, highs, lows } = ohlc;

  // 1. MACD (12,26,9)
  const macdData = computeMACD(closes);
  if (macdData) {
    const { macd, signal } = macdData;
    if (macd > signal) {
      indicators.push({ id: 'macd', label: 'MACD', subSignal: 1, detail: `${macd.toFixed(0)} > ${signal.toFixed(0)}` });
    } else {
      indicators.push({ id: 'macd', label: 'MACD', subSignal: -1, detail: `${macd.toFixed(0)} < ${signal.toFixed(0)}` });
    }
  } else {
    indicators.push({ id: 'macd', label: 'MACD', subSignal: 0, detail: 'unzureichende Daten' });
  }

  // 2. SMA50 vs SMA200 (Golden/Death Cross)
  const sma50 = computeSMASimple(closes, 50);
  const sma200 = computeSMASimple(closes, 200);
  if (sma50 !== null && sma200 !== null) {
    if (sma50 > sma200) {
      indicators.push({ id: 'sma_cross', label: 'SMA-Cross', subSignal: 1, detail: 'Golden Cross (SMA50 > SMA200)' });
    } else {
      indicators.push({ id: 'sma_cross', label: 'SMA-Cross', subSignal: -1, detail: 'Death Cross (SMA50 < SMA200)' });
    }
  } else {
    indicators.push({ id: 'sma_cross', label: 'SMA-Cross', subSignal: 0, detail: 'unzureichende Daten' });
  }

  // 3. ROC(20)
  const roc = computeROC(closes, 20);
  if (roc !== null) {
    if (roc > 2) {
      indicators.push({ id: 'roc', label: 'ROC(20)', subSignal: 1, detail: `+${roc.toFixed(1)}%` });
    } else if (roc < -2) {
      indicators.push({ id: 'roc', label: 'ROC(20)', subSignal: -1, detail: `${roc.toFixed(1)}%` });
    } else {
      indicators.push({ id: 'roc', label: 'ROC(20)', subSignal: 0, detail: `${roc >= 0 ? '+' : ''}${roc.toFixed(1)}%` });
    }
  } else {
    indicators.push({ id: 'roc', label: 'ROC(20)', subSignal: 0, detail: 'unzureichende Daten' });
  }

  // 4. ATR(14) Volatility Trend Confirmation
  const trs = computeTRSeries(highs, lows, closes);
  const currentATR = computeATRAt(trs, 0, 14);
  const prevATR = computeATRAt(trs, 20, 14);
  const sma50ForATR = computeSMASimple(closes, 50);

  if (currentATR !== null && prevATR !== null && sma50ForATR !== null) {
    const expanding = currentATR > prevATR;
    const lastClose = closes.at(-1);
    const atrPct = (currentATR / lastClose) * 100;
    const aboveSMA50 = lastClose > sma50ForATR;

    if (expanding && aboveSMA50) {
      indicators.push({ id: 'atr_vol', label: 'ATR(14)', subSignal: 1, detail: `${atrPct.toFixed(1)}% exp., über SMA50` });
    } else if (expanding && !aboveSMA50) {
      indicators.push({ id: 'atr_vol', label: 'ATR(14)', subSignal: -1, detail: `${atrPct.toFixed(1)}% exp., unter SMA50` });
    } else {
      indicators.push({ id: 'atr_vol', label: 'ATR(14)', subSignal: 0, detail: `${atrPct.toFixed(1)}% (kontrahiert)` });
    }
  } else {
    indicators.push({ id: 'atr_vol', label: 'ATR(14)', subSignal: 0, detail: 'unzureichende Daten' });
  }

  const composite = indicators.reduce((sum, ind) => sum + ind.subSignal, 0);
  const bullish = indicators.filter(i => i.subSignal > 0).length;
  const bearish = indicators.filter(i => i.subSignal < 0).length;
  const neutralCount = indicators.filter(i => i.subSignal === 0).length;

  const result = { indicators, composite, bullish, bearish, neutralCount };
  technicalCache = { data: result, timestamp: now };
  return result;
}

/* ─────────────────────────────────────────────────────────────
 *  Fundamental-Analyse-Provider: 5 Makro-Indikatoren
 *
 *  1. Yield Curve Slope (^TNX − ^IRX) — > 0 = gesund, < −0,2% = Rezession
 *  2. Credit Spread Trend (HYG vs LQD 20d) — > 0 = gesund, < −0,5% = Stress
 *  3. Monetary Policy Stance (^TNX Level) — < 3% = akkommodierend, > 5% = restriktiv
 *  4. Equity vs Bond Rotation (S&P vs TLT 60d) — > +5% = Growth, < −5% = Safety
 *  5. DAX 52w Valuation (Distanz vom 52w-Hoch) — < −15% = unterbewertet
 *
 *  Composite ≥ +3 → positive (makro-stützend)
 *  Composite ≤ −3 → negative (makro-Risiko)
 *  sonst → neutral
 *
 *  1h-Cache (Fundamental ändert sich langsam).
 * ───────────────────────────────────────────────────────────── */

let fundamentalCache = { data: null, timestamp: 0 };
const FUNDAMENTAL_TTL = 60 * 60 * 1000;

export async function getFundamentalIndicators() {
  const now = Date.now();
  if (fundamentalCache.data && (now - fundamentalCache.timestamp) < FUNDAMENTAL_TTL) {
    return fundamentalCache.data;
  }

  const [tnxData, irxData, hygData, lqdData, tltData, spxData, daxData] = await Promise.all([
    (async () => { for (const h of ['query1', 'query2']) { try { return await fetchYahooTicker('^TNX', h); } catch { /* next */ } } return null; })(),
    (async () => { for (const h of ['query1', 'query2']) { try { return await fetchYahooTicker('^IRX', h); } catch { /* next */ } } return null; })(),
    (async () => { for (const h of ['query1', 'query2']) { try { return await fetchYahooTicker('HYG', h, '1mo'); } catch { /* next */ } } return null; })(),
    (async () => { for (const h of ['query1', 'query2']) { try { return await fetchYahooTicker('LQD', h, '1mo'); } catch { /* next */ } } return null; })(),
    (async () => { for (const h of ['query1', 'query2']) { try { return await fetchYahooTicker('TLT', h, '3mo'); } catch { /* next */ } } return null; })(),
    (async () => { for (const h of ['query1', 'query2']) { try { return await fetchYahooTicker('^GSPC', h, '3mo'); } catch { /* next */ } } return null; })(),
    (async () => { for (const h of ['query1', 'query2']) { try { return await fetchYahooTicker('^GDAXI', h, '1y'); } catch { /* next */ } } return null; })()
  ]);

  const indicators = [];

  // 1. Yield Curve Slope (10yr − 13w)
  if (tnxData && irxData) {
    const slope = tnxData.lastClose - irxData.lastClose;
    if (slope > 0) {
      indicators.push({ id: 'yield_curve', label: 'Zinsstruktur', subSignal: 1, detail: `+${slope.toFixed(2)}% (normal)` });
    } else if (slope < -0.2) {
      indicators.push({ id: 'yield_curve', label: 'Zinsstruktur', subSignal: -1, detail: `${slope.toFixed(2)}% (invertiert)` });
    } else {
      indicators.push({ id: 'yield_curve', label: 'Zinsstruktur', subSignal: 0, detail: `${slope.toFixed(2)}% (flach)` });
    }
  } else {
    indicators.push({ id: 'yield_curve', label: 'Zinsstruktur', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 2. Credit Spread Trend (HYG vs LQD 20d)
  if (hygData && lqdData) {
    const hygRet = ((hygData.lastClose / hygData.firstClose) - 1) * 100;
    const lqdRet = ((lqdData.lastClose / lqdData.firstClose) - 1) * 100;
    const creditTrend = hygRet - lqdRet;
    if (creditTrend > 0) {
      indicators.push({ id: 'credit', label: 'Kredit', subSignal: 1, detail: `HYG ${hygRet.toFixed(1)}% vs LQD ${lqdRet.toFixed(1)}%` });
    } else if (creditTrend < -0.5) {
      indicators.push({ id: 'credit', label: 'Kredit', subSignal: -1, detail: `HYG ${hygRet.toFixed(1)}% vs LQD ${lqdRet.toFixed(1)}% (Stress)` });
    } else {
      indicators.push({ id: 'credit', label: 'Kredit', subSignal: 0, detail: `HYG ${hygRet.toFixed(1)}% vs LQD ${lqdRet.toFixed(1)}%` });
    }
  } else {
    indicators.push({ id: 'credit', label: 'Kredit', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 3. Monetary Policy Stance (UST10Y Level)
  if (tnxData) {
    const level = tnxData.lastClose;
    if (level < 3.0) {
      indicators.push({ id: 'monetary', label: 'Geldpolitik', subSignal: 1, detail: `UST ${level.toFixed(2)}% (akkommodierend)` });
    } else if (level > 5.0) {
      indicators.push({ id: 'monetary', label: 'Geldpolitik', subSignal: -1, detail: `UST ${level.toFixed(2)}% (restriktiv)` });
    } else {
      indicators.push({ id: 'monetary', label: 'Geldpolitik', subSignal: 0, detail: `UST ${level.toFixed(2)}%` });
    }
  } else {
    indicators.push({ id: 'monetary', label: 'Geldpolitik', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 4. Equity vs Bond Rotation (S&P vs TLT 60d)
  if (spxData && tltData) {
    const spxRet = ((spxData.lastClose / spxData.firstClose) - 1) * 100;
    const tltRet = ((tltData.lastClose / tltData.firstClose) - 1) * 100;
    const eqBond = spxRet - tltRet;
    if (eqBond > 5) {
      indicators.push({ id: 'eq_bond', label: 'Aktien/Anleihen', subSignal: 1, detail: `S&P ${spxRet.toFixed(1)}% vs TLT ${tltRet.toFixed(1)}%` });
    } else if (eqBond < -5) {
      indicators.push({ id: 'eq_bond', label: 'Aktien/Anleihen', subSignal: -1, detail: `S&P ${spxRet.toFixed(1)}% vs TLT ${tltRet.toFixed(1)}% (Safety)` });
    } else {
      indicators.push({ id: 'eq_bond', label: 'Aktien/Anleihen', subSignal: 0, detail: `S&P ${spxRet.toFixed(1)}% vs TLT ${tltRet.toFixed(1)}%` });
    }
  } else {
    indicators.push({ id: 'eq_bond', label: 'Aktien/Anleihen', subSignal: 0, detail: 'nicht verfügbar' });
  }

  // 5. DAX 52w Valuation
  if (daxData && daxData.closes.length >= 200) {
    const high52w = Math.max(...daxData.closes);
    const lastClose = daxData.lastClose;
    const distPct = ((lastClose / high52w) - 1) * 100;
    if (distPct < -15) {
      indicators.push({ id: 'valuation', label: 'Bewertung', subSignal: 1, detail: `${distPct.toFixed(1)}% vom 52w-Hoch (unterbewertet)` });
    } else if (distPct > -5) {
      indicators.push({ id: 'valuation', label: 'Bewertung', subSignal: -1, detail: `${distPct.toFixed(1)}% vom 52w-Hoch (überbewertet)` });
    } else {
      indicators.push({ id: 'valuation', label: 'Bewertung', subSignal: 0, detail: `${distPct.toFixed(1)}% vom 52w-Hoch` });
    }
  } else {
    indicators.push({ id: 'valuation', label: 'Bewertung', subSignal: 0, detail: 'nicht verfügbar' });
  }

  const composite = indicators.reduce((sum, ind) => sum + ind.subSignal, 0);
  const supportive = indicators.filter(i => i.subSignal > 0).length;
  const risk = indicators.filter(i => i.subSignal < 0).length;
  const neutralCount = indicators.filter(i => i.subSignal === 0).length;

  const result = { indicators, composite, supportive, risk, neutralCount };
  fundamentalCache = { data: result, timestamp: now };
  return result;
}
