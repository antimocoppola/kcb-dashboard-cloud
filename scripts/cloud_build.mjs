import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, "..");

// Stessa mappa ASIN -> parent usata in sellerboard-mcp/scripts/build_dashboard.mjs.
// Se cambia una, aggiorna anche l'altra.
const PARENT_MAP = {
  KPH: ["B07287LFMS","B071VQG35B","B071493954","B0F9PB5W82","B0F9P56QBR"],
  KPHM: ["B071JR532L","B071JR7FGJ","B071G58PZR","B0F9P5XF7Z","B0F9P8W4WH"],
  KPHB: ["B07FC27HPT","B07FC1DTZ3","B07FC27HGD","B0F9P3TKKC","B0F9P5WS8Z"],
  HUG: ["B07FC37H9N","B0F6N5SV5B","B0F6N5T3XW","B0DQYT9ZZL","B0DQYSTHXP","B0DQYSTR3K","B0DQYTP167","B0DQYTBYSS","B07FC6KSL3","B0F6N5WR9M","B0F6N47D22","B0DQYSW8QR","B0DQYRGY8W","B0DQYQFXFL","B0BR8DNJQ2","B0BR8FWVNF","B0BR8DQ96R","B0DTQBHK2B","B0DTQD4336","B0DZ157VP6"],
  KCB1: ["B07G85PQ5J","B07G84LSYJ","B07G85W2CN","B0892MT1V3","B0892LL85K","B0892M2BB1","B0F9B38HPL","B0F9B5KDH6"],
  KCB2: ["B0B972NB6J","B0B97439HB","B0CDD58HPG","B0CDCQPHR8","B0B974V32V","B0B977LBZF","B0D4ZNFKYQ","B0D4ZXLW6R","B0D4ZNFKYP","B0D4ZNZDRH","B0D4ZMP6XH","B0D4ZLGZCC","B0D4ZMPS1Z","B0D512ZDZD"],
  CBR: ["B0FCS94QLM","B0FCS9PFYQ","B0FCS9GK5J","B0FCS9NL5S"],
  CCA: ["B0H71TR6L7","B0H71VK8SZ","B0H71Y87Q2","B0H71VC9LG"],
  KSC: ["B07ND58735","B07Y7JSRNJ","B085NY3RJQ","B085NYR3QG"],
  KST: ["B0B5LD23HJ","B0F9PXS546","B0B5LDVDZQ","B0B5LD2H1Z","B0B5LCT5LT","B0F9PTC7QT","B0B5LFPPQ2","B0B5LFH48C","B0C6KS2VFY","B0F9PXWXXD","B0C6KTLNQ9","B0C6KSGLKF","B0C6KQ3V5D","B0F9PR6363","B0C6KSVQQC","B0C6KPC7LT","B0D4YXMHN8","B0F9PSP71B","B0D4YYPVTV","B0D4ZKJLTC","B0F9PS7YTC","B0F9PTHFF3","B0F9PVQGYY","B0F9PT3TJJ","B0D4YW1GP4","B0F9PSJ39V","B0D4YZ6CV9","B0D4ZJTG1L"],
  CBA: ["B0GYFNKKJQ","B0GYFXCLZH","B0GYFVQDL5","B0GYFVC5ML"],
  KBB: ["B0BFN7K7S2","B0BFN66S42","B0BFN7S56N","B0BFN7FT4Z","B0BFN5ZX4B"],
};
const ASIN_TO_PARENT = {};
for (const [p, asins] of Object.entries(PARENT_MAP)) for (const a of asins) ASIN_TO_PARENT[a] = p;
const PARENT_NAMES = {
  KCB1: "Fascia porta-bebe", KCB2: "Cuddle Band 2.0", KSC: "Coppette paracapezzoli",
  KPH: "Cuscino plagiocefalia", KPHM: "Cuscino plagiocefalia Maxi", KPHB: "Cuscino plagiocefalia Baby",
  HUG: "Cuscino gravidanza", CBA: "Organizer fasciatoio", KST: "Mussole",
  CBR: "Nuova linea CBR", KBB: "Lancio KBB", CCA: "Lancio CCA",
};

function main() {
  const history = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "data", "history.json"), "utf8"));
  const pnlFile = path.join(REPO_DIR, "data", "pnl.json");
  const pnl = fs.existsSync(pnlFile) ? JSON.parse(fs.readFileSync(pnlFile, "utf8")) : [];

  // Il NetProfit e il VAT per-ASIN del report Prodotti non tornano esatti col pannello
  // P&L di sellerboard (le due pipeline interne di SB calcolano entrambi in modo
  // diverso - verificato riga per riga, non e' un problema di formula nostra). Il
  // report P&L invece e' esatto ma solo a livello di intero account/giorno (nessuna
  // colonna paese/ASIN, e solo una finestra scorrevole di ~7 giorni). Calcoliamo un
  // fattore di calibrazione account+giorno = P&L / somma-Prodotti per ciascuno dei due
  // valori, e lo applichiamo a ogni riga di quel giorno: i giorni coperti dal P&L
  // (recenti, crescono da quando abbiamo iniziato a salvarlo) diventano piu' vicini
  // al vero, i giorni piu' vecchi (fuori dalla finestra P&L) restano col valore grezzo.
  const netProfitSumByKey = new Map();
  const vatSumByKey = new Map();
  for (const [iso, accKey, , , , , netProfit, , , , vat] of history) {
    const key = accKey + "|" + iso;
    netProfitSumByKey.set(key, (netProfitSumByKey.get(key) || 0) + netProfit);
    vatSumByKey.set(key, (vatSumByKey.get(key) || 0) + vat);
  }

  function buildFactorMap(pnlValueIdx, productsSumByKey) {
    const map = new Map();
    for (const r of pnl) {
      const key = r[1] + "|" + r[0];
      const productsSum = productsSumByKey.get(key);
      if (productsSum === undefined || Math.abs(productsSum) < 1) continue; // evita divisioni per ~0
      map.set(key, r[pnlValueIdx] / productsSum);
    }
    return map;
  }
  const netProfitFactorByKey = buildFactorMap(3, netProfitSumByKey);
  const vatFactorByKey = buildFactorMap(4, vatSumByKey);

  const rows = [];
  let minDate = null, maxDate = null;
  let calibratedDays = new Set();
  for (const [iso, accKey, marketplace, asin, sku, sales, netProfit, adSpend, refunds, units, vat] of history) {
    if (!minDate || iso < minDate) minDate = iso;
    if (!maxDate || iso > maxDate) maxDate = iso;
    const parent = ASIN_TO_PARENT[asin] || null;
    const key = accKey + "|" + iso;
    const npFactor = netProfitFactorByKey.get(key);
    const vatFactor = vatFactorByKey.get(key);
    const calibratedNetProfit = npFactor !== undefined ? netProfit * npFactor : netProfit;
    const calibratedVat = vatFactor !== undefined ? vat * vatFactor : vat;
    if (npFactor !== undefined) calibratedDays.add(key);
    rows.push([iso, accKey, marketplace, parent, sales, calibratedNetProfit, adSpend, refunds, units, calibratedVat]);
  }

  const dataset = { minDate, maxDate, parentNames: PARENT_NAMES, generatedAt: new Date().toISOString(), rows };
  console.log("giorni calibrati con P&L reale:", calibratedDays.size, "su", new Set(history.map(r => r[1]+"|"+r[0])).size, "giorni totali");

  const template = fs.readFileSync(path.join(__dirname, "dashboard_template.html"), "utf8");
  const fragment = template.replace("__DATA_PLACEHOLDER__", JSON.stringify(dataset));

  // Il template e' un frammento pensato per essere incollato dentro l'involucro
  // <html><head>...</head><body> che Claude aggiunge da se' quando pubblica un Artifact.
  // Servito "nudo" su GitHub Pages non ha quell'involucro: senza <meta name="color-scheme">
  // il dark-mode automatico del browser reinterpreta i colori in modo incoerente
  // (scritte nere illeggibili su sfondo scuro). Qui aggiungiamo l'involucro completo.
  const titleMatch = fragment.match(/<title>[\s\S]*?<\/title>/);
  const title = titleMatch ? titleMatch[0] : "<title>Dashboard</title>";
  const body = titleMatch ? fragment.replace(titleMatch[0], "") : fragment;
  const out = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
${title}
</head>
<body>
${body}
</body>
</html>
`;

  const docsDir = path.join(REPO_DIR, "docs");
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(path.join(docsDir, "index.html"), out);

  console.log("rows:", rows.length, "range:", minDate, "->", maxDate);
  console.log("written docs/index.html, size KB:", Math.round(out.length / 1024));
}

main();
