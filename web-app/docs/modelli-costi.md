# Modelli e costi

Il catalogo è [`models/models.csv`](../../models/models.csv), alla radice del
repository. Nome, provider, reasoning, disponibilità, tariffa al minuto e limite
di utilizzo provengono dal CSV. La pagina **Modelli** è di sola consultazione e
usa il logo OpenAI per quel provider. Il [formato completo](../../models/README.md)
descrive colonne, validazioni e rinomina controllata delle key. Le schede sono
raggruppate per provider e famiglia (per esempio GPT-5.6 Sol). La freccia
**Varianti**, come **Screenshot** nell'Archivio usage, espande o richiude sotto
la scheda tutte le varianti, con tariffa, limite e badge. I gruppi partono chiusi.
L'ordine è sempre Light, Medium, High, XHigh, Ultra: ogni variante Standard è
seguita dalla rispettiva Fast, quando presente. Low è mostrato come Light;
Flash è mostrato come Fast. Espandere un gruppo non modifica dati o tag.
La modalità Fast usa un fulmine pieno monocromatico, come nel selettore dello
screenshot, al posto dell'emoji dipendente dal sistema operativo.
Anche il menu del confronto esplorativo rispetta gli stessi gruppi e ordine.

## Import e tag

A ogni avvio l'API valida l'intero CSV e sincronizza tutti gli account in una
transazione; le nuove registrazioni ricevono lo stesso catalogo. Conserva hash
SHA-256, timestamp e audit delle modifiche. Un file mancante, vuoto o ambiguo
blocca l'avvio senza aggiornamenti parziali. Le tariffe cambiano solo dal CSV.

Dopo una modifica rieseguire `npm run start:windows` da `web-app`. Un semplice
refresh browser non importa il file. La key può cambiare solo mantenendo
un'identità univoca e senza la vecchia key nel file: UUID e tag restano preservati.
Un modello disabilitato o rimosso scompare dai confronti; i suoi tag storici
rimangono e gli importi interessati sono segnalati come parziali.

Il modello è riconosciuto solo dal selettore nello screenshot: almeno due di
tre letture devono concordare con nome e reasoning nel catalogo disponibile.
Non si assegna un modello predefinito. Modello e reasoning taggati non sono
modificabili; una rilettura contraddittoria richiede verifica manuale. Una coppia
con tag diversi non riceve un costo attribuito arbitrariamente a uno dei due.

Un'eccezione esplicita riguarda una coppia fallita perché le due immagini
mostrano modelli diversi: nel Profilo si può scegliere una delle due varianti,
salvare e premere Riprova. È una dichiarazione dell'utente sull'attribuzione
economica dell'intera sessione, non una correzione del testo riconosciuto.
Entrambi i modelli OCR originali restano nella diagnostica; i nuovi snapshot
riportano `modelSource=USER_CHOICE`, la scelta e il timestamp. Archivio e
analisi costi la segnalano come manuale. Il modello scelto diventa immutabile
alla convalida e non può contraddire tag già assegnati. Tutti i controlli sui
valori restano obbligatori. Vedere il [flusso nel Profilo](interfaccia-stati.md).

Il prefisso GPT può mancare nel selettore: `5.6 Sol Alto` corrisponde a
GPT-5.6 Sol high. `6 Astra` e `6.0 Astra` sono equivalenti; 6.1 resta distinto.
L'OCR controlla il selettore e, quando necessario, una seconda zona più stretta;
ogni zona deve raggiungere autonomamente due letture concordi. Il testo delle
conversazioni non viene usato per assegnare il modello.

Il fulmine prima del nome identifica **Fast**, separatamente dal reasoning.
La sua presenza o assenza deve concordare in almeno due passaggi; un'icona
incerta blocca il tag, e una variante Fast assente non ricade sulla tariffa
Standard. `flash` resta un alias storico del CSV, mostrato come Fast in app;
`Light` (equivalente al livello API/CLI `low`) è distinto da medium e high e
richiede una sua tariffa. Il catalogo include stime provvisorie Light fondate
sul confronto costi/durate fornito dall'utente e sul controllo Medium misurato;
i dettagli e i limiti sono nella [guida Light](../../models/README.md#light-e-controllo-medium).

Il badge **Tag OCR immutabile** indica una prima associazione convalidata.
Un modello appena censito senza screenshot associati può essere disponibile
senza mostrare il badge. Gli upload storici validati e senza tag vengono
controllati dal worker senza riscrivere l'uso già rilevato.

## Formule

Il riferimento della finestra è fisso a **13,54 EUR**, comune a tutti i modelli.
È una convenzione di progetto, non un prezzo ufficiale o una fattura osservata.
`max_time_window_minutes` accetta minuti:secondi (`93:03`) o minuti decimali,
entro 300 minuti. È il limite dichiarato consultabile nel catalogo.

```text
costo originale = usage attribuito / 100 × 13,54 EUR
minuti stimati = costo originale / tariffa originale al minuto
costo esplorativo = minuti equivalenti originali × tariffa alternativa
```

La stima dei minuti usa la tariffa CSV arrotondata; con tariffa zero è assente.
L'esplorazione mantiene costante il lavoro equivalente e mostra la differenza
di costo. È temporanea: nessuna scrittura a DB o browser storage; spegnendo
l'interruttore, cambiando pagina o ricaricando l'app si ritorna all'originale.

Le letture cumulative sono attribuite per incremento nella stessa finestra:
88% e poi 100% valgono 88% + 12%. I segmenti sono già delta. L'allocazione avviene
sull'intero account prima del filtro progetto, per evitare doppi conteggi quando
cambia progetto o modello. I reset sono raggruppati con tolleranza di un'ora.
Gli aggregati oltre il 100% rimangono lineari: minuti e costo non vengono troncati.

Acquisti extra dichiarati e osservazioni di fatturazione restano dati separati.
Gli extra sono considerati interamente spesi, con residuo zero. Le calibrazioni
storiche non vanno confuse con il calcolo corrente da CSV o con addebiti ufficiali.

Le varianti Fast/Standard mancanti nel CSV sono completate con il fattore
2,5 richiesto dall'utente, lasciando invariati i prezzi esistenti. Sono stime
derivate degli EUR/min, distinte dalle misure fatturate: formule e provenienza
sono nei registri descritti nella [guida del catalogo](../../models/README.md#fast-standard-e-provenienza).

Torna all'[indice](README.md).
