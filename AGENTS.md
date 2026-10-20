# Istruzioni per gli agenti AI

## Ambito

Questo repository contiene l'app principale in `web-app/` e il motore OCR
secondario indipendente in `html-ocr/`. Non introdurre dipendenze o riferimenti
a repository applicativi esterni. Non creare import, dipendenze npm, mount
Docker o avvii automatici che colleghino i due motori.

## Regole sui dati

- Non salvare ne mostrare nei report il testo OCR completo o dati personali
  presenti negli screenshot.
- Non pubblicare le cartelle reali sotto `projects/` e `html-ocr/projects/`,
  i modelli OCR, le cache o i file `.env`. I demo in `projects/demo/` e
  `html-ocr/projects/demo/` sono le sole eccezioni e contengono dati inventati.
- Trattare i registri JSONL in `html-ocr/projects/<nome>/historical-data/` e
  `html-ocr/projects/<nome>/internet-data/` come append-only. La migrazione ha
  cambiato solo il percorso; eventuali correzioni devono restare tracciabili.
- Non modificare o eliminare `html-ocr/ai-usage-analytics.md`: documento
  originale spostato senza alterarne il contenuto.
- Le foto storiche rimangono in `projects/<nome>/to-process-img/` e
  `processed-images/`; non mescolarle con le cartelle immagini dell'app.
- Separare sempre rilevazioni locali, dati scaricati e stime derivate.
- Conservare gli acquisti di crediti extra come dichiarazioni utente append-only,
  distinti sia dai dati OCR sia dalle stime del piano. Considerarli interamente
  spesi, con residuo assunto pari a zero, come regola esplicita di progetto.
- Conservare le osservazioni di fatturazione e le calibrazioni come dati
  append-only dichiarati dall'utente. Calcolare i risultati derivati nel motore
  e non confonderli con importi direttamente fatturati.
- Usare la calibrazione di fatturazione come metodo primario quando disponibile;
  mantenere le stime basate unicamente sui listini online come confronto
  secondario.

## Regole operative

- Prima di archiviare un'immagine, richiedere l'accordo di almeno due passaggi
  OCR sui valori di utilizzo e reset.
- Se i controlli non concordano, lasciare l'immagine in ingresso e richiedere
  verifica manuale.
- Non registrare snapshot Internet quando nessuna nuova immagine supera la
  validazione.
- Conservare URL, timestamp e hash delle fonti esterne utilizzate.
- Ogni modifica al parser OCR deve superare
  `npm --prefix html-ocr run verify:processed -- <nome>` su almeno un progetto
  locale reale. Il comando si esegue con le dipendenze del motore secondario.
- Eseguire almeno il controllo sintattico degli script modificati e una prova
  offline o dry-run appropriata.

## Dashboard

Le dashboard del motore secondario devono rimanere file HTML statici e autonomi,
senza JavaScript, server locale, endpoint o risorse caricate da Internet. Ogni
progetto conserva la propria dashboard dentro
`html-ocr/projects/<nome>/reports/dashboard.html`. Questa regola riguarda i
report statici; l'app principale conserva la propria interfaccia Angular.
