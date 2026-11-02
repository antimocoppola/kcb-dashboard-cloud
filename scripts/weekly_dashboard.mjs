// Genera docs/kpi-settimanali.html: dashboard KPI per settimana (lunedi-domenica), per paese EU + USA,
// con target e colori verde/giallo/rosso come la dashboard principale. Sessions, CVR, Unita e BSR sono
// solo per vedere l'andamento (nessun target). Legge docs/index.html (dati calibrati sul P&L, generati
// da cloud_build.mjs), data/history.json (Sessions), data/weekly_targets.json e data/bsr_weekly.json.
// Il risultato non contiene l'ora di generazione, solo la data: rilanciarlo piu volte lo stesso giorno
// con gli stessi dati produce lo stesso file (niente commit inutili).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, "..");
const OUT_FILE = path.join(REPO_DIR, "docs", "kpi-settimanali.html");
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
const BSR_FILE = path.join(REPO_DIR, "data", "bsr_weekly.json");
const BSR = fs.existsSync(BSR_FILE) ? JSON.parse(fs.readFileSync(BSR_FILE, "utf8")) : {};

// ---- settimane complete ----
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const lastDate = {};
for (const r of D.rows) if (!lastDate[r[1]] || r[0] > lastDate[r[1]]) lastDate[r[1]] = r[0];
const cutoff = Object.values(lastDate).sort()[0]; // una settimana e' completa se entrambi gli account hanno dati fino alla domenica
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
// Le Sessions di Amazon arrivano con circa 3 giorni di ritardo: per l'ultima settimana (appena chiusa)
// sono incomplete e il CVR risulterebbe gonfiato. Le mostriamo solo se l'ultimo giorno della settimana
// ha gia le sessioni per quell'account.
const sessionsComplete = (w, acc) => history.some((r) => r[1] === acc && r[0] === w.to && (r[11] || 0) > 0);

// target di una settimana: Sales/CM dal mese del giovedi, gli altri fissi
function weekTarget(w, node, overall) {
  if (w.year !== 2026) return {};
  const mt = node.months && node.months[w.month];
  const o = overall || node;
  return { sales: mt ? mt.sales : null, cm: mt ? mt.cm : null, margin: o.marginPct / 100, acos: o.acosPct / 100, resi: o.resiPct / 100 };
}

function euSheet(c) {
  const T = TARGETS.EU[c];
  const units = [{ name: "TOTALE " + c.toUpperCase().replace("CO.UK", "UK"), filter: (r) => r[1] === "EU" && r[2] === c, tgt: (w) => weekTarget(w, T, T.overall) }];
  for (const [p, q] of Object.entries(T.parents)) units.push({ name: p, filter: (r) => r[1] === "EU" && r[2] === c && r[3] === p, tgt: (w) => weekTarget(w, q, q) });
  const sheet = c === "co.uk" ? "UK" : c.toUpperCase();
  return { sheet, label: { IT: "Italia", DE: "Germania", FR: "Francia", ES: "Spagna", UK: "Regno Unito" }[sheet], cur: "EUR", units };
}
function usSheet() {
  const T = TARGETS.USA;
  const units = [{ name: "TOTALE USA", filter: (r) => r[1] === "USA", tgt: (w) => weekTarget(w, T, T.overall) }];
  for (const [p, q] of Object.entries(T.parents)) units.push({ name: p, filter: (r) => r[1] === "USA" && r[3] === p, tgt: (w) => weekTarget(w, q, q) });
  return { sheet: "USA", label: "Stati Uniti", cur: "USD", units };
}

// ---- formattazione ----
const nf = (v, loc = "it-IT") => Math.round(v).toLocaleString(loc, { useGrouping: "always" });
const FMT = {
  money: (v, cur) => (v < 0 ? "-" : "") + (cur === "USD" ? "$" : "€") + (cur === "USD" ? Math.abs(Math.round(v)).toLocaleString("en-US") : nf(Math.abs(v))),
  pct1: (v) => (Math.round(v * 1000) / 10).toLocaleString("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%",
  pct2: (v) => (Math.round(v * 10000) / 100).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%",
  int: (v) => nf(v),
};
const METRICS = [
  { key: "sales", label: "Sales", f: "money", tgt: "sales", better: "high", strong: true },
  { key: "net", label: "Sales netto IVA", f: "money" },
  { key: "cm", label: "CM", f: "money", tgt: "cm", better: "high", strong: true },
  { key: "margin", label: "Margin %", f: "pct1", tgt: "margin", better: "high" },
  { key: "acos", label: "ACOS %", f: "pct1", tgt: "acos", better: "low" },
  { key: "resi", label: "Refund %", f: "pct1", tgt: "resi", better: "low" },
  { key: "units", label: "Unità", f: "int" },
  { key: "sess", label: "Sessions", f: "int", sessions: true },
  { key: "cvr", label: "CVR %", f: "pct2", sessions: true },
  { key: "bsr", label: "BSR", f: "int", bsr: true },
];
// stessa regola della dashboard principale (targetClass)
function targetClass(actual, target, better) {
  if (actual == null || target == null) return null;
  if (better === "low") return actual <= target ? "good" : actual <= target * 1.1 ? "warn" : "bad";
  return actual >= target ? "good" : actual >= target * 0.9 ? "warn" : "bad";
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function cell(M, real, target, cur, pending) {
  if (pending) return `<td class="c"><span class="na" title="Le sessioni di Amazon arrivano con circa 3 giorni di ritardo">in arrivo</span></td>`;
  if (real == null) return `<td class="c"><span class="na">–</span></td>`;
  const txt = FMT[M.f](real, cur);
  const cls = M.tgt ? targetClass(real, target, M.better) : null;
  const t = M.tgt && target != null ? `<span class="tgt">(${FMT[M.f](target, cur)})</span>` : "";
  return `<td class="c">${cls ? `<span class="pill ${cls}">${txt}</span>` : `<span class="v">${txt}</span>`}${t}</td>`;
}

// ---- pannelli ----
const sheets = [...["it", "de", "fr", "es", "co.uk"].map(euSheet), usSheet()];
const summary = []; // riepilogo ultima settimana
const panels = [];
const wi = weeks.length - 1;
for (const def of sheets) {
  const head = `<tr><th class="lead">Metrica</th>${weeks.map((w, i) => `<th class="wk${i === wi ? " last" : ""}">${esc(w.label)}</th>`).join("")}</tr>`;
  let body = "";
  for (const u of def.units) {
    const m = weeks.map((w) => derive(aggregate(u.filter, w)));
    const tg = weeks.map((w) => u.tgt(w));
    const acc = def.sheet === "USA" ? "USA" : "EU";
    const sess = weeks.map((w) => sessionsComplete(w, acc));
    const parentKey = u.name.startsWith("TOTALE") ? null : u.name;
    const bq = parentKey && BSR[def.sheet] && BSR[def.sheet][parentKey];
    if (bq) weeks.forEach((w, i) => { m[i].bsr = bq[w.from] ? bq[w.from].bsr : null; });
    body += `<tr class="grp"><td colspan="${1 + weeks.length}">${esc(u.name)}</td></tr>`;
    for (const M of METRICS) {
      if (M.bsr && !bq) continue;
      const cells = weeks.map((w, i) => {
        const pending = M.sessions && !sess[i];
        return cell(M, pending ? null : m[i][M.key], tg[i][M.tgt], def.cur, pending);
      }).join("");
      body += `<tr class="${M.strong ? "strong" : ""}"><th class="lead">${esc(M.label)}</th>${cells}</tr>`;
    }
    if (u.name.startsWith("TOTALE")) summary.push({ def, m: m[wi], t: tg[wi], prev: m[wi - 1] || null, sess: sess[wi] });
  }
  panels.push(`<section class="panel" id="p-${def.sheet}" hidden><h2>${esc(def.label)} <span class="ccy">${def.cur}</span></h2><div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div></section>`);
}

// riepilogo: ultima settimana, totali paese
const SUM_COLS = METRICS.filter((M) => ["sales", "cm", "margin", "acos", "resi", "cvr"].includes(M.key));
const sumRows = summary.map((s) => `<tr><th class="lead"><a href="#${s.def.sheet}" data-go="${s.def.sheet}">${esc(s.def.label)}</a></th>${SUM_COLS.map((M) => {
  const pending = M.sessions && !s.sess;
  return cell(M, pending ? null : s.m[M.key], s.t[M.tgt], s.def.cur, pending);
}).join("")}</tr>`).join("");
const summaryPanel = `<section class="panel" id="p-RIEPILOGO" hidden><h2>Riepilogo · settimana ${esc(weeks[wi].label)}</h2><p class="hint">Totali per paese, con il target settimanale tra parentesi. Clicca un paese per il dettaglio per prodotto.</p><div class="scroll"><table class="sum"><thead><tr><th class="lead">Paese</th>${SUM_COLS.map((M) => `<th>${esc(M.label)}</th>`).join("")}</tr></thead><tbody>${sumRows}</tbody></table></div></section>`;

const tabs = [{ id: "RIEPILOGO", label: "Riepilogo" }, ...sheets.map((d) => ({ id: d.sheet, label: d.sheet }))];
const today = new Date().toISOString().slice(0, 10);
const page = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="color-scheme" content="light dark">
<title>KPI settimanali · Koala Babycare</title>
<style>
:root{
  --paper:#EEF0EC; --surface:#FFFFFF; --ink:#1B1F23; --ink-2:#4B5359; --ink-3:#7A838A; --line:rgba(27,31,35,.14);
  --accent:#2C4A7C; --accent-soft:#E4EAF4;
  --good-bg:#E7F1E3; --good-fg:#255A29; --warn-bg:#FAF0DC; --warn-fg:#6B4B0F; --bad-bg:#FBEAE8; --bad-fg:#7A2A22;
  --mono: ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace; --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme: dark){:root{
  --paper:#12151A; --surface:#191D22; --ink:#E7ECEF; --ink-2:#A7AFB4; --ink-3:#6E767B; --line:rgba(231,236,239,.14);
  --accent:#7FA8DC; --accent-soft:#1E2A3D;
  --good-bg:#1D2C1C; --good-fg:#A6DDA0; --warn-bg:#332913; --warn-fg:#EFCB82; --bad-bg:#331815; --bad-fg:#F0AA9F;
}}
*{box-sizing:border-box}
html{background:var(--paper)}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.5}
.wrap{max-width:1500px;margin:0 auto;padding:20px 16px 40px}
.eyebrow{display:inline-block;font:500 11px var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--accent);background:var(--accent-soft);padding:4px 10px;border-left:3px solid var(--accent);border-radius:0 8px 8px 0}
h1{font-size:22px;margin:10px 0 4px;letter-spacing:-.01em}
.sub{color:var(--ink-2);font-size:13px;margin:0 0 14px;max-width:90ch}
.legend{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:12px;color:var(--ink-2);margin:0 0 14px}
.tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.tab{font:500 13px var(--mono);padding:7px 14px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);border-radius:8px;cursor:pointer}
.tab[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:#fff}
.panel h2{font-size:16px;margin:4px 0 8px}
.panel .ccy{font:400 12px var(--mono);color:var(--ink-3);margin-left:6px}
.hint{font-size:12px;color:var(--ink-3);margin:0 0 8px}
.scroll{overflow-x:auto;background:var(--surface);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap;text-align:right}
thead th{position:sticky;top:0;background:var(--surface);font:500 11px var(--mono);color:var(--ink-3);text-transform:uppercase;letter-spacing:.04em;z-index:2}
th.lead{text-align:left;position:sticky;left:0;background:var(--surface);z-index:1;font-weight:500;color:var(--ink-2);min-width:150px}
thead th.lead{z-index:3}
th.wk.last{color:var(--accent)}
tr.grp td{background:var(--accent-soft);color:var(--accent);font:600 12px var(--mono);text-align:left;letter-spacing:.06em;padding:6px 10px}
tr.strong th.lead{color:var(--ink);font-weight:600}
td.c{font-family:var(--mono);font-variant-numeric:tabular-nums}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-weight:600}
.pill.good{background:var(--good-bg);color:var(--good-fg)}.pill.warn{background:var(--warn-bg);color:var(--warn-fg)}.pill.bad{background:var(--bad-bg);color:var(--bad-fg)}
.tgt{margin-left:6px;font-size:11px;color:var(--ink-3)}
.na{color:var(--ink-3)}
table.sum th.lead a{color:var(--ink);text-decoration:none;border-bottom:1px dotted var(--ink-3)}
.foot{margin-top:18px;font-size:12px;color:var(--ink-3);line-height:1.7;max-width:110ch}
@media (max-width:640px){.tgt{display:block;margin-left:0}}
</style>
</head>
<body>
<div class="wrap">
  <span class="eyebrow">Koala Babycare · Sellerboard</span>
  <h1>KPI settimanali</h1>
  <p class="sub">Settimane complete lunedì–domenica, da ${esc(weeks[0].label)} a ${esc(weeks[wi].label)}. Si aggiorna ogni lunedì mattina. Dati fino al ${esc(cutoff)} · pagina generata il ${esc(today)}.</p>
  <div class="legend"><span class="pill good">target raggiunto</span><span class="pill warn">entro il 10%</span><span class="pill bad">oltre il 10%</span><span>· il target settimanale è tra parentesi · per ACOS e Refund meno è meglio</span></div>
  <div class="tabs" role="tablist">${tabs.map((t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="false">${esc(t.label)}</button>`).join("")}</div>
  ${summaryPanel}
  ${panels.join("\n  ")}
  <p class="foot">Sales e CM reali dal report Sellerboard "Dashboard by product", con Net Profit e IVA calibrati sul P&amp;L reale; Margin % sulle vendite al netto IVA. Il target Sales segue la convenzione CM ÷ margin (senza IVA), le Sales reali sono lorde IVA: la riga "Sales netto IVA" permette un confronto più corretto. Ogni settimana usa i target del mese del suo giovedì. Sessions e CVR (unità ÷ sessioni) sono salvate dal 14/9/2026; Amazon le consegna con circa 3 giorni di ritardo, quindi per la settimana appena chiusa compare "in arrivo" finché non sono complete (altrimenti il CVR risulterebbe gonfiato). Il BSR è il ranking nella categoria principale Amazon, media della settimana del child con il numero più basso (meglio piazzato), da Helium 10: viene aggiornato a mano, le settimane senza dato restano vuote. Sessions, CVR, Unità e BSR non hanno target. I dati dell'ultima settimana possono cambiare di poco nei giorni successivi (Sellerboard rivede refund e ADS).</p>
</div>
<script>
(function(){
  var ids=${JSON.stringify(tabs.map((t) => t.id))};
  function show(id){
    if(ids.indexOf(id)<0) id='RIEPILOGO';
    ids.forEach(function(x){var p=document.getElementById('p-'+x); if(p) p.hidden=(x!==id);});
    document.querySelectorAll('.tab').forEach(function(b){b.setAttribute('aria-selected', b.dataset.tab===id ? 'true':'false');});
    try{history.replaceState(null,'','#'+id);}catch(e){}
  }
  document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){show(b.dataset.tab);});});
  document.querySelectorAll('[data-go]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();show(a.dataset.go);});});
  show((location.hash||'').replace('#',''));
})();
</script>
</body>
</html>
`;
fs.writeFileSync(OUT_FILE, page);
console.log("scritto", OUT_FILE, "(" + Math.round(fs.statSync(OUT_FILE).size / 1024) + " KB)");
