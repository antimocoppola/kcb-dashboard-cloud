// Genera docs/KPI_settimanali.xlsx: KPI per settimana (lunedi-domenica) per paese EU + USA,
// con target e colori verde/giallo/rosso come la dashboard. Sessions e CVR sono solo per
// vedere l'andamento (nessun target). Legge docs/index.html (dati calibrati sul P&L, generati
// da cloud_build.mjs), data/history.json (per le Sessions) e data/weekly_targets.json.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, "..");
const OUT_FILE = path.join(REPO_DIR, "docs", "KPI_settimanali.xlsx");
const FIRST_WEEK = "2026-09-28"; // primo lunedi mostrato
const MAX_WEEKS = 8;

// ---- dati ----
const html = fs.readFileSync(path.join(REPO_DIR, "docs", "index.html"), "utf8");
const dataLine = html.split("\n").find((l) => l.startsWith("const DATASET = "));
if (!dataLine) throw new Error("DATASET non trovato in docs/index.html");
const D = JSON.parse(dataLine.trim().slice("const DATASET = ".length).replace(/;$/, ""));
const history = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "data", "history.json"), "utf8"));
if (history.length !== D.rows.length) throw new Error("history.json e dataset non sono allineati: rilanciare cloud_build.mjs");
const TARGETS = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "data", "weekly_targets.json"), "utf8"));

// ---- settimane complete ----
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// una settimana e' completa se tutti e due gli account hanno dati fino alla domenica
const lastDate = {};
for (const r of D.rows) if (!lastDate[r[1]] || r[0] > lastDate[r[1]]) lastDate[r[1]] = r[0];
const cutoff = Object.values(lastDate).sort()[0];
let weeks = [];
for (let mon = FIRST_WEEK; addDays(mon, 6) <= cutoff; mon = addDays(mon, 7)) {
  const sun = addDays(mon, 6);
  const thu = addDays(mon, 3); // il mese della settimana e' quello del giovedi (maggioranza dei giorni)
  const [, m, d] = mon.split("-"); const [, m2, d2] = sun.split("-");
  weeks.push({ from: mon, to: sun, month: +thu.slice(5, 7), year: +thu.slice(0, 4), label: `${+d}/${+m} - ${+d2}/${+m2}` });
}
weeks = weeks.slice(-MAX_WEEKS);
if (!weeks.length) { console.log("Nessuna settimana completa disponibile, esco senza generare il file."); process.exit(0); }
console.log("Settimane:", weeks.map((w) => w.label).join(" | "), "(dati fino al", cutoff + ")");

function aggregate(filter, w) {
  const a = { sales: 0, cm: 0, ad: 0, ref: 0, units: 0, vat: 0, sess: 0 };
  for (let i = 0; i < D.rows.length; i++) {
    const r = D.rows[i];
    if (r[0] < w.from || r[0] > w.to || !filter(r)) continue;
    a.sales += r[4]; a.cm += r[5]; a.ad += r[6]; a.ref += r[7]; a.units += r[8]; a.vat += r[9] || 0;
    a.sess += history[i][11] || 0;
  }
  return a;
}
const derive = (a) => ({
  sales: a.sales, net: a.sales - a.vat, cm: a.cm,
  margin: a.sales - a.vat > 0 ? a.cm / (a.sales - a.vat) : null,
  acos: a.sales > 0 ? a.ad / a.sales : null,
  resi: a.units > 0 ? a.ref / a.units : null,
  units: a.units, sess: a.sess,
  cvr: a.sess > 0 ? a.units / a.sess : null,
});
const hasSessions = (w) => history.some((r, i) => r[0] >= w.from && r[0] <= w.to && r[11] != null);

// target di una settimana per un'unita': Sales/CM dal mese del giovedi, gli altri fissi
function weekTarget(w, node, overall) {
  if (w.year !== 2026) return {};
  const mt = node.months && node.months[w.month];
  const o = overall || node;
  return {
    sales: mt ? mt.sales : null, cm: mt ? mt.cm : null,
    margin: o.marginPct / 100, acos: o.acosPct / 100, resi: o.resiPct / 100,
  };
}

// ---- fogli ----
function euSheet(c) {
  const T = TARGETS.EU[c];
  const units = [{ name: "TOTALE " + c.toUpperCase(), filter: (r) => r[1] === "EU" && r[2] === c, tgt: (w) => weekTarget(w, T, T.overall) }];
  for (const [p, q] of Object.entries(T.parents)) units.push({ name: p, filter: (r) => r[1] === "EU" && r[2] === c && r[3] === p, tgt: (w) => weekTarget(w, q, q) });
  return { sheet: c === "co.uk" ? "UK" : c.toUpperCase(), cur: '#,##0 "€"', ccy: "EUR", units };
}
function usSheet() {
  const T = TARGETS.USA;
  const units = [{ name: "TOTALE USA", filter: (r) => r[1] === "USA", tgt: (w) => weekTarget(w, T, T.overall) }];
  for (const [p, q] of Object.entries(T.parents)) units.push({ name: p, filter: (r) => r[1] === "USA" && r[3] === p, tgt: (w) => weekTarget(w, q, q) });
  return { sheet: "USA", cur: '#,##0 "$"', ccy: "USD", units };
}

const METRICS = [
  { key: "sales", label: "Sales", tgt: "sales", better: "high" },
  { key: "net", label: "Sales netto IVA" },
  { key: "cm", label: "CM", tgt: "cm", better: "high" },
  { key: "margin", label: "Margin %", fmt: "0.0%", tgt: "margin", better: "high" },
  { key: "acos", label: "ACOS %", fmt: "0.0%", tgt: "acos", better: "low" },
  { key: "resi", label: "Refund %", fmt: "0.0%", tgt: "resi", better: "low" },
  { key: "units", label: "Unita", fmt: "#,##0" },
  { key: "sess", label: "Sessions", fmt: "#,##0", sessions: true },
  { key: "cvr", label: "CVR %", fmt: "0.00%", sessions: true },
];

const COL = { good: { bg: "FFE7F1E3", fg: "FF255A29" }, warn: { bg: "FFFAF0DC", fg: "FF6B4B0F" }, bad: { bg: "FFFBEAE8", fg: "FF7A2A22" } };
const thin = { style: "thin", color: { argb: "FFD9D9D9" } };
const border = { top: thin, bottom: thin, left: thin, right: thin };
const colLetter = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

const wb = new ExcelJS.Workbook();
wb.creator = "Koala Babycare";

const lg = wb.addWorksheet("Legenda");
lg.columns = [{ width: 115 }];
[
  ["Koala Babycare - KPI settimanali EU + USA"],
  ["Generato il " + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC. Settimane: " + weeks[0].label + " ... " + weeks[weeks.length - 1].label + " (lunedi - domenica, solo settimane complete)."],
  [""],
  ["Dati reali: report Sellerboard \"Dashboard by product\", con Net Profit (CM) e IVA calibrati sul P&L reale, come nella dashboard."],
  ["Sessions e CVR: dal campo Sessions del report Prodotti. CVR = unita / sessioni (come \"Unit Session Percentage\" di Sellerboard). Le sessioni sono salvate solo dal 14/9/2026: prima di quella data il valore resta vuoto."],
  ["Per un parent/paese le sessioni sono la somma di quelle dei singoli ASIN e il CVR e la somma unita / somma sessioni."],
  [""],
  ["Colori (stessa regola della dashboard), solo sulle righe con un target:"],
  ["   Verde = target raggiunto   |   Giallo = entro il 10% dal target   |   Rosso = oltre il 10% dal target"],
  ["   Per ACOS e Refund% e al contrario: piu basso e meglio (verde se <= target, giallo se entro +10%)."],
  ["I colori sono formule condizionali: se cambi un valore nella colonna Target, si aggiornano da soli."],
  [""],
  ["Target:"],
  ["   Sales e CM sono target settimanali. Ogni settimana usa i target del mese in cui cade il suo giovedi (la maggioranza dei giorni)."],
  ["   ACOS, Margin% e Refund% sono fissi. Margin% e calcolato sulle vendite al netto IVA."],
  ["   Il target Sales segue la convenzione CM / margin, quindi non include l'IVA. Le Sales reali sono lorde IVA: la riga \"Sales netto IVA\" serve per un confronto piu corretto."],
  ["   I target sono in data/weekly_targets.json del repository. Per i mesi senza target le celle Target restano vuote e senza colori."],
  ["Sessions, CVR e Unita non hanno target: servono solo per vedere l'andamento."],
].forEach((r) => lg.addRow(r));
lg.getRow(1).font = { bold: true, size: 14 };
lg.getRow(8).font = { bold: true }; lg.getRow(13).font = { bold: true };

for (const def of [...["it", "de", "fr", "es", "co.uk"].map(euSheet), usSheet()]) {
  const ws = wb.addWorksheet(def.sheet);
  const nCols = 2 + weeks.length * 2;
  ws.columns = [{ width: 14 }, { width: 18 }, ...weeks.flatMap(() => [{ width: 14 }, { width: 13 }])];
  ws.mergeCells(1, 1, 1, nCols);
  ws.getCell("A1").value = `${def.sheet} - KPI settimanali (${def.ccy})`;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, nCols);
  ws.getCell("A2").value = "Reale = dati Sellerboard calibrati sul P&L. Target = target settimanale. Colori: verde = raggiunto, giallo = entro 10%, rosso = oltre 10%.";
  ws.getCell("A2").font = { italic: true, color: { argb: "FF6B6B6B" }, size: 10 };
  ws.addRow([]);
  const hrow = ws.addRow(["Parent", "Metrica", ...weeks.flatMap((w) => [w.label + " Reale", "Target"])]);
  hrow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  hrow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  hrow.height = 32;
  hrow.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B4A5A" } }; c.border = border; });
  ws.views = [{ state: "frozen", ySplit: 4, xSplit: 2 }];

  for (const u of def.units) {
    const m = weeks.map((w) => derive(aggregate(u.filter, w)));
    const tg = weeks.map((w) => u.tgt(w));
    const sess = weeks.map((w) => hasSessions(w));
    const first = ws.rowCount + 1;
    for (const M of METRICS) {
      const cells = [u.name, M.label];
      weeks.forEach((w, i) => {
        let real = m[i][M.key];
        if (M.sessions && !sess[i]) real = null;
        cells.push(real, M.tgt && tg[i][M.tgt] != null ? tg[i][M.tgt] : null);
      });
      const row = ws.addRow(cells);
      const fmt = M.fmt || def.cur;
      weeks.forEach((w, i) => {
        for (const c of [3 + i * 2, 4 + i * 2]) { row.getCell(c).numFmt = fmt; row.getCell(c).alignment = { horizontal: "right" }; }
        row.getCell(4 + i * 2).font = { color: { argb: "FF6B6B6B" } };
      });
      row.eachCell({ includeEmpty: true }, (c, i) => { if (i <= nCols) c.border = border; });
      row.getCell(2).font = M.key === "sales" || M.key === "cm" ? { bold: true } : { color: { argb: "FF444444" } };
      if (M.tgt) {
        const r = row.number;
        weeks.forEach((w, i) => {
          if (tg[i][M.tgt] == null) return;
          const ref = colLetter(3 + i * 2) + r, tref = colLetter(4 + i * 2) + r;
          const rules = M.better === "high"
            ? [["good", `AND(ISNUMBER(${ref}),ISNUMBER(${tref}),${ref}>=${tref})`], ["warn", `AND(ISNUMBER(${ref}),ISNUMBER(${tref}),${ref}<${tref},${ref}>=${tref}*0.9)`], ["bad", `AND(ISNUMBER(${ref}),ISNUMBER(${tref}),${ref}<${tref}*0.9)`]]
            : [["good", `AND(ISNUMBER(${ref}),ISNUMBER(${tref}),${ref}<=${tref})`], ["warn", `AND(ISNUMBER(${ref}),ISNUMBER(${tref}),${ref}>${tref},${ref}<=${tref}*1.1)`], ["bad", `AND(ISNUMBER(${ref}),ISNUMBER(${tref}),${ref}>${tref}*1.1)`]];
          ws.addConditionalFormatting({ ref, rules: rules.map(([k, f], j) => ({
            type: "expression", priority: j + 1, formulae: [f],
            style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: COL[k].bg }, fgColor: { argb: COL[k].bg } }, font: { color: { argb: COL[k].fg }, bold: true } },
          })) });
        });
      }
    }
    const lastRow = ws.rowCount;
    for (let r = first; r <= lastRow; r++) ws.getCell("A" + r).value = r === first ? u.name : null;
    ws.mergeCells(`A${first}:A${lastRow}`);
    ws.getCell("A" + first).font = { bold: true, size: 12 };
    ws.getCell("A" + first).alignment = { vertical: "middle", horizontal: "center" };
    ws.getCell("A" + first).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0F2F4" } };
    for (let c = 1; c <= nCols; c++) ws.getCell(lastRow, c).border = { ...border, bottom: { style: "medium", color: { argb: "FF8A94A0" } } };
  }
}
await wb.xlsx.writeFile(OUT_FILE);
console.log("scritto", OUT_FILE, "(" + Math.round(fs.statSync(OUT_FILE).size / 1024) + " KB)");
