# Why each piece exists

The shape comes from running one vault for months with several assistants on two machines. Each piece is there because something went wrong without it.

| Piece | Without it |
|---|---|
| **One router, read first** | Every session started by searching. Assistants found an old note before the current one and acted on stale facts. A front door that *points* (never copies) means one place to start and one place to fix |
| **Router under 8 KB** | A front door that grows becomes a warehouse; sessions spend their context reading it and still miss things. Detail moves to a topic home and leaves a pointer |
| **Standing rules with their origin** | Rules with no origin get argued with or quietly dropped. "(owner, 2026-01-10, after the lost draft)" says why it's there and whether it still applies |
| **"Now" pointer table** | Two notes said different things about the same topic. Each topic gets one home; the table says which, and when it was last brought up to date |
| **In flight** | Work started in one session was forgotten by the next. A short table of open jobs, removed when done |
| **Day logs split by machine** | Two machines appended to the same day log through the sync, and one machine's lines vanished. One file per machine per day can't collide |
| **Logs vs topic homes** | Notes turned into diaries and nobody could tell what was true now. Logs say what happened; homes say what is true now |
| **Third time gets a home** | Important subjects lived only in scattered log lines. The third separate day a subject comes up, it gets a note |
| **Single-writer CORE** | Two assistants edited the facts about the owner at once and each undid the other's change |
| **Append-only, signed inbox** | Other agents had no safe way to contribute. They append; the one writer files. A signature says who to ask |
| **DECISIONS, newest first, with "Applied in"** | A decision got made, then three notes kept stating the old answer. A decision isn't logged until those notes are fixed |
| **LESSONS** | The same mistake, twice. A caught mistake becomes a one-line rule; a lesson that keeps coming back moves into the router |
| **KEY-INDEX, names and places only** | Assistants asked for keys they couldn't find, or keys got pasted into notes. Now the vault knows *which* key and *where*, and never the key |
| **files/ with `_unsorted/`** | Attachments landed everywhere. Anyone may add; nobody edits another's file; unsure goes to `_unsorted/` and gets filed |
| **reports/** | One-off sessions (a coding run, a research task) wrote all over the vault. They get one folder |
| **Wrap-up routine** | Things learned in a session lived only in the chat and were lost when it ended. Write as you go; wrap-up checks nothing was missed |

## What to change for yourself
- Rename anything, but keep the roles: one front door, one writer per file, logs vs homes, names-not-values for keys.
- Add your own standing rules to the router as they come up, each with its origin.
- Add tag families if you like (one per note). The template uses `#vault`, `#topic`, `#log`.
