# Architettura e dati

| Servizio | Responsabilità |
| --- | --- |
| `frontend` | Angular 20, interfaccia SPA servita da nginx. |
| `api` | NestJS 11, autenticazione JWT, API REST e import CSV all'avvio. |
| `worker` | OCR locale Tesseract/Sharp e scansione delle cartelle progetto. |
| `db` | PostgreSQL 17, volume persistente Docker. |

Il modello linguistico OCR viene scaricato durante la build dell'immagine.
Il worker non richiede Internet durante l'elaborazione delle foto. Ogni servizio
applicativo ha dipendenze proprie sotto `web-app`; non importa il motore storico.

## Archivi e montaggi

```text
models/models.csv                      catalogo di configurazione
projects/<nome>--<id-breve>/
├── to-process/                        ingresso e foto da verificare
├── processed/                         foto convalidate
└── deleted/<id-rilevazione>/           foto rimosse, con manifest
```

API e worker montano `projects/` come `/data/projects`. Solo l'API monta
`models/` in sola lettura come `/config/models`. `MODEL_CATALOG_PATH` viene
configurato da Compose; il worker legge il catalogo importato nel database.
Il volume `ai-usage-web_postgres-data` conserva lo stato SQL.

Un record rappresenta uno screenshot singolo (`CONSTANT`) o una coppia
inizio/fine (`SEGMENT`). Gli upload hanno ruoli `SINGLE`, `START` ed `END`.
Snapshot OCR, revisioni delle riletture, correzioni manuali, osservazioni
temporali, tag modello e audit sono entità distinte. Non si salva il testo OCR.

Il suffisso ID evita collisioni tra nomi progetto. La rinomina dalla UI aggiorna
cartella e riferimenti; non rinominare manualmente i nomi tecnici collegati al DB.
La migrazione da `web-app/storage/uploads/` copia i file collegati nel nuovo
archivio. File non associati e `_unassigned/` rimangono nel vecchio archivio.

## API e separazione

L'API è su [localhost:3000/api](http://localhost:3000/api), con documentazione
[OpenAPI](http://localhost:3000/api/docs) e controllo pubblico
[health](http://localhost:3000/api/health). Le aree principali sono progetti,
rilevazioni, contenuti immagine, modelli, dashboard e analisi dei costi.
Le API dei modelli sono di sola lettura; le immagini richiedono JWT e proprietà.

`html-ocr/` non è montato o avviato da Docker. I JSONL, le dashboard statiche e
le foto storiche in `to-process-img` e `processed-images` non vengono importati
dal worker web. Non esiste sincronizzazione automatica fra i due flussi.

Torna all'[indice](README.md).
