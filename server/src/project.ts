import fs from 'node:fs';
import path from 'node:path';

export interface ResolvedProject {
  /** Directory name of the main repository, not the linked-worktree name */
  name: string;
  /** Stable grouping key for project statistics */
  root: string;
}

const HOST_MOUNT = `${path.sep}host`;

function withoutHostMount(value: string): string {
  if (value === HOST_MOUNT) return path.sep;
  return value.startsWith(`${HOST_MOUNT}${path.sep}`)
    ? value.slice(HOST_MOUNT.length)
    : value;
}

function repositoryRoot(candidate: string): string | null {
  let current = path.resolve(candidate);

  while (true) {
    const dotGit = path.join(current, '.git');
    try {
      const stat = fs.statSync(dotGit);
      if (stat.isDirectory()) return withoutHostMount(current);
      if (stat.isFile()) {
        const pointer = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)\s*$/m)?.[1];
        if (pointer) {
          const gitDir = path.resolve(current, pointer);
          const commonFile = path.join(gitDir, 'commondir');
          try {
            const common = fs.readFileSync(commonFile, 'utf8').trim();
            const commonDir = path.resolve(gitDir, common);
            if (path.basename(commonDir) === '.git') {
              return withoutHostMount(path.dirname(commonDir));
            }
          } catch {
            // Older worktree metadata may lack commondir; fall through to
            // the conventional <repo>/.git/worktrees/<name> path shape.
          }

          const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
          const markerAt = gitDir.indexOf(marker);
          if (markerAt !== -1) return withoutHostMount(gitDir.slice(0, markerAt));
        }
        // A .git file can also identify a submodule. In that case the current
        // directory, rather than the superproject's internal gitdir, is its name.
        return withoutHostMount(current);
      }
    } catch {
      // Missing/deleted worktree: keep walking in case an ancestor is the repo.
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function pathShapeFallback(cwd: string): ResolvedProject | null {
  for (const agent of ['claude', 'codex']) {
    const marker = `${path.sep}.${agent}${path.sep}worktrees${path.sep}`;
    const markerAt = cwd.indexOf(marker);
    if (markerAt !== -1) {
      const root = cwd.slice(0, markerAt);
      return { name: path.basename(root), root };
    }
  }

  const orcaMarker = `${path.sep}orca${path.sep}workspaces${path.sep}`;
  const orcaAt = cwd.indexOf(orcaMarker);
  if (orcaAt !== -1) {
    const prefixEnd = orcaAt + orcaMarker.length;
    const name = cwd.slice(prefixEnd).split(path.sep)[0];
    if (name) return { name, root: cwd.slice(0, prefixEnd) + name };
  }
  return null;
}

/** Resolve a transcript cwd to its logical/main repository identity. */
export function resolveProject(cwd: string): ResolvedProject {
  const normalized = path.normalize(cwd || '(unknown)');
  const candidates = [normalized];
  if (path.isAbsolute(normalized)) candidates.push(path.join(HOST_MOUNT, normalized));

  for (const candidate of candidates) {
    const root = repositoryRoot(candidate);
    if (root) return { name: path.basename(root), root };
  }

  return (
    pathShapeFallback(normalized) ?? {
      name: path.basename(normalized) || normalized,
      root: normalized,
    }
  );
}
