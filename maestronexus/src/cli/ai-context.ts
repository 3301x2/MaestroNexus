/**
 * AI Context Generator
 * 
 * Creates AGENTS.md and CLAUDE.md with full inline MaestroNexus context.
 * AGENTS.md is the standard read by Cursor, Windsurf, OpenCode, Cline, etc.
 * CLAUDE.md is for Claude Code which only reads that file.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface RepoStats {
  files?: number;
  nodes?: number;
  edges?: number;
  communities?: number;
  clusters?: number;       // Aggregated cluster count (what tools show)
  processes?: number;
}

const MAESTRONEXUS_START_MARKER = '<!-- maestronexus:start -->';
const MAESTRONEXUS_END_MARKER = '<!-- maestronexus:end -->';

/**
 * Generate the full MaestroNexus context content.
 * 
 * Design principles (learned from real agent behavior):
 * - AGENTS.md is the ROUTER — it tells the agent WHICH skill to read
 * - Skills contain the actual workflows — AGENTS.md does NOT duplicate them
 * - Bold **IMPORTANT** block + "Skills — Read First" heading — agents skip soft suggestions
 * - One-line quick start (read context resource) gives agents an entry point
 * - Tools/Resources sections are labeled "Reference" — agents treat them as lookup, not workflow
 */
function generateMaestroNexusContent(projectName: string, stats: RepoStats): string {
  return `${MAESTRONEXUS_START_MARKER}
# MaestroNexus MCP

This project is indexed by MaestroNexus as **${projectName}** (${stats.nodes || 0} symbols, ${stats.edges || 0} relationships, ${stats.processes || 0} execution flows).

## Always Start Here

1. **Read \`maestronexus://repo/{name}/context\`** — codebase overview + check index freshness
2. **Match your task to a skill below** and **read that skill file**
3. **Follow the skill's workflow and checklist**

> If step 1 warns the index is stale, run \`npx maestronexus analyze\` in the terminal first.

## Skills

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | \`.claude/skills/maestronexus/maestronexus-exploring/SKILL.md\` |
| Blast radius / "What breaks if I change X?" | \`.claude/skills/maestronexus/maestronexus-impact-analysis/SKILL.md\` |
| Trace bugs / "Why is X failing?" | \`.claude/skills/maestronexus/maestronexus-debugging/SKILL.md\` |
| Rename / extract / split / refactor | \`.claude/skills/maestronexus/maestronexus-refactoring/SKILL.md\` |
| Tools, resources, schema reference | \`.claude/skills/maestronexus/maestronexus-guide/SKILL.md\` |
| Index, status, clean, wiki CLI commands | \`.claude/skills/maestronexus/maestronexus-cli/SKILL.md\` |

${MAESTRONEXUS_END_MARKER}`;
}


/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create or update MaestroNexus section in a file
 * - If file doesn't exist: create with MaestroNexus content
 * - If file exists without MaestroNexus section: append
 * - If file exists with MaestroNexus section: replace that section
 */
async function upsertMaestroNexusSection(
  filePath: string,
  content: string
): Promise<'created' | 'updated' | 'appended'> {
  const exists = await fileExists(filePath);

  if (!exists) {
    await fs.writeFile(filePath, content, 'utf-8');
    return 'created';
  }

  const existingContent = await fs.readFile(filePath, 'utf-8');

  // Check if MaestroNexus section already exists
  const startIdx = existingContent.indexOf(MAESTRONEXUS_START_MARKER);
  const endIdx = existingContent.indexOf(MAESTRONEXUS_END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    // Replace existing section
    const before = existingContent.substring(0, startIdx);
    const after = existingContent.substring(endIdx + MAESTRONEXUS_END_MARKER.length);
    const newContent = before + content + after;
    await fs.writeFile(filePath, newContent.trim() + '\n', 'utf-8');
    return 'updated';
  }

  // Append new section
  const newContent = existingContent.trim() + '\n\n' + content + '\n';
  await fs.writeFile(filePath, newContent, 'utf-8');
  return 'appended';
}

/**
 * Install MaestroNexus skills to .claude/skills/maestronexus/
 * Works natively with Claude Code, Cursor, and GitHub Copilot
 */
async function installSkills(repoPath: string): Promise<string[]> {
  const skillsDir = path.join(repoPath, '.claude', 'skills', 'maestronexus');
  const installedSkills: string[] = [];

  // Skill definitions bundled with the package
  const skills = [
    {
      name: 'maestronexus-exploring',
      description: 'Navigate unfamiliar code using MaestroNexus knowledge graph',
    },
    {
      name: 'maestronexus-debugging',
      description: 'Trace bugs through call chains using knowledge graph',
    },
    {
      name: 'maestronexus-impact-analysis',
      description: 'Analyze blast radius before making code changes',
    },
    {
      name: 'maestronexus-refactoring',
      description: 'Plan safe refactors using blast radius and dependency mapping',
    },
    {
      name: 'maestronexus-guide',
      description: 'MaestroNexus quickstart — tools, resources, schema, and workflow reference',
    },
    {
      name: 'maestronexus-cli',
      description: 'MaestroNexus CLI commands — index, status, clean, and wiki generation',
    },
  ];

  for (const skill of skills) {
    const skillDir = path.join(skillsDir, skill.name);
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      // Create skill directory
      await fs.mkdir(skillDir, { recursive: true });

      // Try to read from package skills directory
      const packageSkillPath = path.join(__dirname, '..', '..', 'skills', `${skill.name}.md`);
      let skillContent: string;

      try {
        skillContent = await fs.readFile(packageSkillPath, 'utf-8');
      } catch {
        // Fallback: generate minimal skill content
        skillContent = `---
name: ${skill.name}
description: ${skill.description}
---

# ${skill.name.charAt(0).toUpperCase() + skill.name.slice(1)}

${skill.description}

Use MaestroNexus tools to accomplish this task.
`;
      }

      await fs.writeFile(skillPath, skillContent, 'utf-8');
      installedSkills.push(skill.name);
    } catch (err) {
      // Skip on error, don't fail the whole process
      console.warn(`Warning: Could not install skill ${skill.name}:`, err);
    }
  }

  return installedSkills;
}

/**
 * Generate AI context files after indexing
 */
export async function generateAIContextFiles(
  repoPath: string,
  _storagePath: string,
  projectName: string,
  stats: RepoStats
): Promise<{ files: string[] }> {
  const content = generateMaestroNexusContent(projectName, stats);
  const createdFiles: string[] = [];

  // Create AGENTS.md (standard for Cursor, Windsurf, OpenCode, Cline, etc.)
  const agentsPath = path.join(repoPath, 'AGENTS.md');
  const agentsResult = await upsertMaestroNexusSection(agentsPath, content);
  createdFiles.push(`AGENTS.md (${agentsResult})`);

  // Create CLAUDE.md (for Claude Code)
  const claudePath = path.join(repoPath, 'CLAUDE.md');
  const claudeResult = await upsertMaestroNexusSection(claudePath, content);
  createdFiles.push(`CLAUDE.md (${claudeResult})`);

  // Install skills to .claude/skills/maestronexus/
  const installedSkills = await installSkills(repoPath);
  if (installedSkills.length > 0) {
    createdFiles.push(`.claude/skills/maestronexus/ (${installedSkills.length} skills)`);
  }

  return { files: createdFiles };
}

