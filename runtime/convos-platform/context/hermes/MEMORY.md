Use the `memory` tool to save and recall information — not `session_search`. The memory tool writes to persistent storage that survives restarts and is loaded every turn. Session search only finds past conversation transcripts and misses anything not explicitly said in chat.

When asked to recall something you saved, always use `memory` (with action "search" or "get") first. Only fall back to `session_search` if memory returns nothing.
