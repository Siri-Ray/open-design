import type Database from 'better-sqlite3';
import Parser from 'stream-json/Parser.js';
import {
  eventsEndedWithUnfinishedWork,
  isTodoWriteToolName,
  stopReasonIsTruncation,
} from '@open-design/contracts';

// This is a derived cache. Old clients and recovery writers may still replace
// events_json directly, so invalidate in SQLite rather than at selected callers.
export function migrateProjectStatusSummary(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS message_project_status_summaries (
      message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      unfinished INTEGER NOT NULL CHECK (unfinished IN (0, 1))
    );
    CREATE TRIGGER IF NOT EXISTS invalidate_project_status_summary
    AFTER UPDATE OF events_json ON messages
    BEGIN
      DELETE FROM message_project_status_summaries WHERE message_id = NEW.id;
    END`);
}

type Frame = {
  kind: 'object' | 'array';
  role: 'root' | 'event' | 'input' | 'todos' | 'todo' | 'skip';
  key: string;
  fields: Record<string, unknown>;
  unfinished: boolean;
};
type Token = { name: string; value?: string | boolean | null };

/** Discard text/tool payloads while parsing, including a single huge string.
 * Retain only the fields consumed by the canonical completeness predicate.
 * Each todos array collapses to [] or [{}]; even a huge task list is bounded.
 */
export function createProjectStatusSummaryParser() {
  const parser = new Parser({ packValues: false, streamValues: true });
  const stack: Frame[] = [];
  let scalar = '';
  let key = false;
  let truncated = false;
  let unfinished = false;
  let rootArray = false;
  let complete = false;

  const accept = (value: unknown) => {
    const parent = stack.at(-1);
    if (!parent) return;
    if (parent.role === 'root') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const event = value as Record<string, unknown>;
        if (event.kind === 'usage' && stopReasonIsTruncation(event.stopReason)) truncated = true;
        if (event.kind === 'tool_use' && isTodoWriteToolName(event.name)) {
          unfinished = eventsEndedWithUnfinishedWork([event]);
        }
      }
    } else if (parent.role === 'todos') {
      if (value && typeof value === 'object') {
        parent.unfinished ||= (value as { status?: unknown }).status !== 'completed';
      }
    } else {
      const wanted = parent.role === 'event' ? ['kind', 'name', 'stopReason', 'input']
        : parent.role === 'input' ? ['todos', 'plan']
          : parent.role === 'todo' ? ['status'] : [];
      if (wanted.includes(parent.key)) parent.fields[parent.key] = value;
    }
  };

  parser.on('data', (token: Token) => {
    if (token.name === 'startKey') { key = true; scalar = ''; return; }
    if (token.name === 'endKey') {
      const frame = stack.at(-1);
      if (frame) frame.key = scalar;
      key = false;
      return;
    }
    if (token.name === 'startString' || token.name === 'startNumber') { scalar = ''; return; }
    if (token.name === 'stringChunk' || token.name === 'numberChunk') {
      // All recognized keys and enum values are shorter than this. A longer
      // scalar stays non-matching without retaining its remaining contents.
      if (scalar.length < 64) scalar += String(token.value ?? '').slice(0, 64 - scalar.length);
      return;
    }
    if (token.name === 'endString' || token.name === 'endNumber') {
      if (!key) accept(token.name === 'endString' ? scalar : Number(scalar));
      return;
    }
    if (['trueValue', 'falseValue', 'nullValue'].includes(token.name)) { accept(token.value); return; }
    if (token.name === 'startObject' || token.name === 'startArray') {
      const kind = token.name === 'startObject' ? 'object' : 'array';
      const parent = stack.at(-1);
      let role: Frame['role'] = 'skip';
      if (!parent && kind === 'array') { role = 'root'; rootArray = true; }
      else if (parent?.role === 'root' && kind === 'object') role = 'event';
      else if (parent?.role === 'event' && parent.key === 'input' && kind === 'object') role = 'input';
      else if (parent?.role === 'input' && ['todos', 'plan'].includes(parent.key) && kind === 'array') role = 'todos';
      else if (parent?.role === 'todos' && kind === 'object') role = 'todo';
      stack.push({ kind, role, key: '', fields: {}, unfinished: false });
      return;
    }
    if (token.name === 'endObject' || token.name === 'endArray') {
      const frame = stack.pop();
      if (!frame) return;
      if (!stack.length) complete = true;
      accept(frame.role === 'todos' ? (frame.unfinished ? [{}] : [])
        : frame.kind === 'array' ? [] : frame.fields);
    }
  });
  // Invalid persisted JSON has historically meant no event-derived override.
  // errored is set synchronously by Transform before its error event is emitted.
  parser.on('error', () => {});
  return {
    write(chunk: Buffer) { if (!parser.errored) parser.write(chunk); },
    destroy() { parser.destroy(); },
    end() {
      parser.end();
      const result = !parser.errored && rootArray && complete && (truncated || unfinished);
      parser.destroy();
      return result;
    },
  };
}

export function cacheProjectStatusSummary(db: Database.Database, messageId: string, events: unknown): void {
  storeProjectStatusSummary(db, messageId, eventsEndedWithUnfinishedWork(events));
}

function storeProjectStatusSummary(db: Database.Database, messageId: string, unfinished: boolean): void {
  // Keep this outside messages: updating one cache bit must not rewrite an
  // entire potentially enormous events_json overflow record in SQLite.
  db.prepare(`INSERT INTO message_project_status_summaries (message_id, unfinished)
    VALUES (?, ?) ON CONFLICT(message_id) DO UPDATE SET unfinished = excluded.unfinished`)
    .run(messageId, unfinished ? 1 : 0);
}

/** Lazy, resumable backfill of selected messages only. Never read a full event
 * string into JS. Each completed message is cached; interruption leaves other
 * rows uncached, ready for a later request, without a startup-wide migration scan.
 */
export function readProjectStatusSummary(db: Database.Database, messageId: string): boolean {
  return db.transaction(() => {
    const parser = createProjectStatusSummaryParser();
    // A small fixed buffer bounds JS memory; 16 MiB also avoids thousands of
    // SQLite overflow-page reads for a single legacy event field.
    const chunkSize = 16 * 1024 * 1024;
    const read = db.prepare(`SELECT substr(CAST(events_json AS BLOB), ?, ?) AS chunk
      FROM messages WHERE id = ?`);
    try {
      for (let offset = 1; ; offset += chunkSize) {
        const row = read.get(offset, chunkSize, messageId) as { chunk: Buffer | null } | undefined;
        if (!row) return false;
        if (!row.chunk?.length) break;
        parser.write(row.chunk);
        if (row.chunk.length < chunkSize) break;
      }
      const result = parser.end();
      storeProjectStatusSummary(db, messageId, result);
      return result;
    } finally {
      parser.destroy();
    }
    // Hold one snapshot across chunks and the cache write. An external writer
    // must not replace events halfway through a summary or race invalidation.
  }).immediate();
}
