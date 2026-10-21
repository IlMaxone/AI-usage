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
projects/<UUID-spazio-utente>/<nome>--<UUID-progetto>/
├── .project.json                      identità firmata del progetto
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

La colonna JSONB `ocr_failure_notifications.diagnostics` conserva i tentativi
diagnostici per file, indipendentemente dagli upload eventualmente rimossi.
Il logger ammette soltanto dettagli strutturati: codici, passaggi, valori
numerici e temporali, confidenza, catalogo modelli, dimensioni e hash. Non salva
il testo OCR o eccezioni grezze. Ogni nuovo errore aggiunge un tentativo;
il recupero all'avvio non replica la cronologia già conservata.
`GET /api/notifications/ocr-failures/debug` restituisce il rapporto dei soli
alert aperti del proprietario autenticato. La lista ordinaria degli alert
omette il dettaglio per non inviarlo a ogni polling. Il frontend genera il
download JSON dallo stesso rapporto mostrato nella console.

Le cartelle sono separate per UUID dello spazio utente e UUID del progetto.
Creazione e rinomina bloccano i nomi normalizzati già usati nello stesso account;
utenti diversi possono usare lo stesso nome. Le cartelle firmate del proprio
spazio ricreano i progetti mancanti senza ripristinare dati OCR eliminati.
I nuovi account non ereditano cartelle prive di proprietario. La rinomina dalla
UI aggiorna cartella, riferimenti e manifest; i progetti eliminati non vengono
riaperti. Vedere [identità e recupero](progetti-utenti-recupero.md).
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

## Riprova OCR

`POST /api/notifications/ocr-failures/retry` è autenticato e riaccoda soltanto
gli errori aperti dell'utente corrente tramite il normale importatore. Un lock
per utente evita invii simultanei; le coppie già in coda vengono saltate. Le
foto sorgenti restano conservate durante la preparazione e l'alert non si chiude
prima del successo. Nessun cambiamento al tag immutabile è consentito.

Torna all'[indice](README.md).
