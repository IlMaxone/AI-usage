# Istruzioni per gli agenti AI

## Ambito

Questo repository contiene esclusivamente lo strumento locale di analisi
dell'utilizzo AI. Non introdurre dipendenze o riferimenti a repository
applicativi esterni.

## Regole sui dati

- Non salvare ne mostrare nei report il testo OCR completo o dati personali
  presenti negli screenshot.
- Non pubblicare le cartelle reali sotto `projects/`, i modelli OCR, le cache o
  i file `.env`. `projects/demo/` e l'unica eccezione versionabile e deve
  contenere esclusivamente dati inventati.
- Trattare i registri JSONL in `projects/<nome>/historical-data/` e
  `projects/<nome>/internet-data/` come append-only. Eventuali correzioni devono
  restare tracciabili.
- Non modificare o eliminare `ai-usage-analytics.md`.
- Separare sempre rilevazioni locali, dati scaricati e stime derivate.

## Regole operative

- Prima di archiviare un'immagine, richiedere l'accordo di almeno due passaggi
  OCR sui valori di utilizzo e reset.
- Se i controlli non concordano, lasciare l'immagine in ingresso e richiedere
  verifica manuale.
- Non registrare snapshot Internet quando nessuna nuova immagine supera la
  validazione.
- Conservare URL, timestamp e hash delle fonti esterne utilizzate.
- Ogni modifica al parser OCR deve superare
  `npm run verify:processed -- --project <nome>` su almeno un progetto locale
  reale.
- Eseguire almeno il controllo sintattico degli script modificati e una prova
  offline o dry-run appropriata.

## Dashboard

Le dashboard devono rimanere file HTML statici e autonomi, senza JavaScript,
server locale, endpoint o risorse caricate da Internet. Ogni progetto conserva
la propria dashboard dentro `projects/<nome>/reports/dashboard.html`.
