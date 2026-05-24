const DAYS = Array.from({ length: 30 }, (_, index) => index + 1);
const STORAGE_KEY = "lab-finance-ledger-v1";
const STATE_KEY = "lab-finance-state-v1";
const LOAN_AMOUNT = 1000;
const LOAN_RATE = 0.1;

const data = window.financeData ?? { orders: [], expenses: [], devices: [], materials: [], randomEvents: [] };
let entries = loadEntries();
let financeState = loadState();

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currentDaySelect = document.querySelector("#currentDay");
const incomeSelect = document.querySelector("#incomeSelect");
const expenseSelect = document.querySelector("#expenseSelect");
const invoiceCodeInput = document.querySelector("#invoiceCodeInput");
const invoiceCodeFeedback = document.querySelector("#invoiceCodeFeedback");
const incomeAmount = document.querySelector("#incomeAmount");
const expenseAmount = document.querySelector("#expenseAmount");
const loanBalance = document.querySelector("#loanBalance");
const ledgerBody = document.querySelector("#ledgerBody");
const dailyBalances = document.querySelector("#dailyBalances");
const randomEventNotice = document.querySelector("#randomEventNotice");
const totalIncome = document.querySelector("#totalIncome");
const totalExpense = document.querySelector("#totalExpense");
const totalBalance = document.querySelector("#totalBalance");
const totalDebt = document.querySelector("#totalDebt");
const grandBalance = document.querySelector("#grandBalance");
const addIncomeBtn = document.querySelector("#addIncomeBtn");
const addExpenseBtn = document.querySelector("#addExpenseBtn");
const takeLoanBtn = document.querySelector("#takeLoanBtn");
const repayLoanBtn = document.querySelector("#repayLoanBtn");

addIncomeBtn.addEventListener("click", addIncome);
addExpenseBtn.addEventListener("click", addExpense);
takeLoanBtn.addEventListener("click", takeLoan);
repayLoanBtn.addEventListener("click", repayLoan);
document.querySelector("#clearBtn").addEventListener("click", clearLedger);
document.querySelector("#exportBtn").addEventListener("click", exportCsv);
incomeSelect.addEventListener("change", updatePreviews);
invoiceCodeInput.addEventListener("input", updatePreviews);
expenseSelect.addEventListener("change", updatePreviews);
currentDaySelect.addEventListener("change", changeCurrentDay);

init();

function init() {
  render();
}

function fillCurrentDaySelect() {
  const currentDay = financeState.currentDay ?? 1;
  const startGrantTaken = hasStartGrant();
  currentDaySelect.innerHTML = DAYS.map((day) => {
    const past = day < currentDay;
    const future = startGrantTaken ? day > currentDay + 1 : day > currentDay;
    const locked = past || future;
    const suffix = past ? " - zamknięty" : future ? " - niedostępny" : "";
    return `<option value="${day}" ${locked ? "disabled" : ""}>Dzień ${day}${suffix}</option>`;
  }).join("");
  currentDaySelect.value = String(currentDay);
}

function changeCurrentDay() {
  const selectedDay = Number(currentDaySelect.value);
  if (!hasStartGrant() && selectedDay !== financeState.currentDay) {
    currentDaySelect.value = String(financeState.currentDay);
    return;
  }
  if (selectedDay < financeState.currentDay || selectedDay > financeState.currentDay + 1) {
    currentDaySelect.value = String(financeState.currentDay);
    return;
  }
  financeState.currentDay = selectedDay;
  ensureDayStarted(selectedDay);
  persist();
  render();
}

function fillIncomeSelect() {
  const usedIncomeIds = new Set(entries.filter((entry) => entry.type === "income").map((entry) => entry.itemId));
  const startGrantTaken = hasStartGrant();
  const orderedItems = [...data.orders].sort((a, b) => {
    if (a.id === "G1") return -1;
    if (b.id === "G1") return 1;
    return 0;
  });
  incomeSelect.innerHTML = orderedItems
    .map((item) => {
      const used = usedIncomeIds.has(item.id);
      const lockedBeforeStart = !startGrantTaken && item.id !== "G1";
      const disabled = used || lockedBeforeStart;
      const suffix = used ? (isGrant(item.id) ? " - wykorzystany" : " - zrealizowane") : "";
      return `<option value="${item.id}" ${disabled ? "disabled" : ""}>${escapeHtml(item.name)} (${formatMoney(item.amount)})${suffix}</option>`;
    })
    .join("");

  const firstAvailable = [...incomeSelect.options].find((option) => !option.disabled);
  incomeSelect.disabled = !firstAvailable;
  addIncomeBtn.disabled = !firstAvailable;
  if (firstAvailable) incomeSelect.value = firstAvailable.value;
}

function fillExpenseSelect() {
  const selectedIds = new Set(selectedExpenseItems().map((item) => item.id));
  const purchasedIds = new Set(entries.filter((entry) => entry.type === "expense").map((entry) => entry.itemId));
  const optionFor = (item, prefix) => {
    const purchased = purchasedIds.has(item.id);
    const checked = selectedIds.has(item.id) && !purchased;
    const suffix = purchased ? " - zakupione" : "";
    return `
      <label class="expense-choice ${purchased ? "disabled" : ""}">
        <input type="checkbox" value="${item.id}" ${checked ? "checked" : ""} ${purchased ? "disabled" : ""} />
        <span>${prefix}: ${escapeHtml(item.name)} (${formatMoney(item.amount)})${suffix}</span>
      </label>
    `;
  };

  const groupFor = (label, items, prefix) => `
    <div class="expense-choice-group">
      <strong>${label}</strong>
      ${items.map((item) => optionFor(item, prefix)).join("")}
    </div>
  `;

  expenseSelect.innerHTML = `
    ${groupFor("Urządzenia", data.devices, "Urządzenie")}
    ${groupFor("Materiały", data.materials, "Materiał")}
    ${groupFor("Usługi", data.services ?? [], "Usługa")}
  `;

  expenseSelect.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
    checkbox.addEventListener("change", updatePreviews);
  });
}

function updatePreviews() {
  const income = data.orders.find((item) => item.id === incomeSelect.value);
  const selectedExpenses = selectedExpenseItems();
  const expenseTotal = selectedExpenses.reduce((sum, item) => sum + item.amount, 0);
  const balance = currentBalance();
  const hasFunds = selectedExpenses.length > 0 && expenseTotal <= balance;
  const startGrantTaken = hasStartGrant();

  incomeAmount.textContent = formatMoney(income?.amount ?? 0);
  renderInvoiceCodeState(income);
  expenseAmount.textContent = formatMoney(expenseTotal);
  expenseAmount.classList.remove("negative");
  addExpenseBtn.disabled = !startGrantTaken || selectedExpenses.length === 0 || !hasFunds;

  loanBalance.textContent = formatMoney(financeState.loanPrincipal);
  takeLoanBtn.disabled = !startGrantTaken || financeState.loanPrincipal > 0;
  repayLoanBtn.disabled = !startGrantTaken || financeState.loanPrincipal <= 0 || balance < financeState.loanPrincipal;

  grandBalance.textContent = formatMoney(balance);
  grandBalance.classList.toggle("negative", balance < 0);
}

function addIncome() {
  const item = data.orders.find((order) => order.id === incomeSelect.value);
  if (!item) return;
  if (!hasStartGrant() && item.id !== "G1") return;
  if (!isInvoiceCodeValid(item)) {
    renderInvoiceCodeState(item, true);
    return;
  }
  const alreadyBooked = entries.some((entry) => entry.type === "income" && entry.itemId === item.id);
  if (alreadyBooked) return;

  const day = activeDay();
  entries.push(createEntry({
    day,
    type: "income",
    itemId: item.id,
    name: item.name,
    amount: item.amount,
    signedAmount: item.amount,
  }));
  invoiceCodeInput.value = "";

  persist();
  render();
}

function addExpense() {
  if (!hasStartGrant()) return;
  const selectedExpenses = selectedExpenseItems();
  if (!selectedExpenses.length) return;

  const day = activeDay();
  const total = selectedExpenses.reduce((sum, item) => sum + item.amount, 0);
  if (total > currentBalance()) {
    updatePreviews();
    return;
  }

  for (const item of selectedExpenses) {
    entries.push(createEntry({
      day,
      type: "expense",
      itemId: item.id,
      name: item.name,
      category: item.kind,
      amount: item.amount,
      signedAmount: -item.amount,
    }));
  }

  persist();
  render();
}

function takeLoan() {
  if (!hasStartGrant()) return;
  if (financeState.loanPrincipal > 0) return;
  const day = activeDay();
  financeState.loanPrincipal = LOAN_AMOUNT;
  financeState.loanStartDay = day;
  entries.push(createEntry({
    day,
    type: "loan-in",
    itemId: "LOAN-1000",
    name: "Kredyt 1000 USD",
    amount: LOAN_AMOUNT,
    signedAmount: LOAN_AMOUNT,
  }));
  persist();
  render();
}

function repayLoan() {
  if (!hasStartGrant()) return;
  if (financeState.loanPrincipal <= 0) return;
  if (currentBalance() < financeState.loanPrincipal) return;
  const day = activeDay();
  const amount = financeState.loanPrincipal;
  financeState.loanPrincipal = 0;
  entries.push(createEntry({
    day,
    type: "loan-payment",
    itemId: "LOAN-REPAY",
    name: "Spłata kredytu",
    amount,
    signedAmount: -amount,
    principalPaid: amount,
  }));
  persist();
  render();
}

function ensureDayStarted(day) {
  if (financeState.startedDays.includes(day)) return;
  financeState.startedDays.push(day);
  applyRandomEvent(day);
  applyLoanCharge(day);
}

function applyRandomEvent(day) {
  if (!data.randomEvents?.length) return;
  if (day === 1) return;
  const eventPool = day <= 4 ? data.randomEvents.filter((event) => Number(event.amount) > 0) : data.randomEvents;
  const event = eventPool[Math.floor(Math.random() * eventPool.length)];
  const signedAmount = Number(event.amount);
  const entry = createEntry({
    day,
    type: signedAmount >= 0 ? "gain" : "loss",
    itemId: `RANDOM-${event.id}`,
    name: event.name,
    amount: Math.abs(signedAmount),
    signedAmount,
    source: "random-event",
  });
  entries.push(entry);
  financeState.lastRandomEventId = entry.id;
}

function applyLoanCharge(day) {
  if (financeState.loanPrincipal <= 0) return;
  if (day <= (financeState.loanStartDay ?? 0)) return;
  if (financeState.loanChargedDays.includes(day)) return;

  const principalBefore = financeState.loanPrincipal;
  const principalPayment = Math.min(principalBefore, Math.ceil(principalBefore * LOAN_RATE));
  const interest = Math.ceil(principalBefore * LOAN_RATE);
  const amount = principalPayment + interest;
  financeState.loanPrincipal = Math.max(0, principalBefore - principalPayment);
  financeState.loanChargedDays.push(day);

  entries.push(createEntry({
    day,
    type: "loan-payment",
    itemId: `LOAN-DAY-${day}`,
    name: `Dzienna spłata kredytu: kapitał ${formatMoney(principalPayment)}, odsetki ${formatMoney(interest)}`,
    amount,
    signedAmount: -amount,
    principalPaid: principalPayment,
    interest,
    source: "loan-auto",
  }));
}

function render() {
  fillCurrentDaySelect();
  fillIncomeSelect();
  fillExpenseSelect();
  renderLedger();
  renderSummary();
  renderRandomNotice();
  updatePreviews();
}

function renderLedger() {
  const sorted = [...entries].sort((a, b) => a.day - b.day || entryOrder(a) - entryOrder(b) || a.name.localeCompare(b.name, "pl"));

  if (!sorted.length) {
    ledgerBody.innerHTML = `<tr class="empty-row"><td colspan="5">Dodaj pierwsze zlecenie albo zakup z panelu po lewej.</td></tr>`;
    return;
  }

  ledgerBody.innerHTML = sorted
    .map(
      (entry) => {
        const locked = isProtectedEntry(entry);
        return `
        <tr>
          <td>Dzień ${entry.day}</td>
          <td><span class="entry-type ${entry.type}">${entryTypeLabel(entry)}</span></td>
          <td>${escapeHtml(entry.name)}</td>
          <td>${formatMoney(entryValue(entry))}</td>
          <td>${locked ? '<span class="locked-row" title="Wpis automatyczny">auto</span>' : `<button class="remove-row" type="button" data-id="${entry.id}" aria-label="Usuń operację">×</button>`}</td>
        </tr>
      `;
      },
    )
    .join("");

  ledgerBody.querySelectorAll(".remove-row").forEach((button) => {
    button.addEventListener("click", () => {
      removeEntry(button.dataset.id);
      persist();
      render();
    });
  });
}

function renderSummary() {
  const positive = entries.reduce((sum, entry) => sum + Math.max(0, entryValue(entry)), 0);
  const negative = entries.reduce((sum, entry) => sum + Math.abs(Math.min(0, entryValue(entry))), 0);
  const cashIn = entries
    .filter((entry) => entry.type !== "loan-in")
    .reduce((sum, entry) => sum + Math.max(0, entryValue(entry)), 0);
  const cashOut = entries.reduce((sum, entry) => sum + Math.abs(Math.min(0, entryValue(entry))), 0);
  const balance = positive - negative;

  totalIncome.textContent = formatMoney(cashIn);
  totalExpense.textContent = formatMoney(cashOut);
  totalBalance.textContent = formatMoney(balance);
  totalDebt.textContent = formatMoney(financeState.loanPrincipal);
  grandBalance.textContent = formatMoney(balance);
  totalBalance.classList.toggle("negative", balance < 0);
  totalDebt.classList.toggle("negative", financeState.loanPrincipal > 0);
  grandBalance.classList.toggle("negative", balance < 0);

  dailyBalances.innerHTML = DAYS.map((day) => {
    const dayEntries = entries.filter((entry) => entry.day === day);
    const dayIncome = dayEntries.reduce((sum, entry) => sum + Math.max(0, entryValue(entry)), 0);
    const dayExpense = dayEntries.reduce((sum, entry) => sum + Math.abs(Math.min(0, entryValue(entry))), 0);
    const dayBalance = dayIncome - dayExpense;

    return `
      <div class="day-row">
        <b>${day}</b>
        <div>
          <span>${formatMoney(dayIncome)} / ${formatMoney(dayExpense)}</span>
          <strong class="${dayBalance < 0 ? "negative" : ""}">${formatMoney(dayBalance)}</strong>
        </div>
      </div>
    `;
  }).join("");
}

function renderRandomNotice() {
  const last = entries.find((entry) => entry.id === financeState.lastRandomEventId)
    ?? [...entries].reverse().find((entry) => entry.source === "random-event");

  if (!last) {
    randomEventNotice.textContent = "Pierwsza operacja w nowym dniu uruchomi zdarzenie losowe.";
    return;
  }

  const value = entryValue(last);
  randomEventNotice.innerHTML = `
    <strong>Dzień ${last.day} - ${escapeHtml(last.name)}</strong>
    <span class="${value < 0 ? "negative" : "positive"}">${formatMoney(value)}</span>
  `;
}

function removeEntry(id) {
  const entry = entries.find((item) => item.id === id);
  entries = entries.filter((item) => item.id !== id);
  if (!entry) {
    reconcileDayState();
    return;
  }

  if (entry.type === "loan-in" || entry.type === "loan-payment") {
    rebuildLoanState();
  }
  if (entry.source === "random-event") {
    financeState.startedDays = financeState.startedDays.filter((day) => day !== entry.day);
    if (financeState.lastRandomEventId === id) financeState.lastRandomEventId = null;
  }
  reconcileDayState();
}

function reconcileDayState() {
  const daysWithEntries = [...new Set(entries.map((entry) => entry.day))].sort((a, b) => a - b);
  const highestDay = daysWithEntries.at(-1) ?? 1;
  financeState.currentDay = highestDay;
  financeState.startedDays = financeState.startedDays.filter((day) => daysWithEntries.includes(day));
  if (!entries.some((entry) => entry.id === financeState.lastRandomEventId)) {
    financeState.lastRandomEventId = [...entries].reverse().find((entry) => entry.source === "random-event")?.id ?? null;
  }
}

function rebuildLoanState() {
  financeState.loanPrincipal = 0;
  financeState.loanStartDay = null;
  financeState.loanChargedDays = [];
  for (const entry of entries.sort((a, b) => a.day - b.day || entryOrder(a) - entryOrder(b))) {
    if (entry.type === "loan-in") {
      financeState.loanPrincipal += entry.amount;
      financeState.loanStartDay = financeState.loanStartDay ?? entry.day;
    }
    if (entry.type === "loan-payment") {
      const principalPaid = entry.principalPaid ?? entry.amount;
      financeState.loanPrincipal = Math.max(0, financeState.loanPrincipal - Math.min(financeState.loanPrincipal, principalPaid));
      if (entry.source === "loan-auto") financeState.loanChargedDays.push(entry.day);
    }
  }
}

function currentBalance() {
  return entries.reduce((sum, entry) => sum + entryValue(entry), 0);
}

function selectedExpenseItems() {
  if (!expenseSelect) return [];
  const purchasedIds = new Set(entries.filter((entry) => entry.type === "expense").map((entry) => entry.itemId));
  return [...expenseSelect.querySelectorAll('input[type="checkbox"]:checked')]
    .map((checkbox) => data.expenses.find((expense) => expense.id === checkbox.value))
    .filter((item) => item && !purchasedIds.has(item.id));
}

function isInvoiceCodeValid(order) {
  if (!order?.invoiceCode) return true;
  return invoiceCodeInput.value.trim() === order.invoiceCode;
}

function renderInvoiceCodeState(order, forceError = false) {
  if (!order?.invoiceCode) {
    invoiceCodeInput.disabled = true;
    invoiceCodeInput.value = "";
    invoiceCodeInput.classList.remove("invalid");
    invoiceCodeFeedback.textContent = "Kod faktury nie jest wymagany dla tej pozycji.";
    invoiceCodeFeedback.classList.remove("error");
    return;
  }

  invoiceCodeInput.disabled = false;
  const typed = invoiceCodeInput.value.trim();
  const valid = typed === order.invoiceCode;
  const shouldShowError = forceError || (typed.length === 3 && !valid);
  invoiceCodeInput.classList.toggle("invalid", shouldShowError);
  invoiceCodeFeedback.textContent = shouldShowError
    ? "Niepoprawny kod faktury. Poproś prowadzącego o potwierdzenie realizacji zlecenia."
    : "Wpisz trzycyfrowy kod faktury zatwierdzony przez prowadzącego.";
  invoiceCodeFeedback.classList.toggle("error", shouldShowError);
}

function activeDay() {
  return financeState.currentDay ?? 1;
}

function clearLedger() {
  const confirmed = window.confirm("Wyczyścić wszystkie operacje finansowe?");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STATE_KEY);
  entries = [];
  financeState = defaultState();
  render();
}

function exportCsv() {
  const header = ["Dzień", "Typ", "Tytuł", "Kwota"];
  const rows = entries
    .sort((a, b) => a.day - b.day || entryOrder(a) - entryOrder(b) || a.name.localeCompare(b.name, "pl"))
    .map((entry) => [entry.day, entryTypeLabel(entry), entry.name, entryValue(entry)]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ksiega_finansowa_laboratorium.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function createEntry(entry) {
  return {
    id: crypto.randomUUID(),
    quantity: 1,
    unitAmount: entry.amount,
    ...entry,
  };
}

function entryValue(entry) {
  if (typeof entry.signedAmount === "number") return entry.signedAmount;
  return entry.type === "income" ? entry.amount : -entry.amount;
}

function entryTypeLabel(entry) {
  return {
    income: "Przychód",
    expense: "Wydatek",
    gain: "Zysk losowy",
    loss: "Strata losowa",
    "loan-in": "Kredyt",
    "loan-payment": "Spłata kredytu",
  }[entry.type] ?? "Operacja";
}

function entryOrder(entry) {
  return {
    gain: 1,
    loss: 1,
    "loan-payment": 2,
    "loan-in": 3,
    income: 4,
    expense: 5,
  }[entry.type] ?? 9;
}

function isProtectedEntry(entry) {
  return entry.source === "random-event" || entry.source === "loan-auto" || entry.type === "loan-in" || entry.type === "loan-payment";
}

function formatMoney(value) {
  return money.format(value).replace(/\s?US\$/, " USD");
}

function isGrant(id) {
  return String(id).startsWith("G");
}

function hasStartGrant() {
  return entries.some((entry) => entry.type === "income" && entry.itemId === "G1");
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  localStorage.setItem(STATE_KEY, JSON.stringify(financeState));
}

function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function loadState() {
  try {
    return { ...defaultState(), ...(JSON.parse(localStorage.getItem(STATE_KEY)) ?? {}) };
  } catch {
    return defaultState();
  }
}

function defaultState() {
  return {
    startedDays: [],
    currentDay: 1,
    loanPrincipal: 0,
    loanStartDay: null,
    loanChargedDays: [],
    lastRandomEventId: null,
  };
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
