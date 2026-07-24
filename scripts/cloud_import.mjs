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
  // key -> indice in history, per poter sovrascrivere in-place la giornata ancora aperta
  // (chiamato piu' volte al giorno: i giorni passati sono definitivi e si saltano se gia'
  // visti, il giorno piu' recente del batch invece si aggiorna sempre, perche' sellerboard
  // rivede i numeri di oggi man mano che arrivano nuovi ordini/resi).
  const index = new Map();
  history.forEach((r, i) => index.set(r[1] + "|" + r[0] + "|" + r[2] + "|" + r[3], i));

  let totalNew = 0, totalUpdated = 0;

  for (const acc of ACCOUNTS) {
    if (!acc.url) { console.log(`[${acc.key}] nessun URL configurato, salto`); continue; }
    try {
      const { data: csv } = await axios.get(acc.url, { timeout: 30000, responseType: "text", headers: { "User-Agent": "Mozilla/5.0" } });
      const parsedRows = parseCSV(csv);

      const dateCol = findCol(parsedRows[0] || {}, ["date", "data", "day", "period"]);
      const asinCol = findCol(parsedRows[0] || {}, ["asin"]);
      const mktCol = findCol(parsedRows[0] || {}, ["marketplace", "country"]);

      let maxDateInBatch = null;
      for (const row of parsedRows) {
        const rawDate = row[dateCol] || "";
        if (!rawDate) continue;
        const iso = toISO(rawDate);
        if (!maxDateInBatch || iso > maxDateInBatch) maxDateInBatch = iso;
      }

      let inserted = 0, updated = 0;
      for (const row of parsedRows) {
        const rawDate = row[dateCol] || "";
        const asin = row[asinCol] || "";
        if (!rawDate || !asin) continue;
        const iso = toISO(rawDate);
        const marketplace = (row[mktCol] || acc.defaultMarketplace).replace("Amazon.", "");
        const dedupeKey = acc.key + "|" + iso + "|" + marketplace + "|" + asin;
        const isOpenDay = iso === maxDateInBatch;

        const existingIdx = index.get(dedupeKey);
        if (existingIdx !== undefined && !isOpenDay) continue; // giorno chiuso e gia' registrato: niente da fare

        const sales = num(row["SalesOrganic"]) + num(row["SalesPPC"]);
        const netProfit = num(row["NetProfit"]);
        const adSpend = Math.abs(num(row["Ads spend"]));
        const refunds = num(row["Refunds"]);
        const units = (parseInt(row["UnitsOrganic"]) || 0) + (parseInt(row["UnitsPPC"]) || 0);
        const record = [iso, acc.key, marketplace, asin, sales, netProfit, adSpend, refunds, units];

        if (existingIdx !== undefined) {
          history[existingIdx] = record; // giorno ancora aperto: sovrascrivi con i numeri rivisti
          updated++;
        } else {
          index.set(dedupeKey, history.length);
          history.push(record);
          inserted++;
        }
      }
      totalNew += inserted; totalUpdated += updated;
      console.log(`[${acc.key}] Prodotti: ${inserted} nuovi record, ${updated} aggiornati (giorno aperto: ${maxDateInBatch})`);
    } catch (e) {
      console.error(`[${acc.key}] ERRORE: ${e.message}`);
      process.exitCode = 1;
    }
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  console.log("Totale righe storiche:", history.length, "(nuove:", totalNew, "aggiornate:", totalUpdated + ")");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
