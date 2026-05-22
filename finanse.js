const DAYS = Array.from({ length: 30 }, (_, index) => index + 1);
const STORAGE_KEY = "lab-finance-ledger-v1";

const data = window.financeData ?? { orders: [], expenses: [], devices: [], materials: [] };
let entries = loadEntries();

const money = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const incomeDay = document.querySelector("#incomeDay");
const expenseDay = document.querySelector("#expenseDay");
const incomeSelect = document.querySelector("#incomeSelect");
const expenseSelect = document.querySelector("#expenseSelect");
const incomeAmount = document.querySelector("#incomeAmount");
const expenseAmount = document.querySelector("#expenseAmount");
const ledgerBody = document.querySelector("#ledgerBody");
const dailyBalances = document.querySelector("#dailyBalances");
const totalIncome = document.querySelector("#totalIncome");
const totalExpense = document.querySelector("#totalExpense");
const totalBalance = document.querySelector("#totalBalance");
const grandBalance = document.querySelector("#grandBalance");

document.querySelector("#addIncomeBtn").addEventListener("click", addIncome);
document.querySelector("#addExpenseBtn").addEventListener("click", addExpense);
document.querySelector("#clearBtn").addEventListener("click", clearLedger);
document.querySelector("#exportBtn").addEventListener("click", exportCsv);
incomeSelect.addEventListener("change", updatePreviews);
expenseSelect.addEventListener("change", updatePreviews);

init();

function init() {
  fillDaySelect(incomeDay);
  fillDaySelect(expenseDay);
  fillIncomeSelect();
  fillExpenseSelect();
  updatePreviews();
  render();
}

function fillDaySelect(select) {
  select.innerHTML = DAYS.map((day) => `<option value="${day}">Dzień ${day}</option>`).join("");
}

function fillIncomeSelect() {
  incomeSelect.innerHTML = data.orders
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} (${formatMoney(item.amount)})</option>`)
    .join("");
}

function fillExpenseSelect() {
  const purchasedIds = new Set(entries.filter((entry) => entry.type === "expense").map((entry) => entry.itemId));
  const optionFor = (item, prefix) => {
    const purchased = purchasedIds.has(item.id);
    const suffix = purchased ? " - zakupione" : "";
    return `<option value="${item.id}" ${purchased ? "disabled" : ""}>${prefix}: ${escapeHtml(item.name)} (${formatMoney(item.amount)})${suffix}</option>`;
  };
  const devices = data.devices
    .map((item) => optionFor(item, "Urządzenie"))
    .join("");
  const materials = data.materials
    .map((item) => optionFor(item, "Materiał"))
    .join("");
  const services = (data.services ?? [])
    .map((item) => optionFor(item, "Usługa"))
    .join("");

  expenseSelect.innerHTML = `
    <optgroup label="Urządzenia">${devices}</optgroup>
    <optgroup label="Materiały">${materials}</optgroup>
    <optgroup label="Usługi">${services}</optgroup>
  `;

  const firstAvailable = [...expenseSelect.options].find((option) => !option.disabled);
  if (firstAvailable) {
    expenseSelect.value = firstAvailable.value;
    expenseSelect.disabled = false;
  } else {
    expenseSelect.disabled = true;
  }
}

function updatePreviews() {
  const income = data.orders.find((item) => item.id === incomeSelect.value);
  const expense = data.expenses.find((item) => item.id === expenseSelect.value);

  incomeAmount.textContent = formatMoney(income?.amount ?? 0);
  expenseAmount.textContent = formatMoney(expense?.amount ?? 0);
}

function addIncome() {
  const item = data.orders.find((order) => order.id === incomeSelect.value);
  if (!item) return;

  entries.push({
    id: crypto.randomUUID(),
    day: Number(incomeDay.value),
    type: "income",
    itemId: item.id,
    name: item.name,
    quantity: 1,
    unitAmount: item.amount,
    amount: item.amount,
  });

  persist();
  render();
}

function addExpense() {
  const item = data.expenses.find((expense) => expense.id === expenseSelect.value);
  if (!item) return;
  const alreadyPurchased = entries.some((entry) => entry.type === "expense" && entry.itemId === item.id);
  if (alreadyPurchased) return;

  entries.push({
    id: crypto.randomUUID(),
    day: Number(expenseDay.value),
    type: "expense",
    itemId: item.id,
    name: item.name,
    category: item.kind,
    quantity: 1,
    unitAmount: item.amount,
    amount: item.amount,
  });

  persist();
  render();
}

function render() {
  fillExpenseSelect();
  updatePreviews();
  renderLedger();
  renderSummary();
}

function renderLedger() {
  const sorted = [...entries].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, "pl"));

  if (!sorted.length) {
    ledgerBody.innerHTML = `<tr class="empty-row"><td colspan="5">Dodaj pierwsze zlecenie albo zakup z panelu po lewej.</td></tr>`;
    return;
  }

  ledgerBody.innerHTML = sorted
    .map(
      (entry) => `
        <tr>
          <td>Dzień ${entry.day}</td>
          <td><span class="entry-type ${entry.type}">${entry.type === "income" ? "Przychód" : "Wydatek"}</span></td>
          <td>${escapeHtml(entry.name)}</td>
          <td>${entry.type === "income" ? "" : "-"}${formatMoney(entry.amount)}</td>
          <td><button class="remove-row" type="button" data-id="${entry.id}" aria-label="Usuń operację">×</button></td>
        </tr>
      `,
    )
    .join("");

  ledgerBody.querySelectorAll(".remove-row").forEach((button) => {
    button.addEventListener("click", () => {
      entries = entries.filter((entry) => entry.id !== button.dataset.id);
      persist();
      render();
    });
  });
}

function renderSummary() {
  const income = entries.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expense = entries.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const balance = income - expense;

  totalIncome.textContent = formatMoney(income);
  totalExpense.textContent = formatMoney(expense);
  totalBalance.textContent = formatMoney(balance);
  grandBalance.textContent = formatMoney(balance);
  totalBalance.classList.toggle("negative", balance < 0);
  grandBalance.classList.toggle("negative", balance < 0);

  dailyBalances.innerHTML = DAYS.map((day) => {
    const dayIncome = entries
      .filter((entry) => entry.day === day && entry.type === "income")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const dayExpense = entries
      .filter((entry) => entry.day === day && entry.type === "expense")
      .reduce((sum, entry) => sum + entry.amount, 0);
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

function clearLedger() {
  if (!entries.length) return;
  const confirmed = window.confirm("Wyczyścić wszystkie operacje finansowe?");
  if (!confirmed) return;
  entries = [];
  persist();
  render();
}

function exportCsv() {
  const header = ["Dzień", "Typ", "Tytuł", "Kwota"];
  const rows = entries
    .sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, "pl"))
    .map((entry) => [
      entry.day,
      entry.type === "income" ? "Przychód" : "Wydatek",
      entry.name,
      entry.type === "income" ? entry.amount : -entry.amount,
    ]);

  const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ksiega_finansowa_laboratorium.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatMoney(value) {
  return money.format(value).replace(/\s?US\$/, " USD");
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
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
