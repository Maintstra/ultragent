// Tool guard shared by both workers. It is a regex filter, not a sandbox.
import { isAbsolute, relative, resolve } from 'node:path';

export const BLOCKED_COMMANDS = [
  [/\bgit\s+push\b/i, 'git push is not allowed; the manager reviews and pushes'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s|stash\s+(drop|clear))/i, 'destructive git commands are not allowed'],
  [/\b(npm|pnpm|yarn)\s+publish\b/i, 'publishing packages is not allowed'],
  [/\b(eas|vercel|netlify|fly|railway|wrangler|firebase)\s+(build|deploy|submit|publish|up)\b/i, 'builds/deploys to hosted services are not allowed'],
  [/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i, 'network downloads are not allowed; ask the manager'],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|[A-Za-z]:[\\/]?\s*$)/i, 'recursive delete of a root path is not allowed'],
  [/\bRemove-Item\b[^|;]*-Recurse/i, 'recursive Remove-Item is not allowed'],
  [/\b(setx|reg\s+add|Set-ItemProperty|netsh|schtasks)\b/i, 'system settings changes are not allowed'],
  [/\b(ssh|scp|gh\s+(pr|release|repo)\s+create|gh\s+api)\b/i, 'remote operations are not allowed'],
];

// Returns a reason string when a tool call must be blocked, otherwise null.
export function makeGuard(writableRoots) {
  const inside = (p) => {
    const abs = resolve(p);
    return writableRoots.some((root) => {
      const rel = relative(root, abs);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
  };
  return (toolName, input = {}) => {
    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const cmd = String(input.command ?? '');
      for (const [re, why] of BLOCKED_COMMANDS) if (re.test(cmd)) return why;
      if (/\.env\b/i.test(cmd) && /\b(cat|type|Get-Content|gc|more|less|head|tail|grep|rg|Select-String|sls|findstr|node|python)\b/i.test(cmd)) return '.env files are off limits';
      return null;
    }
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
      const p = String(input.file_path ?? input.notebook_path ?? '');
      if (!p || !inside(p)) return `Writes are limited to: ${writableRoots.join(', ')}`;
      if (/(^|[\\/])\.env(\.|$)/i.test(p)) return '.env files are off limits';
      return null;
    }
    if (toolName === 'Read' && /(^|[\\/])\.env(\.|$)/i.test(String(input.file_path ?? ''))) return '.env files are off limits';
    return null;
  };
}
