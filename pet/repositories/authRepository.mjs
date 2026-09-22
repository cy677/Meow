export function createAuthRepository(db) {
  return {
    credential: role => db.prepare('SELECT * FROM credentials WHERE role=?').get(role),
    saveCredential: (role, c) => db.prepare('INSERT INTO credentials VALUES (?,?,?) ON CONFLICT(role) DO UPDATE SET salt=excluded.salt,hash=excluded.hash').run(role,c.salt,c.hash),
    removeExpired: now => db.prepare('DELETE FROM sessions WHERE expires<=?').run(now),
    removeSession: hash => db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(hash),
    saveSession: (...values) => db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(...values),
    session: (hash,role,now) => db.prepare('SELECT * FROM sessions WHERE tokenHash=? AND role=? AND expires>?').get(hash,role,now),
    revoke: role => db.prepare('DELETE FROM sessions WHERE role=?').run(role),
    initializeNames: (childName,petName) => db.prepare('UPDATE profile SET childName=?,petName=?,version=version+1 WHERE id=1').run(childName,petName),
  };
}
