/**
 * Subagent definitions and orchestration for Ruqenai.
 */

import { SubagentProfile } from '../types/index.js';

export const BUILTIN_SUBAGENTS: Record<string, SubagentProfile> = {
  architect: {
    name: 'Architect',
    role: 'Architecture and design',
    icon: '🏛️',
    color: '#8be9fd',
    capabilities: ['Workspace inspection', 'API design', 'System decomposition'],
    readOnly: true,
    systemPrompt:
      'Map the current system, identify design constraints, and propose a concrete implementation. Inspect the workspace as needed without editing it.',
  },
  coder: {
    name: 'Coder',
    role: 'Implementation and refactoring',
    icon: '💻',
    color: '#50fa7b',
    capabilities: ['Code synthesis', 'Refactoring', 'Bug fixing'],
    systemPrompt:
      'Implement the requested change using the existing code conventions. Read relevant files first, make targeted edits, and verify the change.',
  },
  debugger: {
    name: 'Debugger',
    role: 'Debugging and diagnostics',
    icon: '🔍',
    color: '#ff5555',
    capabilities: ['Error diagnostics', 'Stack trace analysis', 'Race condition detection'],
    systemPrompt:
      'Identify the cause of software failures using logs, code, and local checks. Apply and verify a focused fix when requested.',
  },
  reviewer: {
    name: 'Reviewer',
    role: 'Code review',
    icon: '🛡️',
    color: '#ffb86c',
    capabilities: ['Correctness review', 'Defensive security review', 'Performance review'],
    readOnly: true,
    systemPrompt:
      'Review the requested code for correctness and security issues. Prioritize actionable findings with file and line references. Do not edit the workspace.',
  },
  researcher: {
    name: 'Researcher',
    role: 'Codebase research',
    icon: '🔬',
    color: '#bd93f9',
    capabilities: ['File indexing', 'Symbol lookup', 'Documentation synthesis'],
    readOnly: true,
    systemPrompt:
      'Trace symbols and behavior through source and local documentation. Cite relevant files and clearly identify gaps. Do not edit the workspace.',
  },
};

export class SubagentManager {
  private readonly roster = new Map(Object.entries(BUILTIN_SUBAGENTS));

  public list(): SubagentProfile[] {
    return [...this.roster.values()];
  }

  public get(name: string): SubagentProfile | undefined {
    return this.roster.get(name.toLowerCase());
  }

  public register(profile: SubagentProfile): void {
    this.roster.set(profile.name.toLowerCase(), profile);
  }
}

export const subagentManager = new SubagentManager();
