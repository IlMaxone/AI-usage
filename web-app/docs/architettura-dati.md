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
projects/<nome>/
├── to-process/                        ingresso
├── processed/                         foto convalidate
├── unprocessed/                       tentativi falliti
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
Le letture A/B sono preparate separatamente e pubblicate insieme in transazione.
Un fallimento iniziale rimuove record e riferimenti upload, mantenendo foto e
alert persistente; una rilettura fallita ripristina l'ultima coppia valida.

Le cartelle usano il nome normalizzato, senza ID o suffissi automatici. Creazione
e rinomina bloccano i nomi già usati, anche con maiuscole, accenti o separatori
diversi che produrrebbero la stessa cartella. Il vincolo vale fra account e
riserva anche i nomi dei progetti eliminati, che non vengono riaperti o migrati.
I nuovi account iniziano senza un progetto automatico. La rinomina dalla UI aggiorna cartella, riferimenti
e manifest di recupero; non rinominare manualmente i file collegati al DB.
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
