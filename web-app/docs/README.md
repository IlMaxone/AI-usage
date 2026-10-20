# Guide dell'app principale

L'app Docker comprende frontend, API, worker OCR e PostgreSQL. I comandi si
eseguono da `web-app`, salvo diversa indicazione. I percorsi descrittivi che
iniziano con `web-app/`, `models/` o `projects/` sono relativi al repository.

| Guida | Contenuto |
| --- | --- |
| [Avvio e configurazione](avvio-configurazione.md) | Docker, `.env`, porte, selettore Windows e ricaricamento. |
| [Architettura e dati](architettura-dati.md) | Servizi, volumi, API, archivi e indipendenza da HTML OCR. |
| [Caricamento e OCR](caricamento-ocr.md) | Singoli, batch, coppie A/B, convalida e riletture. |
| [Modelli e costi](modelli-costi.md) | CSV, tag immutabili, formule e modalità esplorativa. |
| [Interfaccia e stati](interfaccia-stati.md) | Pagine, filtri, messaggi, badge e colori. |
| [Backup e recupero](backup-recupero.md) | Dump, foto, eliminazione recuperabile e reset database. |
| [Verifiche e sviluppo](verifiche-sviluppo.md) | Typecheck, build, test, integrazione e riferimento grafico. |
| [Problemi e privacy](problemi-privacy.md) | Diagnosi operativa, accessi, integrità e dati esclusi da Git. |

Per iniziare: [README dell'app](../README.md). Il formato completo del CSV è
nella [guida del catalogo](../../models/README.md). Il motore storico rimane
separato e ha un proprio [indice documentale](../../html-ocr/docs/README.md).
