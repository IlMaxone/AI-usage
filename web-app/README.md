# AI Usage Web

Applicazione separata dal motore locale storico. Il flusso originale, i JSONL
e le dashboard HTML statiche non vengono letti né modificati da questi servizi.

## Servizi

- `frontend`: Angular 20, SPA servita da nginx;
- `api`: NestJS 11, REST API e autenticazione JWT;
- `worker`: processo NestJS standalone per OCR locale Tesseract/Sharp;
- `db`: PostgreSQL 17.

Ogni servizio applicativo è costruito e avviato da Docker Compose. Immagini e
database risiedono in volumi Docker, non nel repository. Il modello OCR viene
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

1. L'utente crea un progetto e, facoltativamente, un evento di lavoro.
2. Carica uno screenshot come rilevazione singola, `inizio` o `fine` e lo
   associa al progetto/evento.
3. Il worker calcola SHA-256 ed esegue più letture OCR locali. Una rilevazione
   è validata solo se almeno due passaggi concordano su percentuali e reset.
4. In caso di disaccordo l'immagine resta in `manual_review`; non viene creato
   alcuno snapshot di utilizzo e non viene salvato il testo OCR completo.
5. Una coppia inizio/fine valida nella stessa finestra di 5 ore attribuisce al
   progetto il delta tra le due percentuali. Senza screenshot iniziale viene
   mantenuto il calcolo storico basato sul valore dello screenshot finale.

## Integrità e privacy

- eventi e configurazioni sono cancellati logicamente e restano nell'audit;
- modelli e formule vengono revisionati: una modifica crea una nuova versione;
- osservazioni di fatturazione e acquisti extra sono append-only; i valori
  calibrati vengono derivati dal motore e non salvati come importi osservati;
- l'audit applicativo è append-only anche a livello SQL;
- i file non hanno URL pubblici; API e metadati sono filtrati per proprietario;
- password hashate con bcrypt e token JWT brevi; nessun token è salvato nel DB;
- non viene persistito il testo OCR completo né alcun dato personale ricavato
  dalle immagini;
- gli acquisti extra, quando inseriti, sono dichiarazioni append-only e sono
  considerati interamente spesi con residuo zero.

## Calcoli

Le formule sono oggetti JSON versionati e modificabili dalla UI. Il motore
supporta operazioni aritmetiche in un AST ristretto (`add`, `subtract`,
`multiply`, `divide`, `min`, `max`) e variabili esplicite; non valuta codice
JavaScript o SQL inserito dall'utente.

Le metriche predefinite mantengono il metodo principale calibrato sulla
fatturazione e il confronto secondario basato su listino. Per modelli esterni a
OpenAI si possono configurare prezzi per milione di token, crediti equivalenti
e una formula personalizzata senza modificare il codice.

## Verifiche locali

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

Il backend include test unitari del motore formule e del calcolo delta; il
frontend include la compilazione TypeScript in modalità strict.
