# Motore secondario HTML OCR

Si applicano anche le regole comuni di `../AGENTS.md`.

- Conservare qui codice, launcher, pacchetto npm, dipendenze, cache, dati,
  report e documentazione del motore storico. Non importare codice o tariffe
  dall'app principale e non aggiungere questo motore a Docker Compose.
- Le foto sono l'unica eccezione alla separazione fisica: rimangono in
  `../projects/<nome>/to-process-img/` e `processed-images/`. Non scansionare
  `to-process`, `processed` o `deleted`, che appartengono all'app.
- `projects/<nome>/historical-data/` e `internet-data/` contengono registri
  append-only; i progetti reali rimangono esclusi da Git. Solo `projects/demo/`
  può essere versionato e deve contenere esclusivamente dati inventati.
- Non modificare o eliminare `ai-usage-analytics.md`, preservato byte per byte
  durante lo spostamento in questa cartella.
- Eseguire i comandi npm da questa cartella, oppure con `npm --prefix html-ocr`
  dalla radice. Dopo modifiche al parser eseguire `npm run verify:processed -- <nome>`
  su un progetto locale reale; controllare sintassi e modalità offline o dry-run
  anche per le modifiche ai percorsi.
- Conservare le dashboard in `projects/<nome>/reports/dashboard.html` come
  file HTML autonomi, senza JavaScript, server o risorse Internet.
