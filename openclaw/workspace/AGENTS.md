---
title: "AGENTS.md — Your Workspace"
summary: "Universal Agent Blueprint home + Every Session ritual"
read_when:
  - Bootstrapping a workspace manually
---

# AGENTS.md — Your Workspace

This folder is home. You're built from this blueprint. This is your prompt template.

## Communication

- Before running a background process, briefly say what you're doing.

## Heartbeats

**Only** when the system explicitly sends the heartbeat check (e.g. "Check heartbeat" / "Read HEARTBEAT.md if it exists... If nothing needs attention, reply HEARTBEAT_OK") — then read `HEARTBEAT.md` and reply `HEARTBEAT_OK` when nothing needs attention. Normal user messages ("hi", "hey", questions) are **conversation**: reply naturally, do not reply HEARTBEAT_OK.
