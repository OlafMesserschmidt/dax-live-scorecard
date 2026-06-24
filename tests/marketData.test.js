import test from 'node:test';
import assert from 'node:assert/strict';
import { getDaxMarketData, selectMarketPointForDate } from '../src/marketData.js';

test('falls back to the screenshot close when live providers fail', async () => {
  const market = await getDaxMarketData({
    providers: [
      async () => {
        throw new Error('provider unavailable');
      }
    ]
  });

  assert.equal(market.close, 25166);
  assert.equal(market.previousYearClose, 24422.49);
  assert.equal(market.status, 'snapshot-fallback');
  assert.equal(market.sourceLabel, 'Screenshot-Fallback');
  assert.equal(market.closeFormatted, '25.166');
  assert.equal(market.previousYearCloseFormatted, '24.422');
  assert.ok(market.warning.includes('Fallback'));
});

test('prefers provider data when a provider returns a valid DAX close', async () => {
  const market = await getDaxMarketData({
    providers: [
      async () => ({
        close: 26000,
        previousYearClose: 24000,
        sma200: 24500,
        sma34: 25100,
        asOf: '2026-06-22',
        source: 'test-provider',
        sourceLabel: 'Test Provider',
        status: 'delayed'
      })
    ]
  });

  assert.equal(market.close, 26000);
  assert.equal(market.sourceLabel, 'Test Provider');
  assert.equal(market.status, 'delayed');
  assert.equal(market.closeFormatted, '26.000');
});

test('selects the close for the chosen date from provider history', () => {
  const selected = selectMarketPointForDate({
    targetDate: '2026-01-15',
    rows: [
      { date: '2026-01-14', close: 24100 },
      { date: '2026-01-15', close: 24200 },
      { date: '2026-01-16', close: 24300 }
    ]
  });

  assert.equal(selected.asOf, '2026-01-15');
  assert.equal(selected.close, 24200);
});

test('uses the previous trading close when the chosen date has no market row', () => {
  const selected = selectMarketPointForDate({
    targetDate: '2026-01-18',
    rows: [
      { date: '2026-01-15', close: 24200 },
      { date: '2026-01-16', close: 24300 },
      { date: '2026-01-20', close: 24500 }
    ]
  });

  assert.equal(selected.asOf, '2026-01-16');
  assert.equal(selected.close, 24300);
});

/* ─────────────────────────────────────────────────────────────
 *  Datumsspezifische Marktdaten — Provider mit rows
 * ───────────────────────────────────────────────────────────── */

function makeRows() {
  const rows = [];
  // 250 Handelstage: 2025-01-02 bis ca. 2025-12-12
  // Close steigt linear von 20000 auf 25000
  let baseDate = new Date('2025-01-02T12:00:00Z');
  let close = 20000;
  for (let i = 0; i < 250; i++) {
    // Wochenende überspringen
    while (baseDate.getUTCDay() === 0 || baseDate.getUTCDay() === 6) {
      baseDate.setUTCDate(baseDate.getUTCDate() + 1);
    }
    rows.push({
      date: baseDate.toISOString().slice(0, 10),
      close: close + i * 20
    });
    baseDate.setUTCDate(baseDate.getUTCDate() + 1);
  }
  return rows;
}

test('builds market data for a specific date from provider rows', async () => {
  const rows = makeRows();
  const market = await getDaxMarketData({
    date: rows[100].date,
    providers: [
      async () => ({ rows, source: 'test', sourceLabel: 'Test', status: 'delayed' })
    ]
  });

  // Close muss dem 100. Tag entsprechen, nicht dem letzten
  assert.equal(market.close, rows[100].close);
  assert.equal(market.asOf, rows[100].date);
  assert.equal(market.source, 'test');
  assert.equal(market.sourceLabel, 'Test');
  assert.equal(market.status, 'delayed');
  assert.ok(typeof market.sma200 === 'number');
  assert.ok(typeof market.sma34 === 'number');
});

test('uses latest data when no date is specified', async () => {
  const rows = makeRows();
  const market = await getDaxMarketData({
    providers: [
      async () => ({ rows, source: 'test', sourceLabel: 'Test', status: 'delayed' })
    ]
  });

  assert.equal(market.close, rows.at(-1).close);
  assert.equal(market.asOf, rows.at(-1).date);
});

test('falls back to previous trading day when selected date is a weekend', async () => {
  const rows = makeRows();
  // 2025-05-17 ist ein Samstag
  const market = await getDaxMarketData({
    date: '2025-05-17',
    providers: [
      async () => ({ rows, source: 'test', sourceLabel: 'Test', status: 'delayed' })
    ]
  });

  // asOf darf nicht 2025-05-17 sein — muss der letzte Freitag davor sein
  assert.notEqual(market.asOf, '2025-05-17');
  assert.ok(market.warning.includes('Kein Handelstag'));
  assert.ok(market.warning.includes('2025-05-17'));
});

test('legacy provider interface still works without rows', async () => {
  const market = await getDaxMarketData({
    date: '2026-01-15',
    providers: [
      async () => ({
        close: 26000,
        previousYearClose: 24000,
        sma200: 24500,
        sma34: 25100,
        asOf: '2026-01-15',
        source: 'test-provider',
        sourceLabel: 'Test Provider',
        status: 'delayed'
      })
    ]
  });

  assert.equal(market.close, 26000);
  assert.equal(market.sourceLabel, 'Test Provider');
});
