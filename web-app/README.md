# AI Usage Web

Applicazione separata dal motore locale storico. Il flusso originale, i JSONL
e le dashboard HTML statiche non vengono letti né modificati da questi servizi.

## Servizi

- `frontend`: Angular 20, SPA servita da nginx;
- `api`: NestJS 11, REST API e autenticazione JWT;
- `worker`: processo NestJS standalone per OCR locale Tesseract/Sharp;
- `db`: PostgreSQL 17.

Ogni servizio applicativo è costruito e avviato da Docker Compose. Il database
risiede in un volume Docker; gli screenshot risiedono nella cartella host
`web-app/storage/uploads/`, esclusa da Git e montata come `/data/uploads` in API
e worker. Il modello OCR viene
scaricato durante la build dell'immagine e il worker non richiede accesso a
Internet durante l'elaborazione.

## Avvio

1. Copiare `.env.example` in `.env`.
2. Sostituire `POSTGRES_PASSWORD` e `JWT_SECRET` con segreti robusti.
3. Avviare:

   ```powershell
   docker compose up --build
   ```

4. Aprire `http://localhost:4400`.

L'API è disponibile su `http://localhost:3000/api`; la documentazione OpenAPI
è su `/api/docs`. La registrazione crea un account isolato con il modello
predefinito `GPT-5.6 Sol` e reasoning `high`.

## Flusso dati

1. L'utente crea, modifica o elimina liberamente i progetti dalla pagina dedicata.
2. Dalla pagina Inserimento sceglie `Usage costante` con un solo screenshot,
   oppure `Segmento di usage` con screenshot iniziale e finale.
3. Il pulsante `Avvia convalida` mette gli screenshot in coda. Il worker calcola
   SHA-256 ed esegue tre letture OCR locali mirate alla zona usage. Esegue inoltre
   tre letture dell'angolo in basso a destra per data e ora. Una rilevazione è
   validata solo se almeno due passaggi concordano sui valori e almeno due sulla
   data e ora visibili nello screenshot.
4. In caso di disaccordo l'immagine resta in `manual_review`; non viene creato
   alcuno snapshot di utilizzo e non viene salvato il testo OCR completo.
5. Un singolo screenshot conserva l'usage corrente. Una coppia inizio/fine
   attribuisce al progetto il delta tra le due percentuali quando gli orari di
   reset 5h differiscono al massimo di 60 minuti. Il reset settimanale viene
   usato come segnale di coerenza (`stessa finestra`, `rollover` o `spostato`),
   ma non blocca la misura: al cambio settimana può infatti saltare in avanti
   o mostrare una data inattesa. Oltre un'ora di scarto sul reset 5h il segmento
   richiede verifica manuale.
6. I valori possono essere corretti dalla UI. La correzione è append-only e
   non sovrascrive lo snapshot OCR originale. La rilevazione può essere rimossa
   dalla vista mantenendo audit e dati tecnici tracciabili.
7. Data e ora della rilevazione non dipendono dall'esecuzione OCR: per l'usage
   costante provengono dallo screenshot singolo; per un segmento provengono dallo
   screenshot finale. Eventuali rettifiche temporali storiche sono osservazioni
   append-only separate e non modificano lo snapshot OCR originale.

## Archivio screenshot e pagina Analisi

Ogni immagine caricata viene conservata con nome tecnico univoco nella
sottocartella del progetto:

```text
web-app/storage/uploads/<nome-progetto>--<id-breve>/
```

Il suffisso dell'ID evita collisioni fra progetti omonimi. Se un progetto viene
rinominato dalla UI, API e database rinominano insieme la relativa cartella.
L'archivio è intenzionalmente escluso da Git e può essere copiato per backup o
recupero mentre lo stack è fermo; non rinominare a mano cartelle o file, perché
i nomi tecnici sono collegati al database. La pagina **Analisi immagini** richiede
la selezione di un progetto alla volta e permette di aprirne le immagini a piena
dimensione.
Durante la migrazione, eventuali file provenienti da database già azzerati e
quindi privi di un progetto associabile vengono preservati in
`storage/uploads/_unassigned/`; non compaiono nella pagina Analisi.
Le immagini vengono lette dalla stessa cartella tramite un endpoint protetto da
JWT: non esiste una directory web pubblica e ogni utente vede soltanto i propri
upload.

## Integrità e privacy

- progetti e rilevazioni sono cancellati logicamente e restano nell'audit;
- i profili economici dei modelli sono separati dai record OCR; una revisione
  crea una nuova versione senza alterare percentuali e screenshot storici;
- osservazioni di fatturazione e acquisti extra sono append-only; i valori
  calibrati vengono derivati dal motore e non salvati come importi osservati;
- l'audit applicativo è append-only anche a livello SQL;
- i file non hanno URL pubblici; API e metadati sono filtrati per proprietario;
- password hashate con bcrypt e token JWT brevi; nessun token è salvato nel DB;
- non viene persistito il testo OCR completo né alcun dato personale ricavato
  dalle immagini;
- gli acquisti extra, quando inseriti, sono dichiarazioni append-only e sono
  considerati interamente spesi con residuo zero.

## Modelli e analisi dei costi

L'OCR registra soltanto usage, reset e data/ora dello screenshot: il modello non
viene più scelto durante l'upload e non è incorporato nella rilevazione. Nella
pagina **Modelli e conti** si censisce per ogni scenario:

- provider, nome e livello di reasoning;
- valuta (`EUR` o `USD`);
- costo dichiarato dell'intera finestra di 5 ore;
- costo dichiarato per minuto equivalente consumato.

Un modello selezionato viene applicato dinamicamente a tutte le rilevazioni OCR,
oppure a un solo progetto, senza riscrivere lo storico. L'usage percentuale viene
convertito in minuti equivalenti su 300 minuti. La UI presenta due stime
alternative: costo proporzionale della finestra e costo per minuti equivalenti,
oltre al loro scostamento. Le due stime non vengono sommate. Cambiando modello si
ottiene immediatamente un nuovo scenario sugli stessi dati OCR.

## Verifiche locali

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

Il backend include test unitari del motore formule e del calcolo delta; il
frontend include la compilazione TypeScript in modalità strict.

## Backup e reset database via npm

Eseguire i comandi dalla cartella `web-app`. I dump vengono salvati in
`web-app/backups/`, cartella esclusa da Git.

```powershell
# Crea un dump SQL senza fermare lo stack
npm run db:backup

# Elimina esclusivamente il volume PostgreSQL e riavvia Compose
npm run db:reset

# Crea prima il dump SQL, poi azzera il database
npm run db:reset:with-backup
```

Il reset verifica il nome esatto `ai-usage-web_postgres-data` prima di
eliminarlo. La cartella `web-app/storage/uploads/`, che contiene le immagini,
non viene rimossa.

## Riferimento grafico conservato

Il design Warm Workbench è applicato all'app Angular. Il solo mockup alternativo
conservato per un possibile uso futuro è
`web-app/mockups/03-aurora-glass.html`; le altre proposte sono state rimosse.
