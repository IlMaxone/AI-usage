# Modelli e costi

Il catalogo è [`models/models.csv`](../../models/models.csv), alla radice del
repository. Nome, provider, reasoning, disponibilità, tariffa al minuto e limite
di utilizzo provengono dal CSV. La pagina **Modelli** è di sola consultazione e
usa il logo OpenAI per quel provider. Il [formato completo](../../models/README.md)
descrive colonne, validazioni e rinomina controllata delle key.

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

Il badge **Tag OCR immutabile** indica una prima associazione convalidata.
Un modello appena censito senza screenshot associati può essere disponibile
senza mostrare il badge. Gli upload storici validati e senza tag vengono
controllati dal worker senza riscrivere l'uso già rilevato.

## Formule

Il riferimento della finestra è fisso a **13,54 EUR**, comune a tutti i modelli.
È una convenzione di progetto, non un prezzo ufficiale o una fattura osservata.
`max_time_window_minutes` accetta minuti:secondi (`93:03`) o minuti decimali,
entro 300 minuti. Il limite esplicito evita che tariffe arrotondate alterino i tempi.

```text
minuti equivalenti = usage attribuito / 100 × max_time_window_minutes
costo originale = usage attribuito / 100 × 13,54 EUR
costo esplorativo = minuti equivalenti originali × tariffa alternativa
```

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

Torna all'[indice](README.md).
