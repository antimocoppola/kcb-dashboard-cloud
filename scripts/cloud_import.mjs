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
  const history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) : [];
  const seen = new Set(history.map((r) => r[1] + "|" + r[0] + "|" + r[2] + "|" + r[3]));
  let totalNew = 0;

  for (const acc of ACCOUNTS) {
    if (!acc.url) { console.log(`[${acc.key}] nessun URL configurato, salto`); continue; }
    try {
      const { data: csv } = await axios.get(acc.url, { timeout: 30000, responseType: "text", headers: { "User-Agent": "Mozilla/5.0" } });
      const rows = parseCSV(csv);
      let inserted = 0;
      for (const row of rows) {
        const dateCol = findCol(row, ["date", "data", "day", "period"]);
        const asinCol = findCol(row, ["asin"]);
        const mktCol = findCol(row, ["marketplace", "country"]);
        const rawDate = row[dateCol] || "";
        const asin = row[asinCol] || "";
        if (!rawDate || !asin) continue;
        const iso = toISO(rawDate);
        const marketplace = (row[mktCol] || acc.defaultMarketplace).replace("Amazon.", "");
        const dedupeKey = acc.key + "|" + iso + "|" + marketplace + "|" + asin;
        if (seen.has(dedupeKey)) continue;
        const sales = num(row["SalesOrganic"]) + num(row["SalesPPC"]);
        const netProfit = num(row["NetProfit"]);
        const adSpend = Math.abs(num(row["Ads spend"]));
        const refunds = num(row["Refunds"]);
        const units = (parseInt(row["UnitsOrganic"]) || 0) + (parseInt(row["UnitsPPC"]) || 0);
        history.push([iso, acc.key, marketplace, asin, sales, netProfit, adSpend, refunds, units]);
        seen.add(dedupeKey);
        inserted++;
      }
      totalNew += inserted;
      console.log(`[${acc.key}] Prodotti: ${inserted} nuovi record (${rows.length - inserted} gia' presenti)`);
    } catch (e) {
      console.error(`[${acc.key}] ERRORE: ${e.message}`);
      process.exitCode = 1;
    }
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  console.log("Totale righe storiche:", history.length, "(nuove oggi:", totalNew + ")");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
