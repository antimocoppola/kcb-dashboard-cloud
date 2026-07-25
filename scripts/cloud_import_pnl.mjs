import axios from "axios";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, "..");
const PNL_FILE = path.join(REPO_DIR, "data", "pnl.json");

// Report P&L: un numero unico per TUTTO l'account (EU = tutti i 10 marketplace
// insieme, nessuna colonna paese/ASIN), e solo una finestra scorrevole di ~7
// giorni - nessuno storico pregresso. Serve solo a calibrare il Net profit del
// report Prodotti (che e' per-ASIN ma non torna esatto col pannello P&L di SB).
const ACCOUNTS = [
  { key: "EU", url: process.env.EU_PROFIT_URL },
  { key: "USA", url: process.env.US_PROFIT_URL },
];

function num(val) {
  if (!val || val === "-" || val === "") return 0;
  const s = String(val).replace(/[€$£%\s]/g, "").trim();
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  return parseFloat(s.replace(",", "")) || 0;
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
  const pnl = fs.existsSync(PNL_FILE) ? JSON.parse(fs.readFileSync(PNL_FILE, "utf8")) : [];
  const index = new Map();
  pnl.forEach((r, i) => index.set(r[1] + "|" + r[0], i));

  let inserted = 0, updated = 0;

  for (const acc of ACCOUNTS) {
    if (!acc.url) { console.log(`[${acc.key}] P&L: nessun URL configurato, salto`); continue; }
    try {
      const { data: csv } = await axios.get(acc.url, { timeout: 30000, responseType: "text", headers: { "User-Agent": "Mozilla/5.0" } });
      const rows = parseCSV(csv);
      for (const row of rows) {
        const rawDate = row["Date"] || "";
        if (!rawDate) continue;
        const iso = toISO(rawDate);
        const sales = num(row["SalesOrganic"]) + num(row["SalesPPC"]);
        const netProfit = num(row["NetProfit"]);
        const key = acc.key + "|" + iso;
        const record = [iso, acc.key, sales, netProfit];
        const existingIdx = index.get(key);
        if (existingIdx !== undefined) { pnl[existingIdx] = record; updated++; }
        else { index.set(key, pnl.length); pnl.push(record); inserted++; }
      }
      console.log(`[${acc.key}] P&L: ${rows.length} righe ricevute dalla finestra scorrevole di sellerboard`);
    } catch (e) {
      console.error(`[${acc.key}] P&L ERRORE: ${e.message}`);
      process.exitCode = 1;
    }
  }

  fs.writeFileSync(PNL_FILE, JSON.stringify(pnl));
  console.log("Totale giorni P&L salvati:", pnl.length, "(nuovi:", inserted, "aggiornati:", updated + ")");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
