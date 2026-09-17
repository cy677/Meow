import { randomUUID } from 'node:crypto';
import { fail, integer, text } from './catalog.mjs';

/** Append-only local history. Migrate v1 without dropping tables or inventing old snapshots. */
export function createLocalLedger(db, getCatalog) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('PRAGMA table_info(ledger)').all().some(c => c.name === 'rewardSnapshot')) {
      db.exec('ALTER TABLE ledger ADD COLUMN rewardSnapshot TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS ledger_kind_idx ON ledger(kind)');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const decode = row => ({ ...row, rewardSnapshot: row.rewardSnapshot ? JSON.parse(row.rewardSnapshot) : null });
  const write = db.prepare('INSERT INTO ledger (id,kind,delta,reason,rewardId,createdAt,rewardSnapshot) VALUES (?,?,?,?,?,?,?)');
  return {
    log(kind, delta, reason, rewardId = null) {
      const reward = rewardId ? getCatalog().rewards.find(r => r.id === rewardId) : null;
      const snapshot=reward?structuredClone(reward):null;
      if(snapshot?.category==='theme')snapshot.memberSnapshots=Object.values(snapshot.params.members).map(id=>structuredClone(getCatalog().rewards.find(r=>r.id===id)));
      write.run(randomUUID(), kind, delta, reason, rewardId, new Date().toISOString(), snapshot ? JSON.stringify(snapshot) : null);
    },
    latest() { return db.prepare('SELECT * FROM ledger ORDER BY rowid DESC LIMIT 100').all().map(decode); },
    all() { return db.prepare('SELECT * FROM ledger ORDER BY rowid').all().map(decode); },
    history({ before = null, limit = 40, kind = 'all', q = '' } = {}) {
      integer(limit, '每页条数', 1, 100);
      if (before !== null) integer(before, '记录游标', 1, Number.MAX_SAFE_INTEGER);
      if (!['all', 'earn', 'adjustment', 'purchase', 'gift', 'catalog'].includes(kind)) fail(400, '记录类型无效');
      q = text(q, '查询文字', 120, 0);
      const clauses = [], values = [];
      if (kind !== 'all') { clauses.push('kind=?'); values.push(kind); }
      // Literal substring search: quotes, % and _ are not treated as SQL or wildcard operators.
      if (q) { clauses.push('instr(lower(reason),lower(?))>0'); values.push(q); }
      const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
      const total = db.prepare('SELECT count(*) AS n FROM ledger' + where).get(...values).n;
      if (before !== null) { clauses.push('rowid<?'); values.push(before); }
      const pageWhere = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
      const rows = db.prepare('SELECT rowid AS cursor, * FROM ledger' + pageWhere + ' ORDER BY rowid DESC LIMIT ?').all(...values, limit + 1);
      const hasMore = rows.length > limit, page = rows.slice(0, limit);
      return { entries: page.map(decode), total, nextCursor: hasMore ? page.at(-1).cursor : null };
    },
  };
}
