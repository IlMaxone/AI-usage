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
`projects/<nome-progetto>--<id-breve>/`, esclusa da Git e montata come
`/data/projects` in API e worker. Il modello OCR viene
scaricato durante la build dell'immagine e il worker non richiede accesso a
Internet durante l'elaborazione.

## Avvio

1. Copiare `.env.example` in `.env`.
2. Sostituire `POSTGRES_PASSWORD` e `JWT_SECRET` con segreti robusti.
3. Avviare:

   ```powershell
   npm run start:windows
   ```

4. Aprire `http://localhost:4400`.

L'avvio Windows esegue Docker Compose in background e avvia un piccolo selettore
locale su `127.0.0.1:4410`. **Carica immagini** apre il dialogo nativo Windows
direttamente nella cartella `to-process` del progetto. Selezionando file da
un'altra cartella ne viene creata una copia in ingresso; gli originali restano
al loro posto. Il selettore accetta solo richieste autorizzate con JWT e verifica
il proprietario del progetto tramite API; ascolta esclusivamente in loopback.
Si può avviare separatamente con `npm run desktop:picker` e fermarlo con Ctrl+C.
Il processo avviato da `start:windows` resta in background fino alla chiusura
della sessione Windows. La porta 4410 deve restare disponibile.

Su altri sistemi, o se non serve il dialogo Windows, rimane disponibile
`docker compose up --build -d --wait`: caricamento singolo e scansione delle
cartelle funzionano comunque, mentre il pulsante del selettore richiede Windows.

L'API è disponibile su `http://localhost:3000/api`; la documentazione OpenAPI
è su `/api/docs`. La registrazione crea un account isolato e importa i modelli
disponibili dal catalogo `models/models.csv` alla radice del repository.

## Flusso dati

1. L'utente crea, modifica o elimina liberamente i progetti dalla pagina dedicata.
2. Dalla pagina Inserimento sceglie screenshot singoli (uno o più file), oppure
   coppie A/B dalla cartella del progetto. A1 è abbinato a B1, A2 a B2, ecc.
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
   sposta gli screenshot in `deleted/<id-rilevazione>/` prima di rimuovere record,
   snapshot, correzioni, osservazioni temporali e audit legati alla rilevazione.
   I file conservano i nomi originali; un manifest registra nomi e ruoli. Per
   recuperare una coppia copiarla in `to-process`, per un singolo ricaricarlo
   dall'app. In caso di errore SQL gli spostamenti vengono annullati.
7. Data e ora della rilevazione non dipendono dall'esecuzione OCR: per l'usage
   costante provengono dallo screenshot singolo; per un segmento provengono dallo
   screenshot finale. Eventuali rettifiche temporali storiche sono osservazioni
   append-only separate e non modificano lo snapshot OCR originale. Il worker
   non usa mai l'ora di modifica del file come fallback: senza accordo OCR sul
   timestamp visibile richiede la verifica manuale.

### Inserimento batch

Il caricamento dall'app accetta fino a 30 screenshot singoli per invio:

- nel **batch singolo**, ogni immagine crea una rilevazione usage costante
  autonoma (30 immagini producono 30 record e 30 processamenti OCR);
- le **coppie** si depositano invece in `projects/<nome>--<id>/to-process/`:
  `A1.png` con `B1.png`, `A2.jpg` con `B2.jpg`, ecc. Il numero determina
  l'abbinamento, indipendentemente dall'ordine e dall'estensione. Sono ammessi
  salti nella numerazione; nomi ambigui come A1 e A01 restano da verificare;
- i file si possono aggiungere anche offline. Il worker controlla le cartelle
  all'avvio e ogni cinque secondi, senza richiedere una sessione browser;
- una coppia incompleta resta in attesa. I file dubbi restano in `to-process`;
  solo i file validati vengono spostati in `processed`. Una metà già validata
  resta associata all'altra anche dopo lo spostamento;
- reinserire un'immagine aggiorna l'OCR della rilevazione esistente, identificata
  nel progetto dal nome/ruolo o dall'hash. La stessa immagine in progetti diversi
  è indipendente. Una coppia non può ricombinare metà di rilevazioni diverse.

Ogni file conserva il limite configurato da `MAX_UPLOAD_BYTES` (10 MB di
default). Ogni rilevazione viene salvata e accodata separatamente. Le copie
ancora in scrittura non vengono importate. I tentativi non accettati non vengono
ripetuti senza una modifica al file o una richiesta esplicita di nuova convalida.

Una nuova lettura valida sostituisce lo snapshot OCR corrente e conserva quello
precedente in `ocr_revisions`, protetto da modifiche. Le correzioni manuali e le
osservazioni temporali precedenti rimangono tracciate, ma non prevalgono su una
lettura OCR successiva. I registri JSONL del motore locale non vengono modificati.

## Dashboard, analisi usage e colori

La pagina **La scrivania** mostra per ogni progetto minuti equivalenti e costo
stimato usando i modelli riconosciuti nei singoli screenshot. I progetti non
hanno un modello modificabile. Il riferimento della finestra 5h è comune e fisso:
**13,54 EUR**, mantenendo il valore già usato nel catalogo prima della modifica.
È un riferimento di progetto, non un prezzo del provider o un addebito osservato.
La pagina **Analisi usage** raccoglie invece indicatori complessivi, ultime
rilevazioni, distribuzione per progetto, crediti extra e il grafico storico a
punti delle percentuali 5h e settimanali osservate negli screenshot validati.
Contiene anche il piccolo interruttore **Modalità esplorativa**: solo quando è
attivo appare il selettore del modello alternativo. Il confronto non salva
alcuna modifica e mostra sempre anche il tag originale. Disattivando
l'interruttore, cambiando pagina o ricaricando l'app si ritorna ai dati originali.

Alla creazione o modifica di un progetto il colore si sceglie da una palette di
20 tinte coerenti con il tema Warm Workbench. Il verde `#9BE15D` resta il colore
predefinito. Il colore identifica il progetto soltanto nella UI e non altera i
dati OCR o i calcoli.

## Archivio screenshot e pagina Analisi

Ogni immagine caricata viene conservata con nome tecnico univoco nella
sottocartella del progetto:

```text
projects/<nome-progetto>--<id-breve>/
├── to-process/   coppie A1/B1 e file in attesa
├── processed/    screenshot validati, con nome tecnico univoco
└── deleted/      screenshot rimossi dall'app, recuperabili
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
Al primo avvio della versione evo-3 i file collegati al database vengono migrati
da `web-app/storage/uploads/` alle nuove cartelle. I file senza record associato
restano preservati nel vecchio archivio, incluso `_unassigned/`. Le cartelle del
motore locale storico e `projects/demo/` non vengono importate dal worker web.
Le immagini vengono lette dalla stessa cartella tramite un endpoint protetto da
JWT: non esiste una directory web pubblica e ogni utente vede soltanto i propri
upload.

## Integrità e privacy

- i progetti sono cancellati logicamente; una rilevazione viene rimossa dal DB
  dopo la conferma UI, conservando i suoi file in `deleted`;
- il modello viene taggato soltanto dall'OCR e non può essere cambiato né rimosso
  da un'immagine. Nome e reasoning rimangono immutabili; le tariffe sono gestite
  soltanto dal CSV all'avvio, con hash e audit delle modifiche. Le API dei modelli
  sono di sola lettura e i vincoli sono protetti anche da trigger PostgreSQL;
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

L'OCR registra usage, reset, data/ora e il modello con reasoning visibile nel
selettore in fondo allo screenshot. Tre letture locali della zona del selettore
devono produrre almeno due risultati concordi. Il tag deve corrispondere senza
ambiguità a un modello già censito; non si usano il contenuto della conversazione
o un modello predefinito come fallback. Non viene conservato il testo OCR.

Una rilettura può aggiornare l'usage, ma non cambiare un tag già assegnato. Se
legge un modello diverso lascia il file da verificare. Le due immagini di una
coppia mantengono i propri tag: se diversi, il costo del segmento non viene
attribuito arbitrariamente a uno dei due modelli.

Gli screenshot storici validati e ancora senza tag vengono arricchiti dal worker
automaticamente, senza riscrivere gli snapshot usage. Quelli con modello dubbio
restano da verificare e non ricevono un prezzo inventato. I totali economici
segnalano esplicitamente quante rilevazioni non sono ancora calcolabili.

La pagina **Modelli** mostra soltanto i modelli disponibili, senza form di
inserimento o modifica. Il catalogo e le tariffe risiedono in
[`../models/models.csv`](../models/models.csv), inizialmente popolato con i valori
già presenti nell'app. La struttura del file è documentata in
[`../models/README.md`](../models/README.md).

Per censire un modello aggiungere una riga al CSV; per modificarne la tariffa
cambiare `cost_per_minute`; per disabilitarlo impostare `available=false` oppure
rimuovere la riga. `max_time_window_minutes` dichiara il limite di utilizzo
al 100% della finestra, in minuti:secondi (per esempio `93:03`) o minuti decimali,
entro 300 minuti. La finestra resta 13,54 EUR per tutti. L'identità di un modello
già importato non cambia; una key rinominata viene ricollegata solo se l'identità
è univoca e la vecchia key non compare nel file. I tag OCR originali non cambiano.

Il CSV è montato in sola lettura nell'API. A ogni avvio l'API valida l'intero file
e sincronizza i modelli di tutti gli account in un'unica transazione. I nuovi
account ricevono lo stesso catalogo. File mancanti, vuoti o ambigui bloccano
l'avvio, senza applicare aggiornamenti parziali. Hash SHA-256 e timestamp del
catalogo sono conservati insieme alla traccia delle tariffe precedenti.

`npm run start:windows` ricrea i servizi applicativi anche se erano già attivi,
quindi rilegge il CSV a ogni esecuzione. Il semplice refresh del browser non
importa cambiamenti dal file. I calcoli successivi usano le tariffe importate;
non vengono riscritti snapshot OCR, osservazioni di fatturazione o JSONL locali.
Un modello rimosso non è più analizzabile o selezionabile per i confronti: il suo
tag storico rimane tracciato e gli importi interessati sono indicati come parziali.

Il minutaggio originale è `usage attribuito / 100 × max_time_window_minutes`:
il limite esplicito evita che le tariffe arrotondate alterino le durate.
Il costo originale è `usage attribuito / 100 × 13,54`. Nel confronto esplorativo
i minuti originali restano costanti e il costo simulato è
`minuti equivalenti originali × tariffa del modello alternativo`. In questo modo
si confronta la stessa quantità di lavoro e la differenza di costo è visibile
anche con il riferimento di finestra uguale per tutti. Nessuna simulazione viene
scritta nel database, nel browser storage o nei registri locali.

Le rilevazioni vengono raggruppate per reset 5h, mantenendo la tolleranza di
un'ora. Gli screenshot singoli nella stessa finestra sono letture cumulative:
la prima conserva il valore letto e le successive attribuiscono soltanto
l'incremento cronologico (per esempio `88%` seguito da `100%` attribuisce
`88% + 12%`). I segmenti inizio/fine sono già delta e restano invariati.

Il motore non applica alcun cap. Se dati inseriti in buona fede portano il totale
attribuito oltre il 100%, usage, minuti e costo proseguono linearmente senza
essere ridotti o troncati. Il costo configurato per la finestra è quindi un
riferimento al 100%, non un massimale. L'attribuzione degli screenshot cumulativi
avviene sull'intero account prima del filtro per progetto o modello, per evitare
di contare nuovamente lo stesso incremento quando cambia il progetto.

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
eliminarlo. Le cartelle `projects/` e `web-app/storage/uploads/` non vengono
rimosse. Un dump SQL non include gli screenshot: per un backup completo copiare
anche le cartelle dei progetti mentre lo stack è fermo.

## Riferimento grafico conservato

Il design Warm Workbench è applicato all'app Angular. Il solo mockup alternativo
conservato per un possibile uso futuro è
`web-app/mockups/03-aurora-glass.html`; le altre proposte sono state rimosse.
