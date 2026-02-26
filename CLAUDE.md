<!-- maestronexus:start -->
# MaestroNexus MCP

This project is indexed by MaestroNexus as **MaestroNexusV2** (1348 symbols, 3469 relationships, 104 execution flows).

MaestroNexus provides a knowledge graph over this codebase — call chains, blast radius, execution flows, and semantic search.

## Always Start Here

For any task involving code understanding, debugging, impact analysis, or refactoring, you must:

1. **Read `maestronexus://repo/{name}/context`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run `npx maestronexus analyze` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/maestronexus/maestronexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/maestronexus/maestronexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/maestronexus/maestronexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/maestronexus/maestronexus-refactoring/SKILL.md` |

## Tools Reference

| Tool | What it gives you |
|------|-------------------|
| `query` | Process-grouped code intelligence — execution flows related to a concept |
| `context` | 360-degree symbol view — categorized refs, processes it participates in |
| `impact` | Symbol blast radius — what breaks at depth 1/2/3 with confidence |
| `detect_changes` | Git-diff impact — what do your current changes affect |
| `rename` | Multi-file coordinated rename with confidence-tagged edits |
| `cypher` | Raw graph queries (read `maestronexus://repo/{name}/schema` first) |
| `list_repos` | Discover indexed repos |

## Resources Reference

Lightweight reads (~100-500 tokens) for navigation:

| Resource | Content |
|----------|---------|
| `maestronexus://repo/{name}/context` | Stats, staleness check |
| `maestronexus://repo/{name}/clusters` | All functional areas with cohesion scores |
| `maestronexus://repo/{name}/cluster/{clusterName}` | Area members |
| `maestronexus://repo/{name}/processes` | All execution flows |
| `maestronexus://repo/{name}/process/{processName}` | Step-by-step trace |
| `maestronexus://repo/{name}/schema` | Graph schema for Cypher |

## Graph Schema

**Nodes:** File, Function, Class, Interface, Method, Community, Process
**Edges (via CodeRelation.type):** CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "myFunc"})
RETURN caller.name, caller.filePath
```

<!-- maestronexus:end -->