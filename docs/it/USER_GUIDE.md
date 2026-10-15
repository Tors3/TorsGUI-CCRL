# Guida di TorsGUI {#torsgui-user-guide}

Il lavoro di un tester CCRL dall'inizio alla fine: **nuova macchina → bench → scaricare i
motori → importare la lista CCRL → creare un gauntlet → farlo girare su NUMA → esportare e
pubblicare**.

TorsGUI tiene tutto in una cartella di *workspace* (`%LOCALAPPDATA%\TorsGUI` su Windows,
`~/.local/share/TorsGUI` su Linux, oppure `TORSGUI_HOME`): il database SQLite `torsgui.db` e una
cartella per torneo con i suoi PGN (`pgn/node<N>_lane<L>.pgn`), i log e gli export. Sono i file
PGN a dire quali partite sono state giocate.

## Per iniziare {#getting-started}

**Per iniziare** (nella barra laterale, o il bottone sul Pannello di una nuova installazione) è
una procedura guidata: ogni passo dice cosa fare e perché, mostra se su questa macchina è già
fatto e ha un bottone per farlo. I passi sono le sezioni di questa guida:

1. **Chi sei**: il tuo nome e il luogo (usati nell'export).
2. **fastchess**: scarica la versione fissata (è lui che gioca le partite).
3. **Cartelle**: motori, libri e il libro di aperture predefinito (*Installa i libri di aperture
   CCRL*: i libri sono inclusi in TorsGUI, vedi [Libri di aperture](#opening-books)).
4. **Bench**: il bench di SF10 dà il fattore della macchina e il tempo di riflessione locale
   (Stockfish 10 è incluso in TorsGUI: *Usa lo Stockfish 10 incluso*).
5. **Motori**: *Aggiungi i motori inclusi* (Stockfish 10 e Triumviratus 8.0 sono inclusi
   in TorsGUI), poi aggiungine altri da GitHub (o da file locali); ognuno viene verificato.
6. **Lista CCRL**: importa la lista per rating, nomi e avversari suggeriti.
7. **Il tuo primo torneo**: la procedura guidata, poi Live, Esporta e il post.

**Prova la demo** gioca un piccolo torneo di esempio con i *motori dimostrativi di TorsGUI* (due
motori minuscoli inclusi che giocano mosse legali ma deboli in pochi millisecondi a mossa; non
sono mai pensati per le liste di rating). Serve solo fastchess: in un paio di minuti vedi il
runner al lavoro, le scacchiere in diretta, la classifica, il visualizzatore delle partite e
l'export CCRL con la sua checklist. La demo può essere a scacchi normali o Chess960, e dopo si
può eliminare (torneo → Elimina).

## Libri di aperture {#opening-books}

TorsGUI include i libri di aperture usati dai tester CCRL, gentilmente forniti da **Graham
Banks** (CCRL); grazie a lui e agli autori dei libri. *Installa i libri di aperture CCRL* (Per
iniziare, oppure **Impostazioni → Libri di aperture**) li estrae nella cartella dei libri e, se
non c'è un libro predefinito, rende predefinito **AVT-Book 2026d** (`AVT2026d.pgn`).

| Libro | Posizioni | Note |
|---|---|---|
| AVT-Book 2026d | 16677 | partite ICCF >2200, 12 mosse, mescolate (predefinito) |
| AVT-Book 2026c | 20319 | partite ICCF >2200, 12 mosse, un po' sbilanciate |
| AVT-Fringe 2026 | 6292 | partite ICCF >2400, 12 mosse, piuttosto sbilanciate |
| AVT 8 moves 50-65 | 3745 | partite ICCF >2200, 8 mosse, valutazione in uscita 50–65 cp |
| AVT ICCF 8 moves more unbalanced | 3745 | partite ICCF >2200, 8 mosse, più sbilanciate |
| GBSelect 2026 | 1879 | aperture scelte con codici ECO e nomi |
| GM2700+ | 13438 | 8 mosse da partite tra grandi maestri 2700+ |
| LowDraw1000 | 1000 | aperture con poche patte |
| TopGM 8 moves | 4999 | partite dei migliori GM, 8 mosse |

L'archivio contiene 9 libri **PGN**, che fastchess gioca, e 9 libri **CGB** (il formato di altre
GUI), installati solo per i tester che usano anche quelle GUI: fastchess non legge i CGB, quindi
TorsGUI non li propone mai per i tornei. I libri CGB sono 2600+ 8 moves, AVT-Fringe 2026, AVT 8
moves 50-65, AVT ICCF 8 moves more unbalanced, FOEBOS v20.1, Hert500, IECG Masters, SuperGM 2020
e WorldClass 2013.
Il pannello mostra autore, descrizione e condizioni d'uso di ogni libro e un bottone *Usa come
predefinito*. Nella procedura guidata, *Libri installati…* accanto al campo del libro sceglie un
qualsiasi libro PGN/EPD della cartella dei libri; un file torneo può indicare un libro per nome
di file (`book = "GM2700+.pgn"`).

## 1. Nuova macchina {#new-machine}

1. Installa TorsGUI (installer, MSI o zip portabile; AppImage/deb su Linux). La versione
   **portabile** tiene tutto — database, tornei, impostazioni — in una cartella `data` accanto a
   `TorsGUI.exe` (lo dice il file `portable.txt` lì accanto). La prima volta ci copia il
   workspace usato fino ad allora (`%LOCALAPPDATA%\TorsGUI`), lasciando l'originale al suo
   posto; se c'è un torneo in corso aspetta un avvio senza tornei in corso. Le Impostazioni
   mostrano in alto quale copia sta girando e da dove. Per aggiornare la versione portabile usa
   **Aggiorna ora** (dalla 0.6.3 sostituisce solo i file di TorsGUI nella stessa cartella),
   oppure estrai il nuovo zip **sopra la stessa cartella**. *Impostazioni → Generali → Crea un
   collegamento sul desktop* crea un collegamento a questa copia, e a ogni avvio TorsGUI fa
   puntare a sé i collegamenti di TorsGUI sul desktop che aprono una copia più vecchia o mancante.
2. Apri **Impostazioni**:
   - *Nome del tester* (usato nel nome del file di export, es. `Francesco Torsello`) e *Luogo*
     (dove sei, il tag PGN `Site` dell'export, es. `Milan`).
   - *Percorsi*: cartella dei motori (i download finiscono in `<cartella>/<Repo>_<tag>`), libri,
     il libro predefinito, tablebase, i percorsi Syzygy, Gaviota e Nalimov passati ai motori che
     hanno l'opzione corrispondente, e la cartella di output dell'export (Sfoglia… apre la
     scelta di file o cartella).
   - *fastchess*: premi **Scarica** per installare la release fissata (`v1.8.2-alpha`) nel
     workspace, oppure imposta un *Eseguibile fastchess personalizzato*. La spunta verde mostra
     la versione trovata.
   - *Riprendi i tornei interrotti all'avvio di TorsGUI* (attivo di default) e, su Windows,
     *Riprendi all'accesso / al riavvio*: registra l'attività dell'Utilità di pianificazione
     `TorsGUI\Resume`, che esegue `torsgui-runner resume` all'accesso, così i tornei ripartono
     dopo un riavvio anche se non apri mai la GUI. Su Linux lo stesso bottone mostra la riga
     `@reboot` di crontab da usare.
   - *Avvia i runner con l'Utilità di pianificazione di Windows*: facoltativo, come il vecchio
     `start_all_task.bat` (un `.bat` CRLF nella cartella del torneo, eseguito da un'attività
     pianificata).
   - *Libri di aperture*: i libri CCRL inclusi in TorsGUI (vedi sopra).
3. Il pannello **Topologia CPU** mostra i nodi NUMA, i gruppi di processori, i core fisici e i
   thread SMT gemelli come vengono rilevati (`GetLogicalProcessorInformationEx` su Windows,
   sysfs su Linux). Le celle evidenziate sono il primo thread hardware di ogni core: l'insieme
   "una CPU logica per core fisico" usato per le partite.

## 2. Bench e tempo di riflessione {#bench-and-time-control}

1. **Bench → Scarica SF10 ufficiale** scarica le tre build ufficiali di Stockfish 10 per Windows
   (x64, popcnt, bmi2) da CCRL_ScirptsTests e ne controlla lo sha256. Su Linux scegli uno
   Stockfish 10 a 64 bit compilato dai sorgenti `sf_10`.
2. Scegli i livelli (istanze in parallelo: 1, mezzo nodo, un nodo, tutti i core…) e le
   esecuzioni.
3. Chiudi tutto e premi **Avvia il bench**. Controlli:
   - un eseguibile a 32 bit viene rifiutato (intestazione PE/ELF e `id name` del motore);
   - la CPU deve essere a riposo (sopra il 5 % di carico il bench non parte; *Esegui anche se
     occupata* segna il risultato come non valido);
   - il piano di alimentazione / stato minimo del processore e la frequenza vengono registrati,
     con avvisi;
   - il numero di nodi deve essere 3 939 338, altrimenti il risultato non vale per il CCRL.
4. La tabella dei risultati dà, per build e livello, gli nps (media, mediana, scarto, dev. st.),
   il tempo di bench equivalente e il **fattore** = tempo di bench locale / 2054 ms.
5. Il **calcolo del tempo** trasforma un tempo nominale CCRL in quello locale: clicca una riga
   dei risultati per usarne il fattore. Le formule sono visibili e modificabili (`B` base, `I`
   incremento, `M` mosse, `f` fattore). Predefinite: `base = round(B × f)`,
   `inc = if(I > 0, max(1, round(I × f)), 0)` (incremento intero perché alcuni motori gestiscono
   male i decimali). Valori di riferimento: Blitz 2'+1" con f≈0,86 → **103+1**; 40/15 come
   15'+10" con f≈1,878 → 1690+19. *Salva formule e fattore come predefiniti* li fa usare alla
   procedura guidata.
6. Il grafico dello storico mostra il fattore rispetto al numero di istanze in parallelo per ogni
   esecuzione; i risultati importati da file JSON di `ccrl_bench.py` fatti con un eseguibile che
   non dichiara una build a 64 bit sono segnati non validi.

## 3. Motori {#engines}

- **Rating CCRL e ricerca**: la libreria mostra il rating di ogni motore nelle liste CCRL
  **Blitz**, **40/15** e **FRC** (la stessa versione, prima 1CPU, altrimenti viene indicata la
  sua categoria CPU; `≈` = questa versione non è ancora in lista, viene mostrata l'ultima
  versione presente). I rating seguono le liste in *Liste CCRL*: **Aggiorna i rating CCRL** le
  scarica di nuovo (se il sito non risponde restano in uso le liste incluse). Clicca
  l'intestazione di una colonna per ordinare, e cerca per nome, autore, build o `id name`.
- **Da GitHub**: scegli uno dei **motori noti** (73 repository pubblici: i motori delle liste
  CCRL che pubblicano le release su GitHub, tutti i motori open source dei primi 60 della
  Blitz; 36 già provati con TorsGUI, con il loro miglior rating Blitz e se sono nella tua
  libreria), oppure incolla l'indirizzo di un repository o di una release. TorsGUI elenca le
  release (viene preselezionata l'ultima *stabile*; quando l'API ha raggiunto il limite di
  richieste usa il rimando `releases/latest` e l'elenco HTML dei file) e classifica ogni file
  con un motivo: il CCRL prova build **AVX2 o AVX-512**, quindi TorsGUI prende la build
  AVX-512 (prima VNNI, poi AVX-512 semplice / x86-64-v4) quando questa CPU la supporta,
  altrimenti la build Windows AVX2 (x86-64-v3 vale come AVX2). Una build AVX-512 viene
  scartata su una CPU senza AVX-512 (andrebbe in crash); archivi a 32 bit, ARM e sorgenti sono
  sempre scartati; le build bmi2/pext, popcnt, universali o generiche vengono prese solo quando
  non c'è di meglio, e sono **segnalate**. Non si compila mai niente. Le reti fornite a parte
  (`.nnue`) vengono scaricate accanto all'eseguibile. Il download viene controllato con il
  digest sha256 di GitHub quando è pubblicato, estratto (zip / 7z / tar.gz) e verificato:
  `uci` → `isready` → `go depth 12`. Vengono registrati `id name`, le opzioni (salvate come
  `uci_options.txt`), la bestmove, il massimo dei Thread e il supporto Syzygy.
- **Scegliere tu la build**: la finestra propone una build e mostra ogni file con il suo
  motivo; clicca un'altra riga accettata per installare quella (il motore tiene il motivo
  "scelta a mano").
- **Solo AVX2**: *Impostazioni → Build dei motori* (o la casella nella finestra) fa prendere ai
  download la build AVX2 anche su una CPU AVX-512.
- **In un torneo**: il CCRL vuole una build AVX2 o AVX-512 di ogni motore. Quando una non lo è
  (bmi2, popcnt, universale, generica), la procedura guidata e la pagina del torneo mostrano
  l'avviso *non tutti i motori scelti sono build AVX2 o AVX-512* con i nomi dei motori: vai
  avanti solo se non esiste una loro build AVX2 o AVX-512 (alcuni motori pubblicano solo una
  build generica). La checklist CCRL avvisa; un file locale il cui nome non dice la build viene
  indicato da controllare. Una build AVX-512 su una CPU senza AVX-512 blocca il torneo (il
  motore andrebbe in crash).
- **Motori inclusi**: gli installer contengono Stockfish 10 e Triumviratus 8.0 (il suo file
  per Windows, che usa da solo AVX2 o AVX-512); il bottone li copia nella cartella dei motori (con controllo sha256)
  e li verifica. Entrambi sono GPL-3: i loro sorgenti sono collegati nella scheda del motore.
- **File locale** fa la stessa verifica per un eseguibile già sul disco.
- **Da una cartella** importa tutti i motori di una cartella in un colpo (anche nelle
  sottocartelle): TorsGUI avvia ogni eseguibile e gli chiede `uci`; i motori che rispondono
  prendono nome e versione dal loro `id name` e vengono verificati quando li importi. Se una
  cartella contiene più build dello stesso motore, viene proposta la migliore per questa CPU (e
  per le regole CCRL). *Ricorda la cartella* aggiunge in Motori un bottone **Aggiorna**: scarichi
  un motore nuovo in quella cartella, premi Aggiorna, ed è importato. Thread e Hash li imposta
  ogni torneo e i percorsi delle tablebase vengono da Impostazioni → Percorsi, quindi non c'è
  niente da impostare motore per motore.
- **Importa da Cute Chess** legge l'`engines.json` di Cute Chess (**Trovalo** cerca nelle
  solite cartelle di Cute Chess, oppure indica il file o la sua cartella, o incollane il
  contenuto): ogni motore UCI viene aggiunto con la sua cartella di lavoro, i suoi argomenti e le
  opzioni UCI cambiate in Cute Chess (non Thread/Hash, che vengono dal torneo), poi verificato.
  I motori il cui eseguibile non è su questo computer vengono aggiunti senza verifica (imposta
  l'eseguibile in *Modifica*); i motori xboard vengono saltati (fastchess gioca motori UCI). Un
  motore già nella libreria (stesso nome) viene saltato.
- **Ricostruisci da REPORT.md** ricostruisce la libreria (solo i dati) da una cartella
  `engines/` in stile CCRL_ScirptsTests: release, file, build, sha256, `id name`, opzioni, usato o
  no, note.
- **Modifica**: nome mostrato canonico `<Motore> <versione>` (l'export aggiunge ` 64-bit` e
  ` NCPU` quando i thread sono più di 1), note, flag "usato" e le **opzioni UCI** inviate nei
  nuovi tornei: ogni opzione che il motore dichiara, con il suo controllo e il suo valore
  predefinito (vuoto = il predefinito del motore); un'opzione che non dichiara si aggiunge con
  **Aggiungi opzione** (nome + valore, es. `EvalFile` e `nets/my.nnue`). I percorsi relativi dei
  file si leggono dalla cartella del motore; nomi sbagliati, valori fuori intervallo e file di
  rete mancanti vengono segnalati. `Ponder=false` e `OwnBook=false` vengono aggiunti quando il
  motore li espone. Thread e Hash vengono sempre dal torneo.
- **Opzioni di un solo torneo**: in *Nuovo torneo* il bottone **opzioni** di un motore scelto le
  cambia solo per quel torneo.
- **Opzioni di un torneo già creato**: la scheda *Configurazione* del torneo, **Opzioni dei
  motori in questo torneo**, le cambia mentre è in pausa o fermo (usate dalla partita
  successiva; per il CCRL ogni partita deve usare le stesse impostazioni).
- **Attivi e disattivati**: ogni motore ha una spunta *Attivo* (accesa di default). La libreria
  ha tre schede, **Attivi**, **Disattivati** e **Tutti**, e la procedura guidata propone solo i
  motori attivi (*anche i disattivati* mostra anche gli altri). Togli la spunta ai motori che non
  provi più: non viene cancellato niente, e ogni tester tiene la sua lista.
- **Motori GPU** (Lc0 e simili): la scheda **GPU** li elenca insieme alle schede video di questo
  computer (le NVIDIA con `nvidia-smi`, le altre dal sistema). Un motore le cui opzioni sono
  quelle di un motore GPU (`WeightsFile` e `Backend`, o un `id name` come Lc0) viene segnato
  quando lo verifichi; la colonna *GPU* segna o toglie qualsiasi motore. In un torneo ogni scheda
  gioca una partita alla volta (due partite sulla stessa scheda si rallentano a vicenda): *Core e
  partite* mostra le schede da usare e suggerisce tante partite quante schede, e ogni partita usa
  la scheda della sua lane — Lc0 con `BackendOptions=gpu=N` (aggiunto alle tue opzioni del
  backend), gli altri motori con `CUDA_VISIBLE_DEVICES`. I thread CPU di un motore GPU vengono
  comunque dal torneo (a Lc0 ne servono pochi). Le liste CCRL sono per motori sulla CPU, quindi la
  checklist CCRL avvisa.
- **Rapporto** produce l'equivalente Markdown di `engines/REPORT.md`.
- Per rinominare un giocatore *dentro un torneo* (tag PGN White/Black e configurazione, mai
  `EngineWhiteName`), usa **Configurazione → Rinomina un motore** del torneo (il torneo deve
  essere in pausa o fermo).

## 4. Liste CCRL {#ccrl-lists}

- **Liste incluse**: TorsGUI contiene le liste Blitz, 40/15 e FRC (versioni migliori, la parte
  alta di ogni lista come pubblicata a fine settembre 2026), così rating, avversari e i nomi
  CCRL usati per rinominare i motori nei PGN funzionano senza rete dal primo avvio. Vengono
  sostituite da qualsiasi lista scarichi o importi; *Liste incluse* le ripristina.
- **Scarica tutte** (o una lista) legge le liste Blitz, 40/15 e FRC (versioni migliori e tutte
  le versioni) da computerchess.org.uk. Ogni lista prova diversi indirizzi (`/4040/`,
  `/ccrl/4040/`, `www.`) e poi l'export in testo semplice del sito; l'intestazione su due righe
  delle tabelle CCRL e le posizioni a pari merito (`14-15`) vengono capite. Quando il sito
  rifiuta il download resta in uso la lista inclusa o quella precedente, e il messaggio elenca
  ogni indirizzo provato.
- **Importa a mano** funziona sempre: *Apri una pagina salvata* (nel browser: *Salva pagina con
  nome…*, solo HTML), incolla la tabella copiata dalla pagina, l'HTML o un CSV
  (`rank,name,rating[,plus,minus,score,games]` oppure `name,rating`). Le categorie CPU si leggono
  dai nomi (`… 64-bit 8CPU`; senza suffisso = 1CPU).
- La tabella segna quali motori della lista sono nella tua libreria.
- **Abbinamento nomi**: abbinamento approssimato ("Integral v8" ↔ "Integral 8", tag di build e
  `64-bit` ignorati); conferma un candidato per salvare l'alias.
- **Avversari**: i primi N della lista, l'ultima versione di ogni motore che vi compare,
  filtrati per quello che è installato e per il supporto ai thread (i motori a un solo thread
  sono esclusi dai tornei multi-thread).
- **Soglia**: il punteggio che serve al seed, contro i suoi avversari reali, perché la sua
  performance superi la posizione k della sua categoria CPU.
- Rating usati per le statistiche: il rating nella categoria CPU del torneo, oppure il rating
  1CPU più uno scarto — lo scarto storico del motore (altre versioni presenti in entrambe le
  categorie), altrimenti la mediana della lista, altrimenti il valore predefinito delle
  Impostazioni (32). I valori stimati sono segnati **stima** ovunque.

**Dalla lista al download**: clicca un motore in una lista CCRL e si apre *Motori → Da GitHub*
con il suo repository ufficiale e la release della versione in lista già selezionata; controlla
la build che TorsGUI propone e premi *Scarica, estrai e verifica*. Per un motore che TorsGUI non
conosce ancora, legge la pagina del motore sul sito CCRL (il link alla sua homepage, spesso
GitHub) e si ricorda quello che trova; i motori che non sono su GitHub (commerciali, o sul loro
sito) mostrano un link al loro sito, poi usa *Aggiungi motore → File locale*. Un indirizzo che
incolli viene ricordato per la volta successiva.

## 5. Creare un gauntlet {#create-a-gauntlet}

**Tornei → Nuovo torneo**:

1. *Tipo*: gauntlet, gauntlet a più seed (i seed giocano un girone tra loro e contro ogni
   avversario; gli avversari non giocano tra loro), girone all'italiana, match, **Svizzero** o
   **Coppa (eliminazione)**; la lista CCRL; l'evento (nome CCRL automatico, es.
   `CCRL Blitz gauntlet Triumviratus 7.0 8CPU`).
2. *Motori*: il seed (o i seed) e gli avversari, oppure **Suggerisci avversari** dalla lista.
   Vengono mostrati i rating nella categoria CPU del torneo (quelli stimati sono segnati).
   **Cerca** i motori, tieni solo un **intervallo di Elo** (*da*–*a*; i motori già scelti restano
   visibili), ordina per nome o rating (intestazioni delle colonne), oppure **Più vicini al
   seed** per elencare gli avversari per distanza dal rating del seed.
3. *Condizioni*: thread, hash (regola CCRL di default: Blitz 256 MB × thread, 2048 a 8CPU;
   40/15 1024 MB a 1CPU, 4096 a 8CPU), partite per accoppiamento (pari, un multiplo di passate ×
   2), passate, tempo di riflessione (o calcolalo dal tempo nominale e dal fattore), libro, inizio
   del libro, percorso Syzygy, luogo, aggiudicazione (predefiniti `-draw movenumber=35
   movecount=8 score=10`, `-resign movecount=4 score=600 twosided=true`) e argomenti extra per
   fastchess.
   **Motori con thread diversi** (la lista CCRL Blitz si fa con motori a 8 thread contro
   avversari a 1 thread): la scelta rapida *seed 8CPU contro avversari 1CPU* sotto *Thread per
   motore*, oppure un numero nella colonna *Thread* della tabella dei motori per qualsiasi motore
   (vuoto = quelli del torneo). Ogni motore riceve i suoi thread e il suo hash (512 MB × i suoi
   thread), il suo rating viene preso dalla categoria CPU giusta della lista, l'evento e i nomi
   esportati dicono *8CPU vs 1CPU* (un motore a 1 thread non ha suffisso, come nelle liste), e le
   lane si dimensionano sui due motori dell'accoppiamento più pesante (8 + 1 = 9 core). In un
   file torneo: `[threads_of] "Engine 1.0" = 8` (e `[hash_of]`).
4. *Core e partite*: il pannello dice, a parole semplici, come il torneo usa la CPU.
   - **Solo core fisici** (come fa il CCRL: un thread per core) oppure **Tutti i thread
     (Hyper-Threading / SMT)**, che raddoppia i thread ma fa dividere un core a due motori, che
     quindi calcolano più lentamente che su un core tutto loro: va bene per i tuoi test, non per
     il CCRL (la checklist avvisa).
   - **Nodi NUMA** (solo sulle macchine che ne hanno più di uno): i nodi da usare.
   - **Partite contemporanee** per nodo, con il numero suggerito (*Usa N*: i core del nodo ÷ i
     thread dei due motori di una partita).
   - **Come si distribuiscono le partite sulle CPU**: *Bloccate al nodo NUMA* (sulle macchine con
     più nodi: una partita non passa mai all'altro socket, così la sua memoria resta vicina),
     *Condivise* (sulle macchine con un solo nodo: tutte le partite condividono le CPU scelte),
     *CPU fisse per partita* (ogni partita ha le sue CPU; funziona su ogni macchina, NUMA o no),
     oppure *Nessun limite* (solo per controllare un problema: su una macchina NUMA una partita
     potrebbe spostarsi da un socket all'altro, e il pannello lo dice in rosso).
   - **Schede video per i motori GPU** (solo quando scegli un motore GPU): le schede da usare,
     una partita per scheda alla volta; un avviso quando girano più partite che schede.
   - La riga *In breve* fa il conto, e la mappa delle CPU mostra quali core riceve ogni partita.

Il **riepilogo** si aggiorna mentre scegli: partite totali, accoppiamenti, aperture per passata
e nodo (es. 15 aperture su 2 nodi → 8 e 7), aperture usate, partite contemporanee, thread
occupati rispetto ai core fisici, RAM necessaria rispetto a quella installata, durata stimata di
una partita e fine prevista, errori e avvisi, e il comando fastchess esatto della prima partita.
**Crea e avvia**, **Crea e metti in coda** oppure **Salva come bozza**.

**Modificare un torneo**: una bozza (o un torneo in coda o fermo che non ha ancora giocato
partite) ha un bottone **Modifica** sulla sua pagina. Apre la stessa procedura guidata con tutte
le impostazioni caricate (motori, lista, tempo, partite, nodi, lane, libro, evento…); **Salva le
modifiche** ne mantiene lo stato, **Salva e metti in coda** e **Salva e avvia** lo mettono anche
in coda o lo avviano. Opzioni e argomenti dei motori del torneo vengono mantenuti.

Come si assegnano le aperture: ogni apertura viene giocata due volte a colori invertiti nello
stesso accoppiamento. Le aperture vengono divise in blocchi disgiunti per partizione di nodo,
passata e accoppiamento con la formula di `run_node.py`:

```
block = (node × PASSES + pass − 1) × n_pairings + pairing
start = BOOK_START + block × RPP_BLOCK        (RPP_BLOCK = max aperture per passata per nodo)
opening(round) = start + round − 1
```

### Svizzero e Coppa (eliminazione) {#swiss-and-cup-knockout}

I loro accoppiamenti dipendono dai risultati, quindi TorsGUI accoppia un turno alla volta:
quando tutte le partite di un turno sono finite, il turno successivo viene accoppiato e giocato
(il runner va avanti da solo). I motori vengono ordinati per rating CCRL (il più alto per primo);
il pannello **Teste di serie** di *Nuovo torneo* cambia l'ordine a mano (frecce; *Per rating*
torna indietro), per esempio per tenere separati due motori forti nei primi turni di una coppa,
e mostra il tabellone del primo turno. Ogni incontro è un mini-match di *Partite / match*
partite: ogni apertura due volte a colori invertiti.

- **Svizzero**: *Turni* turni. Il turno 1 accoppia la metà alta contro la metà bassa; poi si
  incontrano i motori con lo stesso punteggio (sistema olandese), mai due volte quando possibile
  (fino a motori − 1 turni). Con un numero dispari di motori riposa il motore più basso che non
  ha ancora avuto un turno libero, e un turno libero vale come un match pari. La scheda **Turni**
  mostra ogni turno e la classifica (punti, poi Buchholz).
- **Coppa (eliminazione)**: un tabellone con teste di serie (1 contro l'ultimo, 2 contro il
  penultimo…); con un numero di motori che non è una potenza di due le teste di serie migliori
  passano il primo turno senza giocare. Un match in parità gioca spareggi di 2 partite finché un
  motore ne vince uno (solo dopo 20 spareggi patti passa la testa di serie più alta). La scheda
  **Tabellone** mostra ogni turno fino alla finale e il vincitore.
- Lane: un turno ha al massimo (motori ÷ 2) × partite per match partite, quindi le lane in più
  restano ferme finché non viene accoppiato il turno successivo.

## 6. Farlo girare {#run-it}

- Il torneo gira in un processo separato **`torsgui-runner`** avviato staccato (nuovo gruppo di
  processi, fuori dal job della GUI su Windows; nuova sessione su Linux). Chiudi la finestra,
  aggiorna TorsGUI, scollega l'RDP: le partite continuano. Quando riapri TorsGUI si ricollega al
  runner attraverso il database e il lock del runner.
- Ogni partita è un processo fastchess (`-rounds 1 -games 1`, `-reverse` per il secondo colore,
  `-openings … order=sequential start=N`). TorsGUI decide lo slot successivo da quello che i PGN
  contengono già; la ripresa `-config file=` di fastchess non viene mai usata.
- **Piazzamento** (Windows): ogni processo di partita viene creato sospeso, messo nel suo Job
  Object limitato al gruppo di processori e alla maschera di CPU del nodo
  (`JobObjectGroupInformationEx`, kill-on-close), poi ripreso; i motori ereditano il job, quindi
  un motore che fissa i suoi thread su ogni nodo (Caissa 2.0) non può uscirne. *Lane e
  piazzamento* mostra le CPU previste e il piazzamento riletto dal job per ogni partita in corso.
- **Pausa** lascia finire le partite in corso, poi ferma il runner (non parte nessuna nuova
  partita). **Ferma** agisce subito: le partite in corso vengono interrotte, scartate e
  rigiocate dopo (mai contate due volte). **Riprendi** fa continuare in entrambi i casi, anche
  dopo un riavvio; le partite già finite vengono sempre tenute. Nessuno dei due avvia mai il
  torneo successivo in coda.
- La **coda** avvia il torneo successivo solo quando quello in corso ha **tutte** le sue partite
  previste ed è finito bene. Se è finito bene ma con partite mancanti (un motore andato in crash
  non ha mai registrato una partita…), viene riprovato fino a 2 volte, poi segnato *incompleto*
  e la coda si ferma.
- **Togli dalla coda** (su un torneo in coda) lo toglie dalla coda e gli ridà lo stato che
  aveva prima: in pausa, fermo o bozza.
- Una partita che supera la durata massima possibile al suo tempo di riflessione viene chiusa da
  un watchdog e rigiocata.
- Il **Pannello** mostra i tornei in corso e in coda, le partite all'ora su un'ora mobile, la
  fine prevista del torneo in corso e di tutta la coda (tempi), il pannello di stato (runner
  attivi, processi di fastchess e dei motori, RAM libera, crash e sconfitte per tempo, anomalie
  come un torneo segnato in corso senza un runner attivo) e gli eventi. Le notifiche annunciano
  i tornei finiti, i crash dei motori, le sconfitte per tempo e l'avanzare della coda; l'icona
  nell'area di notifica mostra l'avanzamento.
- **Live**: una piccola scacchiera per lane con giocatori, orologi, ultima mossa, valutazione,
  profondità e nps; clicca per la scacchiera grande con la freccia della PV, l'elenco delle
  mosse, le valutazioni di entrambi i motori e il tempo per mossa. I dati vengono dai log dei
  motori di fastchess, letti man mano (solo i byte nuovi).
- La pagina del torneo: partite fatte, V/P/S e punteggio del seed, performance e rating MLE
  (logistico, ancorato ai rating della lista, IC 95 %; **Aggiorna i rating** li legge dalla
  lista importata), partite all'ora, durata media di una partita, fine prevista; tabella per
  avversario con i conteggi Bianco/Nero (una coppia di colori incompleta viene evidenziata);
  fine delle partite; controllo delle coppie di colori; partite decisive; ogni partita nel
  visualizzatore PGN (scacchiera, mosse, grafico della valutazione, informazioni dei motori dai
  commenti di fastchess `{+0.21/20 2.291s, tl=…, n=…, sd=…, nps=…}`).

## 7. Esportare e pubblicare {#export-and-post}

**Esporta** (o il bottone Esporta di un torneo):

- Nome del tester, luogo, data, seed, thread, hash, libro e pezzi EGTB sono già compilati.
- File: `[<Tester> <YYYY-MM-DD>] <Event> (hash <N>MB) (book <libro>) (egtb <N>-man).pgn`, zip
  con `_` al posto di spazi e parentesi. `Event` = `<nome di export del seed> - <Mon D>` (data
  della prima partita), `Site` = dove sei, giocatori `<Motore> <versione> 64-bit` (+ ` NCPU`),
  Round rinumerato 1..N. Ogni partita finita una volta sola (doppioni scartati, tenendo la prima
  per GameEndTime), ordinate per ora di fine; TimeControl e tutti gli altri tag restano
  esattamente come giocati.
- **Nomi come li scrive il CCRL**: ogni giocatore viene rinominato con la grafia della lista CCRL
  del torneo (le liste non sempre coincidono: la Blitz ha `Integral 8`, la 40/15 `Integral v8`),
  altrimenti di un'altra lista, altrimenti, per una versione non ancora in lista, il nome del
  motore come in lista seguito dalla sua versione (`pawnocchio 2.1`). La tabella *Nomi nel PGN*
  mostra da dove viene ogni nome e il nome finale; ognuno si può correggere a mano prima di
  **Crea l'export**.
- Con i nomi non cambiati, il risultato è identico byte per byte a `tools/export_ccrl.py` sugli
  stessi PGN.
- **Post per il forum**: modelli BBCode (finito, annuncio, avanzamento) con segnaposto; il post
  "finito" predefinito ha un titolo, una riga di condizioni, il risultato in grassetto, la
  tabella `[code]` per avversario ordinata per rating di lista e una riga finale che nomina il
  torneo successivo in coda. **Copia** e incollalo sul forum.

### Checklist per l'invio al CCRL {#ccrl-submission-checklist}

Prima di inviare i risultati, la pagina **Esporta** controlla il torneo e segna ogni punto con
✔ ok, ⓘ informazione, ⚠ da controllare o ✖ da sistemare. *Pronto da inviare* vuol dire che non
c'è niente da sistemare.

| Controllo | Perché conta | Come sistemarlo |
|---|---|---|
| Tutte le partite giocate | un gauntlet parziale dà un risultato sbilanciato | lascialo finire, o fermati dopo una passata completa (le passate tengono bilanciata ogni passata) |
| Ogni apertura con entrambi i colori | ogni apertura va giocata due volte, a colori invertiti, altrimenti il risultato favorisce un lato | riprendi il torneo: le partite mancanti vengono rigiocate |
| Nessuna partita doppia | una partita giocata due volte (es. dopo un crash) deve contare una volta | niente: l'export tiene la prima di ogni slot |
| Nessun crash, sconfitta per tempo o mossa illegale | il CCRL vuole saperlo; possono indicare una build difettosa o una macchina sovraccarica | guarda le partite (Decisive, Fine delle partite), citale nel post, riprova il motore se serve |
| Hash 512 MB per thread | condizione CCRL (512 MB × thread, es. 2048 MB a 4CPU) | imposta l'hash nella procedura guidata (il valore predefinito segue la regola) |
| Ponder spento | il CCRL gioca senza ponder | togli `Ponder=true` dalle opzioni del motore |
| Libro di aperture | ogni partita deve partire da una posizione del libro, lo stesso libro per tutte | imposta il libro nella procedura guidata |
| Tablebase | l'EGTB usata fa parte del nome del file (`egtb 5-man`) | imposta il percorso Syzygy (solo informazione) |
| Build CCRL (AVX2 o AVX-512, 64 bit) | il CCRL prova build AVX2 o AVX-512, mai a 32 bit; le build bmi2, popcnt o generiche vengono segnalate | reinstalla il motore con la build proposta (Motori → Da GitHub) |
| Motori verificati | un motore che fallisce `uci / isready / go` rovina le partite | Motori → Verifica |
| Nomi CCRL | la lista abbina i motori per nome: `<Motore> <versione>`; esportati come `… 64-bit NCPU` | torneo → Configurazione → Rinomina un motore; importa la lista CCRL attuale |
| Tempo da un bench | il tempo deve essere quello CCRL scalato sulla velocità di questa macchina | Bench → esegui il bench di SF10 (di nuovo se ha più di 90 giorni), poi il calcolo del tempo |
| Variante e lista | le partite Chess960 vanno solo nella lista FRC, quelle standard nelle altre | scegli la lista/variante giusta nella procedura guidata |
| Nome del tester e luogo | usati nel nome del file e nel tag PGN `Site` | Impostazioni → Tester |

## 7b. Diretta (Lichess, ccrl.live) {#7b-live-broadcast-lichess-ccrl-live}

TorsGUI può mostrare a tutti le partite mentre si giocano. La diretta gira dentro il runner,
quindi continua con la finestra chiusa, e si ferma quando il torneo va in pausa o finisce. Si
sceglie per torneo: nella procedura guidata (*Diretta*) o nella pagina del torneo, scheda
**Diretta**.

**Lichess** (non serve configurare il router)

1. Crea un token su <https://lichess.org/account/oauth/token/create> con solo *Read studies
   and broadcasts* e *Create, update, delete studies and broadcasts*.
2. **Impostazioni → Diretta**: incollalo, premi *Verifica* (mostra l'account), scegli la
   visibilità (pubblica, non in elenco, privata).
3. Accendi *Lichess* per il torneo. Con la prima partita TorsGUI crea la diretta (nome =
   l'evento, descrizione con tester, tempo, thread, hash, libro e motori) e turni da 60 partite;
   ogni partita viene inviata con gli orologi (`%clk`) e le valutazioni (`%eval`), le partite
   finite con il loro risultato. Il link è sulla pagina del torneo.

**ccrl.live** (il sito dove vengono trasmesse le partite di Graham Banks, di Jay Honnold)

TorsGUI è un server compatibile TLCS: ogni lane è una diretta sulla sua porta UDP (la lane 1
sulla prima porta di Impostazioni → Diretta, predefinita 16001, la lane 2 sulla successiva…).
Invia i giocatori, ogni mossa con profondità, valutazione, tempo e PV del motore, gli orologi,
il risultato e la tabella incrociata del torneo dopo ogni partita.

1. Router: inoltra le porte UDP (una per lane) a questo computer.
2. Firewall: *Consenti nel firewall* aggiunge la regola di Windows (chiede i permessi di
   amministratore).
3. Un indirizzo fisso: l'IP pubblico (*Mostra*) o un nome DNS dinamico gratuito se cambia.
4. Bisogna chiedere a Jay di aggiungere il tuo indirizzo e le porte a ccrl.live (il bottone
   *Copia il messaggio* per ora è disattivato).
5. Accendi *ccrl.live* per il torneo: la scheda mostra la porta di ogni lane, la sua partita e
   gli spettatori collegati.

## 8. Chess960 (Fischer Random) {#chess960-fischer-random}

Nella procedura guidata scegli la lista **FRC (960)** (o solo la variante **Chess960**):
fastchess gioca con `-variant fischerandom` e invia `UCI_Chess960 true` a entrambi i motori.

- **Motori**: TorsGUI legge l'opzione `UCI_Chess960` quando verifica un motore e lo segna
  **960** (Motori, procedura guidata). Un motore che non la dichiara viene rifiutato per un
  torneo Chess960; uno le cui opzioni non sono note (non ancora verificato) dà un avviso.
- **Posizioni di partenza**: le aperture sono posizioni di partenza in un libro EPD. Scegliere
  Chess960 genera *tutte le 960 posizioni, mescolate con il seme 1* (esclusa la posizione
  standard); **genera posizioni Chess960…** crea altri libri: tutte le 960 con un altro seme, un
  insieme casuale di N posizioni, oppure **doppio Chess960** (schieramenti diversi per Bianco e
  Nero). Lo stesso seme dà sempre lo stesso libro. Ogni posizione si gioca due volte a colori
  invertiti, come nei tornei standard; puoi anche usare un tuo EPD (arrocco X-FEN o
  Shredder-FEN).
- **Visualizzatore e live**: l'arrocco 960 (il re prende la torre in UCI, O-O/O-O-O nel PGN)
  viene rigiocato ovunque; i PGN contengono `Variant` e il `FEN` di partenza.
- **CCRL**: la lista FRC usa 40 mosse in 2 minuti (ripetuti), scalati con il fattore della
  macchina come le altre liste; controlla le condizioni FRC attuali del CCRL prima di inviare.

## 9. File torneo (e Claude) {#tournament-files-and-claude}

Un torneo si può anche descrivere in un piccolo file TOML — scritto da te o da Claude — e
importare con **Tornei → Importa file**: TorsGUI mostra i motori che ha abbinato, le partite, il
tempo, la fine prevista e ogni avviso, poi lo salvi come bozza, lo metti in coda o lo avvii.
**Modello per Claude** copia un modello con le regole e i nomi dei tuoi motori da dare a Claude
insieme alla richiesta. Vedi [File torneo](TOURNAMENT_FILE.md).

## 10. Partite, visualizzatore e scacchiera {#games-viewer-and-board}

**Partite** è l'archivio: le partite di ogni torneo, più i file o le cartelle PGN che aggiungi
(per esempio i risultati di CCRL_ScirptsTests; vengono solo letti). Clicca una partita per
rivederla: scacchiera con l'ultima mossa, lo scacco evidenziato e la mossa successiva come
freccia, barra della valutazione, materiale catturato, orologi, grafici di valutazione e tempo
(clicca per saltare), elenco delle mosse con le valutazioni. `Spazio` avvia/ferma (0,5×–4×), `t`
modalità teatro (scacchiera grande), `f` gira la scacchiera. La scacchiera grande della Live ha
la stessa barra, gli orologi che scorrono e la PV del motore che deve muovere come frecce.
**Aspetto della scacchiera** (bottone con la tavolozza, o Impostazioni): *Minimale* (piatta,
quella predefinita), ardesia, oceano, verde torneo, marrone classico, noce, acero, legno Szőts,
panno Bastiii, marmo, oliva, viola, corallo, ghiaccio, legno
d'ebano, cuoio, giornale, notte (scura), oppure *Personalizzata* con i tuoi colori delle case chiare e scure; 80 set
di pezzi (set di sharechess e lichess la cui licenza permette di includerli, con le loro
varianti di colore; si possono cercare); velocità dell'animazione, coordinate (**sulla
cornice** attorno alla scacchiera, come su una scacchiera vera, oppure dentro le case del bordo;
seguono la scacchiera quando la giri), frecce e un suono facoltativo delle mosse. **Importa**
aggiunge qualsiasi altro set da una cartella (nomi lichess `wP.svg`…`bK.svg` o nomi sharechess
`pw.svg`…`kb.svg`, SVG o PNG), per esempio i set non commerciali di sharechess: restano sul tuo
computer, per uso personale.

**Tabelle incrociate**: la pagina del torneo (scheda *Tabella incrociata*) e **Partite → Tabella
incrociata** (per il torneo o il file PGN scelto, anche partite giocate con altre GUI) mostrano
ogni giocatore contro ogni altro: punti, V/P/S, %, Sonneborn-Berger (decide le parità di punti) e
la performance quando tutti gli avversari hanno un rating (quelli del torneo, altrimenti i tag
PGN `WhiteElo`/`BlackElo`). Una casella elenca i risultati nell'ordine in cui sono stati giocati
(`1=0=`) quando ogni coppia ha giocato al massimo 4 partite, altrimenti il punteggio (`8.5/10`).
**Copia** la dà come testo, **Copia per il forum** dentro `[code]`; **Salva .txt** e **Salva come
pagina web** la scrivono in `<cartella di export>/crosstables`.

## 11. Importare i tornei dei vecchi script {#importing-the-old-scripts-tournaments}

**Tornei → Importa vecchi tornei** esamina una cartella in stile CCRL_ScirptsTests
(`tournaments/<nome>/config`, `scripts/gauntlet.bat`, PGN in `pgn/` o
`results/gauntlets/<nome>/all_games.pgn`). I tornei finiti vengono importati in sola lettura
(per verifica: stessa classifica, stesso export); quelli configurati ma mai avviati diventano
bozze.

## 12. Manutenzione {#maintenance}

**Impostazioni → Manutenzione**: spazio su disco per torneo, motori non usati, versioni
superate, rotazione dei log dei motori per partita. **Sincronizzazione Git** copia
configurazioni e risultati (ed export) in una cartella di repository e può farne il commit
(come `sync_repo.py`). **Log** mostra il registro degli eventi e ogni log del runner, della
console e delle partite (ultimi 96 KB, aggiornati).

## 13. Analisi partita {#game-analysis}

**Analisi → Analisi partita** (o **Analizza** nel visualizzatore, che apre lì la partita alla
stessa mossa). Incolla un PGN, solo le mosse (`1. e4 e5 2. Cf3…`) o una FEN, oppure parti dalla
posizione iniziale. Scegli un motore della libreria, i suoi thread e l'hash.

- **Motore in diretta**: il motore analizza la posizione mostrata, con 1–5 linee (MultiPV); le
  mosse migliori vengono disegnate come frecce e ti seguono mentre ti muovi nella partita (`←`
  `→` `Home` `Fine`, `f` gira la scacchiera).
- **Analizza la partita**: ogni posizione viene analizzata per il tempo scelto (0,1–10 s). Il
  grafico mostra la valutazione (dal lato del Bianco; clicca per saltare), ogni mossa riceve la
  sua valutazione e le mosse che perdono possibilità di vittoria vengono segnate **?!**
  imprecisione, **?** errore, **??** svarione (le stesse soglie di Lichess sulle possibilità di
  vittoria), con la mossa e la linea migliori del motore. Per ogni lato: precisione, perdita
  media in centipedoni (ACPL) e i conteggi.

Sotto la revisione, **Copia il PGN** e **Salva il PGN** danno la partita con le valutazioni
(`[%eval]`), i segni ($6 ?!, $2 ?, $4 ??) e la linea migliore del motore come variante; le
partite salvate vanno in `<cartella di export>/analysis` e compaiono in **Partite**.

## 14. Test suite {#test-suites}

**Analisi → Test suite** fa girare i motori su posizioni EPD con una risposta nota: problemi e
ricerca del matto. Una posizione è risolta quando la mossa finale del motore è una soluzione
(`bm`), non è la mossa da evitare (`am`), oppure quando annuncia un matto lungo al massimo
quanto richiesto (`dm`, matto in N: vale anche un altro matto altrettanto corto).

- Posizioni: suite incluse — *Mate finding* (matti da 1 a 7) e le prime 20 posizioni di *Win at
  Chess* (controllate con Stockfish 10), più, dalla raccolta di test del motore Arasan di Jon
  Dart (licenza MIT), il WAC completo (300, rivisto), ECM GCP, IQ4, BT-2630, LCT II, un test di
  finali di pedoni, l'Eigenmann Endgame Test e Arasan 2026; tre selezioni dal database dei
  problemi di lichess (CC0): *Lichess mates* (matti da 2 a 5 mosse), *Lichess hard tactics*
  (rating 2700+) e *Lichess endgames* (rating 2300+) — qualsiasi file EPD (STS, Arasan, raccolte di
  matti…) o righe incollate. Le righe che non si riescono a leggere vengono elencate e saltate.
- Motori: uno o più, un tempo per posizione, thread, hash e quanti processi dei motori girano
  insieme.
- Risultati: una colonna per motore, ✓ con il tempo in cui ha trovato la soluzione (e l'ha
  tenuta fino alla fine) oppure ✗ con la mossa giocata; numero e percentuale di risolte, il
  tempo totale di soluzione decide le parità. Clicca una posizione per vederla con la soluzione
  (verde), la mossa da evitare (rossa) e le mosse dei motori come frecce. Ogni esecuzione viene
  conservata (sceglila nell'elenco, o eliminala).

## 15. Giocare contro un motore {#play-against-an-engine}

**Analisi → Gioca col motore**: scegli un motore della libreria, il tuo colore (o a caso), un
tempo (da 1+0 a 15+10, oppure il motore che pensa 1 o 5 s a mossa senza orologio per te) e,
quando il motore lo offre, una forza: *UCI_Elo* (con l'intervallo che il motore dichiara) o il
suo *Skill Level*. Si può dare una posizione di partenza come FEN. Trascina o clicca i pezzi; le
promozioni chiedono il pezzo. **Ritira la mossa** annulla la tua ultima mossa e la risposta del
motore; **Abbandona**; la partita finisce con matto, stallo, triplice ripetizione, regola delle
cinquanta mosse, materiale insufficiente o tempo. *Mostra la valutazione del motore* è spento
di default (niente anticipazioni). **Salva il PGN** salva la partita in
`<cartella di export>/play` (si vede in Partite); **Analizza la partita** la apre in Analisi
partita.

## 16. Aspetto e navigazione {#look-and-navigation}

La barra laterale raggruppa le schermate: **Test** (tornei, partite in diretta, archivio,
export), **Motori** (libreria, liste CCRL, bench), **Analisi** (analisi partita, test suite) e
**App** (impostazioni, log, aiuto). Clicca il titolo di una sezione per chiuderla; *Solo icone*
restringe la barra per gli schermi piccoli. **Temi dei colori**: l'elenco in fondo alla barra
laterale o *Impostazioni → Aspetto* (con anteprime): **Paper** (il predefinito: sobrio, bianco
caldo), Sistema (segue il sistema operativo), Scuro, Chiaro, il sobrio **Graphite**, Nord,
Midnight (nero puro), Forest, **Coffee** (marroni espresso con un accento caramello), **Szőts**
(per Gabor Szőts), **Bastiii** (panno verde, per Bastiii) e Alto contrasto.
**Lingua**: *Impostazioni → Aspetto → Lingua* (English, Italiano). Il numero accanto a **Live**
nella barra laterale è il numero di partite in corso. Le Impostazioni sono divise in sezioni
(Generali, Aspetto, Percorsi e fastchess, Libri di aperture, Diretta, Topologia CPU,
Manutenzione). Le pagine più piene hanno delle **sotto-schede** in cima all'area principale:
*Nuovo torneo* va per passi (Tipo e motori → Teste di serie per svizzero/coppa → Condizioni →
Core e partite; il riepilogo e i bottoni Crea restano a destra), *Pannello* (Adesso, Coda e
tempi, Recenti ed eventi), *Bench* (Esegui e ultimo risultato, Storico, Calcolo del tempo) e
*Liste CCRL* (Liste, Suggerisci avversari, Abbinamento nomi, Soglie). *Motori → Aggiungi motore*
raccoglie tutti i modi per aggiungere motori.

## 17. Notifiche, aggiornamenti e grafici {#notifications-updates-and-insights}

- **Notifiche sul desktop** (Impostazioni → Generali): un torneo finito o finito con partite
  mancanti, il torneo successivo della coda avviato, un motore andato in crash (al massimo una al
  minuto per torneo), un bench, una test suite o un'analisi partita finiti. Arrivano anche
  mentre TorsGUI è nell'area di notifica.
- **Aggiornamenti**: all'avvio (o con *Impostazioni → Generali → Controlla ora gli
  aggiornamenti*) TorsGUI chiede a GitHub la sua ultima release. Quando ce n'è una più nuova una
  barra propone **Aggiorna ora**: TorsGUI scarica il file adatto al modo in cui è stato
  installato (installer Windows, MSI, cartella portabile, AppImage; un pacchetto Debian si apre
  nel gestore dei pacchetti), ne controlla dimensione e SHA-256, lo installa e riparte. I tornei
  in corso continuano a girare. *Non ora* nasconde la barra fino alla versione successiva.
- Il **grafico Elo** di un torneo mostra come si è mosso l'Elo di un giocatore (il seed di
  default) partita dopo partita, con la sua fascia al 95 %, oppure la sua performance quando gli
  avversari hanno un rating CCRL.
- **Dove si piazza**: il rating del seed da questo test (l'MLE ancorato ai rating CCRL quando gli
  avversari hanno un rating, altrimenti la performance) con la sua fascia al 95 %, disegnato tra
  i vicini della lista CCRL nella sua categoria CPU (8CPU per un seed a 8 thread); la posizione
  che occuperebbe, e la sua voce attuale quando una versione precedente è già in lista (righe
  arancioni: le altre versioni dello stesso motore).
- **Aperture**: ogni apertura del libro con i suoi risultati, il punteggio del Bianco, le patte
  e le coppie (gli stessi due motori con entrambi i colori) che il Bianco o il Nero hanno vinto
  due volte — aperture che decidono la partita più dei motori — o che lo stesso motore ha vinto
  entrambe. Cliccane una per rivedere una partita.

## Tastiera {#keyboard}

`Ctrl K` o `/` palette dei comandi · `g` poi `d t l a e c b x s o r h y p v` per spostarsi (`a` =
Partite, `r` = Per iniziare, `h` = Aiuto, `y` = Analisi partita, `p` = Test suite, `v` = Gioca)
· `n` nuovo torneo · `t` tema dei colori successivo · nel visualizzatore `←` `→` `Home` `Fine`,
`Spazio` avvia/ferma, `f` gira la scacchiera, `t` modalità teatro.

## Ritirare un motore, escludere partite dall'export {#withdrawing-an-engine-leaving-games-out-of-the-export}

- Un motore che continua ad andare in crash si può **ritirare**: metti in pausa o ferma il
  torneo, apri *Configurazione → Motori* e clicca *Ritira*. Le sue partite ancora da giocare
  vengono tolte (gli altri accoppiamenti tengono le loro aperture) e le partite previste vengono
  aggiornate; *Riammetti* annulla. I tornei svizzeri e a eliminazione non possono ritirare motori
  (i turni successivi dipendono da loro).
- L'export CCRL esclude di default le **partite abbandonate** (un motore è andato in crash o ha
  smesso di rispondere) e le partite dei motori ritirati (colonna *Escludi*). Togli la spunta per
  tenerle.
- **Test suite e analisi** fanno girare i motori in modalità analisi UCI (`UCI_AnalyseMode
  true`) quando la dichiarano; le partite dei tornei mai.
