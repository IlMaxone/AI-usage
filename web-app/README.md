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
2. Dalla pagina Inserimento sceglie `Batch singolo` con uno o più screenshot,
   oppure `Batch segmento` con liste abbinate di screenshot iniziali e finali.
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
   non sovrascrive lo snapshot OCR originale. Il comando **Elimina rilevazione**
   esegue invece una cancellazione definitiva esplicita: rimuove gli screenshot
   dal disco, record, snapshot, correzioni, osservazioni temporali e audit legati
   alla rilevazione, liberando anche l'hash SHA-256. La stessa immagine può quindi
   essere caricata di nuovo nel progetto corretto.
7. Data e ora della rilevazione non dipendono dall'esecuzione OCR: per l'usage
   costante provengono dallo screenshot singolo; per un segmento provengono dallo
   screenshot finale. Eventuali rettifiche temporali storiche sono osservazioni
   append-only separate e non modificano lo snapshot OCR originale. Il worker
   non usa mai l'ora di modifica del file come fallback: senza accordo OCR sul
   timestamp visibile richiede la verifica manuale.

### Inserimento batch

La stessa pagina accetta fino a 30 batch per invio:

- nel **batch singolo**, ogni immagine crea una rilevazione usage costante
  autonoma (30 immagini producono 30 record e 30 processamenti OCR);
- nel **batch segmento**, le liste iniziale e finale devono avere la stessa
  lunghezza. L'abbinamento è posizionale: inizio 1 con fine 1, inizio 2 con
  fine 2 e così via. Ogni coppia crea un record e un processamento separato.

Ogni file conserva il limite configurato da `MAX_UPLOAD_BYTES` (10 MB di
default). Il batch viene creato atomicamente; successivamente ogni record viene
accodato individualmente alla tripla verifica OCR.

## Dashboard, analisi usage e colori

La pagina **La scrivania** è il riepilogo essenziale: per ogni progetto mostra
soltanto minuti equivalenti e costo stimato secondo il modello economico attivo.
La pagina **Analisi usage** raccoglie invece indicatori complessivi, ultime
rilevazioni, distribuzione per progetto, crediti extra e il grafico storico a
punti delle percentuali 5h e settimanali osservate negli screenshot validati.

Alla creazione o modifica di un progetto il colore si sceglie da una palette di
20 tinte coerenti con il tema Warm Workbench. Il verde `#9BE15D` resta il colore
predefinito. Il colore identifica il progetto soltanto nella UI e non altera i
dati OCR o i calcoli.

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
dimensione. Gli upload sono raggruppati per rilevazione: per ogni segmento gli
screenshot iniziale e finale appaiono nello stesso blocco, nell'ordine del flusso.
Anche **Archivio usage** mostra sempre un solo progetto alla volta; il pulsante
**Dettagli screenshot** disponibile sui segmenti apre direttamente il relativo
blocco nella pagina Analisi immagini.
Durante la migrazione, eventuali file provenienti da database già azzerati e
quindi privi di un progetto associabile vengono preservati in
`storage/uploads/_unassigned/`; non compaiono nella pagina Analisi.
Le immagini vengono lette dalla stessa cartella tramite un endpoint protetto da
JWT: non esiste una directory web pubblica e ogni utente vede soltanto i propri
upload.

## Integrità e privacy

- i progetti sono cancellati logicamente; una rilevazione viene eliminata
  definitivamente solo dopo la conferma esplicita mostrata dalla UI;
- i profili economici dei modelli sono separati dai record OCR; una revisione
  crea una nuova versione senza alterare percentuali e screenshot storici;
- osservazioni di fatturazione e acquisti extra sono append-only; i valori
  calibrati vengono derivati dal motore e non salvati come importi osservati;
- l'audit applicativo è append-only anche a livello SQL, tranne la transazione
  circoscritta di cancellazione definitiva richiesta dall'utente per una singola
  rilevazione;
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
- consumo economico massimo consentito nell'intera finestra di 5 ore;
- costo dichiarato per minuto equivalente consumato.

I due importi accettano sia la virgola sia il punto come separatore decimale,
anche con molte cifre (per esempio `0,1454545454545455`). L'app normalizza il
valore prima di inviarlo all'API e conserva la precisione utile nei calcoli.

Un modello selezionato viene applicato dinamicamente a tutte le rilevazioni OCR,
oppure a un solo progetto, senza riscrivere lo storico. Il minutaggio non viene
più assunto pari a 300 minuti: il massimo disponibile è calcolato come
`consumo massimo 5h / costo al minuto`. La percentuale OCR consuma la stessa
quota del massimale economico e del minutaggio derivato.

Le rilevazioni vengono raggruppate per reset 5h, mantenendo la tolleranza di
un'ora. Se la somma grezza supera il 100%, l'attribuzione della finestra viene
ridotta proporzionalmente: il costo non può superare il massimale configurato e
i minuti non possono superare quelli acquistabili con quel massimale. Cambiando
modello si ottiene immediatamente un nuovo scenario sugli stessi dati OCR.

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
