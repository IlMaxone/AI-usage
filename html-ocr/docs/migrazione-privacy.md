# Migrazione e privacy

Il precedente motore alla radice è stato raccolto in `html-ocr/`. L'app Docker
è il percorso principale; HTML OCR continua a funzionare solo su avvio manuale.

| Posizione precedente | Posizione attuale |
| --- | --- |
| `scripts/`, `run-analysis.ps1` | `html-ocr/scripts/`, `html-ocr/run-analysis.ps1` |
| `package.json`, lockfile e dipendenze | Stessi nomi sotto `html-ocr/`. |
| `ocr-cache/` | `html-ocr/ocr-cache/` |
| `projects/<nome>/historical-data/` | `html-ocr/projects/<nome>/historical-data/` |
| `projects/<nome>/internet-data/` | `html-ocr/projects/<nome>/internet-data/` |
| `projects/<nome>/reports/` | `html-ocr/projects/<nome>/reports/` |
| Foto in `to-process-img/` e `processed-images/` | Percorsi originali sotto `projects/<nome>/`, invariati. |

I registri sono stati spostati senza riscrivere il contenuto. Il
[documento originale](../ai-usage-analytics.md) è preservato byte per byte e
non va modificato o eliminato. La documentazione operativa aggiornata risiede
in questa cartella `docs/`; il documento originale rimane un riferimento storico.

Il motore non importa `web-app`, non legge il CSV dei modelli, non usa
PostgreSQL o il selettore Windows e non è un servizio Docker. Le foto restano
esterne per conservare i percorsi esistenti; le cartelle delle immagini web
sono diverse e non vengono scansionate.

Solo i dati inventati del demo possono essere versionati. Progetti reali,
foto, copie delle fonti, report reali, dipendenze, cache, modelli OCR e `.env`
restano esclusi da Git. Non salvare o mostrare nei report testo OCR completo
o informazioni personali presenti nelle immagini.

Per un backup fermare eventuali analisi in corso e conservare insieme
`html-ocr/projects/<nome>/` e le due cartelle foto in `projects/<nome>/`.
Un backup del database Docker non include i dati di questo motore. Conservare
i file JSONL integralmente, senza correggere a mano le righe storiche.

Le [regole comuni](../../AGENTS.md) e quelle [del motore](../AGENTS.md)
specificano integrità, riservatezza e verifiche richieste.

Torna all'[indice](README.md).
