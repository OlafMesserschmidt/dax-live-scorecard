const DAX_HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-01',
  '2026-12-24',
  '2026-12-25',
  '2026-12-31'
]);

const FOMC_PRE_DATES_2026 = new Set([
  '2026-01-27',
  '2026-03-17',
  '2026-04-28',
  '2026-06-16',
  '2026-07-28',
  '2026-09-15',
  '2026-10-27',
  '2026-12-08'
]);

const HEXEN_DATES_2026 = new Set([
  '2026-03-16',
  '2026-03-17',
  '2026-03-18',
  '2026-03-19',
  '2026-06-15',
  '2026-06-16',
  '2026-06-17',
  '2026-06-18',
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-12-14',
  '2026-12-15',
  '2026-12-16',
  '2026-12-17'
]);

const US_HOLIDAYS_2026 = new Set([
  '2026-01-01',
  '2026-01-19',
  '2026-02-16',
  '2026-04-03',
  '2026-05-25',
  '2026-06-19',
  '2026-07-03',
  '2026-09-07',
  '2026-11-26',
  '2026-12-25'
]);

const formatter = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 0
});

export function formatIndex(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'fehlt';
  return formatter.format(value);
}

function parseDate(dateValue) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${dateValue}`);
  }
  return date;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isTradingDay(date) {
  const day = date.getDay();
  const iso = toIsoDate(date);
  return day !== 0 && day !== 6 && !DAX_HOLIDAYS_2026.has(iso);
}

export function getDecisionDate(dateValue) {
  const today = parseDate(dateValue);
  let cursor = new Date(today);
  while (!isTradingDay(cursor)) {
    cursor = addDays(cursor, 1);
  }

  const todayIso = toIsoDate(today);
  const decisionIso = toIsoDate(cursor);
  return {
    today: todayIso,
    decisionDate: decisionIso,
    tradingDayStatus:
      todayIso === decisionIso
        ? 'Heute ist DAX-Handelstag'
        : 'Heute kein DAX-Handelstag - Vorschau naechster Handelstag'
  };
}

function signalToPoints(signal, weight = 1) {
  if (signal === 'positive') return weight;
  if (signal === 'negative') return -weight;
  return 0;
}

function signalLabel(signal) {
  if (signal === 'positive') return 'Positiv';
  if (signal === 'negative') return 'Negativ';
  return 'Neutral';
}

function makeStrategy({ id, name, group, weight, signal, reason, manual = false }) {
  return {
    id,
    name,
    group,
    weight,
    signal,
    label: signalLabel(signal),
    points: signalToPoints(signal, weight),
    reason,
    manual
  };
}

function evaluateInvestment(decisionDate, market) {
  const date = parseDate(decisionDate);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  const firstFiveDaysPositive = market.firstFiveDaysPositive ?? true;
  const inHalloweenWindow = month >= 11 || month <= 4;
  const inQuarterFirstMonth = [1, 4, 7, 10].includes(month);

  return [
    makeStrategy({
      id: 'even_odd',
      name: 'Gerade/Ungerade',
      group: 'Investment',
      weight: 1,
      signal: year % 2 === 0 ? 'negative' : 'positive',
      reason: year % 2 === 0
        ? `${year} ist gerade — defensiv (Cash/Anleihen)`
        : `${year} ist ungerade — investiert`
    }),
    makeStrategy({
      id: 'five_days',
      name: '5 Tage',
      group: 'Investment',
      weight: 1,
      signal: firstFiveDaysPositive ? 'positive' : 'neutral',
      reason: firstFiveDaysPositive ? 'erste 5 Tage positiv' : '5-Tage-Status nicht positiv'
    }),
    makeStrategy({
      id: 'ytd',
      name: 'YTD',
      group: 'Investment',
      weight: 1,
      signal:
        market.close && market.previousYearClose
          ? market.close > market.previousYearClose
            ? 'positive'
            : 'negative'
          : 'neutral',
      reason: market.close && market.previousYearClose ? 'Schlusskurs gegen Vorjahresschluss' : 'Kursdaten erforderlich'
    }),
    makeStrategy({
      id: 'sma200',
      name: '200-Tage-Linie',
      group: 'Investment',
      weight: 1,
      signal:
        market.close && market.sma200
          ? market.close > market.sma200
            ? 'positive'
            : 'negative'
          : 'neutral',
      reason: market.close && market.sma200 ? 'Schlusskurs gegen 200D' : 'Historie erforderlich'
    }),
    makeStrategy({
      id: 'halloween',
      name: 'Halloween-Effekt',
      group: 'Investment',
      weight: 1,
      signal: inHalloweenWindow ? 'positive' : 'negative',
      reason: inHalloweenWindow ? 'November bis April — investiert' : 'Mai bis Oktober — nicht investiert'
    }),
    makeStrategy({
      id: 'quarter_trick',
      name: 'Quartalstrick',
      group: 'Investment',
      weight: 1,
      signal: inQuarterFirstMonth ? 'positive' : 'neutral',
      reason: inQuarterFirstMonth ? 'erster Monat im Quartal' : 'nicht erster Quartalsmonat'
    })
  ];
}

function evaluateTrading(decisionDate, market) {
  const date = parseDate(decisionDate);
  const iso = toIsoDate(date);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = date.getDay();
  const inUltimoWindow = day >= 26 || day <= 5;
  const inSummerShort = month >= 5 && month <= 9 && day >= 20 && day <= 24;
  const turnaroundTuesday = [1, 2].includes(weekday) && market.close && market.sma34 && market.close < market.sma34;

  return [
    makeStrategy({
      id: 'ultimo',
      name: 'Monats Ultimo',
      group: 'Trading',
      weight: 2,
      signal: inUltimoWindow ? 'positive' : 'neutral',
      reason: inUltimoWindow ? 'im Monatsultimo-Fenster' : 'nicht im Ultimo-Fenster'
    }),
    makeStrategy({
      id: 'tt',
      name: 'Turnaround Tuesday',
      group: 'Trading',
      weight: 2,
      signal: turnaroundTuesday ? 'positive' : 'neutral',
      reason: turnaroundTuesday ? 'Turnaround Tuesday mit SMA34-Filter' : 'Wochentag/SMA34-Filter nicht aktiv'
    }),
    makeStrategy({
      id: 'hexen',
      name: 'Heisse Hexen',
      group: 'Trading',
      weight: 2,
      signal: HEXEN_DATES_2026.has(iso) ? 'positive' : 'neutral',
      reason: HEXEN_DATES_2026.has(iso) ? 'Mo-Do vor grossem Verfall' : 'kein Hexen-Fenster'
    }),
    makeStrategy({
      id: 'pre_fed_long',
      name: 'Vor der FED Long',
      group: 'Trading',
      weight: 2,
      signal: FOMC_PRE_DATES_2026.has(iso) ? 'positive' : 'neutral',
      reason: FOMC_PRE_DATES_2026.has(iso) ? 'ein Handelstag vor FOMC' : 'kein Pre-FED-Termin'
    }),
    makeStrategy({
      id: 'us_holiday',
      name: 'US-Feiertag',
      group: 'Trading',
      weight: 2,
      signal: 'neutral',
      reason: US_HOLIDAYS_2026.has(iso) ? 'US-Feiertag: Liquiditaetshinweis' : 'kein US-Feiertag'
    }),
    makeStrategy({
      id: 'summer_short',
      name: 'Sommerloch Short',
      group: 'Trading',
      weight: 2,
      signal: inSummerShort ? 'negative' : 'neutral',
      reason: inSummerShort ? '20.-24. Mai bis September' : 'kein Sommerloch-Short-Fenster'
    }),
    makeStrategy({
      id: 'election_gift',
      name: 'Wahlgeschenk',
      group: 'Trading',
      weight: 2,
      signal: 'neutral',
      reason: '2026 inaktiv'
    })
  ];
}

function decisionFromScore(score) {
  if (score >= 5) return 'Bullish / Long';
  if (score >= 1) return 'Leicht positiv / Long bevorzugt';
  if (score <= -5) return 'Bearish / Short';
  if (score <= -1) return 'Leicht negativ / Short bevorzugt';
  return 'Neutral / Abwarten';
}

function countSignals(strategies, signal) {
  return strategies.filter((strategy) => strategy.signal === signal).length;
}

function getBerlinMinutes(timestamp) {
  const date = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return hour * 60 + minute;
}

/* ─────────────────────────────────────────────────────────────
 *  evaluateMorningBreakout
 *
 *  Morning-Break-Out-Strategie (Timing, automatisch):
 *    1. Range = High/Low der 9:00–10:00 CET Bars
 *    2. Ausbruch nach 10:00: High > rangeHigh → Long (positive)
 *       Low < rangeLow → Short (negative)
 *    3. Erster Ausbruch gewinnt bei beiden Richtungen
 *    4. Kein Ausbruch → neutral
 *
 *  Datenbasis: Yahoo 5-Min-Bars (15 Min verzögert).
 *  Historische Daten: neutral (Yahoo nur aktueller Handelstag).
 * ───────────────────────────────────────────────────────────── */

function evaluateMorningBreakout(intradayBars) {
  if (!intradayBars || intradayBars.length === 0) {
    return { signal: 'neutral', reason: 'keine Intraday-Daten (nur aktueller Handelstag)' };
  }

  const MARKET_OPEN = 9 * 60;  // 9:00 CET in Minuten
  const RANGE_END = 10 * 60;   // 10:00 CET

  const rangeBars = intradayBars.filter(bar => {
    const t = getBerlinMinutes(bar.timestamp);
    return t >= MARKET_OPEN && t < RANGE_END;
  });

  if (rangeBars.length < 2) {
    return { signal: 'neutral', reason: 'Range 9–10 Uhr noch nicht vollständig' };
  }

  const rangeHigh = Math.max(...rangeBars.map(b => b.high));
  const rangeLow = Math.min(...rangeBars.map(b => b.low));

  const postRangeBars = intradayBars.filter(bar => {
    const t = getBerlinMinutes(bar.timestamp);
    return t >= RANGE_END;
  });

  if (postRangeBars.length === 0) {
    return { signal: 'neutral', reason: `Range ${rangeLow.toFixed(0)}–${rangeHigh.toFixed(0)}, wartet auf Ausbruch` };
  }

  const brokeUp = postRangeBars.some(b => b.high > rangeHigh);
  const brokeDown = postRangeBars.some(b => b.low < rangeLow);

  if (brokeUp && !brokeDown) {
    return { signal: 'positive', reason: `Ausbruch über ${rangeHigh.toFixed(0)} (Long)` };
  }
  if (brokeDown && !brokeUp) {
    return { signal: 'negative', reason: `Ausbruch unter ${rangeLow.toFixed(0)} (Short)` };
  }
  if (brokeUp && brokeDown) {
    const firstUp = postRangeBars.find(b => b.high > rangeHigh);
    const firstDown = postRangeBars.find(b => b.low < rangeLow);
    if (firstUp.timestamp <= firstDown.timestamp) {
      return { signal: 'positive', reason: `zuerst Long-Ausbruch über ${rangeHigh.toFixed(0)}` };
    }
    return { signal: 'negative', reason: `zuerst Short-Ausbruch unter ${rangeLow.toFixed(0)}` };
  }

  return { signal: 'neutral', reason: `kein Ausbruch aus Range ${rangeLow.toFixed(0)}–${rangeHigh.toFixed(0)}` };
}

/* ─────────────────────────────────────────────────────────────
 *  evaluateSeasonality
 *
 *  Automatische Saisonalitätsbewertung (Marktausblick):
 *    Win-Rate + mittlere Monatsrendite aus 20 Jahren Historie
 *    Win-Rate ≥ 65% UND mean > +0,8% → positive
 *    Win-Rate ≤ 35% UND mean < −0,8% → negative
 *    sonst → neutral
 * ───────────────────────────────────────────────────────────── */

function evaluateSeasonality(currentMonth, stats) {
  const monthStats = stats?.[currentMonth];
  if (!monthStats) {
    return { signal: 'neutral', reason: 'keine Saisonalitätsdaten' };
  }

  const { winRate, mean, wins, count } = monthStats;
  const winRatePct = Math.round(winRate * 100);
  const meanStr = mean >= 0 ? `+${mean.toFixed(1)}%` : `${mean.toFixed(1)}%`;

  if (winRate >= 0.65 && mean > 0.8) {
    return { signal: 'positive', reason: `${wins}/${count} Jahre positiv (${winRatePct}%), Ø ${meanStr}` };
  }
  if (winRate <= 0.35 && mean < -0.8) {
    return { signal: 'negative', reason: `${wins}/${count} Jahre positiv (${winRatePct}%), Ø ${meanStr}` };
  }
  return { signal: 'neutral', reason: `${wins}/${count} Jahre positiv (${winRatePct}%), Ø ${meanStr}` };
}

/* ─────────────────────────────────────────────────────────────
 *  evaluateIntermarket
 *
 *  Automatische Intermarket-Analyse (Marktausblick):
 *    5 Indikatoren → Risk-On/Risk-Off Composite-Score
 *    Composite ≥ +3 → positive (Risk-On)
 *    Composite ≤ −3 → negative (Risk-Off)
 *    sonst → neutral
 * ───────────────────────────────────────────────────────────── */

function evaluateIntermarket(intermarket) {
  if (!intermarket || !intermarket.indicators) {
    return { signal: 'neutral', reason: 'keine Intermarket-Daten' };
  }

  const { composite, riskOn, riskOff, neutralCount, indicators } = intermarket;

  const details = indicators
    .map(i => `${i.label} ${i.detail}`)
    .join(', ');

  if (composite >= 3) {
    return { signal: 'positive', reason: `${riskOn}/5 Risk-On: ${details}` };
  }
  if (composite <= -3) {
    return { signal: 'negative', reason: `${riskOff}/5 Risk-Off: ${details}` };
  }
  return { signal: 'neutral', reason: `${riskOn} Risk-On, ${riskOff} Risk-Off, ${neutralCount} Neutral: ${details}` };
}

/* ─────────────────────────────────────────────────────────────
 *  evaluateSentimentOutlook
 *
 *  Automatische Sentiment-Bewertung (Marktausblick, Contrarian):
 *    5 Indikatoren → Composite-Score
 *    Composite ≥ +3 → positive (Extreme Fear = Kaufsignal)
 *    Composite ≤ −3 → negative (Extreme Greed = Vorsicht)
 *    sonst → neutral
 * ───────────────────────────────────────────────────────────── */

function evaluateSentimentOutlook(sentiment) {
  if (!sentiment || !sentiment.indicators) {
    return { signal: 'neutral', reason: 'keine Sentiment-Daten' };
  }

  const { composite, buySignals, cautionSignals, neutralCount, indicators } = sentiment;

  const details = indicators
    .map(i => `${i.label} ${i.detail}`)
    .join(', ');

  if (composite >= 3) {
    return { signal: 'positive', reason: `${buySignals}/5 Contrarian-Kaufsignal: ${details}` };
  }
  if (composite <= -3) {
    return { signal: 'negative', reason: `${cautionSignals}/5 Contrarian-Vorsicht: ${details}` };
  }
  return { signal: 'neutral', reason: `${buySignals} Kaufsignal, ${cautionSignals} Vorsicht, ${neutralCount} Neutral: ${details}` };
}

/* ─────────────────────────────────────────────────────────────
 *  evaluateTechnical
 *
 *  Automatische Technische-Analyse (Marktausblick, Trend-Following):
 *    4 Indikatoren → Composite-Score
 *    Composite ≥ +3 → positive (Trend-Bestätigung)
 *    Composite ≤ −3 → negative (Trend-Warnung)
 *    sonst → neutral
 * ───────────────────────────────────────────────────────────── */

function evaluateTechnical(technical) {
  if (!technical || !technical.indicators) {
    return { signal: 'neutral', reason: 'keine Technische-Analyse-Daten' };
  }

  const { composite, bullish, bearish, neutralCount, indicators } = technical;

  const details = indicators
    .map(i => `${i.label} ${i.detail}`)
    .join(', ');

  if (composite >= 3) {
    return { signal: 'positive', reason: `${bullish}/4 Trend-Bestätigung: ${details}` };
  }
  if (composite <= -3) {
    return { signal: 'negative', reason: `${bearish}/4 Trend-Warnung: ${details}` };
  }
  return { signal: 'neutral', reason: `${bullish} bullish, ${bearish} bearish, ${neutralCount} neutral: ${details}` };
}

/* ─────────────────────────────────────────────────────────────
 *  evaluateFundamental
 *
 *  Automatische Fundamental-Analyse (Marktausblick, Makro):
 *    5 Indikatoren → Composite-Score
 *    Composite ≥ +3 → positive (makro-stützend)
 *    Composite ≤ −3 → negative (makro-Risiko)
 *    sonst → neutral
 * ───────────────────────────────────────────────────────────── */

function evaluateFundamental(fundamental) {
  if (!fundamental || !fundamental.indicators) {
    return { signal: 'neutral', reason: 'keine Fundamental-Daten' };
  }

  const { composite, supportive, risk, neutralCount, indicators } = fundamental;

  const details = indicators
    .map(i => `${i.label} ${i.detail}`)
    .join(', ');

  if (composite >= 3) {
    return { signal: 'positive', reason: `${supportive}/5 makro-stützend: ${details}` };
  }
  if (composite <= -3) {
    return { signal: 'negative', reason: `${risk}/5 makro-Risiko: ${details}` };
  }
  return { signal: 'neutral', reason: `${supportive} stützend, ${risk} Risiko, ${neutralCount} neutral: ${details}` };
}

export function evaluateDashboard({ date, market, overrides = {}, intraday = { bars: [] }, seasonality = { stats: null }, intermarket = null, sentiment = null, technical = null, fundamental = null } = {}) {
  const dateState = getDecisionDate(date);
  const normalizedMarket = {
    ...market,
    closeFormatted: formatIndex(market.close),
    previousYearCloseFormatted: formatIndex(market.previousYearClose),
    sma200Formatted: formatIndex(market.sma200),
    sma34Formatted: formatIndex(market.sma34)
  };

  const investment = evaluateInvestment(dateState.decisionDate, normalizedMarket);
  const trading = evaluateTrading(dateState.decisionDate, normalizedMarket);
  const seasonalityEval = evaluateSeasonality(parseDate(dateState.decisionDate).getMonth() + 1, seasonality?.stats);
  const intermarketEval = evaluateIntermarket(intermarket);
  const sentimentEval = evaluateSentimentOutlook(sentiment);
  const technicalEval = evaluateTechnical(technical);
  const fundamentalEval = evaluateFundamental(fundamental);

  const marketOutlook = [
    makeStrategy({
      id: 'fundamental',
      name: 'Fundamental-Analyse',
      group: 'Marktausblick',
      weight: 1,
      signal: fundamentalEval.signal,
      reason: fundamentalEval.reason
    }),
    makeStrategy({
      id: 'technical',
      name: 'Technische-Analyse',
      group: 'Marktausblick',
      weight: 1,
      signal: technicalEval.signal,
      reason: technicalEval.reason
    }),
    makeStrategy({
      id: 'intermarket',
      name: 'Intermarket-Analyse',
      group: 'Marktausblick',
      weight: 1,
      signal: intermarketEval.signal,
      reason: intermarketEval.reason
    }),
    makeStrategy({
      id: 'sentiment_outlook',
      name: 'Sentiment',
      group: 'Marktausblick',
      weight: 1,
      signal: sentimentEval.signal,
      reason: sentimentEval.reason
    }),
    makeStrategy({
      id: 'seasonality',
      name: 'Saisonalität',
      group: 'Marktausblick',
      weight: 1,
      signal: seasonalityEval.signal,
      reason: seasonalityEval.reason
    })
  ];

  const morningBreakout = evaluateMorningBreakout(intraday?.bars);

  const timing = [
    makeStrategy({
      id: 'morning_breakout',
      name: 'Morning-Break-Out',
      group: 'Timing',
      weight: 2,
      signal: morningBreakout.signal,
      reason: morningBreakout.reason
    }),
    makeStrategy({
      id: 'sentiment_timing',
      name: 'Sentiment',
      group: 'Timing',
      weight: 2,
      signal: 'neutral',
      reason: 'manuelle kurzfristige Bewertung'
    })
  ];

  const allStrategies = [...investment, ...marketOutlook, ...trading, ...timing];
  const investmentScore = investment.reduce((sum, item) => sum + item.points, 0);
  const marketOutlookScore = marketOutlook.reduce((sum, item) => sum + item.points, 0);
  const tradingScore = trading.reduce((sum, item) => sum + item.points, 0);
  const timingScore = timing.reduce((sum, item) => sum + item.points, 0);
  const totalScore = investmentScore + marketOutlookScore + tradingScore + timingScore;

  return {
    date: dateState,
    market: normalizedMarket,
    investment,
    marketOutlook,
    trading,
    timing,
    activeDrivers: allStrategies.filter((strategy) => strategy.signal !== 'neutral'),
    summary: {
      investmentScore,
      marketOutlookScore,
      tradingScore,
      timingScore,
      totalScore,
      decision: decisionFromScore(totalScore),
      positiveCount: countSignals(allStrategies, 'positive'),
      negativeCount: countSignals(allStrategies, 'negative'),
      neutralCount: countSignals(allStrategies, 'neutral')
    }
  };
}
