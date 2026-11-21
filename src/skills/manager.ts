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
        if (!entry.isFile() || !/\.(md|json)$/.test(entry.name)) continue;
        const filePath = path.join(GLOBAL_SKILLS_DIR, entry.name);
        const name = entry.name.replace(/\.(md|json)$/, '');
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) continue;
        try {
          if (fs.statSync(filePath).size > 32_000) continue;
          const content = fs.readFileSync(filePath, 'utf-8');
          const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
          const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1];
          const instructions = frontmatter ? content.slice(frontmatter[0].length).trim() : content;
          this.skills.set(name.toLowerCase(), {
            name,
            description: description ?? 'Custom user skill',
            version: '1.0.0',
            author: frontmatter?.[1].match(/^author:\s*(.+)$/m)?.[1] ?? 'User',
            instructions,
            filePath,
          });
        } catch {}
      }
    }
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
