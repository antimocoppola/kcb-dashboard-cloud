// Riempie data/bsr_weekly.json (riga BSR dei KPI settimanali) dalla serie giornaliera del repository
// helium10-bsr (pubblico): niente chiamate a Helium 10, solo la lettura di due file su GitHub.
// Per ogni parent e paese prende l'ASIN "hero" (il child principale della dashboard BSR) e calcola la
// media del BSR giornaliero di ogni settimana lunedi-domenica (minimo 4 giorni di dato).
// Riempie solo le settimane che mancano: i valori gia presenti (calcolati sul child migliore) restano.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "data", "bsr_weekly.json");
const BASE = "https://raw.githubusercontent.com/antimocoppola/helium10-bsr/main/";
const FIRST_WEEK = "2026-09-28";

// foglio KPI -> mercato Helium 10; parent KPI -> famiglia della dashboard BSR
const SHEETS = { IT: "IT", DE: "DE", FR: "FR", ES: "ES", UK: "UK", USA: "US" };
const PARENTS = { KCB1: "KCB", KSC: "KSC", KCB2: "KCB2", HUG: "HUG", KPH: "KPH", KST: "KST", CBA: "CBA" };

const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function getJson(file) {
  const r = await fetch(BASE + file, { headers: { "User-Agent": "kcb-dashboard-cloud" } });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.json();
}

let sets, seriesFile;
try {
  [sets, seriesFile] = await Promise.all([getJson("config/competitor_sets.json"), getJson("database/bsr_series.json")]);
} catch (e) {
  console.log("BSR: impossibile leggere la serie di helium10-bsr (" + e.message + "), lascio il file com'e'.");
  process.exit(0);
}
const series = seriesFile.series || seriesFile;
// parent davvero presenti in ogni foglio (da weekly_targets.json): gli altri non si mostrano, quindi non servono
const TARGETS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "weekly_targets.json"), "utf8"));
const tracked = (sheet) => Object.keys(sheet === "USA" ? TARGETS.USA.parents : (TARGETS.EU[sheet === "UK" ? "co.uk" : sheet.toLowerCase()] || {}).parents || {});
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};

// ultima data con dato nella serie (per non considerare complete settimane che non lo sono)
let lastDay = "";
for (const k of Object.keys(series)) for (const d of Object.keys(series[k])) if (d > lastDay) lastDay = d;

let added = 0, skipped = 0;
for (const [sheet, mp] of Object.entries(SHEETS)) {
  for (const [parent, fam] of Object.entries(PARENTS)) {
    if (!tracked(sheet).includes(parent)) continue;
    const combo = sets[`${fam}|${mp}`];
    if (!combo || combo.status !== "ok" || !combo.hero) continue;
    const daily = series[`${combo.hero}|${mp}`];
    if (!daily) { skipped++; continue; }
    for (let mon = FIRST_WEEK; addDays(mon, 6) <= lastDay; mon = addDays(mon, 7)) {
      if (out[sheet] && out[sheet][parent] && out[sheet][parent][mon]) continue; // gia presente
      const vals = [];
      for (let i = 0; i < 7; i++) { const v = daily[addDays(mon, i)]; if (v != null) vals.push(Number(v)); }
      if (vals.length < 4) continue;
      const bsr = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      (((out[sheet] ??= {})[parent] ??= {})[mon] = { bsr, asin: combo.hero, children: 1, source: "serie giornaliera helium10-bsr" });
      added++;
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`BSR: ${added} celle aggiunte dalla serie giornaliera (ultimo giorno ${lastDay}), ${skipped} parent senza serie.`);
