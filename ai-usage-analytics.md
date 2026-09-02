# Obbiettivo

Eseguire un'analisi sui consumi di token utilizzati per questo progetto.

## Modalità

Ricordiamo che il piano corrente di Codex è il seguente: ChatGPT PLUS.
Ogni 5h abbiamo un refill di crediti e ogni 7 giorni pure.
Ogni utilizzo di 5h verrà censito con un'immagine in questa cartella.
L'agent che si occuperà di leggere queste immagini dovrà spostare successivamente l'immagine processata nell sottocartella processed-immages.
Una volta letta l'immagine, l'agent deve genserare un file nei docs che verrà arricchito nel tempo con: token stimati utilizzati a seconda del abbonamento corrente, prezzo grezzo dei tokens API, costo senza abbonamento ChatGPT plus.
Questi dati sono a scopo di report per future interrogazioni e analisi, è bene non alterarli ogni iterazione del file nei docs.

Molto importante: questo processo deve essere ripetibile autonomamente dal utente, quindi generiamo uno script in grado di comprendere le immagini, estrarre i dati e aggiornare la tabella di riferimento, per poi successivamente spostare le immagini in processed-images

### Estrazione dei dati

Prendere di riferimento attraverso le stime online di tokens settimanali e il consumo per 5h e per settimana.
Creiamo una tabella dove indichiamo prima di tutto i dati grezzi: data e ora della rilevazione, percentuale in 5h e percentuale settimanale dove il giorno di reset fa da cardine della settimana e va censito anche quello, infine tiriamo giù apposimativamente i token stimati utilizzati in base la percentuale, se abbiamo informazioni in 5h lo facciamo per 5h se lo abbiamo settimanale lo faremo settimanale, i prezzi per milione di tokens al momento del calcolo e il prezzo che avremmo pagato in tokens stimati utilizzati se avessimo utilizzato API Codex con 5.6 Sol High.

#### Privacy della cartella corrente

La cartella corrente viene esclusivamente letta da un qualsiasi agent, non può essere modificata o eliminata in alcun modo se non per spostare le immagini processate.
Questo file invece non potrà essere modificato o eliminato in alcun modo.
Inoltre questa cartella non deve essere inclusa nel .git essendo una cartella "di allineamento/prompting" se potrà essere svuotata delle istruzioni correnti in qualsiasi momento una volta eseguito il suo fine.