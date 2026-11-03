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
const API_URL = "https://script.google.com/macros/s/AKfycbz46Hemu-bMLzM0EspM2ILboj6JHziOzyCC-cuONgefk_ZD5EMNTnKzcvMakO-qurax/exec";
const BOOKS = ["共有", "卓也", "あや"];
// 月末予測に使う本人の傾向（2026-11-03 本人申告）: 買い物は12日に1回、外食は週2.5回（昼・夜別に実績単価で計算、初期値8,000円）、嗜好品は週3回（平均600円）
const FORECAST_PATTERNS = [
  { category: "食費", label: "買い物", perDays: 12 },
  { category: "外食", label: "外食", perWeek: 2.5, fixedTicket: 8000, liveTicket: true },
  { category: "嗜好品", label: "嗜好品", perWeek: 3, fixedTicket: 600 }
];
// 予測ルール（帳簿ごとに自分で定義する月末予測の材料）: 定期ルールは個人帳簿の予測の土台、特別費用はどの帳簿でも上乗せ
const RULE_KINDS = {
  weekday: { label: "平日のみ・毎日", needsCount: false },
  daily: { label: "毎日", needsCount: false },
  weekend: { label: "土日のみ・毎日", needsCount: false },
  weekly: { label: "週に○回", needsCount: true },
  monthly: { label: "月に○回", needsCount: true },
  once: { label: "特別費用（表示中の月だけ）", needsCount: false },
  fixed: { label: "特別費用（毎月）", needsCount: false },
  running: { label: "ランニングコスト（毎月）", needsCount: false, needsDay: true }
};
const RECURRING_KINDS = ["weekday", "daily", "weekend", "weekly", "monthly"];

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
  budgets: readJsonStorage("kakeibo.budgets", {}),
  pin: "",
  connected: false,
  needsPin: false,
  book: "共有",
  editingRow: null,
  rules: [],
  savings: { movements: [], goals: [] },
  savingsMode: false,
  stateHash: "",
  currentEntry: null,
  pollTimer: null
};
try { state.pin = localStorage.getItem("kakeibo.pin") || ""; } catch (_) { state.pin = ""; }
try {
  const savedBook = localStorage.getItem("kakeibo.book") || "";
  if (BOOKS.includes(savedBook)) state.book = savedBook;
} catch (_) {}

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
  "budgetProgress", "budgetCaption", "budgetForm", "budgetInput", "clearBudgetButton",
  "syncBadge", "syncBar", "syncText", "disconnectButton", "loginCard", "pinForm", "pinInput", "forecastNote",
  "pinError", "budgetNote", "addEntryButton", "entryFormDialog", "entryForm", "formDate", "diningStatus",
  "formStore", "formCategory", "formAmount", "formMemo", "formError", "formSubmitButton",
  "closeEntryFormButton", "deleteEntryButton", "receiptButton", "receiptInput",
  "formBook", "storeHints", "entryFormTitle", "editEntryButton",
  "rulesButton", "rulesDialog", "closeRulesButton", "rulesList", "ruleForm",
  "ruleKind", "ruleName", "ruleAmount", "ruleCount", "ruleCountWrap", "ruleError",
  "ruleDayWrap", "ruleDay", "ruleNamePreset", "ruleNameWrap",
  "savingsTotal", "savingsMonthNet", "savingsPace", "savingsCount", "savingsNote",
  "savingsGoals", "goalForm", "goalName", "goalTarget", "savingsList",
  "savingFormDialog", "savingForm", "closeSavingFormButton", "savingDate", "savingType",
  "savingAmount", "savingGoalSelect", "savingMemo", "savingError", "savingSubmitButton",
  "ruleSubWrap", "ruleSubName"
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
  return state.entries.filter((entry) => monthKeyFromDate(entry.date) === ym && entry.book === state.book);
}

function budgetKey(ym = state.selectedMonth, book = state.book) {
  return `${book}|${ym}`;
}

function flattenBudgets(nested) {
  const flat = {};
  Object.entries(nested || {}).forEach(([book, months]) => {
    if (months && typeof months === "object") {
      Object.entries(months).forEach(([ym, amount]) => {
        const value = Number(amount) || 0;
        if (value > 0) flat[`${book}|${ym}`] = value;
      });
    }
  });
  return flat;
}

function flattenLocalBudgets(stored) {
  const flat = {};
  Object.entries(stored || {}).forEach(([key, amount]) => {
    const value = Number(amount) || 0;
    if (!(value > 0)) return;
    if (key.includes("|")) flat[key] = value;
    else if (/^\d{4}-\d{2}$/.test(key)) flat[`共有|${key}`] = value;
  });
  return flat;
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
  const fc = ym === nowKey && elapsed > 0 ? forecastForBook(ym, items, byCategory, total, elapsed) : null;
  const forecast = fc ? fc.amount : null;
  const forecastNotes = fc ? fc.notes : [];
  const forecastFallback = fc ? fc.usedFallback : false;
  const forecastLines = fc ? (fc.lines || []) : [];
  const rulesBased = fc ? Boolean(fc.rulesBased) : false;
  const dining = fc ? fc.dining : null;
  return { items, total, byDate, byCategory, prevTotal, elapsed, dailyAverage, forecast, forecastNotes, forecastFallback, forecastLines, rulesBased, dining };
}

function rulesForBook(book) {
  return (state.rules || []).filter((rule) => (rule.book || "共有") === book);
}

function remainingDayRange(ym) {
  const now = new Date();
  const currentKey = browserMonthKey();
  const dim = daysInMonth(ym);
  if (ym < currentKey) return { from: 1, to: 0, days: 0, dim };
  if (ym === currentKey) {
    const from = now.getDate() + 1;
    return { from, to: dim, days: Math.max(0, dim - from + 1), dim };
  }
  return { from: 1, to: dim, days: dim, dim };
}

function countDaysMatching(ym, range, predicate) {
  const [y, m] = ym.split("-").map(Number);
  let count = 0;
  for (let d = range.from; d <= range.to; d++) {
    if (predicate(new Date(y, m - 1, d).getDay())) count++;
  }
  return count;
}

function computeRuleAmount(rule, ym) {
  const amount = Number(rule.amount) || 0;
  if (!(amount > 0)) return 0;
  const currentKey = browserMonthKey();
  if (rule.kind === "once") return rule.month === ym ? amount : 0;
  if (rule.kind === "fixed" || rule.kind === "running") return ym >= currentKey ? amount : 0;
  const range = remainingDayRange(ym);
  if (range.days <= 0) return 0;
  const count = Math.max(0, Number(rule.count) || 0);
  if (rule.kind === "daily") return amount * range.days;
  if (rule.kind === "weekday") return amount * countDaysMatching(ym, range, (dow) => dow >= 1 && dow <= 5);
  if (rule.kind === "weekend") return amount * countDaysMatching(ym, range, (dow) => dow === 0 || dow === 6);
  if (rule.kind === "weekly") return Math.round(amount * count * range.days / 7);
  if (rule.kind === "monthly") return Math.round(amount * count * range.days / range.dim);
  return 0;
}

function ruleDescription(rule, ym) {
  const value = computeRuleAmount(rule, ym || state.selectedMonth);
  const name = rule.name || RULE_KINDS[rule.kind]?.label || "ルール";
  return `${name}: ${yen(value)}`;
}

function forecastForBook(ym, items, byCategory, total, elapsed) {
  const rules = rulesForBook(state.book);
  const recurring = rules.filter((rule) => RECURRING_KINDS.includes(rule.kind));
  const specials = rules.filter((rule) => !RECURRING_KINDS.includes(rule.kind) && rule.kind !== "running");
  const running = rules.filter((rule) => rule.kind === "running");
  const runningSum = running.reduce((acc, rule) => acc + computeRuleAmount(rule, ym), 0);
  const runningLine = runningSum > 0
    ? [`ランニングコスト: ${yen(runningSum)}（${running.map((rule) => rule.name || "固定費").join("・")}）`]
    : [];
  const specialLines = [
    ...specials
      .map((rule) => ({ rule, value: computeRuleAmount(rule, ym) }))
      .filter((x) => x.value > 0)
      .map((x) => `${x.rule.name || "特別費用"}: ${yen(x.value)}`),
    ...runningLine
  ];
  const specialSum = specials.reduce((acc, rule) => acc + computeRuleAmount(rule, ym), 0) + runningSum;

  if (state.book !== "共有" || recurring.length > 0) {
    // 個人帳簿（と定期ルールのある帳簿）は、自分で定義したルールで予測する
    let amount = total;
    const lines = [];
    recurring.forEach((rule) => {
      const value = computeRuleAmount(rule, ym);
      amount += value;
      lines.push(ruleDescription(rule, ym));
    });
    amount += specialSum;
    lines.push(...specialLines);
    const notes = recurring.length || specialLines.length
      ? lines.slice()
      : ["予測ルール未設定（ルールを追加すると残りの見込みが出ます）"];
    return { amount: Math.round(amount), notes, lines, usedFallback: false, dining: null, rulesBased: true };
  }

  const base = forecastForMonth(ym, items, byCategory, total, elapsed);
  if (specialSum > 0) {
    base.amount += specialSum;
    base.notes = [...base.notes, ...specialLines];
    base.lines = specialLines;
  }
  base.rulesBased = false;
  return base;
}

function forecastForMonth(ym, items, byCategory, total, elapsed) {
  const dim = daysInMonth(ym);
  const patternCategories = new Set(FORECAST_PATTERNS.map((p) => p.category));
  const fallbackTicket = items.length ? total / items.length : 0;
  let forecast = 0;
  let usedFallback = false;
  let dining = null;
  const notes = [];
  FORECAST_PATTERNS.forEach((pattern) => {
    const catItems = items.filter((entry) => entry.category === pattern.category);
    const catTotal = byCategory[pattern.category] || 0;
    const trips = new Set(catItems.map((entry) => `${entry.date}|${entry.store}`)).size;
    const expected = pattern.perDays ? dim / pattern.perDays : pattern.perWeek * dim / 7;

    if (pattern.category === "外食") {
      // 昼と夜で単価が大きく違うため、メモの「昼」「夜」で分けて着地を計算する
      const buckets = {
        lunch: { total: 0, tripKeys: new Set() },
        dinner: { total: 0, tripKeys: new Set() },
        other: { total: 0, tripKeys: new Set() }
      };
      catItems.forEach((entry) => {
        const key = /昼/.test(entry.memo) ? "lunch" : /夜/.test(entry.memo) ? "dinner" : "other";
        buckets[key].total += entry.amount;
        buckets[key].tripKeys.add(`${entry.date}|${entry.store}`);
      });
      const pooledTicket = trips > 0 ? catTotal / trips : (pattern.fixedTicket || fallbackTicket);
      const defaultShares = { lunch: 0.8, dinner: 0.2, other: 0 };
      let dLanding = 0;
      let dRemaining = 0;
      const parts = {};
      Object.entries(buckets).forEach(([key, bucket]) => {
        const bTrips = bucket.tripKeys.size;
        const share = trips > 0 ? bTrips / trips : defaultShares[key];
        const bRemaining = Math.max(0, expected * share - bTrips);
        const bTicket = bTrips > 0 ? bucket.total / bTrips : pooledTicket;
        const bLanding = bucket.total + bRemaining * bTicket;
        dLanding += bLanding;
        dRemaining += bRemaining;
        parts[key] = { trips: bTrips, avg: Math.round(bTicket), landing: Math.round(bLanding) };
      });
      forecast += dLanding;
      notes.push(`外食 あと約${Math.round(dRemaining)}回`);
      const expectedByNow = pattern.perWeek * elapsed / 7;
      dining = {
        trips,
        avgTicket: Math.round(pooledTicket),
        expectedByNow,
        paceOver: trips - expectedByNow >= 1,
        landing: Math.round(dLanding),
        lunch: parts.lunch,
        dinner: parts.dinner,
        other: parts.other
      };
      return;
    }

    const remaining = Math.max(0, expected - trips);
    let ticket;
    if (pattern.liveTicket && trips > 0) ticket = catTotal / trips;
    else if (pattern.fixedTicket) ticket = pattern.fixedTicket;
    else ticket = trips > 0 ? catTotal / trips : fallbackTicket;
    if (!pattern.fixedTicket && !pattern.liveTicket && trips === 0 && remaining > 0 && fallbackTicket > 0) usedFallback = true;
    const landing = catTotal + remaining * ticket;
    forecast += landing;
    notes.push(`${pattern.label} あと約${Math.round(remaining)}回`);
  });
  const othersTotal = items
    .filter((entry) => !patternCategories.has(entry.category))
    .reduce((acc, entry) => acc + entry.amount, 0);
  forecast += elapsed > 0 ? othersTotal * dim / elapsed : othersTotal;
  return { amount: Math.round(forecast), notes, usedFallback, dining };
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
  const book = BOOKS.includes(String(entry.book || "")) ? String(entry.book) : "共有";
  return {
    id: String(entry.id || `entry-${index + 1}`),
    date,
    store,
    category: String(entry.category || "その他"),
    amount: Number(entry.amount) || 0,
    memo: String(entry.memo || ""),
    receipt_id: String(receiptId),
    book
  };
}

function apiError(code) {
  const error = new Error(code || "api_error");
  error.code = code || "api_error";
  return error;
}

async function apiGetState() {
  const url = `${API_URL}?action=state&pin=${encodeURIComponent(state.pin)}&ts=${Date.now()}`;
  const response = await fetch(url, { cache: "no-store" });
  const json = await response.json();
  if (!json.ok) throw apiError(json.error);
  return json;
}

async function apiPost(payload) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ pin: state.pin, ...payload })
  });
  const json = await response.json();
  if (!json.ok) throw apiError(json.error);
  return json;
}

function normalizeApiEntry(entry) {
  const base = normalizeEntry(entry, 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base.date)) {
    const parsed = new Date(entry.date);
    if (!isNaN(parsed.getTime())) {
      base.date = formatDateKey(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
    }
  }
  base.row = Number(entry.row) || null;
  base.id = base.row ? `row-${base.row}` : base.id;
  base.receipt_id = base.row ? `row-${base.row}` : base.receipt_id;
  return base;
}

function applyEntries(entries) {
  state.entries = entries.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
  state.entries.forEach((entry) => {
    if (!state.categories.includes(entry.category)) state.categories.push(entry.category);
  });
  const dataMonths = [...new Set(state.entries.map((entry) => monthKeyFromDate(entry.date)))];
  const current = browserMonthKey();
  state.months = [...new Set([...dataMonths, current])].sort().reverse();
  if (!state.selectedMonth || !state.months.includes(state.selectedMonth)) {
    state.selectedMonth = dataMonths.sort().reverse()[0] || current;
    state.selectedDate = latestSpendDate(state.selectedMonth);
  }
  state.stateHash = JSON.stringify([state.entries, state.budgets, state.rules, state.savings]);
}

function updateBookSwitch() {
  document.querySelectorAll("[data-book]").forEach((button) => {
    const active = state.savingsMode
      ? button.dataset.book === "__savings"
      : button.dataset.book === state.book;
    button.classList.toggle("active", active);
  });
}

function selectBook(book) {
  if (book === "__savings") {
    state.savingsMode = true;
    updateBookSwitch();
    updateConnectionUi();
    setView("savings");
    renderSavings();
    return;
  }
  if (!BOOKS.includes(book)) return;
  state.savingsMode = false;
  state.book = book;
  try { localStorage.setItem("kakeibo.book", book); } catch (_) {}
  state.selectedDate = latestSpendDate(state.selectedMonth);
  updateBookSwitch();
  updateConnectionUi();
  if (state.view === "savings") setView("home");
  renderAll();
}

function buildStoreHints() {
  if (!els.storeHints) return;
  const stores = [...new Set(state.entries.filter((entry) => entry.book === state.book).map((entry) => entry.store))];
  els.storeHints.innerHTML = stores.map((store) => `<option value="${escapeHtml(store)}"></option>`).join("");
}

function finishLoad(updatedText) {
  els.updatedLabel.textContent = updatedText;
  els.dataNote.textContent = `登録されている明細は全${state.entries.length}件です。`;
  els.loadingState.hidden = true;
  els.errorState.hidden = true;
  els.appContent.hidden = false;
  updateConnectionUi();
  updateBookSwitch();
  buildMonthSelect();
  buildCategoryChips();
  renderAll();
}

function timeLabel() {
  const now = new Date();
  return `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function updateConnectionUi() {
  const configured = Boolean(API_URL);
  els.loginCard.hidden = !configured || state.connected || !state.needsPin;
  els.syncBar.hidden = !state.connected;
  els.addEntryButton.hidden = !state.connected;
  els.receiptButton.hidden = !state.connected || state.savingsMode;
  els.syncBadge.textContent = state.connected ? "共有中" : "閲覧モード";
  els.budgetNote.textContent = state.connected
    ? "二人で共有されます"
    : "この端末だけに保存されます（接続すると共有）";
  if (state.connected) els.syncText.textContent = `共有に接続中 ・ ${timeLabel()} 同期`;
}

function setPin(pin) {
  state.pin = pin || "";
  try {
    if (state.pin) localStorage.setItem("kakeibo.pin", state.pin);
    else localStorage.removeItem("kakeibo.pin");
  } catch (_) {}
}

async function connectWithPin(pin, silent = false) {
  setPin(pin);
  const json = await apiGetState();
  state.connected = true;
  state.needsPin = false;
  state.categories = [...DEFAULT_CATEGORIES];
  state.budgets = flattenBudgets(json.budgets);
  writeJsonStorage("kakeibo.budgets", state.budgets);
  state.rules = Array.isArray(json.forecastRules) ? json.forecastRules : [];
  writeJsonStorage("kakeibo.rules", state.rules);
  state.savings = normalizeSavings(json.savings);
  writeJsonStorage("kakeibo.savings", state.savings);
  applyEntries((json.entries || []).map(normalizeApiEntry));
  finishLoad(`共有データ ・ ${timeLabel()} 同期`);
  startPolling();
  if (!silent) showToast("共有に接続しました");
}

async function refreshShared(silent = true) {
  if (!API_URL || !state.connected) return;
  try {
    const json = await apiGetState();
    const nextBudgets = flattenBudgets(json.budgets);
    const nextRules = Array.isArray(json.forecastRules) ? json.forecastRules : [];
    const nextSavings = normalizeSavings(json.savings);
    const nextEntries = (json.entries || []).map(normalizeApiEntry)
      .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
    const hash = JSON.stringify([nextEntries, nextBudgets, nextRules, nextSavings]);
    state.connected = true;
    if (hash !== state.stateHash) {
      state.budgets = nextBudgets;
      writeJsonStorage("kakeibo.budgets", state.budgets);
      state.rules = nextRules;
      writeJsonStorage("kakeibo.rules", state.rules);
      state.savings = nextSavings;
      writeJsonStorage("kakeibo.savings", state.savings);
      state.categories = [...DEFAULT_CATEGORIES];
      applyEntries(nextEntries);
      buildMonthSelect();
      buildCategoryChips();
      renderAll();
      if (!silent) showToast("新しいデータに更新しました");
    }
    updateConnectionUi();
  } catch (error) {
    if (error.code === "unauthorized" || error.code === "pin_not_set") {
      state.connected = false;
      state.needsPin = true;
      setPin("");
      updateConnectionUi();
      showToast("合言葉が必要になりました。再接続してください");
    }
  }
}

function startPolling() {
  if (state.pollTimer) return;
  state.pollTimer = window.setInterval(() => {
    if (!document.hidden) refreshShared(true);
  }, 15000);
}

async function loadData(showLoading = true) {
  if (showLoading) {
    els.loadingState.hidden = false;
    els.errorState.hidden = true;
    els.appContent.hidden = true;
  }
  if (API_URL) {
    try {
      await connectWithPin(state.pin, true);
      return;
    } catch (error) {
      state.connected = false;
      if (error.code === "unauthorized" || error.code === "pin_not_set") {
        state.needsPin = true;
        setPin("");
      }
    }
  }
  try {
    const response = await fetch(`data.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const raw = await response.json();
    const converted = convertData(raw);
    state.data = converted;
    state.categories = converted.categories;
    state.budgets = flattenLocalBudgets(readJsonStorage("kakeibo.budgets", {}));
    state.rules = readJsonStorage("kakeibo.rules", []);
    state.savings = normalizeSavings(readJsonStorage("kakeibo.savings", null));
    applyEntries(converted.entries);
    finishLoad(converted.updated_at ? `最終更新 ${converted.updated_at}` : "保存済みデータ");
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
  try { renderSavings(); } catch (error) { console.error(error); }
  renderHome();
  renderDaily();
  renderEntries();
  renderMonths();
  buildStoreHints();
}

function renderHome() {
  const stats = monthStats(state.selectedMonth);
  els.heroMonthLabel.textContent = `${state.book} ・ ${monthLabel(state.selectedMonth)}の支出`;
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
  if (stats.rulesBased) {
    const lines = stats.forecastLines && stats.forecastLines.length ? stats.forecastLines : (stats.forecastNotes || []);
    els.forecastNote.textContent = lines.length
      ? `予測の内訳（実績 ${yen(stats.total)} ＋ 残りの見込み）: ${lines.join(" ・ ")}`
      : "予測ルール未設定です。「予測ルールを編集」から追加できます";
  } else {
    els.forecastNote.textContent = stats.forecastNotes && stats.forecastNotes.length
      ? `予測の内訳: ${stats.forecastNotes.join(" ・ ")}（${stats.forecastFallback ? "買い物単価は全体の平均で仮置き" : "外食は実績の平均単価、嗜好品は申告の平均単価で計算"}）`
      : "";
  }
  if (stats.dining) {
    const d = stats.dining;
    const dayparts = [];
    if (d.lunch && d.lunch.trips > 0) dayparts.push(`昼 平均 ${yen(d.lunch.avg)}`);
    if (d.dinner && d.dinner.trips > 0) dayparts.push(`夜 平均 ${yen(d.dinner.avg)}`);
    const detail = dayparts.length ? `（${dayparts.join(" ・ ")}）` : ` ・ 平均 ${yen(d.avgTicket)}/回`;
    els.diningStatus.textContent = d.paceOver
      ? `外食ペースオーバー: 今月${d.trips}回（週2.5回ペース超過）・ 着地見込み ${yen(d.landing)}${detail}`
      : `外食: 今月${d.trips}回 ・ 着地見込み ${yen(d.landing)}${detail}`;
    els.diningStatus.classList.toggle("pace-over", d.paceOver);
  } else {
    els.diningStatus.textContent = "";
    els.diningStatus.classList.remove("pace-over");
  }
  renderBudget(stats);
  renderCategories(stats);
  renderChart(stats);
  renderInsights(stats);
}

function renderBudget(stats) {
  const budget = Number(state.budgets[budgetKey()]) || 0;
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
state.currentEntry = entry;
if (typeof resetDeleteButton === "function") resetDeleteButton();
els.deleteEntryButton.hidden = !(state.connected && entry.row);
els.editEntryButton.hidden = !(state.connected && entry.row);
const sameReceipt = state.entries.filter((item) => item.date === entry.date && (item.receipt_id === entry.receipt_id || item.store === entry.store))
.sort((a, b) => b.amount - a.amount);
const receiptTotal = sum(sameReceipt);
els.entryDialogContent.innerHTML = `
<div class="detail-hero"><span>${escapeHtml(entry.category)}</span><strong>${yen(entry.amount)}</strong></div>
<div class="detail-rows">
<div class="detail-row"><span>日付</span><div>${dateLabel(entry.date, true)}</div></div>
<div class="detail-row"><span>店名</span><div>${escapeHtml(entry.store)}</div></div>
<div class="detail-row"><span>帳簿</span><div>${escapeHtml(entry.book || "共有")}</div></div>
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
`【家計簿・${state.book}】${monthLabel(state.selectedMonth)}`,
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
const rows = [["日付", "店名・内容", "項目", "金額", "メモ", "帳簿"]];
items.forEach((entry) => rows.push([entry.date, entry.store, entry.category, entry.amount, entry.memo, entry.book || "共有"]));
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

function fileToResizedDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxDim = 1280;
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image_load_failed")); };
    img.src = url;
  });
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
els.refreshButton.addEventListener("click", async () => {
if (state.connected) { await refreshShared(false); }
else { await loadData(false); showToast("最新データに更新しました"); }
});
els.retryButton.addEventListener("click", () => loadData(true));
document.querySelectorAll("[data-chart-mode]").forEach((button) => {
button.addEventListener("click", () => { state.chartMode = button.dataset.chartMode; renderChart(monthStats(state.selectedMonth));});
});
document.querySelectorAll("[data-view]").forEach((button) => {
button.addEventListener("click", () => {
    if (state.savingsMode) {
      state.savingsMode = false;
      updateBookSwitch();
      updateConnectionUi();
    }
    setView(button.dataset.view);
  });
});
document.querySelectorAll("[data-book]").forEach((button) => {
button.addEventListener("click", () => selectBook(button.dataset.book));
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
const budget = Number(state.budgets[budgetKey()]) || "";
els.budgetInput.value = budget;
els.budgetForm.hidden =!els.budgetForm.hidden;
if (!els.budgetForm.hidden) els.budgetInput.focus();
});
els.budgetForm.addEventListener("submit", async (event) => {
event.preventDefault();
const value = Number(els.budgetInput.value) || 0;
if (state.connected) {
try {
await apiPost({ action: "setBudget", month: state.selectedMonth, amount: value, book: state.book });
await refreshShared(true);
showToast(value > 0 ? "予算を共有しました" : "予算を削除しました");
} catch (_) { showToast("予算を保存できませんでした"); }
return;
}
if (value > 0) state.budgets[budgetKey()] = value;
else delete state.budgets[budgetKey()];
writeJsonStorage("kakeibo.budgets", state.budgets);
renderBudget(monthStats(state.selectedMonth));
showToast(value > 0? "予算を保存しました": "予算を削除しました");
});
els.clearBudgetButton.addEventListener("click", async () => {
if (state.connected) {
try {
await apiPost({ action: "setBudget", month: state.selectedMonth, amount: 0, book: state.book });
await refreshShared(true);
showToast("予算を削除しました");
} catch (_) { showToast("予算を削除できませんでした"); }
return;
}
delete state.budgets[budgetKey()];
writeJsonStorage("kakeibo.budgets", state.budgets);
renderBudget(monthStats(state.selectedMonth));
showToast("予算を削除しました");
});
els.pinForm.addEventListener("submit", async (event) => {
event.preventDefault();
const pin = els.pinInput.value.trim();
if (!pin) return;
els.pinError.hidden = true;
try {
await connectWithPin(pin);
els.pinInput.value = "";
} catch (error) {
setPin("");
state.connected = false;
els.pinError.textContent = error.code === "pin_not_set"
? "合言葉がまだ設定されていません。管理者に連絡してください。"
: "合言葉が違うか、接続できませんでした。";
els.pinError.hidden = false;
}
});
els.disconnectButton.addEventListener("click", () => {
state.connected = false;
setPin("");
if (state.pollTimer) { window.clearInterval(state.pollTimer); state.pollTimer = null; }
loadData(false);
showToast("共有接続を解除しました");
});
els.addEntryButton.addEventListener("click", () => {
if (state.savingsMode) { openSavingForm(); return; }
els.formError.hidden = true;
state.editingRow = null;
els.entryFormTitle.textContent = "支出を記録";
els.formSubmitButton.textContent = "記録する";
const now = new Date();
els.formDate.value = formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
els.formStore.value = "";
els.formAmount.value = "";
els.formMemo.value = "";
els.formCategory.value = "食費";
els.formBook.value = state.book;
if (typeof els.entryFormDialog.showModal === "function") els.entryFormDialog.showModal();
});
els.editEntryButton.addEventListener("click", () => {
const entry = state.currentEntry;
if (!entry || !entry.row) return;
els.entryDialog.close();
state.editingRow = entry.row;
els.entryFormTitle.textContent = "明細を編集";
els.formSubmitButton.textContent = "更新する";
els.formError.hidden = true;
els.formDate.value = entry.date;
els.formStore.value = entry.store;
els.formCategory.value = entry.category;
els.formAmount.value = entry.amount;
els.formMemo.value = entry.memo || "";
els.formBook.value = entry.book || state.book;
if (typeof els.entryFormDialog.showModal === "function") els.entryFormDialog.showModal();
});
els.closeEntryFormButton.addEventListener("click", () => {
state.editingRow = null;
els.entryFormDialog.close();
});

function renderRulesList() {
const rules = rulesForBook(state.book);
if (!rules.length) {
els.rulesList.innerHTML = `<p class="rules-empty">${escapeHtml(state.book)} の予測ルールはまだありません。</p>`;
return;
}
const groups = [
{ title: "定期ルール", items: rules.filter((rule) => RECURRING_KINDS.includes(rule.kind)) },
{ title: "ランニングコスト（毎月）", items: rules.filter((rule) => rule.kind === "running") },
{ title: "特別費用", items: rules.filter((rule) => rule.kind === "once" || rule.kind === "fixed") }
];
els.rulesList.innerHTML = groups.filter((group) => group.items.length).map((group) => {
const subtotal = group.items.reduce((acc, rule) => acc + computeRuleAmount(rule, state.selectedMonth), 0);
const rows = group.items.map((rule) => {
const meta = RULE_KINDS[rule.kind] || {};
const countText = meta.needsCount ? ` ・ ${rule.count || 0}回` : "";
const monthText = rule.kind === "once" ? ` ・ ${rule.month || ""}` : "";
const dayText = rule.kind === "running" && rule.day ? ` ・ 毎月${rule.day}日` : "";
const canDelete = state.connected ? Boolean(rule.row) : true;
return `<div class="rule-row">
<div class="rule-row-main"><strong>${escapeHtml(rule.name || meta.label || "ルール")}</strong><span>${escapeHtml(meta.label || "")} ・ ${yen(rule.amount)}${countText}${monthText}${dayText} ・ 今月の見込み ${yen(computeRuleAmount(rule, state.selectedMonth))}</span></div>
${canDelete ? `<button type="button" class="rule-delete" data-rule-key="${rule.row || rule.id}">削除</button>` : ""}
</div>`;
}).join("");
return `<h3>${group.title} ・ 今月 ${yen(subtotal)}</h3>${rows}`;
}).join("");
}

function updateRuleCountVisibility() {
const meta = RULE_KINDS[els.ruleKind.value] || {};
els.ruleCountWrap.hidden = !meta.needsCount;
els.ruleDayWrap.hidden = !meta.needsDay;
}

function updateRuleNameVisibility() {
els.ruleNameWrap.hidden = els.ruleNamePreset.value !== "__custom";
els.ruleSubWrap.hidden = els.ruleNamePreset.value !== "サブスク";
}

els.rulesButton.addEventListener("click", () => {
renderRulesList();
updateRuleCountVisibility();
updateRuleNameVisibility();
if (typeof els.rulesDialog.showModal === "function") els.rulesDialog.showModal();
});
els.closeRulesButton.addEventListener("click", () => els.rulesDialog.close());
els.ruleKind.addEventListener("change", updateRuleCountVisibility);
els.ruleNamePreset.addEventListener("change", updateRuleNameVisibility);
els.rulesList.addEventListener("click", async (event) => {
const button = event.target.closest("[data-rule-key]");
if (!button) return;
const key = button.dataset.ruleKey;
button.disabled = true;
try {
if (state.connected) {
await apiPost({ action: "deleteRule", row: Number(key) });
await refreshShared(true);
} else {
state.rules = state.rules.filter((rule) => String(rule.id) !== String(key));
writeJsonStorage("kakeibo.rules", state.rules);
}
showToast("予測ルールを削除しました");
} catch (_) {
showToast("削除できませんでした");
} finally {
renderRulesList();
renderAll();
}
});
els.ruleForm.addEventListener("submit", async (event) => {
event.preventDefault();
const kind = els.ruleKind.value;
const meta = RULE_KINDS[kind] || {};
let resolvedRuleName = els.ruleNamePreset.value === "__custom" ? els.ruleName.value.trim() : els.ruleNamePreset.value;
if (els.ruleNamePreset.value === "サブスク") {
const subName = els.ruleSubName.value.trim();
if (subName) resolvedRuleName = `サブスク（${subName}）`;
}
const rule = {
book: state.book,
kind,
name: resolvedRuleName,
amount: Number(els.ruleAmount.value) || 0,
count: meta.needsCount ? (Number(els.ruleCount.value) || 0) : 0,
month: kind === "once" ? state.selectedMonth : "",
day: meta.needsDay ? (Number(els.ruleDay.value) || 0) : 0
};
if (!(rule.amount > 0) || (meta.needsCount && !(rule.count > 0))) {
els.ruleError.textContent = "金額（と回数）を入れてください。";
els.ruleError.hidden = false;
return;
}
els.ruleError.hidden = true;
try {
if (state.connected) {
await apiPost({ action: "addRule", rule });
await refreshShared(true);
} else {
rule.id = `local-${Date.now()}`;
state.rules = [...state.rules, rule];
writeJsonStorage("kakeibo.rules", state.rules);
}
els.ruleName.value = "";
els.ruleAmount.value = "";
els.ruleCount.value = "";
els.ruleDay.value = "";
showToast("予測ルールを追加しました");
} catch (_) {
els.ruleError.textContent = "保存できませんでした。接続を確認してください。";
els.ruleError.hidden = false;
} finally {
renderRulesList();
renderAll();
}
});
els.entryForm.addEventListener("submit", async (event) => {
event.preventDefault();
const entry = {
date: els.formDate.value,
store: els.formStore.value.trim(),
category: els.formCategory.value,
amount: Number(els.formAmount.value) || 0,
memo: els.formMemo.value.trim(),
book: els.formBook.value
};
if (!entry.date || !entry.store || !(entry.amount > 0)) {
els.formError.textContent = "日付・店名・金額を入れてください。";
els.formError.hidden = false;
return;
}
els.formSubmitButton.disabled = true;
try {
if (state.editingRow) {
await apiPost({ action: "updateEntry", row: state.editingRow, entry });
showToast("更新しました");
} else {
await apiPost({ action: "addEntry", entry });
showToast("記録しました");
}
state.editingRow = null;
els.entryFormDialog.close();
if (entry.book !== state.book) selectBook(entry.book);
state.selectedMonth = monthKeyFromDate(entry.date);
state.selectedDate = entry.date;
buildMonthSelect();
await refreshShared(true);
setView("daily");
} catch (_) {
els.formError.textContent = "保存できませんでした。接続を確認してください。";
els.formError.hidden = false;
} finally {
els.formSubmitButton.disabled = false;
}
});
let deleteArmed = false;
let deleteArmTimer = null;
function resetDeleteButton() {
deleteArmed = false;
if (deleteArmTimer) window.clearTimeout(deleteArmTimer);
els.deleteEntryButton.textContent = "この明細を削除";
els.deleteEntryButton.classList.remove("armed");
}
els.deleteEntryButton.addEventListener("click", async () => {
const entry = state.currentEntry;
if (!entry || !entry.row) return;
if (!deleteArmed) {
deleteArmed = true;
els.deleteEntryButton.textContent = `「${entry.store}」${yen(entry.amount)} を削除します（もう一度タップで確定）`;
els.deleteEntryButton.classList.add("armed");
deleteArmTimer = window.setTimeout(resetDeleteButton, 4000);
return;
}
resetDeleteButton();
try {
await apiPost({ action: "deleteEntry", row: entry.row });
els.entryDialog.close();
showToast("削除しました");
await refreshShared(true);
} catch (_) { showToast("削除できませんでした"); }
});
els.receiptButton.addEventListener("click", () => els.receiptInput.click());
els.receiptInput.addEventListener("change", async () => {
const file = els.receiptInput.files && els.receiptInput.files[0];
els.receiptInput.value = "";
if (!file) return;
try {
showToast("レシートを送信しています");
const dataUrl = await fileToResizedDataUrl(file);
await apiPost({ action: "uploadReceipt", image: dataUrl, book: state.book });
showToast("レシートを送りました。内容はMuseが読み取って記録します");
} catch (_) {
showToast("レシートを送れませんでした");
}
});
document.addEventListener("visibilitychange", () => {
if (!document.hidden) refreshShared(true);
});
window.addEventListener("hashchange", () => {
const view = location.hash.replace("#", "");
if (["home", "daily", "entries", "months"].includes(view)) setView(view, false);
});
}

/* ================= 貯金 ================= */
function normalizeSavings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const movements = Array.isArray(source.movements) ? source.movements
    .filter((m) => m && /^\d{4}-\d{2}-\d{2}$/.test(String(m.date || "")) && Number(m.amount) > 0)
    .map((m) => ({
      row: m.row || m.id || null,
      date: String(m.date),
      type: m.type === "出金" ? "出金" : "入金",
      amount: Math.round(Number(m.amount) || 0),
      memo: String(m.memo || ""),
      goal: String(m.goal || "")
    })) : [];
  const goals = Array.isArray(source.goals) ? source.goals
    .filter((g) => g && g.name && Number(g.target) > 0)
    .map((g) => ({ row: g.row || null, name: String(g.name), target: Math.round(Number(g.target) || 0) })) : [];
  return { movements, goals };
}

function savingDateLabel(dateStr) {
  const parts = String(dateStr || "").split("-");
  if (parts.length !== 3) return String(dateStr || "");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

function savingsBalance(goalName) {
  return state.savings.movements
    .filter((m) => !goalName || m.goal === goalName)
    .reduce((sum, m) => sum + (m.type === "出金" ? -m.amount : m.amount), 0);
}

function savingsMonthNet(ym) {
  return state.savings.movements
    .filter((m) => m.date.startsWith(ym))
    .reduce((sum, m) => sum + (m.type === "出金" ? -m.amount : m.amount), 0);
}

function savingsMonthlyAverage() {
  const now = new Date();
  const nets = [];
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const net = savingsMonthNet(key);
    if (i === 0 || state.savings.movements.some((m) => m.date.startsWith(key))) nets.push(net);
  }
  if (!nets.length) return 0;
  return Math.round(nets.reduce((a, b) => a + b, 0) / nets.length);
}

function renderSavings() {
  if (!els.savingsTotal) return;
  const balance = savingsBalance("");
  els.savingsTotal.textContent = yen(balance);
  const nowKey = browserMonthKey();
  els.savingsMonthNet.textContent = signedYen(savingsMonthNet(nowKey));
  const average = savingsMonthlyAverage();
  els.savingsPace.textContent = average > 0 ? `月 ${yen(average)}` : "—";
  els.savingsCount.textContent = `${state.savings.movements.length}件`;
  const nearest = state.savings.goals
    .map((g) => ({ goal: g, current: savingsBalance(g.name) }))
    .filter((x) => x.current < x.goal.target)
    .sort((a, b) => (b.current / b.goal.target) - (a.current / a.goal.target))[0];
  els.savingsNote.textContent = nearest && average > 0
    ? `「${nearest.goal.name}」まであと ${yen(nearest.goal.target - nearest.current)}。今のペースだと約${Math.max(1, Math.ceil((nearest.goal.target - nearest.current) / average))}ヶ月で到達見込みです。`
    : (state.savings.goals.length ? "目標を設定すると、到達までの見込みが表示されます。" : "下のフォームから貯金の目標を設定できます。");

  els.savingsGoals.innerHTML = state.savings.goals.length ? "" : `<p class="empty-note">目標はまだありません</p>`;
  state.savings.goals.forEach((goal) => {
    const current = savingsBalance(goal.name);
    const pct = Math.min(100, Math.max(0, current / goal.target * 100));
    const row = document.createElement("div");
    row.className = "goal-row";
    row.innerHTML = `
      <div class="goal-row-head"><strong></strong><span>${yen(current)} / ${yen(goal.target)}</span></div>
      <div class="progress-track"><div style="width:${pct.toFixed(1)}%"></div></div>
      <p class="progress-caption">${current >= goal.target ? "達成しました！" : `達成率 ${pct.toFixed(0)}% ・ あと ${yen(goal.target - current)}`}</p>
      <div class="goal-actions"><button class="mini-button danger" type="button">この目標を削除</button></div>`;
    row.querySelector("strong").textContent = goal.name;
    row.querySelector(".mini-button").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!state.connected) { showToast("共有に接続すると目標を変更できます"); return; }
      if (button.dataset.armed !== "1") {
        button.dataset.armed = "1";
        button.textContent = `「${goal.name}」を削除します（もう一度タップで確定）`;
        window.setTimeout(() => { button.dataset.armed = ""; button.textContent = "この目標を削除"; }, 4000);
        return;
      }
      try {
        await apiPost({ action: "setSavingGoal", name: goal.name, target: 0 });
        await refreshShared(false);
        showToast("目標を削除しました（貯金の記録は残ります）");
      } catch (error) { showToast("削除に失敗しました"); }
    });
    els.savingsGoals.append(row);
  });

  const sorted = [...state.savings.movements].sort((a, b) => (b.date + String(b.row || "")).localeCompare(a.date + String(a.row || "")));
  els.savingsList.innerHTML = sorted.length ? "" : `<p class="empty-note">貯金の記録はまだありません</p>`;
  sorted.slice(0, 60).forEach((movement) => {
    const row = document.createElement("div");
    row.className = "saving-row";
    const title = [movement.goal, movement.memo].filter(Boolean).join(" ・ ") || (movement.type === "入金" ? "貯金" : "取り崩し");
    row.innerHTML = `
      <div class="saving-row-main"><strong></strong><span>${savingDateLabel(movement.date)} ・ ${movement.type}</span></div>
      <span class="saving-amount ${movement.type === "入金" ? "in" : "out"}">${movement.type === "入金" ? "+" : "−"}${yen(movement.amount)}</span>
      <button class="mini-button danger" type="button">削除</button>`;
    row.querySelector("strong").textContent = title;
    row.querySelector(".mini-button").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!state.connected) { showToast("共有に接続すると削除できます"); return; }
      if (!movement.row) return;
      if (button.dataset.armed !== "1") {
        button.dataset.armed = "1";
        button.textContent = "確定";
        window.setTimeout(() => { button.dataset.armed = ""; button.textContent = "削除"; }, 4000);
        return;
      }
      try {
        await apiPost({ action: "deleteSaving", row: movement.row });
        await refreshShared(false);
        showToast("貯金の記録を削除しました");
      } catch (error) { showToast("削除に失敗しました"); }
    });
    els.savingsList.append(row);
  });

  els.savingGoalSelect.innerHTML = "";
  const common = document.createElement("option");
  common.value = "";
  common.textContent = "共通（目標なし）";
  els.savingGoalSelect.append(common);
  state.savings.goals.forEach((goal) => {
    const option = document.createElement("option");
    option.value = goal.name;
    option.textContent = goal.name;
    els.savingGoalSelect.append(option);
  });
}

function openSavingForm() {
  els.savingError.hidden = true;
  const now = new Date();
  els.savingDate.value = formatDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  els.savingType.value = "入金";
  els.savingAmount.value = "";
  els.savingMemo.value = "";
  renderSavings();
  if (typeof els.savingFormDialog.showModal === "function") els.savingFormDialog.showModal();
}

els.closeSavingFormButton.addEventListener("click", () => els.savingFormDialog.close());
els.savingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const entry = {
    date: els.savingDate.value,
    type: els.savingType.value,
    amount: Math.round(Number(els.savingAmount.value) || 0),
    goal: els.savingGoalSelect.value,
    memo: els.savingMemo.value.trim()
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !(entry.amount > 0)) {
    els.savingError.textContent = "日付と金額を確認してください";
    els.savingError.hidden = false;
    return;
  }
  els.savingSubmitButton.disabled = true;
  try {
    if (state.connected) {
      await apiPost({ action: "addSaving", entry });
      els.savingFormDialog.close();
      await refreshShared(false);
      showToast("貯金を記録しました");
    } else {
      state.savings.movements.push({ ...entry, row: null });
      writeJsonStorage("kakeibo.savings", state.savings);
      els.savingFormDialog.close();
      renderSavings();
      showToast("この端末に保存しました（接続すると共有）");
    }
  } catch (error) {
    els.savingError.textContent = "保存に失敗しました";
    els.savingError.hidden = false;
  } finally {
    els.savingSubmitButton.disabled = false;
  }
});

els.goalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = els.goalName.value.trim();
  const target = Math.round(Number(els.goalTarget.value) || 0);
  if (!name) { showToast("目標の名前を入れてください"); return; }
  if (!state.connected) { showToast("共有に接続すると目標を保存できます"); return; }
  try {
    await apiPost({ action: "setSavingGoal", name, target });
    els.goalName.value = "";
    els.goalTarget.value = "";
    await refreshShared(false);
    showToast(target > 0 ? "目標を保存しました" : "目標を削除しました");
  } catch (error) { showToast("目標の保存に失敗しました"); }
});

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
