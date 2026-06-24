# DAX Live Scorecard Dashboard

Lokales Web-Dashboard für eine tägliche DAX-Handelsentscheidung auf Basis der Scorecard-Logik aus der Portfoliomanager-Ausbildung von André Stagge, CFTe, CFA. Die Web-App ist das Pendant zum Excel-Prototyp (`Scorecard.xlsx`) und kombiniert **20 Strategien** aus 4 Gruppen zu einem gewichteten Gesamtscore.

## Ziel

Der Nutzer soll morgens oder vor einer Handelsentscheidung schnell sehen:

- welcher DAX-Kurs für die Bewertung verwendet wird,
- ob Live-/verzögerte Daten verfügbar sind oder ein Fallback genutzt wird,
- welche Investment-, Marktausblick-, Trading- und Timing-Strategien positiv, negativ oder neutral sind,
- welcher Gesamtscore daraus entsteht,
- ob daraus Long bevorzugen, Short bevorzugen oder Abwarten folgt.

---

## Architektur

```text
DAX-Live-Scorecard-Dashboard/
├── package.json              # Zero-dependency, nur Node-Stdlib
├── public/
│   ├── index.html            # Dashboard-Layout (Topbar → Hero-Grid → Strategy-Duo → Trading → Treiber)
│   ├── styles.css            # Layout, Ampel-Farben, Responsive (3 Breakpoints)
│   └── app.js                # Vanilla-JS-Rendering, API-Aufruf, Score-Farbcodierung
├── src/
│   ├── server.js             # HTTP-Server, /api/dashboard, statische Files, 7 Provider parallel
│   ├── marketData.js         # 7 Daten-Provider mit Caching (Yahoo, CSV, Fear&Greed API)
│   └── scorecard.js          # Kalenderlogik, 20 Strategien, 6 Evaluatoren, Score-Aggregation
└── tests/
    ├── marketData.test.js    # 8 Tests (Provider-Fallback, Datumsspezifik, CSV)
    ├── scorecard.test.js     # 2 Tests (Screenshot-Zustand, Wochenend-Handling)
    └── ui.test.js            # 1 Test (keine Override-Selects)
```

### Datenfluss

```
Browser (public/)
  │  fetch /api/dashboard?date=YYYY-MM-DD
  ▼
server.js
  │  parseOverrides()        → {} (alle Strategien automatisiert)
  │  Promise.all:
  │    ├── getDaxMarketData({ date })       → marketData.js (Yahoo 1y, CSV, Screenshot)
  │    ├── getDaxIntradayData({ date })     → marketData.js (Yahoo 5m, aktueller Handelstag)
  │    ├── getDaxSeasonality()              → marketData.js (Yahoo 20y, 24h-Cache)
  │    ├── getIntermarketIndicators()       → marketData.js (5 Yahoo-Ticker, 15min-Cache)
  │    ├── getTechnicalIndicators()         → marketData.js (DAX OHLC 1y, 15min-Cache)
  │    └── getFundamentalIndicators()       → marketData.js (7 Yahoo-Ticker, 1h-Cache)
  │  getSentimentIndicators({ market })     → marketData.js (VIX, DAX 3mo, F&G API, 15min-Cache)
  │  evaluateDashboard({ date, market, overrides, intraday, seasonality, intermarket, sentiment, technical, fundamental })
  ▼
JSON → app.js → DOM-Rendering
```

Der Browser ruft nur den lokalen Server auf. Dadurch bleiben API-Calls serverseitig — kein API-Key im Browser-Code.

---

## Start

```bash
cd DAX-Live-Scorecard-Dashboard
npm start          # → http://localhost:4173
PORT=4180 npm start  # alternativer Port
npm test           # → 11 Tests
```

**Voraussetzung:** Node.js ≥ 20. Keine npm-Abhängigkeiten — nur Node-Stdlib (`http`, `fs/promises`, `Intl`).

---

## Strategie-Gruppen und Gewichtung

| Gruppe | Gewicht | Strategien | Steuerung |
|---|---|---|---|
| **Investment** | ×1 | Gerade/Ungerade, 5 Tage, YTD, 200-Tage-Linie, Halloween-Effekt, Quartalstrick | Automatisch (Datum + Marktdaten) |
| **Marktausblick** | ×1 | Fundamental-Analyse, Technische-Analyse, Intermarket-Analyse, Sentiment, Saisonalität | **Alle 5 automatisiert** |
| **Trading** | ×2 | Monats Ultimo, Turnaround Tuesday, Heisse Hexen, Vor der FED Long, US-Feiertag, Sommerloch Short, Wahlgeschenk | Automatisch (Datum + Marktdaten) |
| **Timing** | ×2 | Morning-Break-Out, Sentiment (Timing) | Morning-Break-Out automatisch (Intraday), Sentiment manuell |

### Signal-Punkte

| Signal | Farbe | Punkte (pro Gewicht) |
|---|---|---|
| Positiv | Grün | +Gewicht |
| Negativ | Rot | −Gewicht |
| Neutral | Grau | 0 |

### Entscheidungslogik

| Score-Bereich | Entscheidung |
|---|---|
| `>= +5` | Bullish / Long |
| `>= +1` | Leicht positiv / Long bevorzugt |
| `<= -5` | Bearish / Short |
| `<= -1` | Leicht negativ / Short bevorzugt |
| sonst | Neutral / Abwarten |

---

## Investment-Strategien (×1, automatisch)

Alle 6 Investment-Strategien nutzen ausschließlich Kalenderlogik und/oder DAX-Tagescloses.

### 1. Gerade/Ungerade

| Eigenschaft | Wert |
|---|---|
| ID | `even_odd` |
| Logik | `year % 2 === 0 → negative` |
| Begründung | Historisch performt der DAX in ungeraden Jahren besser. Gerade Jahre sind defensiv (Cash/Anleihen). |
| Quelle | "Gerade in Ungnade" — André Stagge |

### 2. 5 Tage bestimmen das Börsenjahr

| Eigenschaft | Wert |
|---|---|
| ID | `five_days` |
| Logik | `firstFiveDaysPositive ? positive : neutral` |
| Begründung | Die ersten 5 Handelstage des Jahres gelten als directionaler Indikator für das restliche Jahr ("As goes January, so goes the year"). |
| Hinweis | Im Screenshot-Fallback hartkodiert `true`. Bei Yahoo/CSV aus Historie berechenbar (noch nicht implementiert — `firstFiveDaysPositive` wird aus `market`-Objekt gelesen, Default `true`). |
| Quelle | "5 Tage bestimmen das Börsenjahr" — André Stagge |

### 3. YTD (Year-to-Date)

| Eigenschaft | Wert |
|---|---|
| ID | `ytd` |
| Logik | `close > previousYearClose → positive; close < previousYearClose → negative` |
| Daten | `market.close` (aktueller Schlusskurs), `market.previousYearClose` (Vorjahresschluss) |
| Fallback | `DAX_2025_CLOSE = 24422,49` wenn Yahoo nur 1J-Historie liefert |
| Quelle | "YTD-Effekt" — André Stagge |

### 4. 200-Tage-Linie (SMA200)

| Eigenschaft | Wert |
|---|---|
| ID | `sma200` |
| Logik | `close > sma200 → positive; close < sma200 → negative` |
| Berechnung | `SMA200 = Durchschnitt der letzten 200 Tages-Closes` |
| Daten | `market.close`, `market.sma200` — berechnet aus Yahoo 1J-Historie oder CSV |
| Quelle | "200-Tage-Linie" — André Stagge |

### 5. Halloween-Effekt

| Eigenschaft | Wert |
|---|---|
| ID | `halloween` |
| Logik | `month ∈ {11, 12, 1, 2, 3, 4} → positive; month ∈ {5, 6, 7, 8, 9, 10} → negative` |
| Begründung | "Sell in May and go away" — historisch performt der DAX von November bis April besser als von Mai bis Oktober. |
| Quelle | "Halloween-Effekt" — André Stagge, akademisch validiert durch Jacobsen/Bouman (2002) für 36 Märkte inkl. Deutschland |

### 6. Quartalstrick

| Eigenschaft | Wert |
|---|---|
| ID | `quarter_trick` |
| Logik | `month ∈ {1, 4, 7, 10} → positive; sonst → neutral` |
| Begründung | Erster Monat jedes Quartals hat historisch positive Renditen (Quartals-Rebalancing, Window Dressing zu Quartalsbeginn). |
| Quelle | "Quartals-Trick" — André Stagge |

---

## Marktausblick-Strategien (×1, alle automatisiert)

Alle 5 Marktausblick-Strategien sind **vollautomatisch** — keine manuellen Overrides mehr.

### 1. Fundamental-Analyse — 5-Factor Macro Composite

| Eigenschaft | Wert |
|---|---|
| ID | `fundamental` |
| Methode | Multi-Factor Macro Composite (strukturell, nicht taktisch) |
| Daten | 7 Yahoo-Ticker parallel, 1h-Cache |
| Quelle | Yahoo Chart API (`^TNX`, `^IRX`, `HYG`, `LQD`, `TLT`, `^GSPC`, `^GDAXI`) |

#### Indikatoren

| # | Indikator | Formel | Risk-On (+1) | Risk-Off (−1) | Neutral (0) |
|---|---|---|---|---|---|
| 1 | **Zinsstrukturkurve** | `Yield(10yr) − Yield(13w)` via `^TNX − ^IRX` | > 0 (normal) | < −0,2% (invertiert) | −0,2% bis 0 |
| 2 | **Kreditbedingungen** | `Return(20d, HYG) − Return(20d, LQD)` | > 0 (gesund) | < −0,5% (Stress) | −0,5% bis 0 |
| 3 | **Geldpolitik** | `Yield(10yr)` Level (`^TNX`) | < 3,0% (akkommodierend) | > 5,0% (restriktiv) | 3,0–5,0% |
| 4 | **Aktien/Anleihen-Rotation** | `Return(60d, S&P 500) − Return(60d, TLT)` | > +5% (Growth) | < −5% (Safety) | ±5% |
| 5 | **Bewertung** | `(Close − High52w) / High52w × 100` via DAX 1J-Historie | < −15% (unterbewertet) | > −5% (überbewertet) | −15% bis −5% |

#### Signal

- Composite ≥ +3 → **positiv** (makro-stützend)
- Composite ≤ −3 → **negativ** (makro-Risiko)
- sonst → **neutral**

#### Begründung der Indikatorenauswahl

- **Zinsstrukturkurve**: Der stärkste makro-Fundamental-Indikator. Eine invertierte Curve (10yr < 13w) signalisiert Rezession — historisch zuverlässig mit 6–18 Monaten Vorlauf.
- **Kreditbedingungen**: Kreditmärkte sind der sensibelste Frühindikator für Makro-Stress. High Yield vs. Investment Grade isoliert die Credit-Spread-Veränderung.
- **Geldpolitik**: Das absolute Zinsniveau bestimmt die Liquiditätsversorgung der Märkte. < 3% = akkommodierend, > 5% = restriktiv.
- **Aktien/Anleihen-Rotation**: 60-Tage-Vergleich misst strukturellen Risikoappetit. Aktien outperformen Anleihen = Growth-Environment.
- **Bewertung**: Distanz vom 52-Wochen-Hoch als pragmatischer Valuations-Proxy. > 15% unter Hoch = potenziell unterbewertet.

### 2. Technische-Analyse — 4-Factor Trend Composite

| Eigenschaft | Wert |
|---|---|
| ID | `technical` |
| Methode | Multi-Factor Trend/Momentum Composite (trend-followend) |
| Daten | Yahoo DAX OHLC `range=1y` (High, Low, Close), 15min-Cache |
| Abgrenzung | Orthogonal zu Investment (nutzt SMA50/SMA200-Cross statt close/SMA200) und Sentiment (nutzt Momentum trend-followend statt contrarian) |

#### Indikatoren

| # | Indikator | Formel | Bullish (+1) | Bearish (−1) | Neutral (0) |
|---|---|---|---|---|---|
| 1 | **MACD (12,26,9)** | `EMA(12) − EMA(26)`, Signal = `EMA(9, MACD)` | MACD > Signal | MACD < Signal | — (binary) |
| 2 | **SMA50 vs SMA200** | `SMA(Close, 50)` vs `SMA(Close, 200)` | SMA50 > SMA200 (Golden Cross) | SMA50 < SMA200 (Death Cross) | — (binary) |
| 3 | **ROC(20)** | `(Close_today − Close_{-20}) / Close_{-20} × 100` | > +2% | < −2% | ±2% |
| 4 | **ATR(14) Volatility** | `ATR(14) aktuell vs ATR(14) vor 20 Tagen + Close vs SMA50` | ATR expanding + Close > SMA50 | ATR expanding + Close < SMA50 | ATR kontrahiert |

#### ATR-Berechnung im Detail

```
TR(t) = max(
  High(t) − Low(t),
  |High(t) − Close(t-1)|,
  |Low(t) − Close(t-1)|
)

ATR(14) = SMA(TR, 14)

Expanding = ATR_aktuell > ATR_vor_20_Tagen
Trend = Close vs SMA50

→ Expanding + Close > SMA50 → +1 (Vola-Expansion bestätigt Aufwärtstrend)
→ Expanding + Close < SMA50 → −1 (Vola-Expansion bestätigt Abwärtstrend)
→ Kontrahiert → 0 (keine Trend-Bestätigung)
```

#### Signal

- Composite ≥ +3 → **positiv** (Trend-Bestätigung)
- Composite ≤ −3 → **negativ** (Trend-Warnung)
- sonst → **neutral**

### 3. Intermarket-Analyse — 5-Ticker Risk-On/Risk-Off

| Eigenschaft | Wert |
|---|---|
| ID | `intermarket` |
| Methode | Multi-Factor Cross-Asset Composite (ko-trend, tagesaktuell) |
| Daten | 5 Yahoo-Ticker parallel (`range=5d`), 15min-Cache |

#### Indikatoren

| # | Indikator | Yahoo-Ticker | Messgröße | Risk-On (+1) | Risk-Off (−1) | Neutral (0) |
|---|---|---|---|---|---|---|
| 1 | EUR/USD | `EURUSD=X` | 5d-Return | < −0,3% (schwacher EUR = Exportvorteil) | > +0,3% (starker EUR = Exportbelastung) | ±0,3% |
| 2 | US 10yr Yield | `^TNX` | 5d-Δ in bp | > +5 bp (rising yields = Risk-On) | < −5 bp (falling yields = Safety) | ±5 bp |
| 3 | VIX | `^VIX` | Absolutes Level | < 18 (niedrige Vola) | > 25 (hohe Vola) | 18–25 |
| 4 | S&P 500 | `^GSPC` | 5d-Return | > +1,0% | < −1,0% | ±1,0% |
| 5 | Gold | `GC=F` | 5d-Return | < −0,5% (fallendes Gold = Risk-On) | > +0,5% (steigendes Gold = Safety) | ±0,5% |

#### Signal

- Composite ≥ +3 → **positiv** (Risk-On)
- Composite ≤ −3 → **negativ** (Risk-Off)
- sonst → **neutral**

#### Begründung

Der DAX steht nicht isoliert — er wird durch Kreuzasset-Flows getrieben. Ein schwacher Euro begünstigt DAX-Exporteure (Siemens, SAP, BMW, VW). Rising yields signalisieren Growth-Erwartungen. Niedriger VIX = Complacency/Risk-On. S&P 500 korreliert ~0,7 mit DAX. Fallendes Gold = keine Safe-Haven-Nachfrage.

### 4. Sentiment — 5-Factor Contrarian Composite

| Eigenschaft | Wert |
|---|---|
| ID | `sentiment_outlook` |
| Methode | Multi-Factor Contrarian Composite (Extreme Fear = Kaufsignal) |
| Daten | VIX (`^VIX`), DAX Closes (`^GDAXI` 3mo), Fear & Greed Index (`api.alternative.me`), SMA200 aus `market`-Objekt. 15min-Cache. |
| Abgrenzung | Orthogonal zu Intermarket: Intermarket nutzt VIX trend-followend (< 18 = Risk-On). Sentiment nutzt VIX contrarian (> 30 = Extreme Fear = Kaufsignal). Unterschiedliche Thresholds, keine Überlappung. |

#### Indikatoren

| # | Indikator | Quelle | Contrarian-Kaufsignal (+1) | Contrarian-Vorsicht (−1) | Neutral (0) |
|---|---|---|---|---|---|
| 1 | **VIX Level** | `^VIX` | > 30 (Extreme Fear / Panik) | < 13 (Extreme Complacency) | 13–30 |
| 2 | **RSI(14)** | DAX Tagescloses (3mo) | < 30 (Oversold) | > 70 (Overbought) | 30–70 |
| 3 | **Distanz SMA200** | `market.close`, `market.sma200` | < −8% (stark unterverkauft) | > +8% (stark überkauft) | ±8% |
| 4 | **Bollinger %B** | DAX Tagescloses (3mo), SMA(20) ± 2σ | < 0 (unter unterem Band) | > 1 (über oberem Band) | 0–1 |
| 5 | **Fear & Greed Index** | `api.alternative.me/fng/` | ≤ 25 (Extreme Fear) | ≥ 75 (Extreme Greed) | 26–74 |

#### RSI(14) — Berechnung

```
RSI = 100 − 100 / (1 + RS)
RS = Ø Gain(14) / Ø Loss(14)

Wilder's Smoothing:
  avgGain(t) = (avgGain(t-1) × 13 + gain(t)) / 14
  avgLoss(t) = (avgLoss(t-1) × 13 + loss(t)) / 14
```

#### Bollinger %B — Berechnung

```
SMA(20) = Durchschnitt der letzten 20 Closes
σ(20)   = Standardabweichung der letzten 20 Closes
Upper   = SMA(20) + 2 × σ(20)
Lower   = SMA(20) − 2 × σ(20)
%B      = (Close − Lower) / (Upper − Lower)
```

#### Fear & Greed Index

- **Quelle**: `https://api.alternative.me/fng/?limit=1` (Crypto Fear & Greed Index)
- **Skala**: 0–100 (0 = Extreme Fear, 100 = Extreme Greed)
- **Warum Crypto F&G**: CNN Fear & Greed Index blockt API-Zugriffe (HTTP 418). `api.alternative.me` ist gratis, stabil, kein API-Key. Crypto-Sentiment korreliert stark mit globalem Risk-Sentiment.
- **Warum Contrarian**: Extreme Fear (≤ 25) = überverkauft → Kaufsignal. Extreme Greed (≥ 75) = überkauft → Vorsicht.

#### Signal

- Composite ≥ +3 → **positiv** (Contrarian-Kaufsignal)
- Composite ≤ −3 → **negativ** (Contrarian-Vorsicht)
- sonst → **neutral**

### 5. Saisonalität — 20-Jahres-Historie

| Eigenschaft | Wert |
|---|---|
| ID | `seasonality` |
| Methode | Win-Rate + mittlere Monatsrendite aus 20 Jahren Historie |
| Daten | Yahoo DAX `range=20y` (~5000 Tages-Closes), 24h-Cache |
| Algorithmus | Monat-über-Monat Renditen → Gruppierung nach Kalendermonat (1–12) |

#### Berechnung

```
1. Letzten Close pro Jahr-Monat erfassen
2. Monat-über-Monat Rendite berechnen:
   R(m, y) = (Close(m, y) / Close(m-1, y) − 1) × 100
3. Pro Kalendermonat (1–12):
   Win-Rate = #(R > 0) / #R
   Mean     = Ø(R)
   Median   = Median(R)
```

#### Signal-Thresholds (Diskordanz-Regel)

| Bedingung | Signal |
|---|---|
| Win-Rate ≥ 65% **UND** Mean > +0,8% | **positiv** |
| Win-Rate ≤ 35% **UND** Mean < −0,8% | **negativ** |
| sonst (Diskordanz oder neutraler Bereich) | **neutral** |

Beide Kriterien müssen übereinstimmen — das verhindert Fehlsignale bei widersprüchlicher Win-Rate/Return-Konstellation.

#### Empirische DAX-Monats-Saisonalitäten (2005–2024, Richtwerte)

| Monat | Tendenz | Win-Rate | Bemerkung |
|---|---|---|---|
| April | ➚ stark positiv | ~75% | Bester Saison-Monat |
| Dezember | ➚ stark positiv | ~70% | Weihnachtsrallye |
| November | ➚ positiv | ~65% | Halloween-Effekt beginnt |
| September | ➘ stark negativ | ~35% | Schlechtester Monat |
| Juni | ➘ negativ | ~40% | Sommerloch startet |

---

## Trading-Strategien (×2, automatisch)

Alle 7 Trading-Strategien nutzen Kalenderlogik und/oder DAX-Marktdaten. Gewicht ×2 → doppelter Einfluss auf Gesamtscore.

### 1. Monats Ultimo

| Eigenschaft | Wert |
|---|---|
| ID | `ultimo` |
| Logik | `day >= 26 || day <= 5 → positive; sonst → neutral` |
| Begründung | Monatsultimo-Fenster: institutionelle Rebalancing-Aktivität, Window Dressing, Index-Extensions treiben Kurse. |
| Quelle | "Monatsultimo-Effekt" — André Stagge, akademisch validiert durch Cadsby/Ratner (1992) |

### 2. Turnaround Tuesday

| Eigenschaft | Wert |
|---|---|
| ID | `tt` |
| Logik | `weekday ∈ {Mo, Di} UND close < sma34 → positive; sonst → neutral` |
| Filter | SMA34-Filter: nur aktiv, wenn DAX unter SMA34 liegt (kaufswertiger Zustand) |
| Begründung | Montags und dienstags tendiert der DAX zur Erholung nach negativen Wochenenden. Der SMA34-Filter verhindert Käufe in intakten Aufwärtstrends. |
| Quelle | "Turnaround Tuesday" — André Stagge |

### 3. Heisse Hexen

| Eigenschaft | Wert |
|---|---|
| ID | `hexen` |
| Logik | `HEXEN_DATES_2026.has(date) → positive; sonst → neutral` |
| Daten | Hartkodierte `Set` von Mo–Do vor großen Verfallstagen (Quartals- und Monatsverfall) |
| Begründung | Vor großen Verfallstagen (Triple Witching) kommt es zu erhöhter Volatilität und institutioneller Positionierung. |
| Quelle | "Heiße Hexen" — André Stagge |

### 4. Vor der FED Long

| Eigenschaft | Wert |
|---|---|
| ID | `pre_fed_long` |
| Logik | `FOMC_PRE_DATES_2026.has(date) → positive; sonst → neutral` |
| Daten | Hartkodierte `Set` von FOMC-Terminen 2026 (jeweils 1 Handelstag vor der Zinsentscheidung) |
| Begründung | Vor FOMC-Meetings herrscht die "Blackout Period" — FOMC-Mitglieder sprechen nicht, Spekulation treibt Kurse. Historisch steigt der DAX am Tag vor FOMC. |
| Quelle | "Vor der FED Long" — André Stagge |

### 5. US-Feiertag

| Eigenschaft | Wert |
|---|---|
| ID | `us_holiday` |
| Logik | Immer `neutral` — dient nur als Liquiditätshinweis |
| Begründung | An US-Feiertagen ist die US-Liquidität reduziert, was zu ungewöhnlichen DAX-Bewegungen führen kann. Kein direktionales Signal. |
| Daten | `US_HOLIDAYS_2026` (hartkodierte `Set`) |

### 6. Sommerloch Short

| Eigenschaft | Wert |
|---|---|
| ID | `summer_short` |
| Logik | `month ∈ {5, 6, 7, 8, 9} UND day ∈ {20, 21, 22, 23, 24} → negative; sonst → neutral` |
| Begründung | Im Sommerloch (20.–24. jedes Monats Mai–September) tendiert der DAX zu Schwäche. Geringeres Volumen, institutionelle Abwesenheit. |
| Quelle | "Sommerloch Short — monatlich Sommer" — André Stagge |

### 7. Wahlgeschenk

| Eigenschaft | Wert |
|---|---|
| ID | `election_gift` |
| Logik | 2026: inaktiv → immer `neutral` |
| Begründung | Historisch steigt der DAX in Wahljahren. 2026 ist kein Bundestagswahljahr → Strategie inaktiv. |
| Quelle | "Wahlgeschenk" — André Stagge |

---

## Timing-Strategien (×2)

### 1. Morning-Break-Out (automatisch)

| Eigenschaft | Wert |
|---|---|
| ID | `morning_breakout` |
| Methode | Intraday-Ausbruch aus der 9–10 Uhr CET-Range |
| Daten | Yahoo 5-Minuten-Bars (`range=1d&interval=5m`), 15 Min verzögert |
| Verfügbarkeit | Nur aktueller Handelstag (Yahoo liefert keine historischen Intraday-Daten) |

#### Strategie-Logik

```
1. Range = High/Low aller 5-Min-Bars im Zeitfenster 9:00–10:00 CET
2. Nach 10:00 CET: Ausbruch prüfen
   → High > RangeHigh → Long (positive)
   → Low  < RangeLow  → Short (negative)
3. Bei beiden Ausbrüchen: erster Ausbruch gewinnt (Timestamp-Vergleich)
4. Kein Ausbruch → neutral
```

#### Signal-Zustände

| Zustand | Signal | Reason-Text |
|---|---|---|
| Wochenende/Feiertag | neutral | `keine Intraday-Daten (nur aktueller Handelstag)` |
| Vor 10:00 CET | neutral | `Range 9–10 Uhr noch nicht vollständig` |
| Nach 10:00, kein Ausbruch | neutral | `Range X–Y, wartet auf Ausbruch` |
| Ausbruch nach oben | **positiv** | `Ausbruch über X (Long)` |
| Ausbruch nach unten | **negativ** | `Ausbruch unter Y (Short)` |
| Beide Richtungen | je nach erstem Ausbruch | `zuerst Long-/Short-Ausbruch über/unter X` |
| Kein Ausbruch bis Session-Ende | neutral | `kein Ausbruch aus Range X–Y` |

#### Zeitraum-Konvertierung

Yahoo-Timestamps sind UTC. Die Zeitfilterung nutzt `Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'` für korrekte CET/CEST-Konvertierung.

#### Begründung

Die erste Bewegung am Morgen (9–10 Uhr) wird durch institutionelle Morning Meetings getrieben. Banken, Versicherungen und Fondsgesellschaften halten ihre Morning Meetings ab, besprechen Strategie und erteilen Orders. Der Ausbruch aus der 9–10 Uhr-Range gibt die Richtung des "großen Geldes" vor.

**Quelle**: "Morning Break Out" — André Stagge, CFTe, CFA

### 2. Sentiment (Timing) — manuell

| Eigenschaft | Wert |
|---|---|
| ID | `sentiment_timing` |
| Status | Manuell — immer `neutral` |
| Begründung | Kurzfristiges Intraday-Sentiment ist bewusst subjektiv und nicht algorithmisch abbildbar. Strategie existiert als Platzhalter für manuelle Bewertung. |

---

## Marktdaten-Provider

### Provider-Kette (Tagesdaten)

Die Provider-Kette versucht mehrere freie (API-key-freie) Datenquellen in Folge. Sobald eine Quelle gültige DAX-Daten liefert, wird sie verwendet.

| # | Provider | Endpoint | Verzögerung | Bemerkung |
|---|---|---|---|---|
| 1 | **Yahoo query1** | `query1.finance.yahoo.com/v8/finance/chart/^GDAXI?range=1y&interval=1d` | 15 Min | Primär |
| 2 | **Yahoo query2** | `query2.finance.yahoo.com/v8/finance/chart/^GDAXI?range=1y&interval=1d` | 15 Min | Sekundär-Server |
| 3 | **Lokale CSV** | `Input/dax-history.csv` | EOD | Broker-Export / Stooq-Browser-Download |
| 4 | **Screenshot** | hartkodiert | — | Automatischer Fallback |

### Screenshot-Fallback

Wenn alle Provider fehlschlagen:

| Feld | Wert |
|---|---|
| Close | 25.166 |
| DAX-Schlusskurs 2025 / YTD-Basis | 24.422,49 |
| SMA200 | 24.208,79 |
| SMA34 | 24.989,25 |
| 5 Tage | positiv |

### Datumsspezifische Berechnung

Bei Datumswechsel im Dashboard:

1. `selectMarketPointForDate({ targetDate, rows })` findet den Close zum gewählten Datum (oder letzten Handelstag davor bei Wochenende/Feiertag).
2. Historie wird bis zu diesem Datum gesliced (`rows.slice(0, sliceIdx + 1)`).
3. `SMA200` = Durchschnitt der letzten 200 Closes im Slice.
4. `SMA34` = Durchschnitt der letzten 34 Closes im Slice.
5. `previousYearClose` = letzter Close des Vorjahres im Slice (oder `DAX_2025_CLOSE` als Fallback).
6. Bei Wochenende/Feiertag: Warning in der Statuszeile.

### Lokale CSV-Datei

Format (Stooq-kompatibel):

```csv
Date,Open,High,Low,Close,Volume
2025-01-02,24200.00,24400.00,24150.00,24350.00,0
2025-01-03,24350.00,24500.00,24300.00,24422.49,0
```

Auch ein reduziertes Format mit nur `Date,Close` wird akzeptiert. Mindestens 200 Zeilen (Handelstage) erforderlich für SMA200.

**Bezugsquellen:**

- Interactive Brokers: Historische Daten → DAX → CSV-Export
- Stooq: Browser-Download `https://stooq.com/q/d/l/?s=^dax&i=d`
- TradingView: DAX → Export

### Intraday-Provider (Morning-Break-Out)

| Provider | Endpoint | Verzögerung |
|---|---|---|
| Yahoo query1 | `query1.finance.yahoo.com/v8/finance/chart/^GDAXI?range=1d&interval=5m` | 15 Min |
| Yahoo query2 | `query2.finance.yahoo.com/v8/finance/chart/^GDAXI?range=1d&interval=5m` | 15 Min |

Historische Intraday-Daten sind bei Yahoo nicht verfügbar. Bei Datumsauswahl für vergangene Tage → `neutral`.

### Caching-Strategie

| Provider | Cache-TTL | Begründung |
|---|---|---|
| `getDaxMarketData` | Kein Cache | Datumsspezifisch — jedes Datum braucht eigene Berechnung |
| `getDaxIntradayData` | Kein Cache | Intraday ändert sich sekündlich |
| `getDaxSeasonality` | 24 Stunden | Ändert sich nur 1× jährlich beim Jahreswechsel |
| `getIntermarketIndicators` | 15 Minuten | Intraday-relevant, aber nicht sekündlich |
| `getSentimentIndicators` | 15 Minuten | Intraday-relevant |
| `getTechnicalIndicators` | 15 Minuten | Daily-Daten, intraday-relevant |
| `getFundamentalIndicators` | 1 Stunde | Makro-Daten ändern sich langsamster |

### Externe APIs

| API | Endpoint | Verwendung | Auth |
|---|---|---|---|
| Yahoo Chart API | `query{1,2}.finance.yahoo.com/v8/finance/chart/` | DAX, VIX, EURUSD, S&P 500, Gold, UST10Y, UST13w, HYG, LQD, TLT | Keine (User-Agent-Header) |
| Fear & Greed Index | `api.alternative.me/fng/?limit=1` | Sentiment-Indikator #5 | Keine |

---

## API-Endpunkte

### `GET /api/dashboard`

**Parameter:**

| Parameter | Typ | Default | Beschreibung |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | Heute | Bewertungsdatum |

**Response:** JSON mit allen Strategien, Scores und Treibern.

### `GET /api/health`

Health-Check. Response: `{ "ok": true }`.

---

## Frontend

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ Topbar: DAX Live Scorecard · Date Input · Aktualisieren          │
├──────────────────┬──────────────────────────┬────────────────────┤
│ Marktdaten       │ Tagesentscheidung         │ Score-Verteilung   │
│ DAX · Schlusskurs│ Entscheidung · Score      │ 4 Gruppen + Counts │
├──────────────────┴──────────────────────────┴────────────────────┤
│ Investment-Strategien (3×2)    │ Marktausblick (3+2)              │
│ Timing (2 Karten gestapelt)    │ (streckt sich auf volle Höhe)    │
├────────────────────────────────┴─────────────────────────────────┤
│ Trading-Strategien (4+3)                                         │
├──────────────────────────────────────────────────────────────────┤
│ Aktive Scorecard-Treiber (Tabelle, 240px max-height)             │
└──────────────────────────────────────────────────────────────────┘
```

### Responsiveness

| Breakpoint | Änderung |
|---|---|
| ≤ 1200px | Strategy-Duo → 1 Spalte; Timing → 2 Spalten |
| ≤ 900px | Hero-Grid → 1 Spalte; alle Strategy-Grids → 2 Spalten |
| ≤ 680px | Topbar → vertikal; alle Grids → 1 Spalte |

### Score-Farbcodierung

| Score-Wert | CSS-Klasse | Farbe |
|---|---|---|
| > 0 | `score-pos` | Grün |
| < 0 | `score-neg` | Rot |
| = 0 | `score-neu` | Grau |

Angewendet auf: Score-Verteilung-Werte (Investment, Marktausblick, Trading, Timing) und Treiber-Tabelle Punkte-Spalte.

---

## Kalender (2026)

Alle kalenderbasierten Strategien nutzen hartkodierte `Set`s für 2026:

| Set | Inhalt | Verwendung |
|---|---|---|
| `DAX_HOLIDAYS_2026` | 7 deutsche Feiertage | `isTradingDay()` — bestimmt Handels- vs. Ruhetag |
| `FOMC_PRE_DATES_2026` | 8 FOMC-Termine | "Vor der FED Long"-Strategie |
| `HEXEN_DATES_2026` | 16 Hexen-Tage (Mo–Do vor Verfall) | "Heisse Hexen"-Strategie |
| `US_HOLIDAYS_2026` | 10 US-Feiertage | "US-Feiertag"-Strategie (Liquiditätshinweis) |

**2027+ nicht abgedeckt** — Kalender-Generator als offene Ausbaustufe.

---

## Bekannte Grenzen

| Grenze | Beschreibung | Mitigation |
|---|---|---|
| **Yahoo-Abhängigkeit** | Alle Live-Provider nutzen Yahoo-Server. Bei globalem Yahoo-Ausfall bleibt nur CSV/Screenshot. | Lokale CSV als Backstop, Screenshot als letzter Fallback |
| **`previousYearClose` bei Yahoo** | Yahoo liefert nur 1J-Historie — Vorjahresschluss kann nicht dynamisch extrahiert werden. | Fallback auf `DAX_2025_CLOSE` (24.422,49). CSV berechnet korrekt. |
| **Intraday nur aktuell** | Yahoo `range=1d` liefert keine historischen Intraday-Daten. | Morning-Break-Out bei historischen Daten → neutral. |
| **5-Tage-Status statisch** | `firstFiveDaysPositive` im Fallback hartkodiert `true`. | Bei Yahoo/CSV aus Historie berechenbar (Default `true`). |
| **Kalender nur 2026** | Feiertage, FOMC, Hexen als `Set` hartkodiert. | Kalender-Generator für 2027+ als Ausbaustufe. |
| **Kein Stooq-Download** | Stooq.com hat JavaScript-PoW-Gatekeeper + Bot-Erkennung. | Manueller Browser-Download funktioniert. |
| **CNN F&G nicht verfügbar** | CNN API blockt (HTTP 418/500). | Ersatz durch `api.alternative.me` (Crypto F&G). |
| **US-Zentrik** | Yield Curve, Credit Spreads sind US-Märkte. | US-Märkte sind globaler Benchmark; DAX korreliert ~0,7 mit S&P. |
| **Keine Anlageberatung** | Dashboard ist ein Entscheidungs-Tool, keine Anlageberatung. | — |

---

## Automatisierungsgrad

| Gruppe | Strategien | Automatisiert | Manuell |
|---|---|---|---|
| **Investment** | 6 | 6 | 0 |
| **Marktausblick** | 5 | 5 | 0 |
| **Trading** | 7 | 7 | 0 |
| **Timing** | 2 | 1 (Morning-Break-Out) | 1 (Sentiment) |
| **Gesamt** | 20 | 19 | 1 |

**19 von 20 Strategien sind vollautomatisch.** Einzig verbleibende manuelle Komponente: Timing-Sentiment (bewusst kurzfristig/Intraday, nicht algorithmisch abbildbar).

---

## Verwandte Dateien (Scorecard-Workspace)

| Datei | Beschreibung |
|---|---|
| `Scorecard.xlsx` | Excel-Prototyp, von dem die Web-App abstammt |
| `Input/Strategie/*.md` | 16 Markdown-Beschreibungen der einzelnen Strategien (André Stagge) |
| `Input/dax-history.csv` | Vorlage für lokale CSV-Datei |
| `Input/Screenshot/` | Screenshot-Snapshots des Excel-Prototyps |
| `Tagesstand_20.06.2026.md` | Änderungsprotokoll der Session vom 20.06.2026 |

---

## Quellen und Referenzen

### Strategie-Quellen

Alle Kalender- und Saisonalitäts-Strategien stammen aus der Portfoliomanager-Ausbildung von **André Stagge, CFTe, CFA**. Die Strategie-Beschreibungen liegen unter `Input/Strategie/*.md`.

### Akademische Referenzen

| Quelle | Thema | Relevanz |
|---|---|---|
| Jacobsen / Bouman (2002) — "The Halloween Indicator" | Oktober–April vs. Mai–September | Halloween-Effekt, akademisch validiert für 36 Märkte inkl. Deutschland |
| Cadsby / Ratner (1992) — "Turn-of-month and pre-holiday effects" | Monatswechsel-Renditen | Monats Ultimo-Strategie |
| Yale Hirsch — Stock Trader's Almanac | "Best Six Months", monatliche Win-Rates | Branchenstandard für saisonale Effekte |
| Wachtel (1942) — January Effect | Januar-Rendite > Marktdurchschnitt | 5-Tage-Strategie |
| Ariel (1990) — "High Stock Returns before Holidays" | Pre-Holiday-Effekt | Mehrere Trading-Strategien |

### Technische Indikatoren

| Indikator | Quelle |
|---|---|
| MACD (12,26,9) | Gerald Appel (1979) |
| RSI(14) | J. Welles Wilder Jr. (1978) — "New Concepts in Technical Trading Systems" |
| Bollinger Bands (20, 2σ) | John Bollinger (1980er) |
| ATR(14) | J. Welles Wilder Jr. (1978) |
| Stochastic (nicht verwendet, durch ATR ersetzt) | George Lane (1950er) |

---

## Nächste Ausbaustufen

1. **5-Tage-Status aus Historie** — `firstFiveDaysPositive` aus Yahoo/CSV berechnen statt Default `true`.
2. **Kalender-Generator für 2027+** — Feiertage, FOMC, Hexen dynamisch berechnen.
3. **Entscheidungshistorie** — tägliche Entscheidungen persistieren und visualisieren.
4. **Provider-Adapter** — Alpha Vantage, Twelve Data oder Broker-Feed für robustere Marktdaten.
5. **Export** — Excel/CSV-Export der täglichen Scorecard.
6. **Weitere Indizes** — MDAX, TecDAX, S&P 500.
7. **VDAX-New** — deutschen Volatilitätsindex als zusätzlichen Sentiment-Indikator.
