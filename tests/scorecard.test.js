import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDashboard } from '../src/scorecard.js';

test('evaluates screenshot market state with positive five-day, YTD and 200D filters', () => {
  const result = evaluateDashboard({
    date: '2026-06-22',
    market: {
      close: 25166,
      previousYearClose: 24422.49,
      sma200: 24208.79,
      sma34: 24989.25,
      source: 'snapshot',
      sourceLabel: 'Screenshot-Fallback',
      asOf: '2026-06-19',
      status: 'snapshot-fallback'
    }
  });

  assert.equal(result.market.closeFormatted, '25.166');
  assert.equal(result.investment.find((s) => s.id === 'five_days').signal, 'positive');
  assert.equal(result.investment.find((s) => s.id === 'ytd').signal, 'positive');
  assert.equal(result.investment.find((s) => s.id === 'sma200').signal, 'positive');
  assert.equal(result.investment.find((s) => s.id === 'even_odd').signal, 'negative');
  assert.equal(result.investment.find((s) => s.id === 'halloween').signal, 'negative');
  assert.equal(result.trading.find((s) => s.id === 'summer_short').signal, 'negative');
  assert.equal(result.summary.investmentScore, 1);
  assert.equal(result.summary.totalScore, -1);
  assert.equal(result.summary.decision, 'Leicht negativ / Short bevorzugt');
});

test('uses next DAX trading day when the selected date is a weekend', () => {
  const result = evaluateDashboard({
    date: '2026-06-20',
    market: {
      close: 25166,
      previousYearClose: 24422.49,
      sma200: 24208.79,
      sma34: 24989.25,
      source: 'snapshot',
      sourceLabel: 'Screenshot-Fallback',
      asOf: '2026-06-19',
      status: 'snapshot-fallback'
    }
  });

  assert.equal(result.date.today, '2026-06-20');
  assert.equal(result.date.decisionDate, '2026-06-22');
  assert.equal(result.date.tradingDayStatus, 'Heute kein DAX-Handelstag - Vorschau naechster Handelstag');
});
