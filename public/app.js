const ids = {
  dateInput: document.querySelector('#dateInput'),
  refreshButton: document.querySelector('#refreshButton'),
  closeValue: document.querySelector('#closeValue'),
  dataStatus: document.querySelector('#dataStatus'),
  decisionPanel: document.querySelector('#decisionPanel'),
  decisionText: document.querySelector('#decisionText'),
  scoreValue: document.querySelector('#scoreValue'),
  tradingDayStatus: document.querySelector('#tradingDayStatus'),
  decisionDate: document.querySelector('#decisionDate'),
  investmentScore: document.querySelector('#investmentScore'),
  marketOutlookScore: document.querySelector('#marketOutlookScore'),
  tradingScore: document.querySelector('#tradingScore'),
  timingScore: document.querySelector('#timingScore'),
  positiveCount: document.querySelector('#positiveCount'),
  negativeCount: document.querySelector('#negativeCount'),
  neutralCount: document.querySelector('#neutralCount'),
  investmentGrid: document.querySelector('#investmentGrid'),
  marketOutlookGrid: document.querySelector('#marketOutlookGrid'),
  tradingGrid: document.querySelector('#tradingGrid'),
  timingGrid: document.querySelector('#timingGrid'),
  driversBody: document.querySelector('#driversBody')
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function signalClass(signal) {
  if (signal === 'positive') return 'is-positive';
  if (signal === 'negative') return 'is-negative';
  return 'is-neutral';
}

function signed(value) {
  return value > 0 ? `+${value}` : String(value);
}

function scoreColorClass(value) {
  if (value > 0) return 'score-pos';
  if (value < 0) return 'score-neg';
  return 'score-neu';
}

function renderStrategies(container, strategies) {
  container.replaceChildren(
    ...strategies.map((strategy) => {
      const card = document.createElement('article');
      card.className = `strategy-card ${signalClass(strategy.signal)}`;
      card.innerHTML = `
        <h3>${strategy.name}</h3>
        <p class="signal">${strategy.label}</p>
        <p class="reason">${strategy.reason}</p>
      `;
      return card;
    })
  );
}

function renderDrivers(drivers) {
  if (!drivers.length) {
    ids.driversBody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px">Keine aktiven Treiber — alle Strategien neutral.</td></tr>';
    return;
  }

  ids.driversBody.innerHTML = drivers.map((driver) => `
    <tr>
      <td style="font-weight:600;color:var(--muted);white-space:nowrap">${driver.group}</td>
      <td style="font-weight:700;white-space:nowrap">${driver.name}</td>
      <td><span class="${signalClass(driver.signal)} text-signal">${driver.label}</span></td>
      <td class="numeric ${scoreColorClass(driver.points)}">${signed(driver.points)}</td>
      <td style="color:var(--muted)">${driver.reason}</td>
    </tr>
  `).join('');
}

const STATUS_LABELS = {
  delayed: 'verzögert (15 Min)',
  local: 'lokale Datei',
  'snapshot-fallback': 'Screenshot-Fallback'
};

function renderDashboard(data) {
  ids.closeValue.textContent = data.market.closeFormatted;

  const statusLabel = STATUS_LABELS[data.market.status] ?? data.market.status;
  let statusLine = `${data.market.sourceLabel} · ${statusLabel} · Stand ${data.market.asOf}`;
  if (data.market.warning) {
    statusLine += ` · ${data.market.warning}`;
  }
  ids.dataStatus.textContent = statusLine;

  ids.decisionText.textContent = data.summary.decision;
  ids.scoreValue.textContent = signed(data.summary.totalScore);
  ids.tradingDayStatus.textContent = data.date.tradingDayStatus;
  ids.decisionDate.textContent = `Entscheidungsdatum: ${data.date.decisionDate}`;
  ids.decisionPanel.className = `panel decision-panel ${data.summary.totalScore >= 1 ? 'positive-panel' : data.summary.totalScore <= -1 ? 'negative-panel' : 'neutral-panel'}`;

  const setScore = (el, value) => {
    el.textContent = signed(value);
    el.className = scoreColorClass(value);
  };

  setScore(ids.investmentScore, data.summary.investmentScore);
  setScore(ids.marketOutlookScore, data.summary.marketOutlookScore);
  setScore(ids.tradingScore, data.summary.tradingScore);
  setScore(ids.timingScore, data.summary.timingScore);

  ids.positiveCount.textContent = data.summary.positiveCount;
  ids.negativeCount.textContent = data.summary.negativeCount;
  ids.neutralCount.textContent = data.summary.neutralCount;

  renderStrategies(ids.investmentGrid, data.investment);
  renderStrategies(ids.marketOutlookGrid, data.marketOutlook);
  renderStrategies(ids.tradingGrid, data.trading);
  renderStrategies(ids.timingGrid, data.timing);
  renderDrivers(data.activeDrivers);
}

async function loadDashboard() {
  ids.refreshButton.disabled = true;
  ids.refreshButton.textContent = 'Lädt';
  try {
    const url = `/api/dashboard?date=${encodeURIComponent(ids.dateInput.value)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`API Fehler ${response.status}`);
    renderDashboard(await response.json());
  } catch (error) {
    ids.dataStatus.textContent = error.message;
  } finally {
    ids.refreshButton.disabled = false;
    ids.refreshButton.textContent = 'Aktualisieren';
  }
}

ids.dateInput.value = todayIso();
ids.refreshButton.addEventListener('click', loadDashboard);
ids.dateInput.addEventListener('change', loadDashboard);
loadDashboard();
