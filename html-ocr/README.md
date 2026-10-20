# HTML OCR

Motore secondario per analisi locale da screenshot e report HTML statici.
Rimane manuale e indipendente dall'app Docker: codice, pacchetto npm, cache,
registri, report e documentazione sono raccolti qui. Le foto storiche restano
nei percorsi originali sotto `projects/<nome>/` alla radice del repository.

## Avvio rapido

Dalla radice del repository, al primo utilizzo:

```powershell
cd html-ocr
npm install
node scripts/analyze.mjs --project demo --dry-run --offline
```

Per un progetto reale usare il suo nome e preparare prima cache OCR e fonti
necessarie. Le stime non rappresentano consumo o fatturazione ufficiali.
Per il demo senza foto eseguire `npm run demo:build` e aprire la
[dashboard inventata](projects/demo/reports/dashboard.html).

## Documentazione

La [cartella docs](docs/README.md) contiene guide brevi per argomento:

- [Avvio e comandi](docs/avvio-comandi.md).
- [Struttura dei dati](docs/struttura-dati.md) e [OCR e convalida](docs/ocr-validazione.md).
- [Calibrazione e stime](docs/calibrazione-stime.md), [fonti e report](docs/fonti-report.md).
- [Verifiche e problemi](docs/verifiche-problemi.md).
- [Migrazione e privacy](docs/migrazione-privacy.md), [sviluppo e riferimenti](docs/sviluppo-riferimenti.md).

Il [documento originale](ai-usage-analytics.md) resta conservato senza modifiche.
Le [regole del motore](AGENTS.md) integrano quelle comuni del repository.
Per il percorso principale consultare il [README dell'app Docker](../web-app/README.md).
