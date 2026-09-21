import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eventsEndedWithUnfinishedWork } from '@open-design/contracts';
import { closeDatabase, openDatabase, insertProject, insertConversation, upsertMessage, deleteMessage, listLatestProjectRunStatuses } from '../src/db.js';
import { createProjectStatusSummaryParser } from '../src/storage/project-status-summary.js';

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); closeDatabase(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function database() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'od-status-summary-')); dirs.push(dir);
  const db = openDatabase(dir, { dataDir: dir });
  insertProject(db, { id: 'p', name: 'p', createdAt: 1, updatedAt: 1 });
  for (const id of ['a', 'b']) insertConversation(db, { id, projectId: 'p', createdAt: 1, updatedAt: 1 });
  return { db, dir };
}
function message(db: ReturnType<typeof openDatabase>, id: string, conversation = 'a', at = 1, events = '[]', status = 'succeeded') {
  db.prepare(`INSERT INTO messages(id, conversation_id, role, content, run_id, run_status, events_json, created_at, ended_at, position)
    VALUES (?, ?, 'assistant', '', ?, ?, ?, ?, ?, 0)`).run(id, conversation, id, status, events, at, at);
}
function parse(text: string, chunkSize = 7) {
  const parser = createProjectStatusSummaryParser(); const bytes = Buffer.from(text);
  for (let i = 0; i < bytes.length; i += chunkSize) parser.write(bytes.subarray(i, i + chunkSize));
  return parser.end();
}
const todo = (items: unknown, name = 'TodoWrite') => ({ kind: 'tool_use', name, input: { todos: items } });

describe('bounded project status reads', () => {
  it('does not materialize discarded history event payloads in JS', () => {
    const { db } = database();
    for (let i = 0; i < 4; i++) message(db, `old-${i}`, 'a', i + 1, JSON.stringify([{ kind: 'text', text: 'x'.repeat(1024 * 1024) }]));
    message(db, 'latest', 'b', 100);
    const prepare = db.prepare.bind(db); let largestString = 0;
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql); const all = statement.all.bind(statement);
      statement.all = ((...args: unknown[]) => {
        const rows = all(...args);
        for (const row of rows) for (const value of Object.values(row as object)) {
          if (typeof value === 'string') largestString = Math.max(largestString, Buffer.byteLength(value));
        }
        return rows;
      }) as typeof statement.all;
      return statement;
    });
    expect(listLatestProjectRunStatuses(db).get('p')?.runId).toBe('latest');
    expect(largestString).toBeLessThanOrEqual(64 * 1024);
  });

  it('writes summaries with normal messages and cascades cache deletion', () => {
    const { db } = database();
    upsertMessage(db, 'a', { id: 'normal', role: 'assistant', content: '', runId: 'normal', runStatus: 'succeeded', events: [todo([{}])] });
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('substr(CAST(events_json AS BLOB)')) throw new Error('unexpected event backfill');
      return prepare(sql);
    });
    expect(listLatestProjectRunStatuses(db).get('p')?.value).toBe('incomplete');
    spy.mockRestore();
    deleteMessage(db, 'normal');
    expect(db.prepare('SELECT count(*) AS n FROM message_project_status_summaries').get()).toEqual({ n: 0 });
  });

  it('selects across conversations and keeps insertion order for equal timestamps', () => {
    const { db } = database(); message(db, 'first', 'a', 10, '[]', 'failed'); message(db, 'second', 'b', 10);
    expect(listLatestProjectRunStatuses(db).get('p')?.runId).toBe('first');
    message(db, 'newest', 'b', 11);
    expect(listLatestProjectRunStatuses(db).get('p')).toEqual({ value: 'succeeded', runId: 'newest', updatedAt: 11 });
  });

  it('lazily caches only selected succeeded rows and invalidates direct event replacements', () => {
    const { db } = database(); message(db, 'old'); message(db, 'latest', 'b', 2, JSON.stringify([todo([{ status: 'pending' }])]));
    expect(listLatestProjectRunStatuses(db).get('p')?.value).toBe('incomplete');
    expect(db.prepare('SELECT s.unfinished AS value FROM messages m LEFT JOIN message_project_status_summaries s ON s.message_id = m.id WHERE m.id = ?').get('old')).toEqual({ value: null });
    expect(db.prepare('SELECT s.unfinished AS value FROM messages m LEFT JOIN message_project_status_summaries s ON s.message_id = m.id WHERE m.id = ?').get('latest')).toEqual({ value: 1 });
    db.prepare('UPDATE messages SET events_json = ? WHERE id = ?').run(JSON.stringify([todo([{ status: 'completed' }])]), 'latest');
    expect(db.prepare('SELECT s.unfinished AS value FROM messages m LEFT JOIN message_project_status_summaries s ON s.message_id = m.id WHERE m.id = ?').get('latest')).toEqual({ value: null });
    expect(listLatestProjectRunStatuses(db).get('p')?.value).toBe('succeeded');
  });

  it('retains cached summaries across reopen and resumes missing summaries without rewriting events', () => {
    const { db, dir } = database(); const events = JSON.stringify([todo([{ status: 'stopped' }])]);
    message(db, 'latest', 'a', 2, events); listLatestProjectRunStatuses(db); closeDatabase();
    const reopened = openDatabase(dir, { dataDir: dir });
    expect(listLatestProjectRunStatuses(reopened).get('p')?.value).toBe('incomplete');
    expect(reopened.prepare('SELECT events_json AS events FROM messages WHERE id = ?').get('latest')).toEqual({ events });
  });

  it('upgrades legacy schemas without eagerly scanning or changing event history', () => {
    const { db, dir } = database();
    message(db, 'legacy', 'a', 1, JSON.stringify([todo([{ status: 'pending' }])]));
    db.exec('DROP TRIGGER invalidate_project_status_summary');
    db.exec('DROP TABLE message_project_status_summaries');
    closeDatabase();
    const upgraded = openDatabase(dir, { dataDir: dir });
    expect(upgraded.prepare('SELECT s.unfinished AS value FROM messages m LEFT JOIN message_project_status_summaries s ON s.message_id = m.id').get()).toEqual({ value: null });
    expect(listLatestProjectRunStatuses(upgraded).get('p')?.value).toBe('incomplete');
  });

  it('leaves interrupted backfills uncached and permits a later retry', () => {
    const { db } = database();
    message(db, 'large', 'a', 1, JSON.stringify([{ kind: 'text', text: 'x'.repeat(17 * 1024 * 1024) }, todo([{}])]));
    const prepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const statement = prepare(sql);
      if (sql.includes('substr(CAST(events_json AS BLOB)')) {
        const get = statement.get.bind(statement); let calls = 0;
        statement.get = ((...args: unknown[]) => {
          if (++calls === 2) throw new Error('simulated read failure');
          return get(...args);
        }) as typeof statement.get;
      }
      return statement;
    });
    expect(() => listLatestProjectRunStatuses(db)).toThrow('simulated read failure');
    spy.mockRestore();
    expect(db.prepare('SELECT s.unfinished AS value FROM messages m LEFT JOIN message_project_status_summaries s ON s.message_id = m.id').get()).toEqual({ value: null });
    expect(listLatestProjectRunStatuses(db).get('p')?.value).toBe('incomplete');
  });

  it('handles a large latest text without truncating subsequent semantic events', () => {
    const { db } = database(); const events = JSON.stringify([{ kind: 'text', text: '界'.repeat(1024 * 1024) }, todo([{ status: 'pending' }])]);
    message(db, 'latest', 'a', 1, events);
    expect(listLatestProjectRunStatuses(db).get('p')?.value).toBe('incomplete');
  });
});

describe('streamed completeness parity', () => {
  const cases: unknown[] = [null, {}, [], [null, 1, []], [todo([])], [todo([null, false, 1, 'completed'])], [todo([[]])],
    [todo([{}])], [todo([{ status: 'completed' }])], [todo([{ status: 'pending' }]), todo([{ status: 'completed' }])],
    [todo([{ status: 'pending' }]), { kind: 'tool_use', name: 'TodoWrite', input: null }],
    [{ kind: 'usage', stopReason: 'max_tokens' }, todo([])], [{ kind: 'usage', stopReason: 'max_output_tokens' }],
    [{ kind: 'usage', stopReason: 'end_turn' }], [{ kind: 'text', text: '中文\\\"\n\u0000😀' }],
  ];
  for (const name of ['TodoWrite', 'todowrite', 'todo_write', 'update_plan', 'other']) {
    for (const status of ['completed', 'pending', 'stopped', null, {}, []]) cases.push([todo([{ status }], name)]);
    cases.push([{ kind: 'tool_use', name, input: { plan: [{ status: 'pending' }] } }]);
    cases.push([{ kind: 'tool_use', name, input: { todos: [], plan: [{ status: 'pending' }] } }]);
  }
  it.each(cases.map((events, i) => ({ events, i })))('matches canonical rule $i', ({ events }) => {
    expect(parse(JSON.stringify(events))).toBe(eventsEndedWithUnfinishedWork(events));
  });
  it.each(['[', '[{"kind":"usage","stopReason":"max_tokens"}] trailing', '[{"kind":"usage","stopReason":"max_tokens"},]'])('does not classify invalid JSON: %s', (text) => {
    expect(parse(text)).toBe(false);
  });
  it('honors duplicate fields like JSON.parse', () => {
    const text = '[{"kind":"usage","stopReason":"max_tokens","stopReason":"end_turn"},{"kind":"tool_use","name":"TodoWrite","input":{"todos":[{}]},"input":null}]';
    expect(parse(text)).toBe(eventsEndedWithUnfinishedWork(JSON.parse(text)));
  });
});
