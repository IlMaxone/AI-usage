# Struttura dei dati

Il progetto è sempre indicato esplicitamente. Ogni nome identifica un archivio
isolato; non viene selezionato automaticamente un progetto predefinito.

```text
projects/<nome>/                     foto, alla radice del repository
├── to-process-img/                  nuove immagini
└── processed-images/                immagini archiviate

html-ocr/projects/<nome>/            dati del solo motore secondario
├── historical-data/
│   ├── usage-snapshots.jsonl
│   ├── capture-time-observations.jsonl
│   ├── extra-credit-purchases.jsonl
│   └── billing-calibrations.jsonl
├── internet-data/
│   ├── pricing-snapshots.jsonl
│   ├── exchange-rate-snapshots.jsonl
│   └── raw/
└── reports/
    ├── dashboard.html
    ├── *.md
    └── csv/
```

I JSONL contengono un oggetto per riga e sono append-only: non riscrivere o
cancellare osservazioni passate per correggere un risultato. Le rettifiche
temporali sono osservazioni separate, associate all'hash dell'immagine. I report
sono risultati derivati e possono essere rigenerati dai registri e dalle fonti.

`html-ocr/scripts/` contiene analisi e rendering; `package.json`, lockfile,
`node_modules/`, `ocr-cache/` e launcher sono tutti interni a `html-ocr/`.
Solo le foto rimangono esterne per conservare i percorsi originali.

Questo motore non legge `models/models.csv`, non usa il database dell'app e
non scansiona le cartelle `to-process`, `processed` o `deleted` dei progetti web.
La dashboard si apre da `html-ocr/projects/<nome>/reports/dashboard.html`.

Il [progetto demo](../projects/demo/README.md) contiene esclusivamente dati
inventati. I progetti reali, cache e dipendenze sono esclusi da Git.
Vedere [migrazione e privacy](migrazione-privacy.md) per backup e conservazione.

Torna all'[indice](README.md).
