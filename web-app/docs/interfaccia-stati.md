# Interfaccia e stati

| Pagina | Scopo |
| --- | --- |
| **La scrivania** | Minuti equivalenti e costo stimato per progetto. |
| **Analisi usage** | Indicatori, ultime rilevazioni, distribuzione, crediti extra e grafico delle percentuali osservate. |
| **I progetti** | Creazione, rinomina, colore ed eliminazione logica dei progetti. |
| **Nuova lettura** | Singoli e coppie A/B caricati dalla UI, oppure coppie dalla cartella. |
| **Archivio usage** | Rilevazioni, correzioni, rimozione e foto espandibili sotto ogni record. |
| **Modelli** | Catalogo CSV consultabile, tariffe, durata e badge OCR. |
| **Profilo** | Account e alert OCR persistenti con progetto, nomi delle immagini e motivo. |

La freccia **Screenshot** in **Archivio usage** mostra o nasconde le foto del
record, con A prima di B. Un clic sulla miniatura apre l'immagine a piena
dimensione; il pulsante di chiusura o Esc chiude l'anteprima. Le foto vengono
caricate solo all'espansione. La pagina separata Analisi immagini è stata rimossa.
I file passano sempre dall'API autorizzata per l'utente.

In **Analisi usage**, **Distribuzione** mostra la quota di ogni progetto sul
totale attribuito: le quote positive sommano al 100%, anche dopo arrotondamento.
Le letture cumulative nella stessa finestra contribuiscono solo per incremento.
Il totale su più finestre è espresso in **finestre equivalenti usate**, non come
percentuale di una singola finestra: 150 punti attribuiti valgono 1,5 finestre.
La tabella usage e costi rimane in fondo, con filtri e modalità esplorativa;
il precedente pannello duplicato Costi per modello OCR è stato rimosso.
Nelle ultime rilevazioni, **Minuti stimati** usa la percentuale attribuita:
`(percentuale / 100 × 13,54 EUR) / tariffa originale al minuto`. L'esplorazione
mantiene questi minuti e cambia solo il confronto economico.

Il profilo si apre dall'avatar in basso a sinistra o dalla campanella accanto.
Il contatore sopra la campanella mostra gli alert fissati e si ferma a **99+**;
il numero completo rimane nel profilo. L'area utente contiene il pulsante **Esci**.
Una coppia mai convalidata
compare solo qui, con le foto in `unprocessed`, senza collegamenti a record da
ritentare. Se una rilettura fallisce, l'ultima coppia valida resta nell'archivio.
Ricaricare dalla UI o da `to-process` risolve l'alert solo dopo convalida completa.

Nel Profilo il pulsante **Debug** apre una console scura in sola lettura: mostra
progetto, file, stato, causa e cronologia dei passaggi OCR. Non esegue comandi
di sistema. **Aggiorna log** rilegge gli errori ancora aperti; **Download error_logs**
scarica `error_logs.json` nella cartella download configurata nel browser
(normalmente Downloads). Il pulsante ×, Esc o un clic fuori chiudono il pop-up.

Il JSON contiene prima `immagini_infette`, elenco delle immagini non convalidate,
poi `logs_errori`, dettaglio per immagine e tentativo. La dicitura identifica gli
esiti OCR, non una scansione antivirus. `PAIR_BLOCKED` distingue la metà rimasta
bloccata dall'immagine che ha causato il fallimento. Il report include hash,
timestamp, misure numeriche, concordanza dei passaggi, modello e modalità Fast
quando disponibili; non include screenshot, testo OCR completo, conversazioni,
credenziali o percorsi personali assoluti.

I nuovi tentativi registrano il dettaglio anche se la coppia viene rimossa
dall'Archivio o viene ripristinata l'ultima lettura valida. Ripetere un tentativo
fallito aggiunge una voce alla cronologia. Gli alert antecedenti alla funzione
conservano la causa originale e dichiarano che i passaggi non erano registrati:
non vengono ricostruiti retroattivamente. Un caricamento riuscito risolve l'alert
e lo esclude dal successivo report degli errori aperti.

Il colore progetto si sceglie da 20 tinte del tema Warm Workbench; il predefinito
è `#9BE15D`. Serve a identificare il progetto nell'interfaccia e non altera OCR
o calcoli. Non esiste un modello modificabile sul progetto.

## Stati visibili

| Stato upload | Etichetta e significato |
| --- | --- |
| `DRAFT` | **Pronto**, file preparato per la convalida. |
| `UPLOADED` | **In coda**, in attesa del worker. |
| `PROCESSING` | **OCR in corso**. |
| `VALIDATED` | **Validato**, lettura accettata. |
| `MANUAL_REVIEW` | **Verifica manuale**, controllare la motivazione. |
| `FAILED` | **Errore**, problema operativo durante l'elaborazione. |

Il record può mostrare **Bozza**, **Tripla verifica**, **Validata**, **Da correggere**
o **Errore**. Lo stato della misura distingue **In attesa OCR**, **Usage misurato**,
**Segmento misurato** e **Finestre 5h diverse**. Uno stato del singolo file non
garantisce da solo la coerenza della coppia o la disponibilità del costo.

Il badge **Tag OCR immutabile** e la modalità esplorativa sono spiegati nella
[guida modelli](modelli-costi.md). Un totale parziale segnala rilevazioni senza
modello utilizzabile; non viene assegnata una tariffa inventata.

I messaggi sono nell'app. Il selettore Windows apre un dialogo file; non è un
servizio di notifiche desktop. Per gli errori consultare [problemi e privacy](problemi-privacy.md).

Nel profilo **Riprova**, accanto a **Debug**, riaccoda gli errori aperti e mostra
quanti tentativi sono stati accodati, già in corso o non accodabili. Il pulsante
è disabilitato durante la preparazione e quando non ci sono alert. Non chiude
gli avvisi prima del successo. Nel debug, l'indicazione dell'ultima lettura
valida conservata distingue l'archivio dal tentativo fallito. Consultare la
[diagnosi OCR](diagnosi-ocr-2026-10-21.md) per i casi storici senza riferimenti.

Torna all'[indice](README.md).
