// D1 access. Every write goes through here so it lands in the audit log in
// the same batch as the change itself.
import type { Expense, ExpenseInput } from './finance';
import type { LastRun } from './sources';

const EXPENSE_COLUMNS = 'id, kind, cadence, category, vendor, description, amount_cents, start_date, end_date, product_key';

export async function listExpenses(db: D1Database): Promise<Expense[]> {
  const { results } = await db
    .prepare(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE deleted_at IS NULL ORDER BY start_date DESC, vendor`)
    .all<Expense>();
  return results;
}

export async function getExpense(db: D1Database, id: string): Promise<Expense | null> {
  return db.prepare(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE id = ? AND deleted_at IS NULL`).bind(id).first<Expense>();
}

function audit(db: D1Database, actor: string, action: string, entityId: string, before: unknown, after: unknown, at: string) {
  return db
    .prepare('INSERT INTO audit_log (at, actor, action, entity, entity_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(at, actor, action, 'expense', entityId, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null);
}

export async function createExpense(db: D1Database, actor: string, input: ExpenseInput): Promise<Expense> {
  const id = crypto.randomUUID();
  const at = new Date().toISOString();
  const expense: Expense = { id, ...input };
  await db.batch([
    db
      .prepare(
        `INSERT INTO expenses (${EXPENSE_COLUMNS}, created_at, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.kind, input.cadence, input.category, input.vendor, input.description, input.amount_cents, input.start_date, input.end_date, input.product_key, at, actor, at),
    audit(db, actor, 'expense.create', id, null, expense, at),
  ]);
  return expense;
}

export async function updateExpense(db: D1Database, actor: string, before: Expense, input: ExpenseInput): Promise<Expense> {
  const at = new Date().toISOString();
  const after: Expense = { id: before.id, ...input };
  await db.batch([
    db
      .prepare(
        `UPDATE expenses SET kind = ?, cadence = ?, category = ?, vendor = ?, description = ?, amount_cents = ?, start_date = ?, end_date = ?, product_key = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(input.kind, input.cadence, input.category, input.vendor, input.description, input.amount_cents, input.start_date, input.end_date, input.product_key, at, before.id),
    audit(db, actor, 'expense.update', before.id, before, after, at),
  ]);
  return after;
}

export async function deleteExpense(db: D1Database, actor: string, before: Expense): Promise<void> {
  const at = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').bind(at, at, before.id),
    audit(db, actor, 'expense.delete', before.id, before, null, at),
  ]);
}

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  before: string | null;
  after: string | null;
}

export async function listAudit(db: D1Database, limit: number, beforeId?: number): Promise<AuditEntry[]> {
  const stmt = beforeId
    ? db.prepare('SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?').bind(beforeId, limit)
    : db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').bind(limit);
  const { results } = await stmt.all<AuditEntry>();
  return results;
}

export async function lastRuns(db: D1Database): Promise<Map<string, LastRun>> {
  const { results } = await db
    .prepare(
      `SELECT s.source, s.status, s.started_at, s.finished_at,
              (SELECT MAX(finished_at) FROM sync_runs o WHERE o.source = s.source AND o.status = 'ok') AS last_ok_at
       FROM sync_runs s
       WHERE s.id = (SELECT MAX(id) FROM sync_runs t WHERE t.source = s.source)`,
    )
    .all<LastRun>();
  return new Map(results.map((r) => [r.source, r]));
}
