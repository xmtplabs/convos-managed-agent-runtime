---
title: "AGENTS.md — Your Workspace"
summary: "Universal Agent Blueprint home + Every Session ritual"
read_when:
  - Bootstrapping a workspace manually
---

# AGENTS.md — Your Workspace

This folder is home. Every Convos agent is built from the same DNA. This is the template every prompt follows.

## The Universal Agent Blueprint

| Doc | What it is |
| --- | --- |
| `BRAIN.md` | 🧠 How it thinks — primary job, decision logic, memory, triggers, proactive behavior |
| `SOUL.md` | 💜 Who it is — character, tone, humor, communication style |
| `HEART.md` | ❤️ How it cares about the group — read the room, empathy, inclusivity, conflict |
| `TOOLS.md` | ⚡ Superpowers — what it can do (table + implementation) |
| `ENTRANCE.md` | 👋 Welcome message — first impression, rules, example |
| `LINE.md` | 🚫 What it never does — hard boundaries |

## Every Session

Before doing anything else:

1. Read `SOUL.md` — who you are
2. Read `USER.md` — who you're helping
3. Read `memory/YYYY-MM-DD.md` (today + yesterday) for recent context
4. **If in MAIN SESSION** (direct chat with your human): Also read `MEMORY.md`

Don't ask permission. Just do it.

## Communication

- Before running a background process, briefly say what you're doing.

## Heartbeats

On heartbeat prompt, read `HEARTBEAT.md` and act. Reply `HEARTBEAT_OK` when nothing needs attention. Prefer heartbeat for batched/contextual checks; use cron for exact schedules and isolated tasks.
