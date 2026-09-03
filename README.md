# AI-usage — Local usage analytics

Strumento locale per ricostruire e stimare l'utilizzo di Codex a partire dagli
screenshot dei limiti, mantenendo distinti i dati storici rilevati, le fonti
scaricate da Internet e le stime derivate.

Il progetto nasce per rendere più leggibile nel tempo il consumo disponibile,
confrontarlo con i prezzi delle API e produrre report consultabili senza
inviare gli screenshot a servizi OCR esterni. Le stime ottenute non rappresentano
il consumo ufficiale dell'account né un importo realmente fatturato.

## Obiettivo principale

AI-usage deve offrire un processo locale, trasparente e verificabile per:

- leggere percentuali e date di reset dagli screenshot;
- conservare uno storico append-only delle rilevazioni accettate;
- registrare prezzi, limiti e cambi insieme alla data e all'ora del download;
- registrare separatamente gli eventuali acquisti di crediti extra dichiarati
  dall'utente;
- distinguere sempre i dati osservati dalle elaborazioni e dalle ipotesi;
- produrre report Markdown, CSV e una dashboard HTML statica;
- isolare completamente i dati privati di ogni progetto analizzato.

L'accuratezza viene preferita all'automazione cieca: una rilevazione dubbia non
viene aggiunta allo storico e l'immagine resta disponibile per il controllo
manuale.

## Codex, vibe coding e responsabilità

Questo progetto è sviluppato esplicitamente con il supporto di **OpenAI Codex**.
Il lavoro è iniziato con **GPT-5.6 Sol** (`gpt-5.6-sol`) e livello di
ragionamento **high** ("Alto"). Il modello impiegato potrà cambiare nel tempo,
ma ogni cambiamento significativo dovrà essere documentato.

Il progetto adotta il **vibe coding consapevole, graduale e verificabile**. La
priorità non è generare rapidamente più codice, ma comprendere cosa viene
costruito e mantenere il controllo umano sull'intero processo. Codex può
proporre, spiegare e accelerare il lavoro, ma non sostituisce la responsabilità
di chi revisiona.

Nessun output dell'AI è considerato corretto per il solo fatto di essere stato
generato. Prima di accettare una modifica, una persona deve:

- leggere il codice e comprenderne scopo, effetti e limiti;
- verificare che non esponga screenshot, dati storici o informazioni locali;
- controllare dipendenze, accessi di rete e superfici di attacco;
- eseguire test proporzionati al rischio della modifica;
- verificare che dati reali, dati dimostrativi e stime restino distinguibili;
- approvare consapevolmente ciò che verrà versionato e pubblicato.

Il repository non vuole dimostrare che si possa sviluppare software senza
conoscerne il funzionamento. L'AI è uno strumento di supporto: comprensione,
sicurezza e decisione finale restano umane.

## Funzionamento attuale

Il motore:

1. prende le immagini da `projects/<nome>/to-process-img/`;
2. esegue più passaggi OCR locali con Tesseract e Sharp;
3. accetta una rilevazione soltanto quando almeno due letture concordano;
4. usa in modo dichiarato data e ora del file come fallback quando necessario;
5. scarica, solo per una nuova rilevazione valida, prezzi e limiti OpenAI e il
   cambio di riferimento EUR/USD della BCE;
6. aggiorna lo storico e rigenera i report del progetto;
7. sposta lo screenshot accettato in `processed-images/`.

L'hash SHA-256 impedisce di registrare due volte la stessa immagine. Il testo
OCR completo non viene conservato.

## Separazione per progetto

Il motore è neutro: il progetto da analizzare viene sempre indicato
esplicitamente e dispone di una cartella isolata.

```text
projects/<nome>/
├── to-process-img/              screenshot in attesa
├── processed-images/            screenshot già elaborati
├── historical-data/
│   ├── usage-snapshots.jsonl    rilevazioni append-only
│   ├── extra-credit-purchases.jsonl
│   └── billing-calibrations.jsonl
├── internet-data/
│   ├── pricing-snapshots.jsonl  prezzi e limiti con timestamp
│   ├── exchange-rate-snapshots.jsonl
│   └── raw/                     copie delle fonti con timestamp e hash
└── reports/
    ├── dashboard.html           dashboard statica locale
    ├── *.md                     report descrittivi
    └── csv/                     dati importabili
```

`projects/demo/` è l'unica cartella progetto versionata. Contiene esclusivamente
dati inventati e mostra un esempio completo della struttura e della dashboard.
Tutte le altre cartelle sotto `projects/`, inclusa `projects/GFP/`, sono private
e ignorate integralmente da Git.

## Requisiti e preparazione

- Node.js 24;
- npm;
- PowerShell per lo script di avvio fornito su Windows.

Installare le dipendenze una sola volta dalla radice del repository:

```powershell
npm install
```

L'OCR viene eseguito localmente. Al primo utilizzo può essere necessario
scaricare i modelli linguistici di Tesseract; gli screenshot non vengono
caricati su Internet.

## Avvio manuale

Con lo script PowerShell:

```powershell
.\run-analysis.ps1 GFP
```

Oppure direttamente con npm:

```powershell
npm run analyze -- GFP
```

Modalità disponibili:

```powershell
.\run-analysis.ps1 GFP -DryRun
.\run-analysis.ps1 GFP -Offline
.\run-analysis.ps1 GFP -VerifyProcessed
npm run verify:processed -- GFP
npm run credits:add -- GFP 500 20
npm run demo:build
```

I comandi npm usano argomenti posizionali dopo `--` per evitare che npm 11 su
Windows interpreti opzioni personalizzate come configurazioni proprie.

- `DryRun` legge e valida senza scrivere o spostare file.
- `Offline` riutilizza l'ultimo snapshot Internet disponibile.
- `VerifyProcessed` riesegue il doppio controllo OCR sulle immagini archiviate
  e confronta i risultati con lo storico, senza scaricare fonti o modificare i
  dati.
- `credits:add` registra un acquisto di crediti extra dichiarato dall'utente e
  rigenera i report senza avviare l'OCR né accedere a Internet.
- `demo:build` rigenera i report dimostrativi con dati inventati.

Lo stesso acquisto può essere registrato direttamente dallo script PowerShell:

```powershell
.\run-analysis.ps1 GFP -RecordExtraCredits -Credits 500 -PaidEur 20
```

La data e l'ora dell'acquisto vengono registrate automaticamente. Per indicare
il momento esatto, aggiungerlo come quarto argomento in formato ISO 8601:

```powershell
npm run credits:add -- GFP 500 20 2026-09-02T18:30:00+02:00
```

Con PowerShell lo stesso valore può essere passato tramite `-PurchasedAt`.

Gli acquisti sono append-only. Ripetere lo stesso comando con lo stesso
timestamp, numero di crediti e importo non crea un duplicato.

## Controllo OCR e fallback

Percentuali e reset vengono cercati nel pannello originale, in una versione
ingrandita e normalizzata e, quando necessario, nell'immagine completa. Almeno
due passaggi devono produrre la stessa firma prima che la rilevazione venga
accettata.

Se i controlli non concordano:

- lo screenshot resta in `to-process-img/`;
- non viene aggiunta alcuna rilevazione allo storico;
- non vengono registrati nuovi snapshot Internet;
- la dashboard non viene rigenerata;
- viene richiesta una verifica manuale.

## Calibrazione sulla fatturazione

Il metodo principale usa osservazioni di fatturazione dichiarate dall'utente.
Ogni progetto conserva localmente percentuale del piano osservata, durate,
importi fatturati, modalità di reasoning e rapporto tra euro e crediti. I dati
reali rimangono nella cartella progetto ignorata da Git; il progetto `demo`
mostra la stessa struttura usando esclusivamente valori inventati.

Da queste osservazioni il motore ricava, senza salvare risultati arbitrari come
costanti, il valore equivalente del 100%, i crediti corrispondenti e la durata
equivalente con il modello e reasoning scelti come pilota.

Per ogni screenshot la percentuale usata viene applicata a questa base. I
crediti e il valore in euro calibrati sono quindi i numeri principali della
dashboard. Gli equivalenti token partono dai crediti calibrati, ma richiedono
anche i rapporti crediti-per-milione scaricati dalla fonte online; input, cache
e output restano scenari alternativi e non devono essere sommati.

Osservazioni, dati derivati e listini online sono mostrati separatamente. Una
nuova calibrazione deve essere aggiunta allo storico soltanto dopo una verifica
umana dei dati di fatturazione.

## Fonti Internet e stime secondarie

Quando una nuova immagine supera la validazione, il processo online acquisisce:

- la scheda API ufficiale del modello configurato;
- la pagina ufficiale dei piani e dei limiti Codex;
- il file XML giornaliero dei cambi di riferimento della BCE.

Per ogni fonte vengono conservati URL, data e ora del download e hash del
contenuto. I dati Internet restano separati dallo storico estratto dagli
screenshot.

Il precedente metodo basato sugli intervalli pubblicati online resta nel report
come confronto secondario. I relativi costi in dollari ed euro non sono
misurazioni del consumo reale di Codex né addebiti dell'abbonamento ChatGPT.

Il settimanale conserva percentuale e reset, ma non viene convertito in token o
costo finché una fonte non pubblica una capacità numerica affidabile.

I crediti extra e l'importo pagato sono invece dati dichiarati manualmente e
vengono mostrati in una sezione distinta della dashboard. Non vengono sommati ai
crediti del piano prima di essere identificati separatamente. Per regola di
progetto, ogni credito acquistato viene considerato già speso: entra quindi nel
totale dei crediti e dei token equivalenti consumati, con residuo assunto pari a
zero.

## Dashboard locale

Ogni progetto genera una pagina HTML autonoma, apribile direttamente dal
filesystem:

```text
projects/GFP/reports/dashboard.html
```

La dashboard non richiede un server, non contiene JavaScript, non usa endpoint
locali e non carica risorse esterne. Il report dimostrativo è disponibile in
[`projects/demo/reports/dashboard.html`](projects/demo/reports/dashboard.html).

## Privacy e contenuti Git

Il repository versionato contiene il motore neutro, la documentazione e il solo
progetto `demo`. Restano esclusi da Git:

- ogni progetto reale sotto `projects/`;
- screenshot in ingresso e già elaborati;
- storico, report e copie delle fonti relativi a progetti reali;
- `node_modules/` e cache o modelli OCR;
- file `.env` e relative varianti.

Prima di ogni commit è obbligatorio controllare lo staging e verificare che non
contenga dati locali. Le regole operative complete per persone e assistenti AI
sono definite in [`AGENTS.md`](AGENTS.md).

## Documentazione di riferimento

- [`AGENTS.md`](AGENTS.md): regole operative, di sicurezza e di verifica.
- [`ai-usage-analytics.md`](ai-usage-analytics.md): richieste originali del
  progetto; il file deve essere preservato senza modifiche.
- [`projects/demo/README.md`](projects/demo/README.md): natura e limiti dei dati
  dimostrativi.

## Stato attuale

Il repository contiene il motore OCR locale, la separazione per progetto, la
raccolta delle fonti con timestamp e hash, i report Markdown e CSV e la dashboard
HTML statica. L'analisi resta volutamente manuale: non sono presenti scheduler,
server locali o processi automatici in background.
