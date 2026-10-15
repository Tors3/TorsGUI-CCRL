# File torneo {#tournament-files}

Un file torneo descrive un torneo in poche righe di [TOML](https://toml.io). Puoi scriverlo tu
o chiederlo a un assistente come Claude ("crea un gauntlet Blitz di Triumviratus 7.0 8CPU
contro 15 motori intorno al suo rating"), poi importarlo in TorsGUI, controllare cosa ha capito
TorsGUI, e salvarlo come bozza, metterlo in coda o avviarlo.

## Come si usa {#workflow}

1. **Tornei → Importa file → Modello per Claude** copia un modello commentato. Contiene le
   regole, la tua macchina (nodi NUMA e core), il tuo libro predefinito e **i nomi dei motori
   della tua libreria**. Dallo a Claude insieme alla tua richiesta.
2. Incolla la risposta di Claude nella stessa finestra, oppure salvala come `qualcosa.toml` nella
   cartella `inbox` del workspace (indicata in cima alla finestra), oppure caricala da un
   percorso qualsiasi.
3. La parte destra mostra il risultato: i motori abbinati nella libreria (esatto,
   approssimato, ultima versione, non trovato → con suggerimenti), partite totali, tempo,
   thread/hash, nodi × lane, fine prevista, e ogni avviso o errore della procedura guidata (RAM,
   core, regola dell'hash, libro…).
4. **Salva come bozza**, **Aggiungi alla coda** oppure **Avvia ora** (il file può suggerirne uno
   con `after_import`). Il torneo viene creato esattamente come lo creerebbe la procedura
   guidata; il file viene conservato accanto come `tournament.toml`.

Qualsiasi torneo si può riportare in un file: **pagina del torneo → Come file** (per riusarlo
con altri motori, o per mostrare un esempio a Claude).

## Esempio {#example}

```toml
format = 1
kind = "gauntlet"
list = "Blitz"
seed = "Triumviratus 7.0"
opponents = [
  "Stockfish 17", "Obsidian 16.0", "Berserk 14", "Caissa 2.0", "Clover 9.0",
]
threads = 8
games_per_opponent = 30
passes = 1
after_import = "queue"
notes = "8CPU gauntlet for the Blitz list"

[options."Clover 9.0"]
Contempt = "0"
```

## Campi {#fields}

I nomi dei campi e i loro valori restano in inglese, come nel file.

| Campo | Predefinito | Significato |
|---|---|---|
| `format` | 1 | versione del formato del file |
| `kind` | `gauntlet` | `gauntlet`, `multi_gauntlet`, `round_robin`, `match`, `swiss`, `knockout` (due o più `seed` fanno un gauntlet a più seed) |
| `list` | `Blitz` | lista CCRL: `Blitz`, `40/15` o `FRC` (rating, nome dell'evento, tempo predefinito) |
| `variant` | dalla lista | `standard` o `chess960` (predefinito `chess960` per la lista FRC); ogni motore deve dichiarare `UCI_Chess960`; senza `book` vengono generate tutte le 960 posizioni di partenza |
| `seed` | — | il motore in prova, o un elenco di motori |
| `opponents` | — | gli avversari di un gauntlet |
| `engines` | — | i giocatori di un girone, un match, uno svizzero o un'eliminazione (al posto di `seed`/`opponents`; svizzero ed eliminazione li ordinano in quest'ordine) |
| `threads` | 1 | thread per motore |
| `hash_mb` | 512 × thread | hash per motore (Impostazioni → hash per thread) |
| `tc` | calcolato | tempo per fastchess (`"103+1"`, `"40/900+10"`); di default il tempo CCRL della lista scalato con il fattore macchina delle impostazioni, o con `factor` |
| `factor` | impostazioni | fattore macchina usato quando `tc` non è dato |
| `games_per_opponent` | 30 | partite per accoppiamento (partite per match in uno svizzero o un'eliminazione), pari (ogni apertura con entrambi i colori) |
| `passes` | 1 | divide le aperture in passate: fermarsi dopo una passata resta bilanciato; in uno svizzero, il numero di turni |
| `nodes` | tutti | nodi NUMA (partizioni delle aperture); un match corto ne usa meno quando ci sono meno aperture |
| `lanes_per_node` | core / (2 × thread) | partite contemporanee per nodo |
| `placement` | `node` | `node` (bloccate al nodo NUMA, o condivise su un solo nodo), `lane` (CPU fisse per partita) o `none` (nessun limite) |
| `smt` | `false` | `true`: le lane usano entrambi i thread hardware di ogni core (SMT / Hyper-Threading), quindi le lane predefinite contano le CPU logiche; le macchine CCRL fanno girare un thread di motore per core fisico |
| `gpus` | tutte le schede | schede video per i motori GPU (Lc0…), es. `[0, 1]`: una partita per scheda alla volta, la lane i sulla scheda i; con motori GPU le lane predefinite sono una per scheda |
| `book` | impostazioni | libro di aperture, assoluto o relativo alla cartella dei libri |
| `book_start` | 1 | prima apertura del libro |
| `syzygy` | impostazioni | percorso Syzygy passato ai motori |
| `event` | stile CCRL | es. `CCRL Blitz gauntlet Triumviratus 7.0 8CPU` |
| `name` | l'evento senza `CCRL ` | nome in TorsGUI |
| `site` | impostazioni | tag PGN Site |
| `extra_args` | — | argomenti extra per fastchess |
| `[adjudication]` | impostazioni | `draw`, `draw_movenumber`, `draw_movecount`, `draw_score`, `resign`, `resign_movecount`, `resign_score`, `resign_twosided` |
| `[options."<motore>"]` | — | opzioni UCI per un motore (aggiunte alle sue opzioni della libreria) |
| `after_import` | `queue` | il bottone che l'importazione propone: `draft`, `queue`, `start` |
| `notes` | — | mostrate nella finestra di importazione |

I campi sconosciuti sono errori (un errore di battitura come `opponent =` viene segnalato, non
ignorato). Viene accettato anche un oggetto JSON con gli stessi campi.

## Nomi dei motori {#engine-names}

I nomi sono quelli della libreria dei motori (**Motori**). L'abbinamento ignora maiuscole,
spazi e punteggiatura; un nome senza versione (`"Stockfish"`) prende l'ultima versione
installata; un piccolo errore di battitura con un solo candidato chiaro viene accettato e
mostrato come *approssimato*. Tutto il resto è un errore con suggerimenti — niente viene
scaricato o indovinato di nascosto. Aggiungi prima i motori mancanti (**Motori → Da GitHub**).
