/**
 * Dynamic Skills Manager and Creator for Ruqenai.
 * Discovers built-in skills and saves user-authored workspace workflows.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SkillDefinition } from '../types/index.js';

const GLOBAL_SKILLS_DIR = path.join(os.homedir(), '.ruqenai', 'skills');

export const BUILTIN_SKILLS: SkillDefinition[] = [
  {
    name: 'computer-use',
    description: 'Operate the visible Windows desktop with screenshots, mouse actions, scrolling and shortcuts.',
    version: '1.1.0',
    author: 'Ruqenai AI',
    tags: ['desktop', 'computer', 'visual'],
    instructions: `Use the computer_use tool for a requested desktop task. Start with screenshot and inspect the returned image before choosing coordinates. After each click, key, scroll or drag, inspect the new screenshot before the next action. Use key for shortcuts such as Ctrl+S; use key_down and key_up only when a held key is necessary. Esc cancels control. If a model cannot see images, tell the user to switch to a vision-capable model. Never enter secrets seen on screen into chat, and never send a message to someone else unless the user explicitly authorized it. Stop when the task is done or canceled.`,
  },
  {
    name: 'code-review',
    description: 'Comprehensive AST, security vulnerability, and code quality review.',
    version: '1.0.0',
    author: 'Ruqenai AI',
    tags: ['review', 'security', 'quality'],
    instructions: `
1. Analyze the target code or git diff.
2. Check for security vulnerabilities: injection, insecure deserialization, credentials exposure.
3. Review code readability, SOLID principles, and error handling.
4. Provide structured feedback with high-priority recommendations.
    `.trim(),
  },
  {
    name: 'refactor-master',
    description: 'Refactor complex code into clean, modular, and maintainable structures.',
    version: '1.0.0',
    author: 'Ruqenai AI',
    tags: ['refactor', 'clean-code', 'maintainability'],
    instructions: `
1. Identify code smells and duplication.
2. Extract helper functions and apply design patterns.
3. Guarantee existing behavior is preserved.
4. Output concise code diffs.
    `.trim(),
  },
  {
    name: 'ponytail',
    description: 'Lazy senior dev mode: the smallest change that fully solves the task, and a reply a busy human understands in one read.',
    version: '1.0.0',
    author: 'Ruqenai AI',
    tags: ['minimal', 'yagni', 'efficient'],
    instructions: `
You are a lazy senior developer. The best code is the code never written. Solve the whole problem with the least new code. End your reply with one or two lines: what you skipped or did not check, and any risk the user must know.

Before you write: read the task and the code it touches. List every place the change must reach: callers, tests, fixtures, config, exports. Check what it could break. That is scope. Extra features are not.

The smallest complete change — take the first option that fully works:
1. Does it need to exist? Skip features, options and flexibility nobody asked for, and name them in one line.
2. Already in this codebase? Use it the way the surrounding code does.
3. Standard library or platform feature? Use it.
4. An installed dependency? Use it. Never add a dependency for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

Be lazy about the solution, never about the change itself: finish every part the task needs, including callers, tests and fixtures it breaks.
No abstraction, wrapper, option, config, boilerplate or "for later" code nobody asked for. Deletion beats addition. Keep the structure the codebase already has.
Bug fix: before you edit, search every caller of the function you touch, then fix the root cause once in the shared code.
New non-trivial logic leaves one small test or assert-based self-check. Trivial changes need none.
A shortcut with a known limit gets a comment: shortcut: <the limit>, <when to upgrade>.

Never cut: validation at trust boundaries, error handling that prevents data loss, security, accessibility, anything the user asked for.
    `.trim(),
  },
  {
    name: 'test-forge',
    description: 'Generate comprehensive unit and integration test suites.',
    version: '1.0.0',
    author: 'Ruqenai AI',
    tags: ['testing', 'unit-tests', 'coverage'],
    instructions: `
1. Inspect public APIs and edge conditions.
2. Generate tests covering normal, boundary, and error cases.
3. Follow the test framework convention of the workspace (Jest, Vitest, PyTest).
    `.trim(),
  },
];

/** Split optional `---` YAML frontmatter from the markdown body. */
export function parseSkillMarkdown(content: string): { frontmatter: string; description?: string; instructions: string } {
  const source = content.replace(/^\uFEFF/, '');
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = match?.[1] ?? '';
  const body = (match ? source.slice(match[0].length) : source).trim();
  const rawDescription = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  const description = rawDescription?.replace(/^['"]|['"]$/g, '');
  return { frontmatter, description, instructions: body };
}

export class SkillsManager {
  private skills: Map<string, SkillDefinition> = new Map();

  constructor() {
    this.reload();
  }

  public reload(): void {
    this.skills.clear();

    // 1. Load Builtin
    for (const b of BUILTIN_SKILLS) {
      this.skills.set(b.name.toLowerCase(), b);
    }

    // 2. Load Global
    if (!fs.existsSync(GLOBAL_SKILLS_DIR)) {
      try {
        fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });
      } catch {}
    } else {
      let files: fs.Dirent[];
      try { files = fs.readdirSync(GLOBAL_SKILLS_DIR, { withFileTypes: true }); } catch { return; }
      for (const entry of files) {
        if (entry.isDirectory()) {
          this.loadSkillDirectory(path.join(GLOBAL_SKILLS_DIR, entry.name));
          continue;
        }
        if (!entry.isFile() || !/\.(md|json)$/.test(entry.name)) continue;
        const filePath = path.join(GLOBAL_SKILLS_DIR, entry.name);
        const name = entry.name.replace(/\.(md|json)$/, '');
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) continue;
        try {
          if (fs.statSync(filePath).size > 32_000) continue;
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = parseSkillMarkdown(content);
          this.skills.set(name.toLowerCase(), {
            name,
            description: parsed.description ?? 'Custom user skill',
            version: '1.0.0',
            author: parsed.frontmatter.match(/^author:\s*(.+)$/m)?.[1] ?? 'User',
            instructions: parsed.instructions,
            filePath,
          });
        } catch {}
      }
    }
  }

  /**
   * Load a folder skill: `<name>/SKILL.md` (any case) plus optional reference
   * files, scripts, and assets that live beside it.
   */
  private loadSkillDirectory(dirPath: string): void {
    const folder = path.basename(dirPath);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(folder)) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    const manifest = entries.find((entry) => entry.isFile() && /^skill\.md$/i.test(entry.name));
    const skillFile = manifest ? path.join(dirPath, manifest.name) : path.resolve(dirPath, 'SKILL.md');
    if (!manifest && !fs.existsSync(skillFile)) return;
    let content: string;
    try {
      if (fs.statSync(skillFile).size > 64_000) return;
      content = fs.readFileSync(skillFile, 'utf-8');
    } catch { return; }

    const parsed = parseSkillMarkdown(content);
    if (!parsed.instructions) return;
    const parts = (parsed.frontmatter.match(/^name:\s*(.+)$/m)?.[1] ?? folder).trim().replace(/^['"]|['"]$/g, '');
    const name = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(parts) ? parts : folder;
    const tags = parsed.frontmatter.match(/^tags:\s*(.+)$/m)?.[1];

    const instructions = `${parsed.instructions}

Skill files: ${dirPath}
Read the reference files in this folder with absolute paths before improvising; run helper scripts from here when the workflow calls for them.`.trim();

    this.skills.set(name.toLowerCase(), {
      name,
      description: parsed.description ?? `Folder skill ${folder}`,
      version: '1.0.0',
      author: parsed.frontmatter.match(/^author:\s*(.+)$/m)?.[1] ?? 'User',
      instructions,
      tags: tags ? tags.replace(/^\[|\]$/g, '').split(',').map((tag) => tag.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : undefined,
      filePath: skillFile,
      dirPath,
    });
  }

  public list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  public get(name: string): SkillDefinition | undefined {
    return this.skills.get(name.toLowerCase());
  }

  public targetPath(name: string): string {
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
      throw new Error('Use a skill name of 1–64 letters, digits, hyphens, or underscores.');
    }
    return path.join(GLOBAL_SKILLS_DIR, `${slug}.md`);
  }

  public createSkill(name: string, description: string, instructions: string, tags: string[] = []): SkillDefinition {
    const filePath = this.targetPath(name);
    const cleanName = path.basename(filePath, '.md');
    if (this.get(cleanName)) throw new Error(`Skill already exists: ${cleanName}`);
    if (!description.trim() || !instructions.trim() || Buffer.byteLength(instructions) > 30_000) {
      throw new Error('Provide a description and skill instructions no larger than 30 KB.');
    }
    fs.mkdirSync(GLOBAL_SKILLS_DIR, { recursive: true });

    const fileContent = `---
name: ${cleanName}
description: ${description.trim().replace(/[\r\n]+/g, ' ')}
version: 1.0.0
author: Ruqenai AI
tags: ${JSON.stringify(tags)}
---

# ${name} Skill

${instructions}
`;

    fs.writeFileSync(filePath, fileContent, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });

    const skill: SkillDefinition = {
      name: cleanName,
      description,
      version: '1.0.0',
      author: 'Ruqenai AI',
      instructions,
      tags,
      filePath,
    };

    this.skills.set(cleanName, skill);
    return skill;
  }
}

export const skillsManager = new SkillsManager();
