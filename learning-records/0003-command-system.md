# Command system understanding established

The user now understands the command system architecture: the Command interface (validate + execute returning inverse), the CommandDispatcher (single mutation path), the UndoStack (record newest-first, clears on project load), and how undo works (dispatch a new command applying the inverse — no undo() method). Key insight: transactions are atomic with rollback on partial failure, and AI proposals use the same command pipeline. The Engine vs EnginePublic split enforces that only commands can mutate state.
