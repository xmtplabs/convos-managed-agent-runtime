---
name: exa-search
description: |
  Web search returning structured results (title, URL, snippet, text).
  USE WHEN: Searching the web for information, articles, venues, or resources. Research without needing to interact with results.
  DON'T USE WHEN: Need to interact with or navigate search results (use smooth-browser). Booking or form-filling flows (use smooth-browser).
  INPUTS: Query string, optional count/time range. OUTPUTS: JSON array of results.
metadata: {"openclaw":{"emoji":"🔎","requires":{"bins":["node"],"env":["EXA_API_KEY"]},"primaryEnv":"EXA_API_KEY","homepage":"https://exa.ai/docs"}}
---

# Exa Search

Use Exa’s Search API via the bundled script.

## Requirements

- Set `EXA_API_KEY` in the Gateway environment (recommended) or in `~/.openclaw/.env`.

## Commands

- Run a search:
  - `node {baseDir}/scripts/exa_search.mjs "<query>" --count 5`

- Include page text in results (costs more):
  - `node {baseDir}/scripts/exa_search.mjs "<query>" --count 5 --text`

- Narrow by time window:
  - `--start 2025-01-01 --end 2026-02-04`

## Notes

- This skill does not modify `web_search`; it provides an Exa-backed alternative you can invoke when you specifically want Exa.
