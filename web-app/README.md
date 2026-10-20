# AI Usage Web

App principale per analizzare l'utilizzo AI: Angular, API NestJS, worker OCR
locale e PostgreSQL, avviati con Docker Compose. I modelli e i prezzi sono
importati dal CSV; le foto sono conservate nelle cartelle private dei progetti.
Il motore storico HTML OCR rimane separato e non viene avviato da questi servizi.

## Avvio rapido su Windows

Richiede Docker Desktop e Node.js. Dalla radice del repository:

```powershell
cd web-app
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Impostare in `.env` valori robusti per `POSTGRES_PASSWORD` e `JWT_SECRET`, poi
eseguire `npm run start:windows`. Aprire [localhost:4400](http://localhost:4400).
Per altri sistemi e dettagli del selettore Windows leggere la
[guida di avvio](docs/avvio-configurazione.md).

## Documentazione

La [cartella docs](docs/README.md) raccoglie le guide operative e tecniche:

- [Avvio e configurazione](docs/avvio-configurazione.md), [architettura e dati](docs/architettura-dati.md).
- [Caricamento e OCR](docs/caricamento-ocr.md).
- [Modelli e costi](docs/modelli-costi.md), [interfaccia e stati](docs/interfaccia-stati.md).
- [Backup e recupero](docs/backup-recupero.md).
- [Verifiche e sviluppo](docs/verifiche-sviluppo.md), [problemi e privacy](docs/problemi-privacy.md).

Il [catalogo CSV](../models/models.csv) ha una propria [guida del formato](../models/README.md).
API e riferimento OpenAPI sono su [localhost:3000/api/docs](http://localhost:3000/api/docs).
Per il motore secondario consultare il [README HTML OCR](../html-ocr/README.md).
