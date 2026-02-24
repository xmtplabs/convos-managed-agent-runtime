# Convos Agents Scaling Plan

**Date:** 2026-02-23
**Status:** In Progress

This plan covers multi-project sharding (one Railway project per agent + GHCR), portable agent instances (templates + cloning), and a product dashboard.

**Target architecture:** [architecture.md](./architecture.md)

---

## Phases

| Phase | Name | Status | Details |
|-------|------|--------|---------|
| 0 | [GHCR CI Pipeline](./phase-0-ghcr.md) | **Complete** | Pre-built runtime images on GitHub Container Registry |
| 1 | [DB Migration](./phase-1-db-migration.md) | Planned | Pool `instances` table, atomic claim, validate end-to-end |
| 2 | [Extract Services + Sharding](./phase-2-services.md) | Planned | Services deployable, one-project-per-agent |
| 3 | [Dashboard (React + Vite + TypeScript)](./phase-3-dashboard.md) | Planned | Product UI built against pool APIs, TypeScript codebase |
| 4 | [Templates](./phase-4-templates.md) | Planned | `agent_templates` table, template-aware claiming |
