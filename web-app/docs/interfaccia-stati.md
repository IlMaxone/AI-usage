# Interfaccia e stati

| Pagina | Scopo |
| --- | --- |
| **La scrivania** | Minuti equivalenti e costo stimato per progetto. |
| **Analisi usage** | Indicatori, ultime rilevazioni, distribuzione, crediti extra e grafico delle percentuali osservate. |
| **I progetti** | Creazione, rinomina, colore ed eliminazione logica dei progetti. |
| **Nuova lettura** | Screenshot singoli, batch e accesso alla cartella delle coppie. |
| **Archivio usage** | Rilevazioni di un progetto alla volta, convalida, correzioni e rimozione. |
| **Analisi immagini** | Foto del progetto selezionato, raggruppate per record e apribili a piena dimensione. |
| **Modelli** | Catalogo CSV consultabile, tariffe, durata e badge OCR. |

Per i segmenti, **Dettagli screenshot** nell'archivio porta al relativo blocco
di **Analisi immagini**, mostrando A prima di B. I file non hanno URL pubblici:
il caricamento passa dall'API autorizzata per l'utente.

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
