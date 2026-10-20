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

Torna all'[indice](README.md).
