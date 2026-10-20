# Sviluppo e riferimenti

Il progetto è sviluppato con il supporto di OpenAI Codex. Il lavoro originale
è iniziato con GPT-5.6 Sol e reasoning `high` (Alto). Il modello usato per
sviluppare il codice non va confuso con il modello attribuito agli screenshot
o con il catalogo dell'app principale.

Il metodo adottato è graduale e verificabile: chi revisiona deve comprendere
scopo, effetti e limiti del codice, controllare dipendenze e accessi di rete,
verificare le esclusioni dei dati locali ed eseguire prove proporzionate.
Un risultato generato dall'AI non è una verifica di correttezza.

Prima di versionare una modifica:

1. Leggere il diff e mantenere indipendenti i due applicativi.
2. Eseguire i controlli della [guida verifiche](verifiche-problemi.md).
3. Controllare che JSONL, dati inventati e risultati derivati rimangano distinti.
4. Ispezionare lo staging per escludere screenshot, credenziali e progetti reali.

Non introdurre scheduler, notifiche desktop o servizi condivisi come conseguenza
di una semplice riorganizzazione. Il processo storico resta manuale; la dashboard
resta un file statico autonomo.

Riferimenti:

- [Regole comuni del repository](../../AGENTS.md).
- [Regole specifiche HTML OCR](../AGENTS.md).
- [Richieste originali, documento protetto](../ai-usage-analytics.md).
- [Dati dimostrativi](../projects/demo/README.md).
- [Documentazione dell'app Docker indipendente](../../web-app/docs/README.md).

Torna all'[indice](README.md).
