---
name: maestronexus-cli
description: MaestroNexus CLI commands — index, status, clean, and wiki generation
---

# MaestroNexus CLI Commands

All commands work via `npx` — no global install required.

## Commands

### analyze — Build or refresh the index

```bash
npx maestronexus analyze
```

Run from the project root. This parses all source files, builds the knowledge graph, writes it to `.maestronexus/`, and generates CLAUDE.md / AGENTS.md context files.

| Flag           | Effect                                                           |
| -------------- | ---------------------------------------------------------------- |
| `--force`      | Force full re-index even if up to date                           |
| `--embeddings` | Enable embedding generation for semantic search (off by default) |

**When to run:** First time in a project, after major code changes, or when `maestronexus://repo/{name}/context` reports the index is stale.

### status — Check index freshness

```bash
npx maestronexus status
```

Shows whether the current repo has a MaestroNexus index, when it was last updated, and symbol/relationship counts. Use this to check if re-indexing is needed.

### clean — Delete the index

```bash
npx maestronexus clean
```

Deletes the `.maestronexus/` directory and unregisters the repo from the global registry. Use before re-indexing if the index is corrupt or after removing MaestroNexus from a project.

| Flag      | Effect                                            |
| --------- | ------------------------------------------------- |
| `--force` | Skip confirmation prompt                          |
| `--all`   | Clean all indexed repos, not just the current one |

### wiki — Generate documentation from the graph

```bash
npx maestronexus wiki
```

Generates repository documentation from the knowledge graph using an LLM. Requires an API key (saved to `~/.maestronexus/config.json` on first use).

| Flag                | Effect                                    |
| ------------------- | ----------------------------------------- |
| `--force`           | Force full regeneration                   |
| `--model <model>`   | LLM model (default: minimax/minimax-m2.5) |
| `--base-url <url>`  | LLM API base URL                          |
| `--api-key <key>`   | LLM API key                               |
| `--concurrency <n>` | Parallel LLM calls (default: 3)           |
| `--gist`            | Publish wiki as a public GitHub Gist      |

### list — Show all indexed repos

```bash
npx maestronexus list
```

Lists all repositories registered in `~/.maestronexus/registry.json`. The MCP `list_repos` tool provides the same information.

## After Indexing

1. **Read `maestronexus://repo/{name}/context`** to verify the index loaded
2. Use the other MaestroNexus skills (`exploring`, `debugging`, `impact-analysis`, `refactoring`) for your task

## Troubleshooting

- **"Not inside a git repository"**: Run from a directory inside a git repo
- **Index is stale after re-analyzing**: Restart Claude Code to reload the MCP server
- **Embeddings slow**: Omit `--embeddings` (it's off by default) or set `OPENAI_API_KEY` for faster API-based embedding
