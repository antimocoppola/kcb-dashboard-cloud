# KCB Dashboard — pipeline cloud

Questo repository aggiorna da solo, ogni giorno, la dashboard vendite/profitto
Koala Babycare (EU + USA), pubblicandola su GitHub Pages. Gira interamente sui
server di GitHub Actions — non serve che nessun PC sia acceso.

## Cosa fa ogni giorno (automaticamente)

1. Scarica il report "Prodotti" sellerboard per EU e USA (`scripts/cloud_import.mjs`).
2. Aggiunge solo le righe nuove a `data/history.json` (nessun duplicato).
3. Ricostruisce `docs/index.html` con lo storico aggiornato (`scripts/cloud_build.mjs`).
4. Fa commit + push dei due file, se sono cambiati.
5. GitHub Pages pubblica automaticamente `docs/index.html` non appena viene aggiornato.

## Setup una tantum (da fare tu, su github.com)

1. **Crea un repository vuoto** su GitHub, **privato** (contiene dati di vendita).
   Nome suggerito: `kcb-dashboard-cloud`. Non aggiungere README/gitignore alla
   creazione: deve restare vuoto, questa cartella lo riempie.
2. Collega questa cartella al repository appena creato e fai il primo push
   (i comandi esatti te li do a parte, dopo che mi hai dato l'URL del repo).
3. **Aggiungi i 2 secrets** — Settings → Secrets and variables → Actions →
   New repository secret:
   - `EU_PRODUCTS_URL` = il link del report "Prodotti" sellerboard account EU
   - `US_PRODUCTS_URL` = il link del report "Prodotti" sellerboard account USA

   Sono gli stessi due link già in uso nel progetto locale (`sellerboard-mcp/.env`).
   Non finiscono mai nel codice o nei log: GitHub li tiene cifrati e li maschera
   automaticamente ovunque vengano stampati per errore.
4. **Abilita GitHub Pages** — Settings → Pages → Source: "Deploy from a branch"
   → Branch: `main`, cartella `/docs` → Save.
   Dopo qualche minuto GitHub mostra l'indirizzo pubblico della dashboard
   (tipo `https://TUO-USER.github.io/kcb-dashboard-cloud/`).
5. (Facoltativo, per testare subito) Actions → "Aggiorna dashboard KCB" →
   Run workflow, invece di aspettare la prossima esecuzione pianificata
   (tutti i giorni alle 09:15 UTC).

## File

- `data/history.json` — storico compatto (una riga per ASIN/giorno/marketplace),
  seed generato dallo storico locale al 2026-07-23. Pesa ~10MB, cresce di poco
  ogni giorno — niente a che vedere con il `database/data.json` da 379MB del
  progetto locale (quello tiene anche l'intera riga CSV grezza, qui no).
- `scripts/cloud_import.mjs` — scarica e appende i dati nuovi.
- `scripts/cloud_build.mjs` — ricostruisce `docs/index.html` (stessa mappa
  ASIN→parent del progetto locale, tienile allineate se cambi l'una o l'altra).
- `scripts/dashboard_template.html` — stesso template/UI della dashboard locale.
- `.github/workflows/dashboard.yml` — la pianificazione giornaliera.

## Nota sul blocco di conferma manuale

A differenza della dashboard pubblicata come Artifact Claude (che richiede un
tap di conferma ad ogni pubblicazione automatica), questa gira come pagina
GitHub Pages normale: nessuna conferma, nessun intervento umano richiesto.
