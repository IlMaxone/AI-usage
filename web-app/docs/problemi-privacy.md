# Problemi e privacy

## Diagnosi operativa

| Situazione | Controllo e azione |
| --- | --- |
| Il selettore Windows non è raggiungibile | Avviare da `web-app` con `npm run start:windows`; controllare la porta 4410 o avviare `npm run desktop:picker` per leggere l'errore. |
| Una coppia non parte | Verificare A/B con lo stesso numero, nomi non ambigui, formato supportato e copia completata. |
| Un file resta in verifica manuale | Leggere il motivo: uso, timestamp o modello possono non concordare. Correggere l'origine o richiedere nuova convalida dopo il controllo. |
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

Il motore HTML OCR non viene avviato né notificato da questi servizi: ha
[dati e regole propri](../../html-ocr/docs/migrazione-privacy.md).

Torna all'[indice](README.md).
