/** SQL and the legacy single-profile mapping live only at this boundary. */
export function createHouseholdRepository(db) {
  return {
    setting: (...args) => db.prepare("SELECT value FROM settings WHERE key=?").get(...args),
    setSetting: (...args) => db.prepare("INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(...args),
    bump: (...args) => db.prepare("UPDATE profile SET version=version+1 WHERE id=1").run(...args),
    grantOwned: (...args) => db.prepare("INSERT OR IGNORE INTO owned VALUES (?,?)").run(...args),
    lifetime: (...args) => db.prepare("SELECT lifetime FROM profile WHERE id=1").get(...args),
    starterEquip: (...args) => db.prepare("INSERT OR IGNORE INTO equipped VALUES (?,?)").run(...args),
    profile: (...args) => db.prepare("SELECT childName,petName,balance,lifetime,version FROM profile WHERE id=1").get(...args),
    owned: (...args) => db.prepare("SELECT id FROM owned").all(...args),
    equipped: (...args) => db.prepare("SELECT slot,id FROM equipped").all(...args),
    request: (...args) => db.prepare("SELECT fingerprint FROM requests WHERE key=?").get(...args),
    saveRequest: (...args) => db.prepare("INSERT INTO requests VALUES (?,?)").run(...args),
    equip: (...args) => db.prepare("INSERT INTO equipped VALUES (?,?) ON CONFLICT(slot) DO UPDATE SET id=excluded.id").run(...args),
    unequip: (...args) => db.prepare("DELETE FROM equipped WHERE slot=?").run(...args),
    clearThemeAndCreation: (...args) => db.prepare("DELETE FROM equipped WHERE slot IN ('theme','creation')").run(...args),
    ledgerCount: (...args) => db.prepare("SELECT count(*) AS n FROM ledger").get(...args),
    addPoints: (...args) => db.prepare("UPDATE profile SET balance=balance+?, lifetime=lifetime+? WHERE id=1").run(...args),
    hasOwned: (...args) => db.prepare("SELECT id FROM owned WHERE id=?").get(...args),
    spendPoints: (...args) => db.prepare("UPDATE profile SET balance=balance-? WHERE id=1").run(...args),
    saveOwned: (...args) => db.prepare("INSERT INTO owned VALUES (?,?)").run(...args),
    clearCreation: (...args) => db.prepare("DELETE FROM equipped WHERE slot='creation'").run(...args),
    clearTheme: (...args) => db.prepare("DELETE FROM equipped WHERE slot='theme'").run(...args),
    setNames: (...args) => db.prepare("UPDATE profile SET childName=?,petName=? WHERE id=1").run(...args),
  };
}
