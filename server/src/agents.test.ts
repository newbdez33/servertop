import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ClaudeScanner } from './claude.js';
import { CodexScanner } from './codex.js';
import { resolveProject } from './project.js';

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

test('project resolver uses the main repository name for linked worktrees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'servertop-project-'));
  try {
    const main = path.join(root, 'original-project');
    const gitDir = path.join(main, '.git');
    const worktree = path.join(root, 'random-worktree-name');
    const worktreeGitDir = path.join(gitDir, 'worktrees', 'random-worktree-name');
    fs.mkdirSync(worktreeGitDir, { recursive: true });
    fs.mkdirSync(worktree, { recursive: true });
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${worktreeGitDir}\n`);
    fs.writeFileSync(path.join(worktreeGitDir, 'commondir'), '../..\n');

    assert.deepEqual(resolveProject(worktree), {
      name: 'original-project',
      root: main,
    });
    assert.equal(
      resolveProject('/Users/test/orca/workspaces/token-beats/temporary-branch').name,
      'token-beats',
    );
    assert.equal(
      resolveProject('/Users/test/projects/office-admin/.claude/worktrees/fix-123').name,
      'office-admin',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Claude reports the latest real prompt and running/wait turn state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'servertop-claude-'));
  try {
    const projectDir = path.join(root, 'projects', '-tmp-project');
    fs.mkdirSync(projectDir, { recursive: true });
    const transcript = path.join(projectDir, 'session.jsonl');
    fs.writeFileSync(
      transcript,
      [
        {
          type: 'user',
          timestamp: '2026-08-30T10:00:00.000Z',
          cwd: '/tmp/project',
          gitBranch: 'main',
          isMeta: false,
          isSidechain: false,
          message: { content: 'First Claude prompt' },
        },
        {
          type: 'assistant',
          isSidechain: false,
          message: { content: [{ type: 'text', text: 'First answer' }], stop_reason: 'end_turn' },
        },
        { type: 'system', subtype: 'turn_duration', messageCount: 2 },
        {
          type: 'user',
          isMeta: false,
          isSidechain: false,
          message: { content: '<command-name>ignored wrapper</command-name>' },
        },
        {
          type: 'user',
          isMeta: false,
          isSidechain: false,
          message: { content: 'Latest Claude prompt' },
        },
        { type: 'last-prompt', lastPrompt: 'Latest Claude prompt' },
        { type: 'system', subtype: 'turn_duration', isSidechain: true, messageCount: 99 },
        {
          type: 'user',
          isMeta: false,
          isSidechain: false,
          message: {
            content: [{ type: 'tool_result', content: 'x'.repeat(300_000) }],
          },
        },
      ].map(line).join(''),
    );

    const scanner = new ClaudeScanner(root);
    let session = scanner.scan().sessions[0];
    assert.equal(session.title, 'First Claude prompt');
    assert.equal(session.projectName, 'project');
    assert.equal(session.lastPrompt, 'Latest Claude prompt');
    assert.equal(session.status, 'running');
    assert.equal(session.active, true);

    fs.appendFileSync(
      transcript,
      [
        {
          type: 'assistant',
          isSidechain: false,
          message: { content: 'Finished', stop_reason: 'end_turn' },
        },
        { type: 'system', subtype: 'turn_duration', messageCount: 4 },
      ].map(line).join(''),
    );
    session = scanner.scan().sessions[0];
    assert.equal(session.lastPrompt, 'Latest Claude prompt');
    assert.equal(session.status, 'wait');
    assert.equal(session.active, false);
    assert.equal(session.turns, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Codex reports the latest real prompt and task lifecycle state', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'servertop-codex-'));
  try {
    const sessionsDir = path.join(root, 'sessions', '2026', '08', '30');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const transcript = path.join(sessionsDir, 'rollout-test-session.jsonl');
    fs.writeFileSync(
      transcript,
      [
        {
          type: 'session_meta',
          payload: {
            cwd: '/tmp/project',
            timestamp: '2026-08-30T10:00:00.000Z',
            git: { branch: 'main' },
          },
        },
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'one' } },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'First Codex prompt' }],
          },
        },
        { type: 'event_msg', payload: { type: 'task_complete', turn_id: 'one' } },
        { type: 'event_msg', payload: { type: 'task_started', turn_id: 'two' } },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '<environment_context>ignored</environment_context>' }],
          },
        },
        {
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Latest Codex prompt' }],
          },
        },
        {
          type: 'response_item',
          payload: { type: 'custom_tool_call_output', output: 'x'.repeat(300_000) },
        },
      ].map(line).join(''),
    );

    const scanner = new CodexScanner(root);
    let session = scanner.scan().sessions[0];
    assert.equal(session.title, 'First Codex prompt');
    assert.equal(session.projectName, 'project');
    assert.equal(session.lastPrompt, 'Latest Codex prompt');
    assert.equal(session.status, 'running');
    assert.equal(session.active, true);

    fs.appendFileSync(
      transcript,
      line({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'two' } }),
    );
    session = scanner.scan().sessions[0];
    assert.equal(session.lastPrompt, 'Latest Codex prompt');
    assert.equal(session.status, 'wait');
    assert.equal(session.active, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
