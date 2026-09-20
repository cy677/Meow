const validRecord = "NOT EXISTS (SELECT 1 FROM growth_corrections c WHERE c.ledgerId=l.id)";

export function createGrowthRepository(db) {
  function count(t,date,stepId='') {
    const vals=[t.id],clauses=['l.taskId=?',"l.kind IN ('earn','observation')",validRecord];
    if(t.steps.length){clauses.push("json_extract(l.growthSnapshot,'$.stepId')=?");vals.push(stepId);}
    else if(t.frequency==='daily'){clauses.push('l.awardDay=?');vals.push(date);}
    return db.prepare('SELECT count(*) AS n FROM ledger l WHERE '+clauses.join(' AND ')).get(...vals).n;
  }
  return {
    count,
    dailySummary: (since,today) => db.prepare(`SELECT awardDay AS day,growthCategory AS category,count(*) AS count,COALESCE(sum(delta),0) AS points FROM ledger l WHERE growthCategory IS NOT NULL AND awardDay>=? AND awardDay<=? AND kind IN ('earn','observation') AND ${validRecord} GROUP BY awardDay,growthCategory ORDER BY awardDay`).all(since,today),
    initialize() {
    db.exec(`CREATE TABLE IF NOT EXISTS growth_tasks(id TEXT PRIMARY KEY,definition TEXT NOT NULL,revision INTEGER NOT NULL,active INTEGER NOT NULL,archived INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_submissions(id TEXT PRIMARY KEY,taskId TEXT NOT NULL,snapshot TEXT NOT NULL,reason TEXT NOT NULL,occurredAt TEXT NOT NULL,awardDay TEXT NOT NULL,stepId TEXT NOT NULL,status TEXT NOT NULL,ledgerId TEXT,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_audit(id TEXT PRIMARY KEY,kind TEXT NOT NULL,detail TEXT NOT NULL,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS growth_corrections(ledgerId TEXT PRIMARY KEY,correctionId TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS growth_submissions_pending ON growth_submissions(taskId,status,awardDay);`);
    },
    seedTask: (...args) => db.prepare('INSERT OR IGNORE INTO growth_tasks VALUES (?,?,1,0,0)').run(...args),
    audit: (...args) => db.prepare('INSERT INTO growth_audit VALUES (?,?,?,?)').run(...args),
    task: (...args) => db.prepare('SELECT * FROM growth_tasks WHERE id=?').get(...args),
    tasks: (...args) => db.prepare('SELECT * FROM growth_tasks ORDER BY rowid').all(...args),
    categorySummary: (...args) => db.prepare(`SELECT growthCategory AS category,count(*) AS count,COALESCE(sum(delta),0) AS points FROM ledger l WHERE growthCategory IS NOT NULL AND awardDay>=? AND awardDay<=? AND kind IN ('earn','observation') AND ${validRecord} GROUP BY growthCategory`).all(...args),
    pending: (...args) => db.prepare("SELECT * FROM growth_submissions WHERE status='pending' ORDER BY createdAt LIMIT 100").all(...args),
    recent: (...args) => db.prepare(`SELECT id,reason,delta,occurredAt,createdAt,growthCategory,growthSnapshot FROM ledger l WHERE growthCategory IS NOT NULL AND kind IN ('earn','observation') AND ${validRecord} ORDER BY rowid DESC LIMIT 100`).all(...args),
    unclassifiedCount: (...args) => db.prepare("SELECT count(*) AS n FROM ledger WHERE kind IN ('earn','observation') AND growthCategory IS NULL").get(...args),
    version: (...args) => db.prepare('SELECT version FROM profile WHERE id=1').get(...args),
    taskCount: (...args) => db.prepare('SELECT count(*) AS n FROM growth_tasks').get(...args),
    hasTaskHistory: (...args) => db.prepare('SELECT 1 FROM ledger WHERE taskId=? LIMIT 1').get(...args),
    saveTask: (...args) => db.prepare('INSERT INTO growth_tasks VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition,revision=excluded.revision,active=excluded.active,archived=excluded.archived').run(...args),
    submission: (...args) => db.prepare('SELECT * FROM growth_submissions WHERE id=?').get(...args),
    pendingForTask: (...args) => db.prepare("SELECT id FROM growth_submissions WHERE taskId=? AND stepId=? AND status='pending' AND (awardDay=? OR ?='once')").get(...args),
    account: (...args) => db.prepare('SELECT balance,lifetime FROM profile WHERE id=1').get(...args),
    addPoints: (...args) => db.prepare('UPDATE profile SET balance=balance+?,lifetime=lifetime+? WHERE id=1').run(...args),
    settleSubmission: (...args) => db.prepare('UPDATE growth_submissions SET status=?,ledgerId=? WHERE id=?').run(...args),
    hasPending: (...args) => db.prepare("SELECT 1 FROM growth_submissions WHERE taskId=? AND stepId=? AND status='pending' AND (awardDay=? OR ?='once')").get(...args),
    saveSubmission: (...args) => db.prepare('INSERT INTO growth_submissions VALUES (?,?,?,?,?,?,?,?,NULL,?)').run(...args),
    cancelSubmission: (...args) => db.prepare("UPDATE growth_submissions SET status='cancelled' WHERE id=?").run(...args),
    ledgerRecord: (...args) => db.prepare('SELECT * FROM ledger WHERE id=?').get(...args),
    classifyRecord: (...args) => db.prepare('UPDATE ledger SET growthCategory=?,growthSnapshot=?,occurredAt=?,awardDay=? WHERE id=?').run(...args),
    earnedRecord: (...args) => db.prepare("SELECT * FROM ledger WHERE id=? AND kind IN ('earn','observation')").get(...args),
    hasCorrection: (...args) => db.prepare('SELECT 1 FROM growth_corrections WHERE ledgerId=?').get(...args),
    saveCorrection: (...args) => db.prepare('INSERT INTO growth_corrections VALUES (?,?)').run(...args),
    submissions: (...args) => db.prepare('SELECT * FROM growth_submissions ORDER BY createdAt').all(...args),
    audits: (...args) => db.prepare('SELECT * FROM growth_audit ORDER BY rowid').all(...args),
    corrections: (...args) => db.prepare('SELECT * FROM growth_corrections').all(...args),
  };
}
