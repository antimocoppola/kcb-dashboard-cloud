import axios from "axios";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, "..");
const HISTORY_FILE = path.join(REPO_DIR, "data", "history.json");

const ACCOUNTS = [
  { key: "EU", url: process.env.EU_PRODUCTS_URL, defaultMarketplace: "all" },
  { key: "USA", url: process.env.US_PRODUCTS_URL, defaultMarketplace: "Amazon.com" },
];

function num(val) {
  if (!val || val === "-" || val === "") return 0;
  const s = String(val).replace(/[€$£%\s]/g, "").trim();
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  return parseFloat(s.replace(",", "")) || 0;
}
function findCol(row, candidates) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const found = keys.find((k) => k.toLowerCase().includes(c.toLowerCase()));
    if (found) return found;
  }
  return null;
}
function parseCSV(csvText) {
  const firstLine = csvText.split("\n")[0];
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolons > commas ? ";" : ",";
  return parse(csvText, { delimiter, columns: true, skip_empty_lines: true, trim: true });
}
function toISO(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split("/");
  return `${y}-${m}-${d}`;
}

async function main() {
  const historyRaw = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
  // Record piu' vecchi avevano 9 campi (prima della fix SKU) o 10 (prima di aggiungere
  // il VAT): normalizza sempre a 11 (sku vuoto e/o vat 0, non recuperabili retroattivamente
  // per le date fuori dalla finestra di refresh) cosi' la destrutturazione in
  // cloud_build.mjs resta sempre allineata.
  let history = historyRaw.map((r) => {
    if (r.length === 9) return [r[0], r[1], r[2], r[3], "", r[4], r[5], r[6], r[7], r[8], 0];
    if (r.length === 10) return [...r, 0];
    return r;
  });

  let totalRemoved = 0, totalInserted = 0;

  for (const acc of ACCOUNTS) {
    if (!acc.url) { console.log(`[${acc.key}] nessun URL configurato, salto`); continue; }
    try {
      const { data: csv } = await axios.get(acc.url, { timeout: 30000, responseType: "text", headers: { "User-Agent": "Mozilla/5.0" } });
      const parsedRows = parseCSV(csv);

      const dateCol = findCol(parsedRows[0] || {}, ["date", "data", "day", "period"]);
      const asinCol = findCol(parsedRows[0] || {}, ["asin"]);
      const skuCol = findCol(parsedRows[0] || {}, ["sku"]);
      const mktCol = findCol(parsedRows[0] || {}, ["marketplace", "country"]);

      // Il report "Dashboard by product" restituisce sempre l'intera finestra scorrevole
      // (~30 giorni), rivista giorno per giorno da sellerboard. Invece di aggiornare riga
      // per riga (rischio di lasciare in giro righe "orfane" se una chiave cambia forma,
      // come e' successo passando da 9 a 10 campi), sostituiamo in blocco TUTTI i giorni
      // presenti nel batch fresco per quell'account, poi reinseriamo tutte le righe fresche.
      // I giorni piu' vecchi della finestra (fuori da questo batch) restano intatti.
      const datesInBatch = new Set();
      for (const row of parsedRows) {
        const rawDate = row[dateCol] || "";
        if (rawDate) datesInBatch.add(toISO(rawDate));
      }

      const before = history.length;
      history = history.filter((r) => !(r[1] === acc.key && datesInBatch.has(r[0])));
      const removed = before - history.length;

      let inserted = 0;
      for (const row of parsedRows) {
        const rawDate = row[dateCol] || "";
        const asin = row[asinCol] || "";
        if (!rawDate || !asin) continue;
        const iso = toISO(rawDate);
        const sku = row[skuCol] || "";
        const marketplace = (row[mktCol] || acc.defaultMarketplace).replace("Amazon.", "");
        const sales = num(row["SalesOrganic"]) + num(row["SalesPPC"]);
        const netProfit = num(row["NetProfit"]);
        const adSpend = Math.abs(num(row["Ads spend"]));
        const refunds = num(row["Refunds"]);
        const units = (parseInt(row["UnitsOrganic"]) || 0) + (parseInt(row["UnitsPPC"]) || 0);
        const vat = Math.abs(num(row["VAT"]));
        history.push([iso, acc.key, marketplace, asin, sku, sales, netProfit, adSpend, refunds, units, vat]);
        inserted++;
      }
      totalRemoved += removed; totalInserted += inserted;
      const sortedDates = [...datesInBatch].sort();
      console.log(`[${acc.key}] Prodotti: sostituita finestra ${sortedDates[0]} -> ${sortedDates[sortedDates.length - 1]} (rimosse ${removed} righe vecchie, reinserite ${inserted} righe fresche)`);
    } catch (e) {
      console.error(`[${acc.key}] ERRORE: ${e.message}`);
      process.exitCode = 1;
    }
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  console.log("Totale righe storiche:", history.length, "(rimosse:", totalRemoved, "reinserite:", totalInserted + ")");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
