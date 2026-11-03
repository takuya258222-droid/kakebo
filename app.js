"use strict";

const CATEGORY_COLORS = {
  "食費": "#2f9e6e",
  "外食": "#e67e22",
  "日用品": "#3488ce",
  "嗜好品": "#9b59b6",
  "その他": "#7f8c8d"
};
const DEFAULT_CATEGORIES = Object.keys(CATEGORY_COLORS);
const WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

const state = {
  data: null,
  categories: [...DEFAULT_CATEGORIES],
  entries: [],
  months: [],
  selectedMonth: "",
  selectedDate: null,
  selectedCategory: "すべて",
  query: "",
  sort: "date-desc",
  chartMode: "daily",
  view: "home",
  budgets: readJsonStorage("kakeibo.budgets", {})
};

const els = {};
[
  "updatedLabel", "monthSelect", "prevMonthButton", "nextMonthButton", "currentMonthButton",
  "loadingState", "errorState", "appContent", "heroMonthLabel", "monthTotal", "monthComparison",
  "dailyAverage", "activeDays", "entryCount", "forecastAmount", "donutChart", "donutTotal",
  "categoryLegend", "categoryBars", "balanceTableBody", "chartCaption", "chartArea", "chartFoot",
  "topDayLabel", "topDayAmount", "topStoreLabel", "topStoreAmount", "averageEntry",
  "largestEntryLabel", "largestEntryAmount", "storeRanking", "calendarGrid", "clearDayButton",
  "selectedDayTitle", "selectedDaySummary", "selectedDayTotal", "selectedDayEntries", "dailyGroups",
  "searchInput", "categoryChips", "sortSelect", "resetFiltersButton", "activeDayFilter",
  "activeDayFilterText", "clearActiveDayButton", "filterSummary", "filteredEntries",
  "monthlyTrend", "annualSummary", "monthlyCards", "dataNote", "themeButton", "refreshButton",
  "retryButton", "copySummaryButton", "downloadCsvButton", "entryDialog", "entryDialogContent",
  "toast", "editBudgetButton", "budgetEmpty", "budgetContent", "budgetRemaining", "budgetDetail",
  "budgetProgress", "budgetCaption", "budgetForm", "budgetInput", "clearBudgetButton"
].forEach((id) => { els[id] = document.getElementById(id); });

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function yen(value) {
  const n = Number(value) || 0;
  return `${n < 0 ? "-" : ""}¥${Math.abs(Math.round(n)).toLocaleString("ja-JP")}`;
}

function signedYen(value) {
  const n = Number(value) || 0;
  if (n === 0) return "±¥0";
  return `${n > 0 ? "+" : "-"}${yen(Math.abs(n)).replace("-", "")}`;
}

function parseDate(value) {
  const [y, m, d] = String(value).split("-").map(Number);
  return { y, m, d, date: new Date(y, m - 1, d) };
}

function formatDateKey(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthKeyFromDate(value) {
  return String(value).slice(0, 7);
}

function monthLabel(ym, withYear = true) {
  const [y, m] = ym.split("-").map(Number);
  return withYear ? `${y}年${m}月` : `${m}月`;
}

function dateLabel(value, withYear = false) {
  const { y, m, d, date } = parseDate(value);
  const weekday = WEEKDAYS[(date.getDay() + 6) % 7];
  return `${withYear ? `${y}年` : ""}${m}月${d}日（${weekday}）`;
}

function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function previousMonthKey(ym) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return formatDateKey(d.getFullYear(), d.getMonth() + 1, 1).slice(0, 7);
}

function browserMonthKey() {
  const now = new Date();
  return formatDateKey(now.getFullYear(), now.getMonth() + 1, 1).slice(0, 7);
}

function groupBy(items, keyFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  });
  return map;
}

function sum(items) {
  return items.reduce((total, item) => total + (Number(item.amount) || 0), 0);
}

function entriesForMonth(ym = state.selectedMonth) {
  return state.entries.filter((entry) => monthKeyFromDate(entry.date) === ym);
}

function categoryTotals(items) {
  const totals = Object.fromEntries(state.categories.map((category) => [category, 0]));
  items.forEach((entry) => {
    if (!(entry.category in totals)) totals[entry.category] = 0;
    totals[entry.category] += Number(entry.amount) || 0;
  });
  return totals;
}

function totalsByDate(items) {
  const totals = new Map();
  items.forEach((entry) => totals.set(entry.date, (totals.get(entry.date) || 0) + (Number(entry.amount) || 0)));
  return totals;
}

function monthStats(ym) {
  const items = entriesForMonth(ym);
  const total = sum(items);
  const byDate = totalsByDate(items);
  const byCategory = categoryTotals(items);
  const prevTotal = sum(entriesForMonth(previousMonthKey(ym)));
  const nowKey = browserMonthKey();
  const elapsed = ym === nowKey ? new Date().getDate() : daysInMonth(ym);
  const dailyAverage = elapsed > 0 ? total / elapsed : 0;
  const forecast = ym === nowKey && elapsed > 0 ? Math.round(dailyAverage * daysInMonth(ym)) : null;
  return { items, total, byDate, byCategory, prevTotal, elapsed, dailyAverage, forecast };
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.hidden = true; }, 2600);
}

function setView(view, updateHash = true) {
  state.view = view;
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== view;
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  if (updateHash) history.replaceState(null, "", `#${view}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function convertData(raw) {
  const categories = Array.isArray(raw.categories) && raw.categories.length ? raw.categories : [...DEFAULT_CATEGORIES];
  let entries = [];
  if (Array.isArray(raw.entries)) {
    entries = raw.entries.map((entry, index) => normalizeEntry(entry, index));
  } else if (raw.months && typeof raw.months === "object") {
    Object.values(raw.months).forEach((month) => {
      (month.entries || []).forEach((entry) => entries.push(normalizeEntry(entry, entries.length)));
    });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { updated_at: raw.updated_at || "", categories, entries };
}

function normalizeEntry(entry, index) {
  const date = String(entry.date || "").slice(0, 10);
  const store = String(entry.store || entry.title || "不明");
  const receiptId = entry.receipt_id || entry.receiptId || `${date}-${store}`;
  return {
    id: String(entry.id || `entry-${index + 1}`),
    date,
    store,
    category: String(entry.category || "その他"),
    amount: Number(entry.amount) || 0,
    memo: String(entry.memo || ""),
    receipt_id: String(receiptId)
  };
}

async function loadData(showLoading = true) {
  if (showLoading) {
    els.loadingState.hidden = false;
    els.errorState.hidden = true;
    els.appContent.hidden = true;
  }
  try {
    const response = await fetch(`data.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    const converted = convertData(raw);
    state.data = converted;
    state.categories = converted.categories;
    state.entries = converted.entries.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
    state.entries.forEach((entry) => {
      if (!state.categories.includes(entry.category)) state.categories.push(entry.category);
    });

    const dataMonths = [...new Set(state.entries.map((entry) => monthKeyFromDate(entry.date)))];
    const current = browserMonthKey();
    state.months = [...new Set([...dataMonths, current])].sort().reverse();
    if (!state.selectedMonth || !state.months.includes(state.selectedMonth)) {
      state.selectedMonth = dataMonths.sort().reverse()[0] || current;
    }
    state.selectedDate = latestSpendDate(state.selectedMonth);

    els.updatedLabel.textContent = converted.updated_at ? `最終更新 ${converted.updated_at}` : "共有データ";
    els.dataNote.textContent = `全${state.entries.length}件の明細を表示しています。`;
    els.loadingState.hidden = true;
    els.errorState.hidden = true;
    els.appContent.hidden = false;
    buildMonthSelect();
    buildCategoryChips();
    renderAll();
  } catch (error) {
    console.error(error);
    els.loadingState.hidden = true;
    els.errorState.hidden = false;
    els.appContent.hidden = true;
  }
}

function buildMonthSelect() {
  els.monthSelect.innerHTML = "";
  state.months.forEach((ym) => {
    const option = document.createElement("option");
    option.value = ym;
    option.textContent = monthLabel(ym);
    els.monthSelect.appendChild(option);
  });
  els.monthSelect.value = state.selectedMonth;
  updateMonthButtons();
}

function updateMonthButtons() {
  const index = state.months.indexOf(state.selectedMonth);
  els.prevMonthButton.disabled = index >= state.months.length - 1;
  els.nextMonthButton.disabled = index <= 0;
}

function selectMonth(ym) {
  if (!state.months.includes(ym)) return;
  state.selectedMonth = ym;
  state.selectedDate = latestSpendDate(ym);
  els.monthSelect.value = ym;
  updateMonthButtons();
  renderAll();
}

function latestSpendDate(ym) {
  const items = entriesForMonth(ym);
  if (!items.length) return null;
  return items.map((entry) => entry.date).sort().reverse()[0];
}

function renderAll() {
  renderHome();
  renderDaily();
  renderEntries();
  renderMonths();
}

function renderHome() {
  const stats = monthStats(state.selectedMonth);
  els.heroMonthLabel.textContent = `${monthLabel(state.selectedMonth)}の支出`;
  els.monthTotal.textContent = yen(stats.total);
  if (stats.prevTotal > 0) {
    const diff = stats.total - stats.prevTotal;
    const pct = Math.abs(diff / stats.prevTotal * 100).toFixed(1);
    els.monthComparison.textContent = `前月より ${signedYen(diff)}（${diff >= 0 ? "+" : "-"}${pct}%）`;
  } else if (stats.total > 0) {
    els.monthComparison.textContent = "前月の記録はありません";
  } else {
    els.monthComparison.textContent = "この月の記録はまだありません";
  }
  els.dailyAverage.textContent = yen(stats.dailyAverage);
  els.activeDays.textContent = `${stats.byDate.size}日`;
  els.entryCount.textContent = `${stats.items.length}件`;
  els.forecastAmount.textContent = stats.forecast == null ? "-" : yen(stats.forecast);
  renderBudget(stats);
  renderCategories(stats);
  renderChart(stats);
  renderInsights(stats);
}

function renderBudget(stats) {
  const budget = Number(state.budgets[state.selectedMonth]) || 0;
  const hasBudget = budget > 0;
  els.budgetEmpty.hidden = hasBudget;
  els.budgetContent.hidden = !hasBudget;
  els.budgetForm.hidden = true;
  if (!hasBudget) return;
  const remaining = budget - stats.total;
  const pct = Math.min(999, stats.total / budget * 100);
  els.budgetRemaining.textContent = remaining >= 0 ? yen(remaining) : `${yen(Math.abs(remaining))} 超過`;
  els.budgetDetail.textContent = remaining >= 0 ? "まだ使えます" : "予算を超えています";
  els.budgetProgress.style.width = `${Math.min(100, pct)}%`;
  els.budgetProgress.classList.toggle("over", remaining < 0);
  els.budgetCaption.textContent = `予算 ${yen(budget)} ／ 使用 ${yen(stats.total)} ／ ${pct.toFixed(1)}%`;
}

function renderCategories(stats) {
  els.donutTotal.textContent = yen(stats.total);
  const svg = els.donutChart;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  let svgText = `<circle cx="80" cy="80" r="${radius}" fill="none" style="stroke:var(--surface-3)" stroke-width="23"></circle>`;
  if (stats.total > 0) {
    state.categories.forEach((category) => {
      const value = stats.byCategory[category] || 0;
      if (!value) return;
      const length = value / stats.total * circumference;
      svgText += `<circle cx="80" cy="80" r="${radius}" fill="none" stroke="${CATEGORY_COLORS[category] || CATEGORY_COLORS["その他"]}" stroke-width="23" stroke-dasharray="${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}" stroke-dashoffset="${-offset}" stroke-linecap="butt"></circle>`;
      offset += length;
    });
  }
  svg.innerHTML = svgText;

  els.categoryLegend.innerHTML = "";
  const maxCategory = Math.max(1, ...state.categories.map((category) => stats.byCategory[category] || 0));
  state.categories.forEach((category) => {
    const value = stats.byCategory[category] || 0;
    const pct = stats.total ? value / stats.total * 100 : 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "legend-button";
    button.innerHTML = `<span class="legend-dot" style="background:${CATEGORY_COLORS[category] || CATEGORY_COLORS["その他"]}"></span><span>${escapeHtml(category)}<small>${pct.toFixed(1)}%</small></span><strong>${yen(value)}</strong>`;
    button.addEventListener("click", () => {
      state.selectedCategory = category;
      buildCategoryChips();
      renderEntries();
      setView("entries");
    });
    els.categoryLegend.appendChild(button);
  });

  els.categoryBars.innerHTML = "";
  state.categories.forEach((category) => {
    const value = stats.byCategory[category] || 0;
    const row = document.createElement("div");
    row.className = "category-bar-row";
    row.innerHTML = `<span>${escapeHtml(category)}</span><span class="track"><span class="fill" style="display:block;width:${value / maxCategory * 100}%;background:${CATEGORY_COLORS[category] || CATEGORY_COLORS["その他"]}"></span></span><strong>${yen(value)}</strong>`;
    els.categoryBars.appendChild(row);
  });

  els.balanceTableBody.innerHTML = "";
  state.categories.forEach((category) => {
    const value = stats.byCategory[category] || 0;
    const pct = stats.total ? (value / stats.total * 100).toFixed(1) : "0.0";
    els.balanceTableBody.innerHTML += `<tr><td>${escapeHtml(category)}</td><td>${yen(value)}</td><td>${pct}%</td></tr>`;
  });
  els.balanceTableBody.innerHTML += `<tr class="total-row"><td>合計</td><td>${yen(stats.total)}</td><td>${stats.total ? "100.0" : "0.0"}%</td></tr>`;
}

function renderChart(stats) {
  document.querySelectorAll("[data-chart-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.chartMode === state.chartMode);
  });
  if (state.chartMode === "daily") renderDailyChart(stats);
  if (state.chartMode === "cumulative") renderCumulativeChart(stats);
  if (state.chartMode === "weekday") renderWeekdayChart(stats);
}

function renderDailyChart(stats) {
  els.chartCaption.textContent = "日ごとの支出（バーをタップで日別表示）";
  const max = Math.max(1, ...stats.byDate.values());
  const totalDays = daysInMonth(state.selectedMonth);
  const wrap = document.createElement("div");
  wrap.className = "daily-chart";
  for (let day = 1; day <= totalDays; day += 1) {
    const key = formatDateKey(...state.selectedMonth.split("-").map(Number), day);
    const value = stats.byDate.get(key) || 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `daily-bar-button${value ? "" : " zero"}${state.selectedDate === key ? " selected" : ""}`;
    button.title = `${dateLabel(key)} ${yen(value)}`;
    button.setAttribute("aria-label", `${dateLabel(key)} ${yen(value)}`);
    const height = value ? Math.max(7, value / max * 100) : 2;
    button.innerHTML = `<span class="daily-bar" style="height:${height}%"></span><span>${[1, 5, 10, 15, 20, 25, totalDays].includes(day) ? day : ""}</span>`;
    button.addEventListener("click", () => {
      state.selectedDate = key;
      renderAll();
      setView("daily");
    });
    wrap.appendChild(button);
  }
  els.chartArea.replaceChildren(wrap);
  const top = [...stats.byDate.entries()].sort((a, b) => b[1] - a[1])[0];
  els.chartFoot.textContent = top ? `一番多かったのは ${dateLabel(top[0])} の ${yen(top[1])} です。` : "この月はまだ支出がありません。";
}

function renderCumulativeChart(stats) {
  els.chartCaption.textContent = "月内の累計支出";
  const totalDays = daysInMonth(state.selectedMonth);
  let running = 0;
  const values = [];
  for (let day = 1; day <= totalDays; day += 1) {
    const key = formatDateKey(...state.selectedMonth.split("-").map(Number), day);
    running += stats.byDate.get(key) || 0;
    values.push(running);
  }
  const width = 640, height = 210, left = 42, right = 14, top = 16, bottom = 30;
  const max = Math.max(1, stats.total);
  const x = (day) => left + (day - 1) / Math.max(1, totalDays - 1) * (width - left - right);
  const y = (value) => top + (1 - value / max) * (height - top - bottom);
  const points = values.map((value, index) => `${x(index + 1)},${y(value)}`).join(" ");
  const area = `${left},${y(0)} ${points} ${x(totalDays)},${y(0)}`;
  const grid = [0, .5, 1].map((ratio) => {
    const gy = y(max * ratio);
    return `<line class="grid" x1="${left}" y1="${gy}" x2="${width - right}" y2="${gy}"></line><text x="3" y="${gy + 4}">${ratio === 0 ? "0" : yen(max * ratio).replace("¥", "")}</text>`;
  }).join("");
  els.chartArea.innerHTML = `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="累計支出グラフ">${grid}<polygon class="area" points="${area}"></polygon><polyline class="line" points="${points}"></polyline>${values.map((value, index) => (index === totalDays - 1 || value !== values[index - 1]) && value > 0 ? `<circle class="dot" cx="${x(index + 1)}" cy="${y(value)}" r="3.5"></circle>` : "").join("")}<text x="${left}" y="${height - 7}">1日</text><text x="${x(Math.ceil(totalDays / 2)) - 10}" y="${height - 7}">${Math.ceil(totalDays / 2)}日</text><text x="${width - right - 24}" y="${height - 7}">${totalDays}日</text></svg>`;
  els.chartFoot.textContent = stats.total ? `${monthLabel(state.selectedMonth)}の累計は ${yen(stats.total)} です。` : "この月はまだ支出がありません。";
}

function renderWeekdayChart(stats) {
  els.chartCaption.textContent = "曜日ごとの合計";
  const totals = Array(7).fill(0);
  stats.items.forEach((entry) => {
    const weekdayIndex = (parseDate(entry.date).date.getDay() + 6) % 7;
    totals[weekdayIndex] += entry.amount;
  });
  const max = Math.max(1, ...totals);
  els.chartArea.innerHTML = `<div class="weekday-chart">${totals.map((value, index) => `<div class="weekday-item"><div class="bar-shell"><div class="bar" style="height:${Math.max(4, value / max * 124)}px"></div></div><strong>${WEEKDAYS[index]}</strong><span>${yen(value)}</span></div>`).join("")}</div>`;
  const topIndex = totals.indexOf(Math.max(...totals));
  els.chartFoot.textContent = stats.total ? `一番支出が多いのは ${WEEKDAYS[topIndex]}曜日です。` : "この月はまだ支出がありません。";
}

function renderInsights(stats) {
  const topDay = [...stats.byDate.entries()].sort((a, b) => b[1] - a[1])[0];
  els.topDayLabel.textContent = topDay ? dateLabel(topDay[0]) : "-";
  els.topDayAmount.textContent = topDay ? yen(topDay[1]) : "-";

  const byStore = groupBy(stats.items, (entry) => entry.store);
  const storeRows = [...byStore.entries()].map(([store, items]) => ({ store, total: sum(items), count: items.length })).sort((a, b) => b.total - a.total);
  const topStore = storeRows[0];
  els.topStoreLabel.textContent = topStore ? topStore.store : "-";
  els.topStoreAmount.textContent = topStore ? `${yen(topStore.total)} ・ ${topStore.count}件` : "-";
  els.averageEntry.textContent = stats.items.length ? yen(stats.total / stats.items.length) : "¥0";

  const largest = [...stats.items].sort((a, b) => b.amount - a.amount)[0];
  els.largestEntryLabel.textContent = largest ? largest.store : "-";
  els.largestEntryAmount.textContent = largest ? `${yen(largest.amount)} ・ ${dateLabel(largest.date)}` : "-";

  els.storeRanking.innerHTML = "";
  if (!storeRows.length) {
    els.storeRanking.innerHTML = '<div class="empty-message">まだ記録がありません</div>';
    return;
  }
  storeRows.slice(0, 5).forEach((row, index) => {
    const div = document.createElement("div");
    div.className = "ranking-row";
    div.innerHTML = `<b>${index + 1}</b><span>${escapeHtml(row.store)}<br><small>${row.count}件</small></span><strong>${yen(row.total)}</strong>`;
    els.storeRanking.appendChild(div);
  });
}

function createEntryButton(entry) {
const button = document.createElement("button");
button.type = "button";
button.className = "entry-button";
const color = CATEGORY_COLORS[entry.category] || CATEGORY_COLORS["その他"];
button.innerHTML = `<span class="entry-icon" style="background:${color}">${escapeHtml(entry.category.slice(0, 1))}</span><span class="entry-main"><strong>${escapeHtml(entry.store)}</strong><small>${dateLabel(entry.date)} ・ ${escapeHtml(entry.category)}${entry.memo? ` ・ ${escapeHtml(entry.memo)}`: ""}</small></span><span class="entry-amount">${yen(entry.amount)}</span>`;
button.addEventListener("click", () => openEntryDialog(entry));
return button;
}

function renderDaily() {
const stats = monthStats(state.selectedMonth);
renderCalendar(stats);
renderSelectedDay(stats);
renderDailyGroups(stats);
}

function renderCalendar(stats) {
const [y, m] = state.selectedMonth.split("-").map(Number);
const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7;
const totalDays = daysInMonth(state.selectedMonth);
const max = Math.max(1,...stats.byDate.values());
const todayKey = (() => { const n = new Date(); return formatDateKey(n.getFullYear(), n.getMonth() + 1, n.getDate());})();
els.calendarGrid.innerHTML = "";
for (let i = 0; i < firstWeekday; i += 1) {
const blank = document.createElement("span");
blank.className = "calendar-day empty-cell";
els.calendarGrid.appendChild(blank);
}
for (let day = 1; day <= totalDays; day += 1) {
const key = formatDateKey(y, m, day);
const value = stats.byDate.get(key) || 0;
const button = document.createElement("button");
button.type = "button";
button.className = `calendar-day${value? " has-spend": ""}${state.selectedDate === key? " selected": ""}${todayKey === key? " today": ""}`;
if (value) button.style.background = `color-mix(in srgb, var(--brand) ${18 + Math.round(value / max * 34)}%, var(--surface-2))`;
button.innerHTML = `<span class="day-num">${day}</span><span class="day-amount">${value? yen(value): "記録なし"}</span>`;
button.setAttribute("aria-label", `${dateLabel(key)} ${value? yen(value): "記録なし"}`);
button.addEventListener("click", () => {
state.selectedDate = state.selectedDate === key? null: key;
renderAll();
});
els.calendarGrid.appendChild(button);
}
}

function renderSelectedDay(stats) {
const selected = state.selectedDate && monthKeyFromDate(state.selectedDate) === state.selectedMonth? state.selectedDate: null;
const items = selected? stats.items.filter((entry) => entry.date === selected): [...stats.items].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
els.selectedDayTitle.textContent = selected? dateLabel(selected): "最近の明細";
els.selectedDaySummary.textContent = selected? `${items.length}件の記録`: "選択していないため、最近の5件を表示しています";
els.selectedDayTotal.textContent = yen(selected? sum(items): stats.total);
els.selectedDayEntries.replaceChildren();
if (!items.length) {
els.selectedDayEntries.innerHTML = '<div class="empty-message">この日の記録はありません</div>';
return;
}
items.forEach((entry) => els.selectedDayEntries.appendChild(createEntryButton(entry)));
}

function renderDailyGroups(stats) {
els.dailyGroups.replaceChildren();
const dates = [...stats.byDate.keys()].sort().reverse();
if (!dates.length) {
els.dailyGroups.innerHTML = '<div class="empty-message">この月はまだ記録がありません</div>';
return;
}
dates.forEach((date) => {
const items = stats.items.filter((entry) => entry.date === date).sort((a, b) => b.amount - a.amount);
const group = document.createElement("section");
group.className = "day-group";
const head = document.createElement("div");
head.className = "day-group-head";
head.innerHTML = `<div><strong>${dateLabel(date)}</strong><span>${items.length}件</span></div><b>${yen(sum(items))}</b>`;
group.appendChild(head);
items.forEach((entry) => group.appendChild(createEntryButton(entry)));
els.dailyGroups.appendChild(group);
});
}

function buildCategoryChips() {
els.categoryChips.replaceChildren();
["すべて",...state.categories].forEach((category) => {
const chip = document.createElement("button");
chip.type = "button";
chip.className = `chip${state.selectedCategory === category? " active": ""}`;
chip.textContent = category;
chip.addEventListener("click", () => {
state.selectedCategory = category;
buildCategoryChips();
renderEntries();
});
els.categoryChips.appendChild(chip);
});
}

function filteredEntries() {
let items = entriesForMonth();
if (state.selectedDate && monthKeyFromDate(state.selectedDate) === state.selectedMonth) {
items = items.filter((entry) => entry.date === state.selectedDate);
}
if (state.selectedCategory!== "すべて") {
items = items.filter((entry) => entry.category === state.selectedCategory);
}
if (state.query.trim()) {
const q = state.query.trim().toLocaleLowerCase("ja-JP");
items = items.filter((entry) => [entry.store, entry.memo, entry.category, entry.date].join(" ").toLocaleLowerCase("ja-JP").includes(q));
}
const sorted = [...items];
switch (state.sort) {
case "date-asc": sorted.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)); break;
case "amount-desc": sorted.sort((a, b) => b.amount - a.amount || b.date.localeCompare(a.date)); break;
case "amount-asc": sorted.sort((a, b) => a.amount - b.amount || b.date.localeCompare(a.date)); break;
case "store": sorted.sort((a, b) => a.store.localeCompare(b.store, "ja") || b.date.localeCompare(a.date)); break;
default: sorted.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}
return sorted;
}

function renderEntries() {
const items = filteredEntries();
const hasDay = Boolean(state.selectedDate && monthKeyFromDate(state.selectedDate) === state.selectedMonth);
els.activeDayFilter.hidden =!hasDay;
if (hasDay) els.activeDayFilterText.textContent = `${dateLabel(state.selectedDate)}だけ表示中`;
els.filterSummary.textContent = `${items.length}件 ・ 合計 ${yen(sum(items))}`;
els.filteredEntries.replaceChildren();
if (!items.length) {
els.filteredEntries.innerHTML = '<div class="card empty-message">条件に合う明細がありません。<br>検索や絞り込みを変えてみてください。</div>';
return;
}
items.forEach((entry) => els.filteredEntries.appendChild(createEntryButton(entry)));
}

function renderMonths() {
const keys = [...new Set(state.entries.map((entry) => monthKeyFromDate(entry.date)))].sort();
const rows = keys.map((ym) => ({ ym,...monthStats(ym)}));
const max = Math.max(1,...rows.map((row) => row.total));
els.monthlyTrend.replaceChildren();
rows.forEach((row) => {
const button = document.createElement("button");
button.type = "button";
button.className = `month-trend-item${row.ym === state.selectedMonth? " selected": ""}`;
button.innerHTML = `<span>${yen(row.total)}</span><span class="bar" style="height:${Math.max(5, row.total / max * 112)}px"></span><strong>${monthLabel(row.ym, false)}</strong><span>${row.ym.split("-")[0]}年</span>`;
button.addEventListener("click", () => { selectMonth(row.ym); setView("home");});
els.monthlyTrend.appendChild(button);
});
if (!rows.length) els.monthlyTrend.innerHTML = '<div class="empty-message">月別データがまだありません</div>';

const selectedYear = state.selectedMonth.split("-")[0];
const yearRows = rows.filter((row) => row.ym.startsWith(`${selectedYear}-`));
els.annualSummary.innerHTML = yearRows.length? `${selectedYear}年の合計は <strong>${yen(sum(yearRows.map((row) => ({ amount: row.total}))))}</strong> です。記録がある月は ${yearRows.length}か月です。`: "年間の記録がまだありません。";

els.monthlyCards.replaceChildren();
[...rows].reverse().forEach((row, index, reversed) => {
const previous = reversed[index + 1];
const diff = previous? row.total - previous.total: null;
const card = document.createElement("button");
card.type = "button";
card.className = "month-card-item";
const stack = state.categories.map((category) => {
const value = row.byCategory[category] || 0;
return value && row.total? `<div style="width:${value / row.total * 100}%;background:${CATEGORY_COLORS[category] || CATEGORY_COLORS["その他"]}"></div>`: "";
}).join("");
const topCategories = state.categories.map((category) => [category, row.byCategory[category] || 0]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `${c} ${yen(v)}`).join(" ・ ");
card.innerHTML = `<div class="month-card-top"><div><strong>${monthLabel(row.ym)}</strong><span>${diff == null? "比較対象なし": `前月比 ${signedYen(diff)}`}</span></div><strong>${yen(row.total)}</strong></div><div class="mini-stack">${stack}</div><div class="month-card-meta"><span>${row.items.length}件</span><span>使った日 ${row.byDate.size}日</span><span>${escapeHtml(topCategories || "記録なし")}</span></div>`;
card.addEventListener("click", () => { selectMonth(row.ym); setView("home");});
els.monthlyCards.appendChild(card);
});
}

function openEntryDialog(entry) {
const sameReceipt = state.entries.filter((item) => item.receipt_id === entry.receipt_id && item.date === entry.date)
.sort((a, b) => b.amount - a.amount);
const receiptTotal = sum(sameReceipt);
els.entryDialogContent.innerHTML = `
<div class="detail-hero"><span>${escapeHtml(entry.category)}</span><strong>${yen(entry.amount)}</strong></div>
<div class="detail-rows">
<div class="detail-row"><span>日付</span><div>${dateLabel(entry.date, true)}</div></div>
<div class="detail-row"><span>店名</span><div>${escapeHtml(entry.store)}</div></div>
<div class="detail-row"><span>メモ</span><div>${escapeHtml(entry.memo || "なし")}</div></div>
<div class="detail-row"><span>レシート合計</span><div>${yen(receiptTotal)}</div></div>
</div>
${sameReceipt.length > 1? `<div class="receipt-block"><h3>同じレシートの内訳</h3>${sameReceipt.map((item) => `<div class="detail-row"><span>${escapeHtml(item.category)}</span><div>${yen(item.amount)}${item.memo? ` ・ ${escapeHtml(item.memo)}`: ""}</div></div>`).join("")}</div>`: ""}
`;
if (typeof els.entryDialog.showModal === "function") els.entryDialog.showModal();
}

function monthlySummaryText() {
const stats = monthStats(state.selectedMonth);
const lines = [
`${monthLabel(state.selectedMonth)}`,
`合計：${yen(stats.total)}`,
...state.categories.map((category) => `${category}：${yen(stats.byCategory[category] || 0)}`),
`使った日：${stats.byDate.size}日`,
`明細：${stats.items.length}件`
];
return lines.join("\n");
}

async function copySummary() {
const text = monthlySummaryText();
try {
if (navigator.share) {
await navigator.share({ title: "家計簿", text});
return;
}
throw new Error("share unavailable");
} catch (error) {
if (error && error.name === "AbortError") return;
try {
await navigator.clipboard.writeText(text);
showToast("月のまとめをコピーしました");
} catch (_) {
showToast("コピーできませんでした");
}
}
}

function downloadCsv() {
const items = filteredEntries();
const rows = [["日付", "店名・内容", "項目", "金額", "メモ"]];
items.forEach((entry) => rows.push([entry.date, entry.store, entry.category, entry.amount, entry.memo]));
const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n")}`;
const blob = new Blob([csv], { type: "text/csv;charset=utf-8"});
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `kakeibo-${state.selectedMonth}.csv`;
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
showToast("CSVを保存しました");
}

function applyTheme(theme) {
if (theme === "dark" || theme === "light") {
document.documentElement.dataset.theme = theme;
} else {
delete document.documentElement.dataset.theme;
}
}

function initTheme() {
const saved = (() => { try { return localStorage.getItem("kakeibo.theme");} catch (_) { return null;}})();
if (saved) applyTheme(saved);
els.themeButton.addEventListener("click", () => {
const isDark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
const next = isDark? "light": "dark";
applyTheme(next);
try { localStorage.setItem("kakeibo.theme", next);} catch (_) {}
showToast(isDark? "ライト表示に切り替えました": "ダーク表示に切り替えました");
});
}

function bindEvents() {
els.monthSelect.addEventListener("change", () => selectMonth(els.monthSelect.value));
els.prevMonthButton.addEventListener("click", () => {
const index = state.months.indexOf(state.selectedMonth);
if (index < state.months.length - 1) selectMonth(state.months[index + 1]);
});
els.nextMonthButton.addEventListener("click", () => {
const index = state.months.indexOf(state.selectedMonth);
if (index > 0) selectMonth(state.months[index - 1]);
});
els.currentMonthButton.addEventListener("click", () => {
const current = browserMonthKey();
if (!state.months.includes(current)) {
state.months = [current,...state.months].sort().reverse();
buildMonthSelect();
}
selectMonth(current);
});
els.refreshButton.addEventListener("click", async () => { await loadData(false); showToast("最新データに更新しました");});
els.retryButton.addEventListener("click", () => loadData(true));
document.querySelectorAll("[data-chart-mode]").forEach((button) => {
button.addEventListener("click", () => { state.chartMode = button.dataset.chartMode; renderChart(monthStats(state.selectedMonth));});
});
document.querySelectorAll("[data-view]").forEach((button) => {
button.addEventListener("click", () => setView(button.dataset.view));
});
els.clearDayButton.addEventListener("click", () => { state.selectedDate = null; renderAll();});
els.clearActiveDayButton.addEventListener("click", () => { state.selectedDate = null; renderAll();});
els.searchInput.addEventListener("input", () => { state.query = els.searchInput.value; renderEntries();});
els.sortSelect.addEventListener("change", () => { state.sort = els.sortSelect.value; renderEntries();});
els.resetFiltersButton.addEventListener("click", () => {
state.query = "";
state.selectedCategory = "すべて";
state.selectedDate = null;
state.sort = "date-desc";
els.searchInput.value = "";
els.sortSelect.value = "date-desc";
buildCategoryChips();
renderAll();
});
els.copySummaryButton.addEventListener("click", copySummary);
els.downloadCsvButton.addEventListener("click", downloadCsv);
els.editBudgetButton.addEventListener("click", () => {
const budget = Number(state.budgets[state.selectedMonth]) || "";
els.budgetInput.value = budget;
els.budgetForm.hidden =!els.budgetForm.hidden;
if (!els.budgetForm.hidden) els.budgetInput.focus();
});
els.budgetForm.addEventListener("submit", (event) => {
event.preventDefault();
const value = Number(els.budgetInput.value) || 0;
if (value > 0) state.budgets[state.selectedMonth] = value;
else delete state.budgets[state.selectedMonth];
writeJsonStorage("kakeibo.budgets", state.budgets);
renderBudget(monthStats(state.selectedMonth));
showToast(value > 0? "予算を保存しました": "予算を削除しました");
});
els.clearBudgetButton.addEventListener("click", () => {
delete state.budgets[state.selectedMonth];
writeJsonStorage("kakeibo.budgets", state.budgets);
renderBudget(monthStats(state.selectedMonth));
showToast("予算を削除しました");
});
window.addEventListener("hashchange", () => {
const view = location.hash.replace("#", "");
if (["home", "daily", "entries", "months"].includes(view)) setView(view, false);
});
}

function init() {
initTheme();
bindEvents();
const initialView = location.hash.replace("#", "");
if (["home", "daily", "entries", "months"].includes(initialView)) setView(initialView, false);
loadData(true);
if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
navigator.serviceWorker.register("service-worker.js").catch(() => {});
}
}

document.addEventListener("DOMContentLoaded", init);
