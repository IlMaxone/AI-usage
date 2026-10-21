# Problemi e privacy

## Diagnosi operativa

| Situazione | Controllo e azione |
| --- | --- |
| Il selettore Windows non è raggiungibile | Avviare da `web-app` con `npm run start:windows`; controllare la porta 4410 o avviare `npm run desktop:picker` per leggere l'errore. |
| Una coppia non parte | Verificare A/B con lo stesso numero, nomi non ambigui, formato supportato e copia completata. |
| Un tentativo OCR fallisce | Leggere l'alert nel Profilo: progetto, nomi e motivo. Le foto sono in `unprocessed`; ricaricarle dalla UI o da `to-process` dopo il controllo. |
| Serve un rapporto da condividere per la diagnosi | Profilo → Debug → Download error_logs. Il JSON elenca prima i file e poi tutti i passaggi diagnostici conservati. Gli errori storici senza dettaglio sono segnalati esplicitamente. |
| Modello/reasoning non riconosciuto | Il selettore nello screenshot deve mostrare nome e livello di ragionamento presenti nel CSV; almeno due dei tre ritagli OCR devono riconoscerli insieme. Vale anche per un'immagine singola. |
| Variante assente nel catalogo CSV | Il nome è stato letto: manca la combinazione modello, reasoning e Fast/Standard. Aggiungere una tariffa esplicita; non sostituire con un'altra variante. Light è l'alias UI di low. |
| Immagine già registrata | Non è un errore OCR: si esegue una rilettura con sostituzione tracciata. Gli avvisi del vecchio blocco duplicati vengono chiusi. |
| Nome progetto già usato | È già usato nel proprio account dopo normalizzazione. Utenti diversi possono usare lo stesso nome in cartelle UUID separate. |
| Progetti assenti dopo reset | Registrarsi con la stessa email/password dell'ultimo accesso e conservare `projects/`, compresi `.storage-key` e `.owners/`. Vedere la guida del recupero. |
| Richiesto un nuovo accesso dopo l'aggiornamento | I vecchi token non contengono l'identità dello spazio UUID. Accedere nuovamente per abilitarne il recupero. |
| La coppia fallita non è nell'Archivio | È previsto per coppie mai convalidate: rimangono solo alert e foto. Una rilettura fallita conserva invece l'ultima coppia valida. |
| API non parte dopo modifica CSV | Controllare intestazione, valori, durate, duplicati e identità; correggere il file e riavviare l'API. |
| Tariffe non cambiano nel browser | Riavviare l'API o usare `start:windows`: il refresh non importa il CSV. |
| Modello nuovo senza badge | Attende la prima associazione OCR; non è un'indicazione di indisponibilità. |
| Totale economico parziale | Alcune rilevazioni non hanno tag utilizzabile o hanno modelli non disponibili. |
| Immagine assente dalla galleria | Controllare progetto selezionato, accesso, collegamento DB e file sul disco. Non rinominare i file tecnici. |

Da `web-app`, `docker compose ps` mostra i servizi. Per approfondire usare
`docker compose logs --tail 50 api worker`; non pubblicare log con dati locali
o configurazioni sensibili. L'API health interroga il database: se non risponde,
controllare prima `db`, poi `api`. Le [verifiche](verifiche-sviluppo.md) e il
[backup](backup-recupero.md) descrivono le operazioni successive.

## Integrità e accessi

Le password sono hashate con bcrypt; i token JWT hanno durata limitata e non
sono salvati nel database. API, metadati e immagini sono filtrati per proprietario.
Non esiste una cartella di screenshot servita pubblicamente. Il selettore Windows
ascolta solo in loopback e verifica l'utente del progetto tramite API.

Il tag modello è assegnato solo dall'OCR; i vincoli SQL proteggono identità e tag
già usati. Le API modelli sono di sola lettura e i prezzi si importano dal CSV
con audit. Revisioni OCR, correzioni, osservazioni temporali, acquisti extra e
fonti del catalogo conservano tracciabilità separata. L'audit è append-only,
salvo la rimozione circoscritta dei dati della rilevazione eliminata dall'utente.

Non si conserva il testo OCR completo né si riportano dati personali estratti
dalle foto. Progetti reali, screenshot, `storage`, dump, `.env`, dipendenze,
cache e modelli OCR sono esclusi da Git. Prima del commit controllare lo staging;
sono versionabili soltanto dati dimostrativi inventati e asset pubblici pertinenti.

I report `error_logs.json` esportati contengono nomi dei file e dei progetti:
conservarli come dati locali. Non contengono il testo OCR completo o immagini.

Il motore HTML OCR non viene avviato né notificato da questi servizi: ha
[dati e regole propri](../../html-ocr/docs/migrazione-privacy.md).

Torna all'[indice](README.md).
