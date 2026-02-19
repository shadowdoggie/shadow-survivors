// ============================================================
// DARK SURVIVORS - Co-op Server
// Express + SQLite + WebSocket
// ============================================================
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const initSqlJs = require('sql.js');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const PORT = 3002;
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, perMessageDeflate: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// DATABASE SETUP (sql.js — pure JS SQLite, no native deps)
// ============================================================
let db, stmts;
const DB_PATH = path.join(__dirname, 'darksurvivors.db');

// sql.js wrapper: mimics better-sqlite3 prepare/get/all/run API
function prepareStmt(sql) {
    return {
        get(...params) {
            const stmt = db.prepare(sql);
            stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
            if (stmt.step()) {
                const row = stmt.getAsObject();
                stmt.free();
                return row;
            }
            stmt.free();
            return undefined;
        },
        all(...params) {
            const results = [];
            const stmt = db.prepare(sql);
            stmt.bind(params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
            while (stmt.step()) results.push(stmt.getAsObject());
            stmt.free();
            return results;
        },
        run(...params) {
            db.run(sql, params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
            const lastId = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
            const changes = db.getRowsModified();
            saveDb();
            return { lastInsertRowid: lastId, changes };
        }
    };
}

function saveDb() {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function initDatabase() {
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_PATH)) {
        const buf = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buf);
    } else {
        db = new SQL.Database();
    }

    // Note: sql.js is in-memory, WAL mode not applicable
    db.run('PRAGMA foreign_keys = ON');

    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS progression (
        user_id INTEGER PRIMARY KEY,
        gold INTEGER DEFAULT 0,
        total_xp INTEGER DEFAULT 0,
        account_level INTEGER DEFAULT 1,
        games_played INTEGER DEFAULT 0,
        total_kills INTEGER DEFAULT 0,
        best_time REAL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS unlocks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        unlock_type TEXT NOT NULL,
        unlock_key TEXT NOT NULL,
        unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, unlock_type, unlock_key)
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS upgrades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        upgrade_key TEXT NOT NULL,
        level INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, upgrade_key)
    )`);
    saveDb();

    stmts = {
        findUser: prepareStmt('SELECT * FROM users WHERE username = ?'),
        createUser: prepareStmt('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
        createProgression: prepareStmt('INSERT INTO progression (user_id) VALUES (?)'),
        getProgression: prepareStmt('SELECT * FROM progression WHERE user_id = ?'),
        updateProgression: prepareStmt(`UPDATE progression SET gold = ?, total_xp = ?, account_level = ?, games_played = ?, total_kills = ?, best_time = ? WHERE user_id = ?`),
        getUnlocks: prepareStmt('SELECT unlock_type, unlock_key FROM unlocks WHERE user_id = ?'),
        addUnlock: prepareStmt('INSERT OR IGNORE INTO unlocks (user_id, unlock_type, unlock_key) VALUES (?, ?, ?)'),
        getUpgrades: prepareStmt('SELECT upgrade_key, level FROM upgrades WHERE user_id = ?'),
        setUpgrade: prepareStmt('INSERT INTO upgrades (user_id, upgrade_key, level) VALUES (?, ?, ?) ON CONFLICT(user_id, upgrade_key) DO UPDATE SET level = ?'),
    };
}

// ============================================================
// CHARACTER DEFINITIONS (server-authoritative)
// ============================================================
const CharacterDefs = {
    knight: {
        id: 'knight',
        name: 'Knight',
        description: 'Balanced fighter with sword and shield',
        color: '#4488ff',
        cloakColor: '#2244aa',
        skinColor: '#ffcc88',
        startingWeapon: 'magic_wand',
        baseHp: 100,
        baseSpeed: 150,
        statBonuses: { might: 0, moveSpeed: 0, maxHp: 0, armor: 1 },
        unlockCost: 0, // free starter
    },
    rogue: {
        id: 'rogue',
        name: 'Rogue',
        description: 'Fast and deadly, starts with knives',
        color: '#44cc44',
        cloakColor: '#226622',
        skinColor: '#eebb88',
        startingWeapon: 'knife',
        baseHp: 80,
        baseSpeed: 185,
        statBonuses: { might: 0, moveSpeed: 0.15, maxHp: 0, armor: 0 },
        unlockCost: 500,
    },
    mage: {
        id: 'mage',
        name: 'Archmage',
        description: 'Powerful caster with fire wand, but fragile',
        color: '#aa44ff',
        cloakColor: '#5522aa',
        skinColor: '#ffddaa',
        startingWeapon: 'fire_wand',
        baseHp: 70,
        baseSpeed: 140,
        statBonuses: { might: 0.2, moveSpeed: 0, maxHp: 0, armor: 0 },
        unlockCost: 1500,
    },
    paladin: {
        id: 'paladin',
        name: 'Paladin',
        description: 'Holy tank with garlic aura and massive HP',
        color: '#ffdd44',
        cloakColor: '#aa8800',
        skinColor: '#ffcc88',
        startingWeapon: 'garlic',
        baseHp: 140,
        baseSpeed: 125,
        statBonuses: { might: 0, moveSpeed: 0, maxHp: 0.20, armor: 1, regen: 0.5 },
        unlockCost: 5000,
    },
    priest: {
        id: 'priest',
        name: 'Priest',
        description: 'Healing aura restores allies and self. Scales with battle duration',
        color: '#ffaaee',
        cloakColor: '#cc66aa',
        skinColor: '#ffddc0',
        startingWeapon: 'holy_water',
        baseHp: 95,
        baseSpeed: 140,
        statBonuses: { might: 0, moveSpeed: 0, maxHp: 0, armor: 0, regen: 1.0, area: 0.10, healAura: 3.0, healRadius: 150 },
        unlockCost: 5000,
    },
    druid: {
        id: 'druid',
        name: 'Druid',
        description: 'Kills heal nearby allies. Damage buffs allies and self in range',
        color: '#44dd88',
        cloakColor: '#228844',
        skinColor: '#ddc8a0',
        startingWeapon: 'garlic',
        baseHp: 110,
        baseSpeed: 135,
        statBonuses: { might: 0, moveSpeed: 0, maxHp: 0.10, armor: 0, regen: 0.3, healOnKill: 5, healRadius: 120, allyMightAura: 0.15 },
        unlockCost: 6000,
    },
    necromancer: {
        id: 'necromancer',
        name: 'Necromancer',
        description: 'Grows stronger with each kill (up to a cap). Glass cannon that snowballs',
        color: '#bb44ff',
        cloakColor: '#661199',
        skinColor: '#ddccbb',
        startingWeapon: 'lightning_ring',
        baseHp: 60,
        baseSpeed: 145,
        statBonuses: { might: 0.10, moveSpeed: 0, maxHp: 0, armor: 0, mightPerKill: 0.002, mightPerKillCap: 1.5 },
        unlockCost: 12000,
    },
    berserker: {
        id: 'berserker',
        name: 'Berserker',
        description: 'Deals more damage the lower your HP. Lifesteal keeps you in the danger zone',
        color: '#ff4444',
        cloakColor: '#991111',
        skinColor: '#eebb99',
        startingWeapon: 'axe',
        baseHp: 100,
        baseSpeed: 160,
        statBonuses: { might: 0.10, moveSpeed: 0.05, maxHp: 0, armor: 0, berserkerRage: true, berserkerLifesteal: 0.15 },
        unlockCost: 10000,
    },
};

// Meta upgrade definitions (permanent stat bonuses bought with gold)
const MetaUpgradeDefs = {
    meta_might:    { name: 'Might',       cost: [100,200,350,550,800,1100,1500,2000,2600,3500], bonus: 0.03, stat: 'might', maxLevel: 10 },
    meta_speed:    { name: 'Speed',       cost: [100,200,350,550,800,1100,1500,2000,2600,3500], bonus: 0.03, stat: 'moveSpeed', maxLevel: 10 },
    meta_hp:       { name: 'Max HP',      cost: [100,200,350,550,800,1100,1500,2000,2600,3500], bonus: 0.05, stat: 'maxHp', maxLevel: 10 },
    meta_armor:    { name: 'Armor',       cost: [150,300,500,750,1100,1500,2000,2700,3500,4500], bonus: 1, stat: 'armor', maxLevel: 10 },
    meta_regen:    { name: 'Recovery',    cost: [150,300,500,750,1100,1500,2000,2700,3500,4500], bonus: 0.15, stat: 'regen', maxLevel: 10 },
    meta_cooldown: { name: 'Cooldown',    cost: [200,400,650,1000,1400,1900,2500,3200,4000,5000], bonus: -0.02, stat: 'cooldown', maxLevel: 10 },
    meta_area:     { name: 'Area',        cost: [100,200,350,550,800,1100,1500,2000,2600,3500], bonus: 0.03, stat: 'area', maxLevel: 10 },
    meta_magnet:   { name: 'Magnet',      cost: [100,200,350,550,800,1100,1500,2000,2600,3500], bonus: 0.08, stat: 'magnet', maxLevel: 10 },
    meta_reroll:   { name: 'Reroll',      cost: [200,400,700,1100,1600,2200,2900,3700,4600,5500], bonus: 1, stat: null, maxLevel: 10 },
};

// ============================================================
// AUTH ENDPOINTS
// ============================================================
// Simple token store (in-memory; session tokens with TTL)
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map(); // token -> { userId, username, createdAt }

// Clean up expired sessions every hour
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL) sessions.delete(token);
    }
}, 60 * 60 * 1000);

function authMiddleware(req, res, next) {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    if (!token || !sessions.has(token)) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    const session = sessions.get(token);
    if (Date.now() - session.createdAt > SESSION_TTL) {
        sessions.delete(token);
        return res.status(401).json({ error: 'Session expired' });
    }
    req.user = session;
    next();
}

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3 || username.length > 20) return res.status(400).json({ error: 'Username must be 3-20 characters' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });

    const existing = stmts.findUser.get(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });

    const hash = bcrypt.hashSync(password, 10);
    const result = stmts.createUser.run(username, hash);
    const userId = result.lastInsertRowid;

    // Create progression row
    stmts.createProgression.run(userId);

    // Unlock knight (starter character) by default
    stmts.addUnlock.run(userId, 'character', 'knight');

    // Create session
    const token = uuidv4();
    sessions.set(token, { userId: Number(userId), username, createdAt: Date.now() });

    res.json({ token, username, userId: Number(userId) });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = stmts.findUser.get(username);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = uuidv4();
    sessions.set(token, { userId: user.id, username: user.username, createdAt: Date.now() });

    res.json({ token, username: user.username, userId: user.id });
});

app.post('/api/logout', authMiddleware, (req, res) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    sessions.delete(token);
    res.json({ ok: true });
});

// ============================================================
// PROGRESSION ENDPOINTS
// ============================================================
app.get('/api/profile', authMiddleware, (req, res) => {
    const prog = stmts.getProgression.get(req.user.userId);
    const unlocks = stmts.getUnlocks.all(req.user.userId);
    const upgrades = stmts.getUpgrades.all(req.user.userId);

    const unlocksMap = {};
    for (const u of unlocks) {
        if (!unlocksMap[u.unlock_type]) unlocksMap[u.unlock_type] = [];
        unlocksMap[u.unlock_type].push(u.unlock_key);
    }

    const upgradesMap = {};
    for (const u of upgrades) {
        upgradesMap[u.upgrade_key] = u.level;
    }

    res.json({
        username: req.user.username,
        progression: prog,
        unlocks: unlocksMap,
        upgrades: upgradesMap,
        characters: CharacterDefs,
        metaUpgrades: MetaUpgradeDefs,
        achievements: AchievementDefs,
    });
});

app.post('/api/unlock-character', authMiddleware, (req, res) => {
    const { characterId } = req.body;
    const charDef = CharacterDefs[characterId];
    if (!charDef) return res.status(400).json({ error: 'Invalid character' });

    const prog = stmts.getProgression.get(req.user.userId);
    const unlocks = stmts.getUnlocks.all(req.user.userId);
    const alreadyUnlocked = unlocks.some(u => u.unlock_type === 'character' && u.unlock_key === characterId);
    if (alreadyUnlocked) return res.status(400).json({ error: 'Already unlocked' });

    if (prog.gold < charDef.unlockCost) {
        return res.status(400).json({ error: 'Not enough gold' });
    }

    stmts.updateProgression.run(
        prog.gold - charDef.unlockCost, prog.total_xp, prog.account_level,
        prog.games_played, prog.total_kills, prog.best_time, req.user.userId
    );
    stmts.addUnlock.run(req.user.userId, 'character', characterId);

    res.json({ ok: true, goldSpent: charDef.unlockCost, newGold: prog.gold - charDef.unlockCost });
});

// Achievement checking — returns array of newly unlocked achievement keys
function checkAndAwardAchievements(userId, context) {
    const unlocks = stmts.getUnlocks.all(userId);
    const existing = new Set(unlocks.filter(u => u.unlock_type === 'achievement').map(u => u.unlock_key));
    const newlyUnlocked = [];

    for (const [key, def] of Object.entries(AchievementDefs)) {
        if (existing.has(key)) continue;
        let earned = false;
        switch(def.condition) {
            case 'kills': earned = (context.kills || 0) >= def.threshold; break;
            case 'time': earned = (context.time || 0) >= def.threshold; break;
            case 'victory': earned = context.victory === true; break;
            case 'boss_kill': earned = context.bossKill === true; break;
            case 'evolve': earned = context.evolved === true; break;
            case 'max_weapon': earned = context.maxWeapon === true; break;
            case 'full_weapons': earned = context.fullWeapons === true; break;
            case 'level': earned = (context.level || 0) >= def.threshold; break;
            case 'total_gold': {
                const prog = stmts.getProgression.get(userId);
                earned = prog && prog.gold >= def.threshold;
                break;
            }
            case 'total_kills': {
                const prog = stmts.getProgression.get(userId);
                earned = prog && prog.total_kills >= def.threshold;
                break;
            }
            case 'games_played': {
                const prog = stmts.getProgression.get(userId);
                earned = prog && prog.games_played >= def.threshold;
                break;
            }
            case 'all_characters': {
                const charUnlocks = unlocks.filter(u => u.unlock_type === 'character');
                earned = charUnlocks.length >= Object.keys(CharacterDefs).length;
                break;
            }
        }
        if (earned) {
            stmts.addUnlock.run(userId, 'achievement', key);
            newlyUnlocked.push(key);
        }
    }
    return newlyUnlocked;
}

app.get('/api/achievements', authMiddleware, (req, res) => {
    const unlocks = stmts.getUnlocks.all(req.user.userId);
    const earned = unlocks.filter(u => u.unlock_type === 'achievement').map(u => u.unlock_key);
    res.json({ achievements: AchievementDefs, earned });
});

// Dev mode: single endpoint, compare SHA-256 hashes only — secrets never in transit
const crypto = require('crypto');
function sha256(str) { return crypto.createHash('sha256').update(str).digest('hex'); }
const DEV_CODES = [
    { hash: sha256('REDACTED'), action: 'gold' },
    { hash: sha256('REDACTED'), action: 'reset' },
];
app.post('/api/dev-command', authMiddleware, (req, res) => {
    const { hashes } = req.body;
    if (!Array.isArray(hashes)) return res.json({ matched: false });

    const matched = DEV_CODES.find(c => hashes.includes(c.hash));
    if (!matched) return res.json({ matched: false });

    const uid = req.user.userId;
    if (matched.action === 'gold') {
        const prog = stmts.getProgression.get(uid);
        const newGold = 999999;
        stmts.updateProgression.run(
            newGold, prog.total_xp, prog.account_level,
            prog.games_played, prog.total_kills, prog.best_time, uid
        );
    } else if (matched.action === 'reset') {
        stmts.updateProgression.run(0, 0, 1, 0, 0, 0, uid);
        db.run('DELETE FROM unlocks WHERE user_id = ?', [uid]);
        db.run('DELETE FROM upgrades WHERE user_id = ?', [uid]);
        stmts.addUnlock.run(uid, 'character', 'knight');
        saveDb();
    }
    res.json({ matched: true });
});

// Reset account — wipes progression, unlocks, upgrades; keeps username/password
app.post('/api/account/reset', authMiddleware, (req, res) => {
    const uid = req.user.userId;
    stmts.updateProgression.run(0, 0, 1, 0, 0, 0, uid);
    db.run('DELETE FROM unlocks WHERE user_id = ?', [uid]);
    db.run('DELETE FROM upgrades WHERE user_id = ?', [uid]);
    stmts.addUnlock.run(uid, 'character', 'knight');
    saveDb();
    res.json({ ok: true });
});

// Delete account — removes user entirely
app.delete('/api/account', authMiddleware, (req, res) => {
    const { confirmUsername } = req.body;
    if (confirmUsername !== req.user.username) {
        return res.status(400).json({ error: 'Username does not match' });
    }
    const uid = req.user.userId;
    const token = req.headers['authorization']?.replace('Bearer ', '');
    db.run('DELETE FROM upgrades WHERE user_id = ?', [uid]);
    db.run('DELETE FROM unlocks WHERE user_id = ?', [uid]);
    db.run('DELETE FROM progression WHERE user_id = ?', [uid]);
    db.run('DELETE FROM users WHERE id = ?', [uid]);
    if (token) sessions.delete(token);
    saveDb();
    res.json({ ok: true });
});

app.post('/api/buy-upgrade', authMiddleware, (req, res) => {
    const { upgradeKey } = req.body;
    const upgDef = MetaUpgradeDefs[upgradeKey];
    if (!upgDef) return res.status(400).json({ error: 'Invalid upgrade' });

    const prog = stmts.getProgression.get(req.user.userId);
    const upgrades = stmts.getUpgrades.all(req.user.userId);
    const currentLevel = upgrades.find(u => u.upgrade_key === upgradeKey)?.level || 0;

    if (currentLevel >= upgDef.maxLevel) return res.status(400).json({ error: 'Already max level' });

    const cost = upgDef.cost[currentLevel];
    if (prog.gold < cost) return res.status(400).json({ error: 'Not enough gold' });

    const newLevel = currentLevel + 1;
    stmts.updateProgression.run(
        prog.gold - cost, prog.total_xp, prog.account_level,
        prog.games_played, prog.total_kills, prog.best_time, req.user.userId
    );
    stmts.setUpgrade.run(req.user.userId, upgradeKey, newLevel, newLevel);

    res.json({ ok: true, goldSpent: cost, newGold: prog.gold - cost, newLevel });
});

// ============================================================
// GAME CONSTANTS (shared with client)
// ============================================================
const GAME_DURATION = 20 * 60;
const WORLD_SIZE = 8000;
const MAX_ENEMIES_SOLO = 200;       // Solo cap (was 400 - way too many for 1 player)
const MAX_ENEMIES_PER_EXTRA = 100;  // Extra cap per additional player
const PICKUP_MAGNET_BASE = 80;      // Slightly larger base magnet (was 60)
const IFRAME_DURATION = 0.5;
const ENEMY_DAMAGE_FLASH = 0.1;
const TICK_RATE = 20; // server ticks per second
const TICK_DT = 1 / TICK_RATE;
const BROADCAST_RATE = 20; // network broadcasts per second (match tick rate for smooth remote player movement)
const BROADCAST_INTERVAL = 1 / BROADCAST_RATE;
const HEAL_DROP_RATE_SOLO = 0.06;   // 6% heal drop for solo (was 3%)
const HEAL_DROP_RATE_BASE = 0.03;   // 3% heal drop for multiplayer

// ============================================================
// WEAPON DEFINITIONS (server-side)
// ============================================================
const WeaponDefs = {
    magic_wand: {
        baseCooldown: 1.0, baseDamage: 10, baseSpeed: 350, baseCount: 1, basePierce: 1, baseArea: 1.0,
        projRadius: 6, projColor: '#44aaff', projTrail: true,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
            if (lv >= 2) s.damage *= 1.3;
            if (lv >= 3) s.count = 2;
            if (lv >= 4) { s.damage *= 1.3; s.speed *= 1.2; }
            if (lv >= 5) s.count = 3;
            if (lv >= 6) { s.damage *= 1.3; s.pierce += 1; }
            if (lv >= 7) { s.count = 4; s.pierce += 1; }
            return s;
        },
        fire(player, stats, enemies, projectiles) {
            const targets = findClosestEnemies(player.x, player.y, enemies, stats.count);
            for (const t of targets) {
                const dx = t.x - player.x, dy = t.y - player.y;
                const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                projectiles.push(makeProjectile(player.x, player.y, dx/dist*stats.speed, dy/dist*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, stats.pierce, 3.0, this.projTrail, player.id));
            }
            return targets.length > 0;
        }
    },
    knife: {
        baseCooldown: 0.7, baseDamage: 8, baseSpeed: 500, baseCount: 1, basePierce: 2, baseArea: 1.0,
        projRadius: 5, projColor: '#cccccc',
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
            if (lv >= 2) s.count = 2;
            if (lv >= 3) s.damage *= 1.4;
            if (lv >= 4) s.pierce += 2;
            if (lv >= 5) s.count = 3;
            if (lv >= 6) s.damage *= 1.4;
            if (lv >= 7) { s.count = 4; s.pierce += 2; }
            return s;
        },
        fire(player, stats, enemies, projectiles) {
            const dir = player.facing;
            const spread = 0.15;
            for (let i = 0; i < stats.count; i++) {
                const angle = Math.atan2(dir.y, dir.x) + (i - (stats.count-1)/2) * spread;
                projectiles.push(makeProjectile(player.x, player.y,
                    Math.cos(angle)*stats.speed, Math.sin(angle)*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    '#cccccc', stats.pierce, 2.0, false, player.id));
            }
            return true;
        }
    },
    garlic: {
        baseCooldown: 0.8, baseDamage: 5, baseRadius: 80, baseArea: 1.0,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, radius: this.baseRadius, area: this.baseArea, knockback: 0 };
            if (lv >= 2) { s.area *= 1.15; s.damage *= 1.2; }
            if (lv >= 3) { s.area *= 1.15; s.damage *= 1.2; }
            if (lv >= 4) { s.area *= 1.15; s.damage *= 1.2; s.knockback = 50; }
            if (lv >= 5) { s.area *= 1.15; s.damage *= 1.2; }
            if (lv >= 6) { s.area *= 1.2; s.damage *= 1.25; }
            if (lv >= 7) { s.area *= 1.2; s.damage *= 1.35; s.knockback = 120; }
            return s;
        },
        fire() { return false; }
    },
    holy_water: {
        baseCooldown: 3.0, baseDamage: 8, baseRadius: 50, baseDuration: 2.5, baseCount: 1, baseArea: 1.0,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, radius: this.baseRadius, area: this.baseArea, count: this.baseCount, duration: this.baseDuration };
            if (lv >= 2) s.area *= 1.25;
            if (lv >= 3) s.count = 2;
            if (lv >= 4) s.damage *= 1.4;
            if (lv >= 5) s.area *= 1.25;
            if (lv >= 6) { s.count = 3; s.damage *= 1.4; }
            if (lv >= 7) { s.count = 4; s.area *= 1.25; s.damage *= 1.4; }
            return s;
        },
        fire(player, stats, enemies, projectiles, aoeZones) {
            for (let i = 0; i < stats.count; i++) {
                const angle = Math.random() * Math.PI * 2;
                // Box-Muller normal distribution: mean=200, stddev=60, clamped to [80, 400]
                const u1 = Math.random() || 1e-10;
                const u2 = Math.random();
                const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
                const d = Math.max(80, Math.min(400, 200 + z * 60));
                aoeZones.push({
                    x: player.x + Math.cos(angle) * d,
                    y: player.y + Math.sin(angle) * d,
                    radius: stats.radius * stats.area * player.stats.area,
                    damage: stats.damage * player.stats.might,
                    duration: stats.duration, timer: 0, tickRate: 0.3,
                    ownerId: player.id
                });
            }
            return true;
        }
    },
    fire_wand: {
        baseCooldown: 2.0, baseDamage: 20, baseSpeed: 250, baseCount: 1, basePierce: 1, baseArea: 1.0,
        baseExplosionRadius: 60, projRadius: 8, projColor: '#ff6600', projTrail: true,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea, explosionRadius: this.baseExplosionRadius };
            if (lv >= 2) s.explosionRadius *= 1.25;
            if (lv >= 3) s.damage *= 1.35;
            if (lv >= 4) s.count = 2;
            if (lv >= 5) { s.explosionRadius *= 1.25; s.damage *= 1.35; }
            if (lv >= 6) s.count = 3;
            if (lv >= 7) { s.damage *= 1.5; s.explosionRadius *= 1.3; }
            return s;
        },
        fire(player, stats, enemies, projectiles) {
            const targets = findClosestEnemies(player.x, player.y, enemies, stats.count);
            for (const t of targets) {
                const dx = t.x - player.x, dy = t.y - player.y;
                const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                const p = makeProjectile(player.x, player.y, dx/dist*stats.speed, dy/dist*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, 1, 3.0, true, player.id);
                p.explosive = true;
                p.explosionRadius = stats.explosionRadius * player.stats.area;
                p.explosionDamage = stats.damage * player.stats.might * 0.6;
                projectiles.push(p);
            }
            return targets.length > 0;
        }
    },
    lightning_ring: {
        baseCooldown: 2.5, baseDamage: 15, baseCount: 1, baseArea: 1.0, baseRange: 250,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, count: this.baseCount, area: this.baseArea, range: this.baseRange };
            if (lv >= 2) s.count = 2;
            if (lv >= 3) s.damage *= 1.3;
            if (lv >= 4) s.count = 3;
            if (lv >= 5) { s.damage *= 1.3; s.range *= 1.25; }
            if (lv >= 6) s.count = 4;
            if (lv >= 7) { s.count = 5; s.damage *= 1.4; s.range *= 1.25; }
            return s;
        },
        fire(player, stats, enemies, projectiles, aoeZones, lightningEffects) {
            const range = stats.range * player.stats.area;
            const nearby = [];
            for (const e of enemies) {
                const dx = e.x - player.x, dy = e.y - player.y;
                if (dx*dx+dy*dy < range*range) nearby.push(e);
            }
            shuffleArray(nearby);
            const targets = nearby.slice(0, stats.count);
            for (const t of targets) {
                const dmg = stats.damage * player.stats.might;
                t.hp -= dmg;
                t.flashTimer = ENEMY_DAMAGE_FLASH;
                lightningEffects.push({
                    x1: player.x, y1: player.y, x2: t.x, y2: t.y, life: 0.15, maxLife: 0.15
                });
            }
            return targets.length > 0;
        }
    },
    axe: {
        baseCooldown: 1.6, baseDamage: 25, baseSpeed: 300, baseCount: 1, basePierce: 3, baseArea: 1.0,
        projRadius: 10, projColor: '#cc8844', projTrail: false,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
            if (lv >= 2) s.damage *= 1.3;
            if (lv >= 3) s.count = 2;
            if (lv >= 4) { s.damage *= 1.3; s.pierce += 2; }
            if (lv >= 5) s.count = 3;
            if (lv >= 6) s.damage *= 1.3;
            if (lv >= 7) { s.count = 4; s.pierce += 2; s.damage *= 1.3; }
            return s;
        },
        fire(player, stats, enemies, projectiles) {
            for (let i = 0; i < stats.count; i++) {
                const angle = -Math.PI/2 + (Math.random() - 0.5) * 1.2; // mostly upward with spread
                const p = makeProjectile(player.x, player.y,
                    Math.cos(angle) * stats.speed * 0.6, Math.sin(angle) * stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, stats.pierce, 3.0, false, player.id);
                p.gravity = 400; // pixels/sec^2, pulls projectile down
                p.spin = true;
                projectiles.push(p);
            }
            return true;
        }
    },
    whip: {
        baseCooldown: 1.2, baseDamage: 12, baseArea: 1.0, baseRange: 120, baseWidth: 40,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, area: this.baseArea, range: this.baseRange, width: this.baseWidth, hitBehind: false };
            if (lv >= 2) s.damage *= 1.3;
            if (lv >= 3) { s.range *= 1.2; s.width *= 1.2; }
            if (lv >= 4) s.damage *= 1.3;
            if (lv >= 5) { s.range *= 1.2; s.width *= 1.2; }
            if (lv >= 6) s.damage *= 1.3;
            if (lv >= 7) { s.damage *= 1.4; s.hitBehind = true; }
            return s;
        },
        fire(player, stats, enemies, projectiles, aoeZones, lightningEffects, slashEffects) {
            const dir = player.facing;
            const angle = Math.atan2(dir.y, dir.x);
            const range = stats.range * stats.area * player.stats.area;
            const width = stats.width * stats.area * player.stats.area;
            const dmg = stats.damage * player.stats.might;
            let hit = false;
            const directions = [angle];
            if (stats.hitBehind) directions.push(angle + Math.PI);
            for (const a of directions) {
                if (slashEffects) slashEffects.push({ x: player.x, y: player.y, angle: a, range, width, color: '#dd5555', life: 0.2 });
                const cosA = Math.cos(a), sinA = Math.sin(a);
                for (const e of enemies) {
                    if (e.hp <= 0) continue;
                    const dx = e.x - player.x, dy = e.y - player.y;
                    // Project onto whip direction
                    const along = dx * cosA + dy * sinA;
                    const perp = Math.abs(-dx * sinA + dy * cosA);
                    if (along > 0 && along < range && perp < width / 2) {
                        e.hp -= dmg;
                        e.flashTimer = ENEMY_DAMAGE_FLASH;
                        // Knockback away from player
                        const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                        e.x += (dx/dist) * 15;
                        e.y += (dy/dist) * 15;
                        hit = true;
                    }
                }
            }
            return hit || true; // always "fires" for visual
        }
    },
    cross: {
        baseCooldown: 1.5, baseDamage: 15, baseSpeed: 350, baseCount: 1, basePierce: 10, baseArea: 1.0,
        projRadius: 8, projColor: '#ffdd44', projTrail: true,
        getStats(lv) {
            const s = { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
            if (lv >= 2) s.damage *= 1.25;
            if (lv >= 3) s.count = 2;
            if (lv >= 4) s.speed *= 1.2;
            if (lv >= 5) s.damage *= 1.3;
            if (lv >= 6) s.count = 3;
            if (lv >= 7) { s.damage *= 1.3; s.pierce += 5; }
            return s;
        },
        fire(player, stats, enemies, projectiles) {
            const targets = findClosestEnemies(player.x, player.y, enemies, stats.count);
            if (targets.length === 0) {
                // Fire in facing direction if no enemies
                for (let i = 0; i < stats.count; i++) {
                    const p = makeProjectile(player.x, player.y,
                        player.facing.x * stats.speed, player.facing.y * stats.speed,
                        stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                        this.projColor, stats.pierce, 3.0, this.projTrail, player.id);
                    p.boomerang = true;
                    p.boomerangTime = 0.6;
                    p.originX = player.x;
                    p.originY = player.y;
                    p.ownerRef = player;
                    projectiles.push(p);
                }
                return true;
            }
            for (const t of targets) {
                const dx = t.x - player.x, dy = t.y - player.y;
                const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                const p = makeProjectile(player.x, player.y, dx/dist*stats.speed, dy/dist*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, stats.pierce, 3.0, this.projTrail, player.id);
                p.boomerang = true;
                p.boomerangTime = 0.6;
                p.originX = player.x;
                p.originY = player.y;
                p.ownerRef = player;
                projectiles.push(p);
            }
            return true;
        }
    },
};

const PassiveDefs = {
    might:    { stat: 'might', bonus: 0.10, maxLv: 5 },
    speed:    { stat: 'moveSpeed', bonus: 0.10, maxLv: 5 },
    maxHp:    { stat: 'maxHp', bonus: 0.15, maxLv: 5 },
    regen:    { stat: 'regen', bonus: 0.3, maxLv: 5 },
    armor:    { stat: 'armor', bonus: 1, maxLv: 5 },
    cooldown: { stat: 'cooldown', bonus: -0.08, maxLv: 5 },
    area:     { stat: 'area', bonus: 0.10, maxLv: 5 },
    magnet:   { stat: 'magnet', bonus: 0.25, maxLv: 5 },
};

// ============================================================
// WEAPON EVOLUTION DEFINITIONS
// ============================================================
// When a base weapon is at max level (7) and player has the required passive,
// picking up a chest evolves the weapon into its evolved form.
const EvolutionDefs = {
    magic_wand:     { requiresPassive: 'cooldown', evolvesInto: 'holy_wand' },
    knife:          { requiresPassive: 'might',    evolvesInto: 'thousand_edge' },
    garlic:         { requiresPassive: 'maxHp',    evolvesInto: 'soul_eater' },
    holy_water:     { requiresPassive: 'magnet',   evolvesInto: 'la_borra' },
    fire_wand:      { requiresPassive: 'area',     evolvesInto: 'hellfire' },
    lightning_ring: { requiresPassive: 'armor',    evolvesInto: 'thunder_loop' },
    axe:            { requiresPassive: 'might',    evolvesInto: 'death_spiral' },
    whip:           { requiresPassive: 'speed',    evolvesInto: 'bloody_tear' },
    cross:          { requiresPassive: 'cooldown', evolvesInto: 'heaven_sword' },
};

// Evolved weapon definitions — these replace the base weapon entirely
const EvolvedWeaponDefs = {
    holy_wand: {
        baseCooldown: 0.6, baseDamage: 18, baseSpeed: 400, baseCount: 3, basePierce: 3, baseArea: 1.2,
        projRadius: 7, projColor: '#88ddff', projTrail: true, homing: true,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
        },
        fire(player, stats, enemies, projectiles) {
            const targets = findClosestEnemies(player.x, player.y, enemies, stats.count);
            for (const t of targets) {
                const dx = t.x - player.x, dy = t.y - player.y;
                const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                const p = makeProjectile(player.x, player.y, dx/dist*stats.speed, dy/dist*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, stats.pierce, 4.0, this.projTrail, player.id);
                p.homing = true;
                p.evolved = true;
                p.shape = 5; // orb shape
                projectiles.push(p);
            }
            return targets.length > 0;
        }
    },
    thousand_edge: {
        baseCooldown: 0.45, baseDamage: 12, baseSpeed: 600, baseCount: 4, basePierce: 3, baseArea: 1.0,
        projRadius: 5, projColor: '#ccddff',
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
        },
        fire(player, stats, enemies, projectiles) {
            const dir = player.facing;
            const spread = 0.12;
            for (let i = 0; i < stats.count; i++) {
                const angle = Math.atan2(dir.y, dir.x) + (i - (stats.count-1)/2) * spread;
                const p = makeProjectile(player.x, player.y,
                    Math.cos(angle)*stats.speed, Math.sin(angle)*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, stats.pierce, 2.0, true, player.id);
                p.evolved = true;
                p.shape = 1; // blade but with evolved glow
                projectiles.push(p);
            }
            return true;
        }
    },
    soul_eater: {
        baseCooldown: 0.6, baseDamage: 12, baseRadius: 140, baseArea: 1.3, lifeSteal: 0.08, maxHealPercent: 0.03,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, radius: this.baseRadius, area: this.baseArea, knockback: 150, lifeSteal: this.lifeSteal, maxHealPercent: this.maxHealPercent };
        },
        fire() { return false; } // handled like garlic, in updateGarlicAura
    },
    la_borra: {
        baseCooldown: 2.5, baseDamage: 16, baseRadius: 80, baseDuration: 3.0, baseCount: 2, baseArea: 1.3,
        followPlayer: true,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, radius: this.baseRadius, area: this.baseArea, count: this.baseCount, duration: this.baseDuration };
        },
        fire(player, stats, enemies, projectiles, aoeZones) {
            for (let i = 0; i < stats.count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const d = 30 + Math.random() * 60;
                aoeZones.push({
                    x: player.x + Math.cos(angle) * d,
                    y: player.y + Math.sin(angle) * d,
                    radius: stats.radius * stats.area * player.stats.area,
                    damage: stats.damage * player.stats.might,
                    duration: stats.duration, timer: 0, tickRate: 0.35,
                    ownerId: player.id,
                    followPlayer: true, followOffset: { x: Math.cos(angle) * d, y: Math.sin(angle) * d },
                    evolved: true, color: '#aa44ff',
                });
            }
            return true;
        }
    },
    hellfire: {
        baseCooldown: 1.5, baseDamage: 35, baseSpeed: 280, baseCount: 4, basePierce: 1, baseArea: 1.3,
        baseExplosionRadius: 100, projRadius: 12, projColor: '#ff2200', projTrail: true,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea, explosionRadius: this.baseExplosionRadius };
        },
        fire(player, stats, enemies, projectiles) {
            const targets = findClosestEnemies(player.x, player.y, enemies, stats.count);
            for (const t of targets) {
                const dx = t.x - player.x, dy = t.y - player.y;
                const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                const p = makeProjectile(player.x, player.y, dx/dist*stats.speed, dy/dist*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, 1, 3.5, true, player.id);
                p.explosive = true;
                p.evolved = true;
                p.explosionRadius = stats.explosionRadius * player.stats.area;
                p.explosionDamage = stats.damage * player.stats.might * 0.8;
                projectiles.push(p);
            }
            return targets.length > 0;
        }
    },
    thunder_loop: {
        baseCooldown: 1.5, baseDamage: 25, baseCount: 6, baseArea: 1.0, baseRange: 350, chainCount: 2,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, count: this.baseCount, area: this.baseArea, range: this.baseRange, chainCount: this.chainCount };
        },
        fire(player, stats, enemies, projectiles, aoeZones, lightningEffects) {
            const range = stats.range * player.stats.area;
            const nearby = [];
            for (const e of enemies) {
                const dx = e.x - player.x, dy = e.y - player.y;
                if (dx*dx+dy*dy < range*range) nearby.push(e);
            }
            shuffleArray(nearby);
            const targets = nearby.slice(0, stats.count);
            const hitSet = new Set();
            for (const t of targets) {
                const dmg = stats.damage * player.stats.might;
                t.hp -= dmg;
                t.flashTimer = ENEMY_DAMAGE_FLASH;
                hitSet.add(t.id);
                lightningEffects.push({ x1: player.x, y1: player.y, x2: t.x, y2: t.y, life: 0.2, maxLife: 0.2, evolved: true });
                // Chain lightning to nearby enemies (2 chains for evolved)
                let chainSource = t;
                for (let c = 0; c < stats.chainCount; c++) {
                    let closestChain = null, closestDist = 180 * 180;
                    for (const e of enemies) {
                        if (hitSet.has(e.id) || e.hp <= 0) continue;
                        const cdx = e.x - chainSource.x, cdy = e.y - chainSource.y;
                        const cdSq = cdx*cdx+cdy*cdy;
                        if (cdSq < closestDist) { closestDist = cdSq; closestChain = e; }
                    }
                    if (!closestChain) break;
                    closestChain.hp -= dmg * 0.5;
                    closestChain.flashTimer = ENEMY_DAMAGE_FLASH;
                    hitSet.add(closestChain.id);
                    lightningEffects.push({ x1: chainSource.x, y1: chainSource.y, x2: closestChain.x, y2: closestChain.y, life: 0.2, maxLife: 0.2, evolved: true });
                    chainSource = closestChain;
                }
            }
            return targets.length > 0;
        }
    },
    death_spiral: {
        baseCooldown: 1.0, baseDamage: 35, baseSpeed: 350, baseCount: 5, basePierce: 5, baseArea: 1.3,
        projRadius: 14, projColor: '#ff2200', projTrail: true,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
        },
        fire(player, stats, enemies, projectiles) {
            for (let i = 0; i < stats.count; i++) {
                const angle = (Math.PI * 2 / stats.count) * i;
                const p = makeProjectile(player.x, player.y,
                    Math.cos(angle) * stats.speed, Math.sin(angle) * stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, stats.pierce, 3.5, true, player.id);
                p.gravity = 300;
                p.spin = true;
                p.evolved = true;
                p.shape = 6; // scythe shape
                projectiles.push(p);
            }
            return true;
        }
    },
    bloody_tear: {
        baseCooldown: 0.8, baseDamage: 25, baseArea: 1.3, baseRange: 180, baseWidth: 55, lifeSteal: 0.06, maxHealPercent: 0.04,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, area: this.baseArea, range: this.baseRange, width: this.baseWidth, hitBehind: true, lifeSteal: this.lifeSteal, maxHealPercent: this.maxHealPercent };
        },
        fire(player, stats, enemies, projectiles, aoeZones, lightningEffects, slashEffects) {
            const dir = player.facing;
            const angle = Math.atan2(dir.y, dir.x);
            const range = stats.range * stats.area * player.stats.area;
            const width = stats.width * stats.area * player.stats.area;
            const dmg = stats.damage * player.stats.might;
            let totalDmg = 0;
            const directions = [angle, angle + Math.PI];
            for (const a of directions) {
                if (slashEffects) slashEffects.push({ x: player.x, y: player.y, angle: a, range, width, color: '#cc0033', life: 0.25, evolved: true });
                const cosA = Math.cos(a), sinA = Math.sin(a);
                for (const e of enemies) {
                    if (e.hp <= 0) continue;
                    const dx = e.x - player.x, dy = e.y - player.y;
                    const along = dx * cosA + dy * sinA;
                    const perp = Math.abs(-dx * sinA + dy * cosA);
                    if (along > 0 && along < range && perp < width / 2) {
                        e.hp -= dmg;
                        e.flashTimer = ENEMY_DAMAGE_FLASH;
                        totalDmg += dmg;
                        const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                        e.x += (dx/dist) * 20;
                        e.y += (dy/dist) * 20;
                    }
                }
            }
            if (totalDmg > 0 && stats.lifeSteal) {
                const rawHeal = totalDmg * stats.lifeSteal;
                const maxHeal = player.maxHp * (stats.maxHealPercent || 0.04);
                player.hp = Math.min(player.maxHp, player.hp + Math.min(rawHeal, maxHeal));
            }
            return true;
        }
    },
    heaven_sword: {
        baseCooldown: 1.0, baseDamage: 30, baseSpeed: 450, baseCount: 3, basePierce: 12, baseArea: 1.3,
        projRadius: 10, projColor: '#ffff88', projTrail: true,
        getStats() {
            return { cooldown: this.baseCooldown, damage: this.baseDamage, speed: this.baseSpeed, count: this.baseCount, pierce: this.basePierce, area: this.baseArea };
        },
        fire(player, stats, enemies, projectiles) {
            const targets = findClosestEnemies(player.x, player.y, enemies, stats.count);
            const fireAt = targets.length > 0 ? targets : [];
            for (let i = 0; i < stats.count; i++) {
                let dx, dy;
                if (fireAt[i]) {
                    dx = fireAt[i].x - player.x; dy = fireAt[i].y - player.y;
                } else {
                    const a = (Math.PI * 2 / stats.count) * i;
                    dx = Math.cos(a); dy = Math.sin(a);
                }
                const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                const p = makeProjectile(player.x, player.y, dx/dist*stats.speed, dy/dist*stats.speed,
                    stats.damage * player.stats.might, this.projRadius * stats.area * player.stats.area,
                    this.projColor, stats.pierce, 4.0, this.projTrail, player.id);
                p.boomerang = true;
                p.boomerangTime = 0.8;
                p.originX = player.x;
                p.originY = player.y;
                p.ownerRef = player;
                p.evolved = true;
                p.shape = 7; // holy cross
                projectiles.push(p);
            }
            return true;
        }
    },
};

const EnemyDefs = {
    bat:       { name: 'Bat', hp: 8, speed: 80, damage: 5, radius: 10, color: '#885588', xp: 1 },
    skeleton:  { name: 'Skeleton', hp: 15, speed: 55, damage: 8, radius: 12, color: '#ccccaa', xp: 2 },
    zombie:    { name: 'Zombie', hp: 30, speed: 35, damage: 12, radius: 14, color: '#558855', xp: 3 },
    ghost:     { name: 'Ghost', hp: 12, speed: 90, damage: 7, radius: 10, color: '#aaaadd', xp: 2 },
    werewolf:  { name: 'Werewolf', hp: 50, speed: 70, damage: 15, radius: 16, color: '#886644', xp: 5 },
    mage:      { name: 'Dark Mage', hp: 20, speed: 45, damage: 10, radius: 12, color: '#8844aa', xp: 4 },
    elite_bat: { name: 'Elite Bat', hp: 80, speed: 100, damage: 15, radius: 14, color: '#cc66cc', xp: 10, elite: true },
    elite_skel:{ name: 'Elite Skeleton', hp: 150, speed: 65, damage: 20, radius: 18, color: '#ffddaa', xp: 15, elite: true },
    boss_reaper:{ name: 'The Reaper', hp: 800, speed: 40, damage: 20, radius: 30, color: '#ff2222', xp: 100, boss: true },
    boss_lich: { name: 'Lich King', hp: 1800, speed: 35, damage: 28, radius: 35, color: '#9922ff', xp: 200, boss: true },
    boss_dragon:{ name: 'Bone Dragon', hp: 4000, speed: 30, damage: 35, radius: 40, color: '#ff8800', xp: 500, boss: true },
};

// ============================================================
// ACHIEVEMENT DEFINITIONS
// ============================================================
const AchievementDefs = {
    first_blood:     { name: 'First Blood',       icon: '🗡️', desc: 'Kill your first enemy',                   condition: 'kills', threshold: 1 },
    slayer_100:      { name: 'Slayer',             icon: '💀', desc: 'Kill 100 enemies in a single run',        condition: 'kills', threshold: 100 },
    slayer_500:      { name: 'Mass Extinction',    icon: '☠️', desc: 'Kill 500 enemies in a single run',        condition: 'kills', threshold: 500 },
    survivor_5:      { name: 'Survivor',           icon: '⏱️', desc: 'Survive for 5 minutes',                   condition: 'time', threshold: 300 },
    survivor_10:     { name: 'Enduring',           icon: '🕐', desc: 'Survive for 10 minutes',                  condition: 'time', threshold: 600 },
    survivor_15:     { name: 'Ironclad',           icon: '🕑', desc: 'Survive for 15 minutes',                  condition: 'time', threshold: 900 },
    victory:         { name: 'Champion',           icon: '🏆', desc: 'Win a game',                              condition: 'victory', threshold: 1 },
    boss_slayer:     { name: 'Boss Slayer',        icon: '🐉', desc: 'Kill a boss',                             condition: 'boss_kill', threshold: 1 },
    evolve_weapon:   { name: 'Evolution',          icon: '🔥', desc: 'Evolve a weapon',                         condition: 'evolve', threshold: 1 },
    max_weapon:      { name: 'Perfection',         icon: '⭐', desc: 'Max out a weapon to Lv 7',                condition: 'max_weapon', threshold: 1 },
    full_build:      { name: 'Full Arsenal',       icon: '🎒', desc: 'Fill all 6 weapon slots',                 condition: 'full_weapons', threshold: 1 },
    level_20:        { name: 'Experienced',        icon: '📖', desc: 'Reach room level 20',                     condition: 'level', threshold: 20 },
    level_40:        { name: 'Veteran',            icon: '📚', desc: 'Reach room level 40',                     condition: 'level', threshold: 40 },
    gold_hoarder:    { name: 'Gold Hoarder',       icon: '💰', desc: 'Accumulate 50,000 total gold',            condition: 'total_gold', threshold: 50000 },
    total_kills_1k:  { name: 'Genocide',           icon: '💀', desc: 'Kill 1,000 enemies total across all runs', condition: 'total_kills', threshold: 1000 },
    total_kills_10k: { name: 'Armageddon',         icon: '🌋', desc: 'Kill 10,000 enemies total across all runs',condition: 'total_kills', threshold: 10000 },
    games_10:        { name: 'Regular',            icon: '🎮', desc: 'Play 10 games',                           condition: 'games_played', threshold: 10 },
    all_characters:  { name: 'Collector',          icon: '👥', desc: 'Unlock all characters',                   condition: 'all_characters', threshold: 1 },
};

// ============================================================
// GAME HELPER FUNCTIONS
// ============================================================
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i+1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

function findClosestEnemies(x, y, enemies, count) {
    const sorted = enemies.filter(e => e.hp > 0).map(e => ({ e, d: (e.x-x)**2+(e.y-y)**2 })).sort((a,b) => a.d-b.d);
    return sorted.slice(0, count).map(s => s.e);
}

let nextProjectileIdGlobal = 1;
function makeProjectile(x, y, vx, vy, damage, radius, color, pierce, lifetime, trail, ownerId) {
    return { id: nextProjectileIdGlobal++, x, y, vx, vy, damage, radius, color, pierce, lifetime, trail, hitSet: new Set(), age: 0, ownerId };
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function xpForLevel(lv, playerCount) {
    const base = Math.floor(5 + lv * 8 + lv * lv * 0.8);
    // Scale XP requirements by player count so shared XP doesn't make leveling too fast
    // Solo: 1x, 2P: 1.4x, 3P: 1.7x, 4P: 2x
    const scale = playerCount ? 1 + (playerCount - 1) * 0.33 : 1;
    return Math.floor(base * scale);
}

function getWaveConfig(gameTime) {
    const minute = gameTime / 60;
    const configs = [];
    // Base spawn rates tuned for solo - multiplayer scaling handled in spawnEnemies()
    // Rates are enemies-per-second before difficulty multiplier
    configs.push({ type: 'bat', weight: Math.max(1, 10 - minute), rate: 0.6 + minute * 0.15 });
    if (minute >= 1) configs.push({ type: 'skeleton', weight: 5, rate: 0.3 + minute * 0.08 });
    if (minute >= 2) configs.push({ type: 'zombie', weight: 4, rate: 0.2 + minute * 0.06 });
    if (minute >= 3) configs.push({ type: 'ghost', weight: 4, rate: 0.25 + minute * 0.08 });
    if (minute >= 5) configs.push({ type: 'werewolf', weight: 3, rate: 0.1 + minute * 0.03 });
    if (minute >= 7) configs.push({ type: 'mage', weight: 3, rate: 0.08 + minute * 0.03 });
    if (minute >= 5) configs.push({ type: 'elite_bat', weight: 1, rate: 0.03 + minute * 0.012 });
    if (minute >= 8) configs.push({ type: 'elite_skel', weight: 1, rate: 0.02 + minute * 0.01 });
    return configs;
}

function getBossForTime(gameTime) {
    const minute = gameTime / 60;
    if (minute >= 20 && minute < 21) return 'boss_dragon';
    if (minute >= 15 && minute < 16) return 'boss_lich';
    if (minute >= 10 && minute < 11) return 'boss_lich';
    if (minute >= 5 && minute < 6) return 'boss_reaper';
    return null;
}

// ============================================================
// GAME ROOM (server-authoritative game simulation for co-op)
// ============================================================
class GameRoom {
    constructor(roomId, hostClient) {
        this.roomId = roomId;
        this.players = new Map(); // playerId -> playerState
        this.clients = new Map(); // playerId -> ws client info
        this.state = null;
        this.running = false;
        this.paused = false;
        this.pausedBy = new Set(); // playerIds currently choosing upgrades
        this.manuallyPaused = false; // true when any player pressed Escape to pause
        this.manualPausedBy = null; // username of last person who triggered manual pause
        this.tickInterval = null;
        this.lastBossMinute = -1;
        this.maxPlayers = 4;
        this.pendingLevelUps = new Map(); // playerId -> array of pending level-ups
        this.rerollsRemaining = new Map(); // playerId -> rerolls left for current level-up
        this.nextEnemyId = 1;
        this.nextPickupId = 1;
        this.nextProjectileId = 1;
        this.nextZoneId = 1;
        this.broadcastTimer = 0; // throttle broadcasts to BROADCAST_RATE
        this.pendingSfx = []; // batch SFX into state updates
        this.knownEntities = new Map(); // playerId -> Set of enemy IDs they've seen (for static data dedup)
        this.userSessionCount = new Map(); // userId -> number of sessions in this room (games_played only increments on first)
        this.disconnectedPlayers = new Map(); // userId -> saved player state (for rejoin)
    }

    get playerCount() { return this.players.size; }
    get isFull() { return this.playerCount >= this.maxPlayers; }

    addPlayer(playerId, ws, username, characterId, metaUpgrades, userId) {
        const spawnAngle = (this.playerCount) * (Math.PI * 2 / 4);
        const spawnDist = this.playerCount === 0 ? 0 : 80;
        const cx = WORLD_SIZE / 2 + Math.cos(spawnAngle) * spawnDist;
        const cy = WORLD_SIZE / 2 + Math.sin(spawnAngle) * spawnDist;

        // Check if this user has saved state from a previous session in this room
        const saved = userId ? this.disconnectedPlayers.get(userId) : null;
        let player;
        let isRejoin = false;

        if (saved && this.running) {
            // Rejoin: restore saved player state with new playerId and ws
            isRejoin = true;
            this.disconnectedPlayers.delete(userId);
            player = saved;
            player.id = playerId;
            player.username = username;
            player.x = cx;
            player.y = cy;
            player.facing = { x: 1, y: 0 };
            player.iframeTimer = 0;
            player.walkAnim = 0;
            player.input = { dx: 0, dy: 0 };
            // Keep alive status, weapons, passives, stats, level, kills, etc.
            // Update joinTime to current game time (gold calc for this session starts now)
            player.joinTime = this.state ? this.state.gameTime : 0;
        } else {
            // Fresh join: create new player
            const charDef = CharacterDefs[characterId] || CharacterDefs.knight;

            // Compute meta stat bonuses
            const metaStats = { might: 0, moveSpeed: 0, maxHp: 0, armor: 0, regen: 0, cooldown: 0, area: 0, magnet: 0 };
            let metaRerollBonus = 0;
            if (metaUpgrades) {
                for (const [key, level] of Object.entries(metaUpgrades)) {
                    const def = MetaUpgradeDefs[key];
                    if (def && level > 0) {
                        if (key === 'meta_reroll') {
                            metaRerollBonus = level;
                        } else if (def.stat) {
                            metaStats[def.stat] = (metaStats[def.stat] || 0) + def.bonus * level;
                        }
                    }
                }
            }

            player = {
                id: playerId,
                username: username,
                characterId: characterId,
                x: cx, y: cy,
                radius: 8,
                hp: charDef.baseHp,
                maxHp: charDef.baseHp,
                level: 1, xp: 0, xpToNext: xpForLevel(1, this.players.size + 1),
                weapons: { [charDef.startingWeapon]: 1 },
                passives: {},
                stats: { might: 1, moveSpeed: 1, maxHp: 1, regen: 0, armor: 0, cooldown: 1, area: 1, magnet: 1 },
                charBonuses: charDef.statBonuses,
                metaStats: metaStats,
                baseSpeed: charDef.baseSpeed,
                baseHp: charDef.baseHp,
                facing: { x: 1, y: 0 },
                iframeTimer: 0,
                weaponTimers: {},
                walkAnim: 0,
                input: { dx: 0, dy: 0 },
                alive: true,
                deathTime: null,
                kills: 0,
                bossKills: 0,
                hasEvolved: false,
                color: charDef.color,
                cloakColor: charDef.cloakColor,
                skinColor: charDef.skinColor,
                joinTime: this.state ? this.state.gameTime : 0,
                maxRerolls: metaRerollBonus,
            };
        }

        this.players.set(playerId, player);
        this.clients.set(playerId, { ws, username, userId: userId || null });
        this.pendingLevelUps.set(playerId, saved ? (saved._pendingLevelUps || []) : []);
        if (saved && saved._rerollsRemaining !== undefined) {
            this.rerollsRemaining.set(playerId, saved._rerollsRemaining);
        }
        this.knownEntities.set(playerId, new Set());

        if (!isRejoin) {
            this.recalcPlayerStats(player);
            player.hp = player.maxHp; // Start at full HP (after meta upgrades applied)
        }

        // Recalc room XP threshold since player count changed
        this.recalcRoomXpThreshold();

        return { player, isRejoin };
    }

    savePlayerState(playerId) {
        const player = this.players.get(playerId);
        const clientInfo = this.clients.get(playerId);
        if (player && clientInfo && clientInfo.userId && this.running) {
            // Save pending level-ups and reroll state along with the player state
            const pending = this.pendingLevelUps.get(playerId) || [];
            player._pendingLevelUps = pending;
            player._rerollsRemaining = this.rerollsRemaining.get(playerId) || 0;
            this.disconnectedPlayers.set(clientInfo.userId, player);
        }
    }

    removePlayer(playerId) {
        this.players.delete(playerId);
        this.clients.delete(playerId);
        this.pendingLevelUps.delete(playerId);
        this.knownEntities.delete(playerId);
        // If this player was choosing an upgrade, remove them from pause set
        if (this.pausedBy.has(playerId)) {
            this.pausedBy.delete(playerId);
            this.checkUnpause();
        }
        if (this.players.size === 0 && this.disconnectedPlayers.size === 0) {
            this.stop();
        } else if (this.players.size > 0) {
            // Recalc room XP threshold since player count changed
            this.recalcRoomXpThreshold();
        }
    }

    recalcPlayerStats(player) {
        const s = player.stats;
        s.might = 1; s.moveSpeed = 1; s.maxHp = 1; s.regen = 0;
        s.armor = 0; s.cooldown = 1; s.area = 1; s.magnet = 1;

        // Apply passive upgrades from in-game
        for (const [key, lv] of Object.entries(player.passives)) {
            const def = PassiveDefs[key];
            if (!def) continue;
            for (let i = 0; i < lv; i++) {
                s[def.stat] += def.bonus;
            }
        }

        // Apply character bonuses (only real stats, skip special ability keys)
        const specialKeys = new Set(['healAura', 'healRadius', 'healOnKill', 'allyMightAura', 'mightPerKill', 'mightPerKillCap', 'berserkerRage', 'berserkerLifesteal']);
        if (player.charBonuses) {
            for (const [stat, val] of Object.entries(player.charBonuses)) {
                if (specialKeys.has(stat)) continue;
                s[stat] = (s[stat] || 0) + val;
            }
        }

        // Apply meta upgrades
        if (player.metaStats) {
            for (const [stat, val] of Object.entries(player.metaStats)) {
                s[stat] = (s[stat] || 0) + val;
            }
        }

        // Necromancer kill scaling (capped with diminishing returns)
        if (player.charBonuses && player.charBonuses.mightPerKill) {
            const rawBonus = player.kills * player.charBonuses.mightPerKill;
            const cap = player.charBonuses.mightPerKillCap || 1.5;
            // Soft cap: diminishing returns past 50% of cap, hard cap at max
            const softCapThreshold = cap * 0.5;
            let effectiveBonus;
            if (rawBonus <= softCapThreshold) {
                effectiveBonus = rawBonus;
            } else {
                // Past soft cap, bonus grows at half rate
                effectiveBonus = softCapThreshold + (rawBonus - softCapThreshold) * 0.5;
            }
            s.might += Math.min(effectiveBonus, cap);
        }

        // Berserker rage bonus
        if (player.charBonuses && player.charBonuses.berserkerRage && player._lastRageMight) {
            s.might += player._lastRageMight;
        }

        // Druid might aura: buffs nearby allies at full rate, self at 50% rate
        for (const other of this.players.values()) {
            if (!other.alive) continue;
            if (other.charBonuses && other.charBonuses.allyMightAura) {
                if (other.id === player.id) {
                    // Self-buff at 50% rate
                    s.might += other.charBonuses.allyMightAura * 0.5;
                } else {
                    const dx = player.x - other.x, dy = player.y - other.y;
                    const radius = other.charBonuses.healRadius || 120;
                    if (dx * dx + dy * dy <= radius * radius) {
                        s.might += other.charBonuses.allyMightAura;
                    }
                }
            }
        }

        player.maxHp = Math.floor(player.baseHp * s.maxHp);
        player.hp = Math.min(player.hp, player.maxHp);
    }

    revivePlayer(player) {
        // Find an alive ally to respawn at
        const alivePlayers = [...this.players.values()].filter(p => p.alive);
        if (alivePlayers.length === 0) return;

        const ally = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];

        // Spawn directly at ally position
        player.x = ally.x;
        player.y = ally.y;

        // Revive with half HP
        player.alive = true;
        player.deathTime = null;
        player.hp = Math.floor(player.maxHp * 0.5);
        player.iframeTimer = 2.0; // 2 seconds of invulnerability

        // Broadcast revive with position so clients can reset interpolation
        this.broadcast({ type: 'player_revived', playerId: player.id, username: player.username, x: Math.round(player.x), y: Math.round(player.y) });

        // Notify the player
        this.queueSfxForPlayer(player.id, 'revive');
    }

    recalcRoomXpThreshold() {
        if (this.state) {
            this.state.roomXpToNext = xpForLevel(this.state.roomLevel, this.players.size);
        }
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.paused = false;
        this.pausedBy.clear();
        this.manuallyPaused = false;
        this.manualPausedBy = null;
        this.lastBossMinute = -1;

        const playerCount = this.players.size;
        this.state = {
            gameTime: 0,
            kills: 0,
            enemies: [],
            projectiles: [],
            pickups: [],
            aoeZones: [],
            lightningEffects: [],
            slashEffects: [],
            explosionEffects: [],
            spawnAccumulator: {},
            playerCount: playerCount,
            roomLevel: 1,
            roomXp: 0,
            roomXpToNext: xpForLevel(1, playerCount),
        };

        // Initialize rerolls for the entire run (per-run, not per-level-up)
        for (const [pid, player] of this.players) {
            this.rerollsRemaining.set(pid, player.maxRerolls || 0);
        }

        // Broadcast game start
        this.broadcast({ type: 'game_start', playerCount });

        this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    }

    stop() {
        this.running = false;
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
    }

    // Buffer SFX to batch into next state broadcast (avoids separate tiny messages)
    queueSfx(sound) {
        if (!this.pendingSfx.includes(sound)) {
            this.pendingSfx.push(sound);
        }
    }

    // Buffer SFX for a specific player only
    queueSfxForPlayer(playerId, sound) {
        const clientInfo = this.clients.get(playerId);
        if (!clientInfo) return;
        if (!clientInfo.pendingSfx) clientInfo.pendingSfx = [];
        if (!clientInfo.pendingSfx.includes(sound)) {
            clientInfo.pendingSfx.push(sound);
        }
    }

    tick() {
        if (!this.running || !this.state) return;
        // When paused (someone is choosing an upgrade), don't simulate or broadcast
        if (this.paused) {
            return;
        }
        const dt = TICK_DT;
        const st = this.state;
        st.gameTime += dt;

        // Check if all players are dead (ignore if no active players but disconnected ones exist)
        if (this.players.size === 0 && this.disconnectedPlayers.size > 0) {
            // No active players but some may rejoin — keep ticking but skip gameplay
            return;
        }
        let anyAlive = false;
        for (const [, p] of this.players) {
            if (p.alive) { anyAlive = true; break; }
        }
        if (!anyAlive) {
            this.endGame('gameover');
            return;
        }

        // Boss check — MUST run before victory check so final boss can spawn
        const currentMinute = Math.floor(st.gameTime / 60);
        const bossType = getBossForTime(st.gameTime);
        if (bossType && currentMinute !== this.lastBossMinute) {
            this.lastBossMinute = currentMinute;
            this.spawnBoss(bossType);
        }

        // Check victory - must kill final boss (after boss spawn so dragon gets a chance)
        if (st.gameTime >= GAME_DURATION) {
            let bossAlive = false;
            for (const e of st.enemies) {
                if (e.boss) {
                    bossAlive = true;
                    break;
                }
            }
            if (!bossAlive) {
                this.endGame('victory');
                return;
            }
        }

        // Check for dead players to revive after 10 seconds
        for (const [, p] of this.players) {
            if (!p.alive && p.deathTime && st.gameTime - p.deathTime >= 10) {
                this.revivePlayer(p);
            }
        }

        // Update each player
        for (const [, p] of this.players) {
            if (!p.alive) continue;
            this.updatePlayer(p, dt);
        }

        // Spawn enemies (scale spawn rate by player count)
        this.spawnEnemies(dt);

        // Weapons for each player
        for (const [, p] of this.players) {
            if (!p.alive) continue;
            this.updateWeapons(p, dt);
            this.updateGarlicAura(p, dt);
        }

        // Projectiles
        this.updateProjectiles(dt);

        // AOE zones
        this.updateAOEZones(dt);

        // Enemies
        this.updateEnemies(dt);

        // Pickups (each player has own magnet)
        this.updatePickups(dt);

        // Lightning effects
        for (let i = st.lightningEffects.length - 1; i >= 0; i--) {
            st.lightningEffects[i].life -= dt;
            if (st.lightningEffects[i].life <= 0) st.lightningEffects.splice(i, 1);
        }
        // Slash effects (whip/bloody tear)
        for (let i = st.slashEffects.length - 1; i >= 0; i--) {
            st.slashEffects[i].life -= dt;
            if (st.slashEffects[i].life <= 0) st.slashEffects.splice(i, 1);
        }
        // Explosion effects (fire wand/hellfire)
        for (let i = st.explosionEffects.length - 1; i >= 0; i--) {
            st.explosionEffects[i].life -= dt;
            if (st.explosionEffects[i].life <= 0) st.explosionEffects.splice(i, 1);
        }

        // Throttle broadcasts to BROADCAST_RATE (10Hz) instead of every tick (20Hz)
        this.broadcastTimer += dt;
        if (this.broadcastTimer < BROADCAST_INTERVAL) return;
        this.broadcastTimer -= BROADCAST_INTERVAL;

        // Send state to all clients
        this.broadcastState();
    }

    updatePlayer(p, dt) {
        const dir = p.input;
        const speed = p.baseSpeed * p.stats.moveSpeed;
        p.x += dir.dx * speed * dt;
        p.y += dir.dy * speed * dt;
        p.x = clamp(p.x, 50, WORLD_SIZE - 50);
        p.y = clamp(p.y, 50, WORLD_SIZE - 50);
        if (dir.dx !== 0 || dir.dy !== 0) {
            p.facing = { x: dir.dx, y: dir.dy };
            p.walkAnim += dt * speed * 0.03;
        }

        // Regen
        if (p.stats.regen > 0) {
            p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);
        }

        // Healer aura (Priest): heal nearby allies + self (self at 50% rate), scales with game time
        if (p.charBonuses && p.charBonuses.healAura && p.alive) {
            const baseHeal = p.charBonuses.healAura; // 3.0
            const gameTime = this.state.gameTime || 0;
            const healPerSec = Math.min(baseHeal + gameTime / 180, 8.0); // scales up to 8 HP/s by ~15 min
            const radius = p.charBonuses.healRadius || 150;
            // Self-heal at 50% rate
            p.hp = Math.min(p.maxHp, p.hp + healPerSec * 0.5 * dt);
            for (const ally of this.players.values()) {
                if (ally.id === p.id || !ally.alive) continue;
                const dx = ally.x - p.x, dy = ally.y - p.y;
                if (dx * dx + dy * dy <= radius * radius) {
                    ally.hp = Math.min(ally.maxHp, ally.hp + healPerSec * dt);
                }
            }
        }

        // Druid ally might aura: boost nearby allies' damage
        if (p.charBonuses && p.charBonuses.allyMightAura && p.alive) {
            // Applied during recalcPlayerStats instead (checked each tick via flag)
        }

        // Necromancer kill scaling: accumulate might from kills
        if (p.charBonuses && p.charBonuses.mightPerKill) {
            const bonusMight = p.kills * p.charBonuses.mightPerKill;
            if (p._lastKillMight !== bonusMight) {
                p._lastKillMight = bonusMight;
                this.recalcPlayerStats(p);
            }
        }

        // Berserker rage: more damage at low HP (recalc when HP changes significantly)
        if (p.charBonuses && p.charBonuses.berserkerRage) {
            const hpRatio = p.hp / p.maxHp;
            const rageMight = (1 - hpRatio) * 1.0; // up to +100% damage at 0 HP
            if (Math.abs((p._lastRageMight || 0) - rageMight) > 0.02) {
                p._lastRageMight = rageMight;
                this.recalcPlayerStats(p);
            }
        }

        // iframes
        if (p.iframeTimer > 0) p.iframeTimer -= dt;
    }

    spawnEnemies(dt) {
        const st = this.state;
        const alivePlayers = [...this.players.values()].filter(p => p.alive);
        const playerCount = alivePlayers.length;
        
        // Scale max enemies with player count
        const maxEnemies = MAX_ENEMIES_SOLO + (playerCount - 1) * MAX_ENEMIES_PER_EXTRA;
        if (st.enemies.length >= maxEnemies) return;

        const configs = getWaveConfig(st.gameTime);
        // Time scaling: gentler curve - reaches 4x by 20 min instead of 13x
        // Solo gets base rate, each extra player adds 50% more spawns
        const playerMult = 1 + (playerCount - 1) * 0.5;
        const timeScale = 1 + st.gameTime / 400; // Much gentler: 4x at 20 min (was /100 = 13x)
        const difficultyMult = timeScale * playerMult;

        for (const cfg of configs) {
            const key = cfg.type;
            if (!st.spawnAccumulator[key]) st.spawnAccumulator[key] = 0;
            st.spawnAccumulator[key] += cfg.rate * difficultyMult * dt;
            while (st.spawnAccumulator[key] >= 1 && st.enemies.length < maxEnemies) {
                st.spawnAccumulator[key] -= 1;
                this.spawnEnemy(cfg.type);
            }
        }
    }

    spawnEnemy(type) {
        const def = EnemyDefs[type];
        // Spawn near a random alive player
        const alivePlayers = [...this.players.values()].filter(p => p.alive);
        if (alivePlayers.length === 0) return;
        const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        const playerCount = alivePlayers.length;

        // Try up to 5 angles to avoid spawning too close (world-edge clamping can collapse distance)
        let x, y;
        const MIN_SPAWN_DIST = 400;
        for (let attempt = 0; attempt < 5; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 500 + Math.random() * 200;
            x = Math.max(20, Math.min(WORLD_SIZE - 20, target.x + Math.cos(angle) * dist));
            y = Math.max(20, Math.min(WORLD_SIZE - 20, target.y + Math.sin(angle) * dist));
            const dx = x - target.x, dy = y - target.y;
            if (Math.sqrt(dx * dx + dy * dy) >= MIN_SPAWN_DIST) break;
            if (attempt === 4) return; // All attempts too close, skip this spawn
        }

        // HP scaling: gentle time growth + per-player scaling
        // Solo: 1x at start, ~2.3x at 20 min (was 5x)
        // 4-player: each enemy has 60% more HP per extra player (so total DPS needed scales with group size)
        const timeMult = 1 + this.state.gameTime / 500;       // Gentler: 3.4x at 20 min (was /300 = 5x)
        const playerScaleHp = 1 + (playerCount - 1) * 0.4;    // 40% more HP per extra player

        // Damage scaling: very gentle time growth + per-player scaling
        // Solo: 1x at start, ~1.5x at 20 min (was 3x)
        // Multiplayer players have combined HP pools so enemies can hit harder
        const playerScaleDmg = 1 + (playerCount - 1) * 0.2;   // 20% more damage per extra player
        const timeDmgMult = 1 + this.state.gameTime / 1200;    // Gentle: 2x at 20 min (was /600 = 3x)

        this.state.enemies.push({
            id: this.nextEnemyId++,
            x, y, radius: def.radius, color: def.color,
            hp: def.hp * timeMult * playerScaleHp,
            maxHp: def.hp * timeMult * playerScaleHp,
            speed: def.speed, 
            damage: def.damage * timeDmgMult * playerScaleDmg,
            xp: def.xp, name: def.name,
            boss: def.boss || false, elite: def.elite || false,
            flashTimer: 0, wobblePhase: Math.random() * Math.PI * 2,
            contactTimer: 0,
        });
    }

    spawnBoss(type) {
        const def = EnemyDefs[type];
        const alivePlayers = [...this.players.values()].filter(p => p.alive);
        if (alivePlayers.length === 0) return;
        const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
        const playerCount = alivePlayers.length;

        // Try up to 5 angles to avoid spawning too close (world-edge clamping can collapse distance)
        let x, y;
        const MIN_SPAWN_DIST = 350;
        for (let attempt = 0; attempt < 5; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            x = Math.max(20, Math.min(WORLD_SIZE - 20, target.x + Math.cos(angle) * 400));
            y = Math.max(20, Math.min(WORLD_SIZE - 20, target.y + Math.sin(angle) * 400));
            const dx = x - target.x, dy = y - target.y;
            if (Math.sqrt(dx * dx + dy * dy) >= MIN_SPAWN_DIST) break;
            // Bosses always spawn — last attempt uses whatever position we got
        }

        // Boss HP scales significantly per player since all players DPS together
        // Solo: base HP. 2P: 1.8x. 3P: 2.6x. 4P: 3.4x
        const playerScaleHp = 1 + (playerCount - 1) * 0.8;
        // Boss damage scales mildly - multiple players share the threat
        const playerScaleDmg = 1 + (playerCount - 1) * 0.15;

        this.state.enemies.push({
            id: this.nextEnemyId++,
            x, y, radius: def.radius, color: def.color,
            hp: def.hp * playerScaleHp,
            maxHp: def.hp * playerScaleHp,
            speed: def.speed, damage: def.damage * playerScaleDmg,
            xp: def.xp, name: def.name,
            boss: true, elite: false,
            flashTimer: 0, wobblePhase: 0,
            contactTimer: 0,
        });

        this.queueSfx('boss');
    }

    updateWeapons(player, dt) {
        const st = this.state;
        for (const [wepKey, wepLv] of Object.entries(player.weapons)) {
            // Check if this is an evolved weapon or a base weapon
            const isEvolved = !!EvolvedWeaponDefs[wepKey];
            const def = isEvolved ? EvolvedWeaponDefs[wepKey] : WeaponDefs[wepKey];
            if (!def) continue;
            // Skip garlic/soul_eater (handled in updateGarlicAura)
            if (wepKey === 'garlic' || wepKey === 'soul_eater') continue;
            if (!player.weaponTimers[wepKey]) player.weaponTimers[wepKey] = 0;
            player.weaponTimers[wepKey] -= dt;
            if (player.weaponTimers[wepKey] <= 0) {
                const stats = isEvolved ? def.getStats() : def.getStats(wepLv);
                const cd = stats.cooldown * player.stats.cooldown;
                player.weaponTimers[wepKey] = cd;
                if (st.enemies.length > 0) {
                    const fired = def.fire(player, stats, st.enemies, st.projectiles, st.aoeZones, st.lightningEffects, st.slashEffects);
                    if (fired) {
                        this.queueSfx('shoot');
                    }
                }
            }
        }
    }

    updateGarlicAura(player, dt) {
        const st = this.state;
        // Handle both garlic and its evolution (soul_eater)
        const auraKey = player.weapons.soul_eater ? 'soul_eater' : (player.weapons.garlic ? 'garlic' : null);
        if (!auraKey) return;
        const isEvolved = auraKey === 'soul_eater';
        const def = isEvolved ? EvolvedWeaponDefs.soul_eater : WeaponDefs.garlic;
        const stats = isEvolved ? def.getStats() : def.getStats(player.weapons.garlic);
        if (!player.weaponTimers[auraKey]) player.weaponTimers[auraKey] = 0;
        player.weaponTimers[auraKey] -= dt;
        if (player.weaponTimers[auraKey] <= 0) {
            player.weaponTimers[auraKey] = stats.cooldown * player.stats.cooldown;
            const radius = stats.radius * stats.area * player.stats.area;
            let totalDamageDealt = 0;
            for (const e of st.enemies) {
                if (e.hp <= 0) continue;
                const dx = e.x - player.x, dy = e.y - player.y;
                const distSq = dx*dx+dy*dy;
                if (distSq < radius*radius) {
                    const dmg = stats.damage * player.stats.might;
                    e.hp -= dmg;
                    e.flashTimer = ENEMY_DAMAGE_FLASH;
                    totalDamageDealt += dmg;
                    if (stats.knockback > 0) {
                        const d = Math.sqrt(distSq) || 1;
                        e.x += (dx/d) * stats.knockback * 0.15;
                        e.y += (dy/d) * stats.knockback * 0.15;
                    }
                }
            }
            // Soul Eater life steal (capped per tick)
            if (isEvolved && stats.lifeSteal > 0 && totalDamageDealt > 0) {
                const rawHeal = totalDamageDealt * stats.lifeSteal;
                const maxHeal = player.maxHp * (stats.maxHealPercent || 0.03);
                player.hp = Math.min(player.maxHp, player.hp + Math.min(rawHeal, maxHeal));
            }
        }
    }

    updateProjectiles(dt) {
        const st = this.state;
        for (let i = st.projectiles.length - 1; i >= 0; i--) {
            const proj = st.projectiles[i];
            // Homing: steer toward nearest enemy
            if (proj.homing) {
                let closestE = null, closestDist = Infinity;
                for (const e of st.enemies) {
                    if (e.hp <= 0 || proj.hitSet.has(e.id)) continue;
                    const dx = e.x - proj.x, dy = e.y - proj.y;
                    const d = dx*dx+dy*dy;
                    if (d < closestDist) { closestDist = d; closestE = e; }
                }
                if (closestE) {
                    const dx = closestE.x - proj.x, dy = closestE.y - proj.y;
                    const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                    const spd = Math.sqrt(proj.vx*proj.vx+proj.vy*proj.vy);
                    const turnRate = 5.0 * dt; // radians/sec steer strength
                    proj.vx += (dx/dist * spd - proj.vx) * turnRate;
                    proj.vy += (dy/dist * spd - proj.vy) * turnRate;
                    // Normalize speed
                    const curSpd = Math.sqrt(proj.vx*proj.vx+proj.vy*proj.vy) || 1;
                    proj.vx = proj.vx/curSpd * spd;
                    proj.vy = proj.vy/curSpd * spd;
                }
            }
            // Gravity (axes)
            if (proj.gravity) {
                proj.vy += proj.gravity * dt;
            }
            // Boomerang (cross) — after boomerangTime, reverse toward owner
            if (proj.boomerang && proj.age >= proj.boomerangTime && !proj.returning) {
                proj.returning = true;
                proj.hitSet.clear(); // can hit enemies again on return
            }
            if (proj.returning && proj.ownerRef) {
                const dx = proj.ownerRef.x - proj.x, dy = proj.ownerRef.y - proj.y;
                const dist = Math.sqrt(dx*dx+dy*dy) || 1;
                const spd = Math.sqrt(proj.vx*proj.vx+proj.vy*proj.vy) || 300;
                proj.vx = dx/dist * spd;
                proj.vy = dy/dist * spd;
                if (dist < 30) { st.projectiles.splice(i, 1); continue; }
            }
            proj.x += proj.vx * dt;
            proj.y += proj.vy * dt;
            proj.age += dt;
            proj.lifetime -= dt;
            if (proj.lifetime <= 0) { st.projectiles.splice(i, 1); continue; }

            for (const e of st.enemies) {
                if (e.hp <= 0) continue;
                if (proj.hitSet.has(e.id)) continue;
                const dx = proj.x - e.x, dy = proj.y - e.y;
                const combinedR = proj.radius + e.radius;
                if (dx*dx+dy*dy < combinedR*combinedR) {
                    proj.hitSet.add(e.id);
                    e.hp -= proj.damage;
                    e.flashTimer = ENEMY_DAMAGE_FLASH;
                    const kd = Math.sqrt(dx*dx+dy*dy) || 1;
                    e.x -= (dx/kd) * 8;
                    e.y -= (dy/kd) * 8;

                    proj.pierce--;
                    if (proj.pierce <= 0) {
                        if (proj.explosive) {
                            this.doExplosion(proj.x, proj.y, proj.explosionRadius, proj.explosionDamage, proj.evolved ? '#ff2200' : '#ff6600', proj.evolved);
                        }
                        st.projectiles.splice(i, 1);
                        break;
                    }
                }
            }
        }
    }

    doExplosion(x, y, radius, damage, color, evolved = false) {
        const st = this.state;
        this.queueSfx('explosion');
        st.explosionEffects.push({ x, y, radius, color, life: evolved ? 0.4 : 0.3, evolved });
        for (const e of st.enemies) {
            if (e.hp <= 0) continue;
            const dx = e.x - x, dy = e.y - y;
            if (dx*dx+dy*dy < radius*radius) {
                e.hp -= damage;
                e.flashTimer = ENEMY_DAMAGE_FLASH;
                const kd = Math.sqrt(dx*dx+dy*dy) || 1;
                e.x += (dx/kd) * 20;
                e.y += (dy/kd) * 20;
            }
        }
    }

    updateAOEZones(dt) {
        const st = this.state;
        for (let i = st.aoeZones.length - 1; i >= 0; i--) {
            const zone = st.aoeZones[i];
            if (!zone.id) zone.id = this.nextZoneId++;
            zone.duration -= dt;
            zone.timer -= dt;
            if (zone.duration <= 0) { st.aoeZones.splice(i, 1); continue; }
            // La Borra: follow the player
            if (zone.followPlayer && zone.ownerId && zone.followOffset) {
                const owner = this.players.get(zone.ownerId);
                if (owner) {
                    zone.x = owner.x + zone.followOffset.x;
                    zone.y = owner.y + zone.followOffset.y;
                }
            }
            if (zone.timer <= 0) {
                zone.timer = zone.tickRate;
                for (const e of st.enemies) {
                    if (e.hp <= 0) continue;
                    const dx = e.x - zone.x, dy = e.y - zone.y;
                    if (dx*dx+dy*dy < zone.radius*zone.radius) {
                        e.hp -= zone.damage;
                        e.flashTimer = ENEMY_DAMAGE_FLASH;
                    }
                }
            }
        }
    }

    updateEnemies(dt) {
        const st = this.state;
        const alivePlayers = [...this.players.values()].filter(p => p.alive);

        for (let i = st.enemies.length - 1; i >= 0; i--) {
            const e = st.enemies[i];

            // Death
            if (e.hp <= 0) {
                st.kills++;
                // Attribute kill to closest player
                let closestPlayer = null, closestDist = Infinity;
                for (const p of alivePlayers) {
                    const dx = p.x - e.x, dy = p.y - e.y;
                    const d = dx*dx+dy*dy;
                    if (d < closestDist) { closestDist = d; closestPlayer = p; }
                }
                if (closestPlayer) {
                    closestPlayer.kills++;
                    if (e.boss) closestPlayer.bossKills++;

                    // Druid heal-on-kill: heal nearby allies (rate-capped at 20 HP/sec)
                    if (closestPlayer.charBonuses && closestPlayer.charBonuses.healOnKill) {
                        const now = this.state.gameTime;
                        const healAmt = closestPlayer.charBonuses.healOnKill;
                        const hRadius = closestPlayer.charBonuses.healRadius || 120;
                        // Rate cap: track healing done in last second
                        if (!closestPlayer._healOnKillTracker) closestPlayer._healOnKillTracker = { total: 0, resetTime: now };
                        if (now - closestPlayer._healOnKillTracker.resetTime >= 1.0) {
                            closestPlayer._healOnKillTracker = { total: 0, resetTime: now };
                        }
                        const maxHealPerSec = 20;
                        const remainingBudget = maxHealPerSec - closestPlayer._healOnKillTracker.total;
                        if (remainingBudget > 0) {
                            const actualHeal = Math.min(healAmt, remainingBudget);
                            closestPlayer._healOnKillTracker.total += actualHeal;
                            for (const ally of alivePlayers) {
                                const adx = ally.x - closestPlayer.x, ady = ally.y - closestPlayer.y;
                                if (adx * adx + ady * ady <= hRadius * hRadius) {
                                    ally.hp = Math.min(ally.maxHp, ally.hp + actualHeal);
                                }
                            }
                        }
                    }

                    // Berserker lifesteal: heal % of overkill damage on kill
                    if (closestPlayer.charBonuses && closestPlayer.charBonuses.berserkerLifesteal) {
                        const lifestealRate = closestPlayer.charBonuses.berserkerLifesteal;
                        const hpRatio = closestPlayer.hp / closestPlayer.maxHp;
                        // Lifesteal is stronger at low HP (2x at 0% HP, 1x at 100%)
                        const scaledRate = lifestealRate * (1 + (1 - hpRatio));
                        const healAmt = Math.min(e.maxHp * scaledRate, closestPlayer.maxHp * 0.05); // cap at 5% maxHP per kill
                        closestPlayer.hp = Math.min(closestPlayer.maxHp, closestPlayer.hp + healAmt);
                    }
                }

                const tier = e.boss ? 3 : e.elite ? 2 : (e.xp > 3 ? 1 : 0);
                // Try to merge XP into a nearby existing gem to reduce pickup count
                let merged = false;
                if (!e.boss && !e.elite) {
                    for (const pk of st.pickups) {
                        if (pk.type !== 'xp') continue;
                        const mdx = pk.x - e.x, mdy = pk.y - e.y;
                        if (mdx*mdx + mdy*mdy < 40*40) {
                            pk.value += e.xp;
                            pk.age = Math.min(pk.age, 2); // Reset age so merged gem doesn't despawn early
                            if (tier > pk.tier) pk.tier = tier;
                            merged = true;
                            break;
                        }
                    }
                }
                if (!merged) {
                    const gemCount = e.boss ? 10 : e.elite ? 3 : 1;
                    for (let g = 0; g < gemCount; g++) {
                        st.pickups.push({
                            id: this.nextPickupId++,
                            x: e.x + (Math.random()-0.5)*20, y: e.y + (Math.random()-0.5)*20,
                            type: 'xp', value: e.xp / gemCount, tier, radius: 8, age: 0
                        });
                    }
                }
                // Heal drop rate scales with player count - solo gets more heals to compensate
                const healRate = alivePlayers.length === 1 ? HEAL_DROP_RATE_SOLO : HEAL_DROP_RATE_BASE;
                if (Math.random() < healRate) {
                    st.pickups.push({ id: this.nextPickupId++, x: e.x, y: e.y, type: 'heal', value: 20, radius: 8, age: 0 });
                }
                // Bosses always drop a chest
                if (e.boss) {
                    st.pickups.push({ id: this.nextPickupId++, x: e.x, y: e.y, type: 'chest', value: 0, radius: 12, age: 0 });
                }
                // Regular enemies: 1 chest every 3-4 minutes via timed cooldown
                if (!e.boss && !st.lastChestTime) st.lastChestTime = 0;
                if (!e.boss && st.gameTime - (st.lastChestTime || 0) >= 180 + Math.random() * 60) {
                    st.lastChestTime = st.gameTime;
                    st.pickups.push({ id: this.nextPickupId++, x: e.x, y: e.y, type: 'chest', value: 0, radius: 12, age: 0 });
                }

                this.queueSfx('kill');
                st.enemies.splice(i, 1);
                continue;
            }

            e.flashTimer = Math.max(0, e.flashTimer - dt);
            e.wobblePhase = (e.wobblePhase || 0) + dt * 5;

            // Move toward closest alive player
            let targetPlayer = null, targetDist = Infinity;
            for (const p of alivePlayers) {
                const dx = p.x - e.x, dy = p.y - e.y;
                const d = dx*dx+dy*dy;
                if (d < targetDist) { targetDist = d; targetPlayer = p; }
            }

            if (targetPlayer) {
                const dx = targetPlayer.x - e.x, dy = targetPlayer.y - e.y;
                const d = Math.sqrt(dx*dx+dy*dy) || 1;
                e.x += (dx/d) * e.speed * dt;
                e.y += (dy/d) * e.speed * dt;
            }

            // No enemy-enemy separation — enemies freely overlap like in Vampire Survivors

            // Contact damage to all alive players
            for (const p of alivePlayers) {
                const dx = p.x - e.x, dy = p.y - e.y;
                const d = Math.sqrt(dx*dx+dy*dy) || 1;
                const combinedR = e.radius + p.radius;
                if (dx*dx+dy*dy < combinedR*combinedR) {
                    if (p.iframeTimer <= 0) {
                        // Percentage-based armor: armor/(armor+10) reduction, always take at least 1
                        const armorReduction = p.stats.armor / (p.stats.armor + 10);
                        let dmg = Math.max(1, Math.round(e.damage * (1 - armorReduction)));
                        p.hp -= dmg;
                        p.iframeTimer = IFRAME_DURATION;

                        // Notify that specific player about being hurt
                        this.queueSfxForPlayer(p.id, 'hurt');

                        // Check player death
                        if (p.hp <= 0) {
                            p.alive = false;
                            p.deathTime = st.gameTime;
                            this.broadcast({ type: 'player_died', playerId: p.id, username: p.username });
                        }
                    }
                }
            }

            // Despawn if too far from all players (never despawn bosses)
            if (!e.boss) {
                let closestPlayerDist = Infinity;
                for (const p of alivePlayers) {
                    const dx = p.x - e.x, dy = p.y - e.y;
                    const d = Math.sqrt(dx*dx+dy*dy);
                    if (d < closestPlayerDist) closestPlayerDist = d;
                }
                if (closestPlayerDist > 1200) {
                    st.enemies.splice(i, 1);
                }
            }
        }
    }

    updatePickups(dt) {
        const st = this.state;
        const alivePlayers = [...this.players.values()].filter(p => p.alive);

        for (let i = st.pickups.length - 1; i >= 0; i--) {
            const pk = st.pickups[i];
            pk.age += dt;

            // Find closest player for magnet pull
            let closestPlayer = null, closestDist = Infinity;
            for (const p of alivePlayers) {
                const dx = p.x - pk.x, dy = p.y - pk.y;
                const d = Math.sqrt(dx*dx+dy*dy);
                if (d < closestDist) { closestDist = d; closestPlayer = p; }
            }

            if (closestPlayer) {
                const magnetRange = PICKUP_MAGNET_BASE * closestPlayer.stats.magnet;
                let dx = closestPlayer.x - pk.x, dy = closestPlayer.y - pk.y;
                let d = closestDist;
                if (d > 0 && d < magnetRange) {
                    const pullSpeed = 300 + (1 - d/magnetRange) * 400;
                    const moveDist = pullSpeed * dt;
                    if (moveDist >= d) {
                        // Would overshoot — snap to player (will be collected below)
                        pk.x = closestPlayer.x;
                        pk.y = closestPlayer.y;
                        d = 0;
                    } else {
                        pk.x += (dx/d) * moveDist;
                        pk.y += (dy/d) * moveDist;
                        // Recalculate distance after pull
                        dx = closestPlayer.x - pk.x;
                        dy = closestPlayer.y - pk.y;
                        d = Math.sqrt(dx*dx + dy*dy);
                    }
                }

                // Collect (by closest player) — uses post-pull distance
                if (d < closestPlayer.radius + pk.radius) {
                    if (pk.type === 'xp') {
                        // Room-based shared XP
                        st.roomXp += pk.value;
                        this.queueSfx('xp');
                        while (st.roomXp >= st.roomXpToNext) {
                            st.roomXp -= st.roomXpToNext;
                            st.roomLevel++;
                            st.roomXpToNext = xpForLevel(st.roomLevel, this.players.size);
                            // Trigger level up for ALL players (including dead)
                            this.triggerRoomLevelUp();
                        }
                    } else if (pk.type === 'heal') {
                        closestPlayer.hp = Math.min(closestPlayer.maxHp, closestPlayer.hp + pk.value);
                    } else if (pk.type === 'chest') {
                        // Check if collecting player can evolve a weapon
                        const evolved = this.tryEvolveWeapon(closestPlayer);
                        if (!evolved) {
                            // No evolution available — give room level up as fallback
                            this.triggerRoomLevelUp();
                        }
                    }
                    st.pickups.splice(i, 1);
                    continue;
                }
            }

            // Despawn old heals and chests (not XP - players should be able to collect that)
            if (pk.type !== 'xp' && pk.age > 30 && closestDist > 600) {
                st.pickups.splice(i, 1);
            }
        }
    }

    triggerRoomLevelUp() {
        // Give ALL players (including dead) an upgrade choice
        for (const [, player] of this.players) {
            this.triggerLevelUp(player);
        }
    }

    tryEvolveWeapon(player) {
        // Check each base weapon for evolution eligibility:
        // weapon must be at max level (7) AND player must have the required passive (any level)
        for (const [baseWeapon, evo] of Object.entries(EvolutionDefs)) {
            if (!player.weapons[baseWeapon]) continue;
            if (player.weapons[baseWeapon] < 7) continue;
            if (!player.passives[evo.requiresPassive]) continue;
            // Already evolved? (shouldn't happen, but guard)
            if (player.weapons[evo.evolvesInto]) continue;

            // Evolve! Remove base weapon, add evolved weapon at level 1 (evolved weapons don't level up)
            delete player.weapons[baseWeapon];
            delete player.weaponTimers[baseWeapon];
            player.weapons[evo.evolvesInto] = 1;
            player.hasEvolved = true;

            // Notify the player
            this.queueSfxForPlayer(player.id, 'evolve');
            this.broadcast({
                type: 'weapon_evolved',
                playerId: player.id,
                username: player.username,
                baseWeapon,
                evolvedWeapon: evo.evolvesInto,
            });
            return true;
        }
        return false;
    }

    triggerLevelUp(player) {
        const choices = this.generateUpgradeChoices(player);

        // If no upgrades available (all maxed), skip the level-up screen
        if (choices.length === 0) {
            this.queueSfxForPlayer(player.id, 'levelUp');
            return;
        }

        const pending = this.pendingLevelUps.get(player.id) || [];
        pending.push(choices);
        this.pendingLevelUps.set(player.id, pending);

        // Rerolls are per-run (not per-level-up) — don't reset here

        // Mark this player as choosing an upgrade and pause the game
        this.pausedBy.add(player.id);
        if (!this.paused) {
            this.paused = true;
            // Zero out all player inputs so nobody drifts during pause
            this.zeroAllPlayerInputs();
            this.broadcastPauseState();
        } else {
            // Already paused but new player added, update the pause info
            this.broadcastPauseState();
        }

        // Only send the level_up message if this is the first pending (no upgrade screen showing yet).
        // Subsequent pending level-ups are sent after the player picks/skips the current one.
        if (pending.length === 1) {
            const clientInfo = this.clients.get(player.id);
            if (clientInfo && clientInfo.ws.readyState === WebSocket.OPEN) {
                clientInfo.ws.send(JSON.stringify({
                    type: 'level_up',
                    choices,
                    pendingCount: pending.length,
                    level: this.state.roomLevel,
                    rerollsLeft: this.rerollsRemaining.get(player.id)
                }));
            }
        }
        this.queueSfxForPlayer(player.id, 'levelUp');
    }

    handleUpgradeReroll(playerId) {
        const pending = this.pendingLevelUps.get(playerId);
        if (!pending || pending.length === 0) return;
        const player = this.players.get(playerId);
        if (!player) return;
        // Check reroll limit
        const remaining = this.rerollsRemaining.get(playerId) || 0;
        if (remaining <= 0) return;
        this.rerollsRemaining.set(playerId, remaining - 1);
        // Replace current choices with new random ones
        const newChoices = this.generateUpgradeChoices(player);
        if (newChoices.length === 0) return;
        pending[0] = newChoices;
        // Send new choices to player
        const clientInfo = this.clients.get(playerId);
        if (clientInfo && clientInfo.ws.readyState === WebSocket.OPEN) {
            clientInfo.ws.send(JSON.stringify({
                type: 'level_up',
                choices: newChoices,
                pendingCount: pending.length,
                level: this.state.roomLevel,
                rerolled: true,
                rerollsLeft: this.rerollsRemaining.get(playerId)
            }));
        }
    }

    handleUpgradeSkip(playerId) {
        const pending = this.pendingLevelUps.get(playerId);
        if (!pending || pending.length === 0) return;
        const player = this.players.get(playerId);
        // Remove current level-up without applying any upgrade
        pending.shift();
        if (pending.length > 0) {
            const clientInfo = this.clients.get(playerId);
            if (clientInfo && clientInfo.ws.readyState === WebSocket.OPEN) {
                clientInfo.ws.send(JSON.stringify({
                    type: 'level_up',
                    choices: pending[0],
                    pendingCount: pending.length,
                    level: this.state.roomLevel,
                    rerollsLeft: this.rerollsRemaining.get(playerId)
                }));
            }
        } else {
            this.pausedBy.delete(playerId);
            this.checkUnpause();
        }
    }

    generateUpgradeChoices(player) {
        const choices = [];

        // Build set of evolved weapon keys that replaced base weapons
        // so we don't offer the base weapon again
        const evolvedKeys = new Set(Object.keys(EvolvedWeaponDefs));
        const playerHasEvolved = new Set();
        for (const wk of Object.keys(player.weapons)) {
            if (evolvedKeys.has(wk)) playerHasEvolved.add(wk);
        }
        // Map base weapon -> its evolved form key if player already has it
        const baseToEvolved = {};
        for (const [base, evo] of Object.entries(EvolutionDefs)) {
            baseToEvolved[base] = evo.evolvesInto;
        }

        // Count non-evolved weapons for slot limit
        const weaponSlotCount = Object.keys(player.weapons).length;

        for (const [key, def] of Object.entries(WeaponDefs)) {
            // Skip if player already evolved this weapon
            if (baseToEvolved[key] && player.weapons[baseToEvolved[key]]) continue;
            if (player.weapons[key]) {
                if (player.weapons[key] < 7) {
                    choices.push({ type: 'weapon', key, level: player.weapons[key] + 1 });
                }
            } else {
                if (weaponSlotCount < 6) {
                    choices.push({ type: 'weapon', key, level: 1 });
                }
            }
        }
        // Evolved weapons don't appear in upgrade choices — they're only obtained via chests

        for (const [key, def] of Object.entries(PassiveDefs)) {
            const lv = player.passives[key] || 0;
            if (lv < def.maxLv) {
                choices.push({ type: 'passive', key, level: lv + 1 });
            }
        }

        shuffleArray(choices);
        return choices.slice(0, 3);
    }

    handleUpgradeChoice(playerId, choiceIndex) {
        const pending = this.pendingLevelUps.get(playerId);
        if (!pending || pending.length === 0) return;

        const player = this.players.get(playerId);
        if (!player) return;

        // Validate index BEFORE consuming the pending entry
        const choices = pending[0];
        if (choiceIndex < 0 || choiceIndex >= choices.length) return;
        pending.shift();
        const choice = choices[choiceIndex];

        if (choice.type === 'weapon') {
            if (player.weapons[choice.key]) player.weapons[choice.key]++;
            else player.weapons[choice.key] = 1;
        } else {
            player.passives[choice.key] = choice.level;
        }
        this.recalcPlayerStats(player);

        // Send next pending level up if any
        if (pending.length > 0) {
            const clientInfo = this.clients.get(playerId);
            if (clientInfo && clientInfo.ws.readyState === WebSocket.OPEN) {
                clientInfo.ws.send(JSON.stringify({
                    type: 'level_up',
                    choices: pending[0],
                    pendingCount: pending.length,
                    level: this.state.roomLevel,
                    rerollsLeft: this.rerollsRemaining.get(playerId)
                }));
            }
        } else {
            // This player is done choosing - remove from paused set
            this.pausedBy.delete(playerId);
            this.checkUnpause();
        }
    }

    broadcastPauseState() {
        // Gather usernames of players who are choosing upgrades
        const choosingPlayers = [];
        for (const pid of this.pausedBy) {
            const p = this.players.get(pid);
            if (p) choosingPlayers.push({ id: pid, username: p.username });
        }
        this.broadcast({
            type: 'game_paused',
            choosingPlayers,
            manuallyPaused: this.manuallyPaused,
            manualPausedBy: this.manualPausedBy,
        });
    }

    checkUnpause() {
        if (this.pausedBy.size === 0 && this.paused) {
            // Double-check: make sure no player has pending level-ups
            let anyPending = false;
            for (const [pid, pending] of this.pendingLevelUps) {
                if (pending && pending.length > 0) {
                    // This player still has pending choices, re-add to pausedBy
                    this.pausedBy.add(pid);
                    anyPending = true;
                }
            }
            if (!anyPending && !this.manuallyPaused) {
                this.paused = false;
                this.broadcast({ type: 'game_unpaused' });
            } else {
                this.broadcastPauseState();
            }
        } else if (this.paused) {
            // Still paused but the list changed, update clients
            this.broadcastPauseState();
        }
    }

    zeroAllPlayerInputs() {
        for (const [, p] of this.players) {
            p.input = { dx: 0, dy: 0 };
        }
    }

    handleManualPause(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;

        if (this.manuallyPaused) {
            // Any player can unpause
            this.manuallyPaused = false;
            this.manualPausedBy = null;
            // Check if we should fully unpause (no upgrade choices pending either)
            if (this.pausedBy.size === 0) {
                this.paused = false;
                this.broadcast({ type: 'game_unpaused' });
            } else {
                // Still paused for upgrade choices, update state
                this.broadcastPauseState();
            }
        } else {
            // Pause the game
            this.manuallyPaused = true;
            this.manualPausedBy = player.username;
            this.paused = true;
            this.zeroAllPlayerInputs();
            this.broadcastPauseState();
        }
    }

    endGame(result) {
        this.stop();
        this.disconnectedPlayers.clear(); // No more rejoin possible after game ends
        const st = this.state;
        const gameTime = st.gameTime;

        // Calculate gold rewards per player (using personal time played)
        for (const [playerId, player] of this.players) {
            const clientInfo = this.clients.get(playerId);
            if (!clientInfo) continue;

            const personalTime = gameTime - (player.joinTime || 0);
            const baseGold = Math.floor(personalTime * 1.2); // 1.2 gold per second personally played
            const killGold = Math.floor(player.kills * 0.5); // 0.5 gold per kill
            const bonusGold = result === 'victory' ? 1200 : 0;
            let totalGold = baseGold + killGold + bonusGold;
            const xpGained = Math.floor(personalTime * 2 + player.kills * 3);

            // Save to DB — only count games_played on the first session in this room
            if (clientInfo.userId) {
                const sessionNum = (this.userSessionCount.get(clientInfo.userId) || 0) + 1;
                this.userSessionCount.set(clientInfo.userId, sessionNum);
                const isFirstSession = sessionNum === 1;

                const prog = stmts.getProgression.get(clientInfo.userId);
                if (prog) {
                    const newBestTime = Math.max(prog.best_time, personalTime);
                    const newTotalXp = prog.total_xp + xpGained;
                    const newAccountLevel = Math.floor(1 + Math.sqrt(newTotalXp / 100));
                    stmts.updateProgression.run(
                        prog.gold + totalGold,
                        newTotalXp,
                        newAccountLevel,
                        prog.games_played + (isFirstSession ? 1 : 0),
                        prog.total_kills + player.kills,
                        newBestTime,
                        clientInfo.userId
                    );
                }
            }

            // Check achievements
            let newAchievements = [];
            if (clientInfo.userId) {
                const hasMaxWeapon = Object.values(player.weapons).some(lv => lv >= 7);
                const fullWeapons = Object.keys(player.weapons).length >= 6;
                newAchievements = checkAndAwardAchievements(clientInfo.userId, {
                    kills: player.kills,
                    time: personalTime,
                    victory: result === 'victory',
                    bossKill: player.bossKills > 0,
                    evolved: player.hasEvolved,
                    maxWeapon: hasMaxWeapon,
                    fullWeapons,
                    level: st.roomLevel,
                });
            }

            // Send end game to player
            if (clientInfo.ws.readyState === WebSocket.OPEN) {
                clientInfo.ws.send(JSON.stringify({
                    type: 'game_end',
                    result,
                    stats: {
                        time: personalTime,
                        kills: player.kills,
                        totalKills: st.kills,
                        level: st.roomLevel,
                        goldEarned: totalGold,
                        xpEarned: xpGained,
                    },
                    newAchievements: newAchievements.length > 0 ? newAchievements : undefined,
                }));
            }
        }
    }

    broadcastState() {
        // ================================================================
        // BANDWIDTH-OPTIMIZED STATE BROADCAST
        // ================================================================
        // Key optimizations vs original:
        // 1. Broadcast at 10Hz instead of 20Hz (2x reduction)
        // 2. Enemies: static data (color, radius, name, boss, elite, maxHp) sent ONCE
        //    per enemy per client. Updates are compact arrays [id, x, y, hp, flash?]
        // 3. Projectiles as arrays: [id, x, y, vx, vy, radius, color_idx, trail]
        // 4. Pickups as arrays: [id, x, y, type_code, tier]
        // 5. Players: compact arrays for dynamic, static sent alongside
        // 6. SFX batched into state message (no separate sends)
        // 7. Short JSON keys, omit empty arrays, omit zero values
        // ================================================================
        const st = this.state;
        const VIEW_RANGE = 800;
        const VIEW_RANGE_SQ = VIEW_RANGE * VIEW_RANGE;

        // Build shared compact player arrays (max 4 players, so overhead is minimal)
        // Dynamic: [id, x, y, hp, maxHp, alive, iframeTimer, facingX, facingY, walkAnim, deathTime]
        const pDyn = [];
        for (const [, p] of this.players) {
            pDyn.push([
                p.id,
                Math.round(p.x), Math.round(p.y),
                Math.round(p.hp), p.maxHp,
                p.alive ? 1 : 0,
                p.iframeTimer > 0 ? +(p.iframeTimer.toFixed(2)) : 0,
                +p.facing.x.toFixed(2), +p.facing.y.toFixed(2),
                +p.walkAnim.toFixed(1),
                p.deathTime || 0,
            ]);
        }
        // Static (changes rarely - on level up, weapon change, etc.):
        // [id, username, color, cloakColor, skinColor, charId, weapons, might, area, cd, armor, regen, speed, magnet, maxHpStat, baseSpeed, passives]
        const pStatic = [];
        for (const [, p] of this.players) {
            pStatic.push([
                p.id, p.username,
                p.color, p.cloakColor, p.skinColor, p.characterId,
                p.weapons,
                +p.stats.might.toFixed(2), +p.stats.area.toFixed(2),
                +p.stats.cooldown.toFixed(2), +p.stats.armor.toFixed(1),
                +p.stats.regen.toFixed(2), +p.stats.moveSpeed.toFixed(2),
                +p.stats.magnet.toFixed(2), +p.stats.maxHp.toFixed(2),
                p.baseSpeed,
                p.passives || {},
            ]);
        }

        // Collect global SFX and clear buffer
        const globalSfx = this.pendingSfx.length > 0 ? this.pendingSfx.slice() : null;
        this.pendingSfx = [];

        // Send per-player snapshot with only nearby entities
        for (const [playerId, clientInfo] of this.clients) {
            if (clientInfo.ws.readyState !== WebSocket.OPEN) continue;
            const player = this.players.get(playerId);
            if (!player) continue;

            const px = player.x, py = player.y;
            const known = this.knownEntities.get(playerId);

            // --- ENEMIES ---
            // New enemies: full data array [id, x, y, hp, maxHp, radius, color, name, boss, elite]
            // Known enemies: compact [id, x, y, hp] or [id, x, y, hp, 1] if flashing
            const eNew = [];
            const eUpd = [];

            // Build list of visible enemies sorted by distance (closest first)
            // so the render cap always includes the nearest threats
            const visibleEnemies = [];
            for (let i = 0; i < st.enemies.length; i++) {
                const e = st.enemies[i];
                const dx = e.x - px, dy = e.y - py;
                const distSq = dx*dx+dy*dy;
                if (!e.boss && distSq >= VIEW_RANGE_SQ) continue;
                visibleEnemies.push({ e, distSq });
            }
            visibleEnemies.sort((a, b) => a.distSq - b.distSq);

            const maxVisible = 200;
            let eCount = 0;
            for (let i = 0; i < visibleEnemies.length && eCount < maxVisible; i++) {
                const e = visibleEnemies[i].e;
                eCount++;
                if (known.has(e.id)) {
                    if (e.flashTimer > 0) {
                        eUpd.push([e.id, +e.x.toFixed(1), +e.y.toFixed(1), Math.round(e.hp), 1]);
                    } else {
                        eUpd.push([e.id, +e.x.toFixed(1), +e.y.toFixed(1), Math.round(e.hp)]);
                    }
                } else {
                    known.add(e.id);
                    eNew.push([
                        e.id, +e.x.toFixed(1), +e.y.toFixed(1),
                        Math.round(e.hp), Math.round(e.maxHp),
                        e.radius, e.color, e.name || '',
                        e.boss ? 1 : 0, e.elite ? 1 : 0
                    ]);
                }
            }

            // Periodically clean up known set (dead enemies)
            if (Math.random() < 0.05) {
                const aliveIds = new Set(st.enemies.map(e => e.id));
                for (const eid of known) {
                    if (!aliveIds.has(eid)) known.delete(eid);
                }
            }

            // --- PROJECTILES --- compact: [id, x, y, vx, vy, radius, color, trail, shape, evolved]
            // shape: 0=star, 1=blade, 2=diamond, 3=cross, 4=axe, 5=orb, 6=scythe, 7=holy_cross
            const pr = [];
            for (const p of st.projectiles) {
                if (pr.length >= 80) break;
                const dx = p.x - px, dy = p.y - py;
                if (dx*dx+dy*dy < VIEW_RANGE_SQ) {
                    const shape = p.shape || (p.spin ? 4 : p.boomerang ? 3 : p.explosive ? 2 : p.homing ? 0 : (!p.trail ? 1 : 0));
                    pr.push([p.id, Math.round(p.x), Math.round(p.y),
                        Math.round(p.vx), Math.round(p.vy),
                        p.radius, p.color, p.trail ? 1 : 0, shape, p.evolved ? 1 : 0]);
                }
            }

            // --- PICKUPS --- compact: [id, x, y, type(0=xp,1=heal,2=chest), tier]
            // Prioritize heals/chests (always sent), then closest XP gems
            const pk = [];
            const xpGems = [];
            for (const p of st.pickups) {
                const dx = p.x - px, dy = p.y - py;
                const distSq = dx*dx+dy*dy;
                if (distSq >= VIEW_RANGE_SQ) continue;
                if (p.type !== 'xp') {
                    // Heals and chests always included
                    pk.push([p.id, Math.round(p.x), Math.round(p.y),
                        p.type === 'heal' ? 1 : 2, p.tier || 0]);
                } else {
                    xpGems.push({ p, distSq });
                }
            }
            // Sort XP gems by distance (closest first) and fill remaining slots
            xpGems.sort((a, b) => a.distSq - b.distSq);
            for (const g of xpGems) {
                if (pk.length >= 80) break;
                pk.push([g.p.id, Math.round(g.p.x), Math.round(g.p.y), 0, g.p.tier || 0]);
            }

            // --- AOE ZONES --- compact: [id, x, y, radius, duration, evolved, color]
            const az = [];
            for (const z of st.aoeZones) {
                const dx = z.x - px, dy = z.y - py;
                if (dx*dx+dy*dy < VIEW_RANGE_SQ) {
                    az.push([z.id, Math.round(z.x), Math.round(z.y), Math.round(z.radius), +z.duration.toFixed(1), z.evolved ? 1 : 0, z.color || '']);
                }
            }

            // --- LIGHTNING --- compact: [x1, y1, x2, y2, evolved]
            const ln = [];
            for (const l of st.lightningEffects) {
                const dx = l.x1 - px, dy = l.y1 - py;
                if (dx*dx+dy*dy < VIEW_RANGE_SQ) {
                    ln.push([Math.round(l.x1), Math.round(l.y1), Math.round(l.x2), Math.round(l.y2), l.evolved ? 1 : 0]);
                }
            }

            // --- SLASH EFFECTS (whip/bloody tear) --- compact: [x, y, angle, range, width, color, evolved]
            const sl = [];
            for (const s of st.slashEffects) {
                const dx = s.x - px, dy = s.y - py;
                if (dx*dx+dy*dy < VIEW_RANGE_SQ) {
                    sl.push([Math.round(s.x), Math.round(s.y), +s.angle.toFixed(2), Math.round(s.range), Math.round(s.width), s.color, s.evolved ? 1 : 0]);
                }
            }

            // --- EXPLOSION EFFECTS (fire wand/hellfire) --- compact: [x, y, radius, color, evolved]
            const xp = [];
            for (const e of st.explosionEffects) {
                const dx = e.x - px, dy = e.y - py;
                if (dx*dx+dy*dy < VIEW_RANGE_SQ) {
                    xp.push([Math.round(e.x), Math.round(e.y), Math.round(e.radius), e.color, e.evolved ? 1 : 0]);
                }
            }

            // Merge global + player-specific SFX
            let sfx = globalSfx;
            if (clientInfo.pendingSfx && clientInfo.pendingSfx.length > 0) {
                sfx = sfx ? sfx.concat(clientInfo.pendingSfx) : clientInfo.pendingSfx.slice();
                clientInfo.pendingSfx = [];
            }

            // Build compact snapshot - short keys, omit empty/undefined arrays
            const snap = {
                T: 's',
                t: +st.gameTime.toFixed(2),
                k: st.kills,
                rl: st.roomLevel,
                rx: st.roomXp,
                rn: st.roomXpToNext,
                p: pDyn,
                ps: pStatic,
                e: eUpd,
            };
            if (eNew.length > 0) snap.en = eNew;
            if (pr.length > 0) snap.pr = pr;
            if (pk.length > 0) snap.pk = pk;
            if (az.length > 0) snap.az = az;
            if (ln.length > 0) snap.ln = ln;
            if (sl.length > 0) snap.sl = sl;
            if (xp.length > 0) snap.xp = xp;
            if (sfx) snap.sf = sfx;

            clientInfo.ws.send(JSON.stringify(snap));
        }
    }

    broadcast(msg) {
        const data = JSON.stringify(msg);
        for (const [, clientInfo] of this.clients) {
            if (clientInfo.ws.readyState === WebSocket.OPEN) {
                clientInfo.ws.send(data);
            }
        }
    }

    // Send a single state snapshot to one specific player (used for mid-game joins)
    sendStateToPlayer(playerId) {
        if (!this.state) return;
        const clientInfo = this.clients.get(playerId);
        if (!clientInfo || clientInfo.ws.readyState !== WebSocket.OPEN) return;
        const player = this.players.get(playerId);
        if (!player) return;

        const st = this.state;
        const px = player.x, py = player.y;
        const known = this.knownEntities.get(playerId);

        // Build player arrays (same as broadcastState)
        const pDyn = [];
        for (const [, p] of this.players) {
            pDyn.push([
                p.id, Math.round(p.x), Math.round(p.y),
                Math.round(p.hp), p.maxHp,
                p.alive ? 1 : 0,
                p.iframeTimer > 0 ? +(p.iframeTimer.toFixed(2)) : 0,
                +p.facing.x.toFixed(2), +p.facing.y.toFixed(2),
                +p.walkAnim.toFixed(1),
                p.deathTime || 0,
            ]);
        }
        const pStatic = [];
        for (const [, p] of this.players) {
            pStatic.push([
                p.id, p.username,
                p.color, p.cloakColor, p.skinColor, p.characterId,
                p.weapons,
                +p.stats.might.toFixed(2), +p.stats.area.toFixed(2),
                +p.stats.cooldown.toFixed(2), +p.stats.armor.toFixed(1),
                +p.stats.regen.toFixed(2), +p.stats.moveSpeed.toFixed(2),
                +p.stats.magnet.toFixed(2), +p.stats.maxHp.toFixed(2),
                p.baseSpeed,
            ]);
        }

        // All enemies as new (player just joined, hasn't seen any)
        const eNew = [];
        const VIEW_RANGE = 800;
        const VIEW_RANGE_SQ = VIEW_RANGE * VIEW_RANGE;
        for (const e of st.enemies) {
            const dx = e.x - px, dy = e.y - py;
            if (!e.boss && dx*dx+dy*dy >= VIEW_RANGE_SQ) continue;
            if (eNew.length >= 200) break;
            known.add(e.id);
            eNew.push([
                e.id, +e.x.toFixed(1), +e.y.toFixed(1),
                Math.round(e.hp), Math.round(e.maxHp),
                e.radius, e.color, e.name || '',
                e.boss ? 1 : 0, e.elite ? 1 : 0
            ]);
        }

        const snap = {
            T: 's',
            t: +st.gameTime.toFixed(2),
            k: st.kills,
            rl: st.roomLevel,
            rx: st.roomXp,
            rn: st.roomXpToNext,
            p: pDyn,
            ps: pStatic,
            e: [],
        };
        if (eNew.length > 0) snap.en = eNew;

        clientInfo.ws.send(JSON.stringify(snap));
    }
}

// ============================================================
// LOBBY / ROOM MANAGEMENT
// ============================================================
const rooms = new Map(); // roomId -> GameRoom
const playerRooms = new Map(); // playerId -> roomId
const userRooms = new Map(); // userId -> roomId (prevent same user joining multiple rooms)

wss.on('connection', (ws) => {
    let playerId = uuidv4();
    let currentRoom = null;

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch(e) { return; }

        switch(msg.type) {
            case 'create_room': {
                if (currentRoom) break;
                if (msg.userId && userRooms.has(msg.userId)) {
                    const existingRoomId = userRooms.get(msg.userId);
                    if (rooms.has(existingRoomId)) {
                        ws.send(JSON.stringify({ type: 'error', message: 'You are already in a room' }));
                        break;
                    }
                    userRooms.delete(msg.userId);
                }
                const roomId = uuidv4().substring(0, 8).toUpperCase();
                const room = new GameRoom(roomId);
                rooms.set(roomId, room);
                currentRoom = room;
                const { player } = room.addPlayer(playerId, ws, msg.username, msg.characterId, msg.metaUpgrades, msg.userId);
                playerRooms.set(playerId, roomId);
                if (msg.userId) userRooms.set(msg.userId, roomId);
                ws.send(JSON.stringify({
                    type: 'room_created',
                    roomId,
                    playerId,
                    players: getPlayersInfo(room),
                }));
                break;
            }
            case 'join_room': {
                if (currentRoom) break;
                if (msg.userId && userRooms.has(msg.userId)) {
                    const existingRoomId = userRooms.get(msg.userId);
                    if (rooms.has(existingRoomId)) {
                        ws.send(JSON.stringify({ type: 'error', message: 'You are already in a room' }));
                        break;
                    }
                    userRooms.delete(msg.userId);
                }
                const room = rooms.get(msg.roomId?.toUpperCase());
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
                    break;
                }
                if (room.isFull) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 4 players)' }));
                    break;
                }
                currentRoom = room;
                const { player, isRejoin } = room.addPlayer(playerId, ws, msg.username, msg.characterId, msg.metaUpgrades, msg.userId);
                playerRooms.set(playerId, room.roomId);
                if (msg.userId) userRooms.set(msg.userId, room.roomId);
                ws.send(JSON.stringify({
                    type: 'room_joined',
                    roomId: room.roomId,
                    playerId,
                    players: getPlayersInfo(room),
                    isRejoin,
                    restoredCharacterId: isRejoin ? player.characterId : undefined,
                }));
                // Notify others
                room.broadcast({ type: 'player_joined', players: getPlayersInfo(room) });
                // If game is already running, tell the new player to start immediately
                if (room.running) {
                    ws.send(JSON.stringify({ type: 'game_start', playerCount: room.players.size }));
                    // Send an immediate state snapshot so the player sees the game right away
                    // (critical when the game is paused, since tick() won't broadcast)
                    room.sendStateToPlayer(playerId);
                    // If the game is paused, also send the pause state
                    if (room.paused) {
                        room.broadcastPauseState();
                    }
                }
                break;
            }
            case 'start_game': {
                if (!currentRoom) break;
                if (currentRoom.running) break;
                currentRoom.start();
                break;
            }
            case 'input': {
                if (!currentRoom || !currentRoom.running) break;
                // Block input while game is paused (prevents movement that snaps back on unpause)
                if (currentRoom.paused) break;
                const player = currentRoom.players.get(playerId);
                if (player && player.alive) {
                    let dx = msg.dx || 0, dy = msg.dy || 0;
                    const len = Math.sqrt(dx*dx+dy*dy);
                    if (len > 1) { dx /= len; dy /= len; }
                    player.input = { dx, dy };
                }
                break;
            }
            case 'upgrade_choice': {
                if (!currentRoom || !currentRoom.running) break;
                currentRoom.handleUpgradeChoice(playerId, msg.choiceIndex);
                break;
            }
            case 'upgrade_reroll': {
                if (!currentRoom || !currentRoom.running) break;
                currentRoom.handleUpgradeReroll(playerId);
                break;
            }
            case 'upgrade_skip': {
                if (!currentRoom || !currentRoom.running) break;
                currentRoom.handleUpgradeSkip(playerId);
                break;
            }
            case 'toggle_pause': {
                if (!currentRoom || !currentRoom.running) break;
                currentRoom.handleManualPause(playerId);
                break;
            }
            case 'give_up': {
                if (!currentRoom || !currentRoom.running) break;
                const player = currentRoom.players.get(playerId);
                if (!player) break;

                // Calculate rewards based on personal play time (not total room time)
                // This prevents gold farming by repeatedly giving up and rejoining
                const st = currentRoom.state;
                const gameTime = st.gameTime;
                const personalTime = gameTime - (player.joinTime || 0);
                const baseGold = Math.floor(personalTime * 1.2); // 1.2 gold per second personally played
                const killGold = Math.floor(player.kills * 0.5); // 0.5 gold per kill
                let totalGold = baseGold + killGold;
                const xpGained = Math.floor(personalTime * 2 + player.kills * 3);

                // Save to DB — only count games_played on the first session in this room
                const ci = currentRoom.clients.get(playerId);
                if (ci && ci.userId) {
                    const sessionNum = (currentRoom.userSessionCount.get(ci.userId) || 0) + 1;
                    currentRoom.userSessionCount.set(ci.userId, sessionNum);
                    const isFirstSession = sessionNum === 1;

                    const prog = stmts.getProgression.get(ci.userId);
                    if (prog) {
                        const newBestTime = Math.max(prog.best_time, personalTime);
                        const newTotalXp = prog.total_xp + xpGained;
                        const newAccountLevel = Math.floor(1 + Math.sqrt(newTotalXp / 100));
                        stmts.updateProgression.run(
                            prog.gold + totalGold,
                            newTotalXp,
                            newAccountLevel,
                            prog.games_played + (isFirstSession ? 1 : 0),
                            prog.total_kills + player.kills,
                            newBestTime,
                            ci.userId
                        );
                    }
                }

                // Check achievements
                let newAchievements = [];
                if (ci && ci.userId) {
                    const hasMaxWeapon = Object.values(player.weapons).some(lv => lv >= 7);
                    const fullWeapons = Object.keys(player.weapons).length >= 6;
                    newAchievements = checkAndAwardAchievements(ci.userId, {
                        kills: player.kills,
                        time: personalTime,
                        victory: false,
                        bossKill: player.bossKills > 0,
                        evolved: player.hasEvolved,
                        maxWeapon: hasMaxWeapon,
                        fullWeapons,
                        level: st.roomLevel,
                    });
                }

                // Send gave_up result to the player
                if (ci && ci.ws.readyState === WebSocket.OPEN) {
                    ci.ws.send(JSON.stringify({
                        type: 'game_end',
                        result: 'gave_up',
                        stats: {
                            time: personalTime,
                            kills: player.kills,
                            totalKills: st.kills,
                            level: st.roomLevel,
                            goldEarned: totalGold,
                            xpEarned: xpGained,
                        },
                        newAchievements: newAchievements.length > 0 ? newAchievements : undefined,
                    }));
                }

                // Save player state for potential rejoin, then remove
                currentRoom.savePlayerState(playerId);
                const ciEnd = currentRoom.clients.get(playerId);
                if (ciEnd && ciEnd.userId) userRooms.delete(ciEnd.userId);
                currentRoom.removePlayer(playerId);
                currentRoom.broadcast({ type: 'player_left', playerId, players: getPlayersInfo(currentRoom) });
                if (currentRoom.players.size === 0 && currentRoom.disconnectedPlayers.size === 0) {
                    rooms.delete(currentRoom.roomId);
                }
                currentRoom = null;
                playerRooms.delete(playerId);
                break;
            }
            case 'leave_room': {
                if (currentRoom) {
                    currentRoom.savePlayerState(playerId);
                    const ciLeave = currentRoom.clients.get(playerId);
                    if (ciLeave && ciLeave.userId) userRooms.delete(ciLeave.userId);
                    currentRoom.removePlayer(playerId);
                    currentRoom.broadcast({ type: 'player_left', playerId, players: getPlayersInfo(currentRoom) });
                    if (currentRoom.players.size === 0 && currentRoom.disconnectedPlayers.size === 0) {
                        rooms.delete(currentRoom.roomId);
                    }
                    currentRoom = null;
                    playerRooms.delete(playerId);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        if (currentRoom) {
            currentRoom.savePlayerState(playerId);
            const ciClose = currentRoom.clients.get(playerId);
            if (ciClose && ciClose.userId) userRooms.delete(ciClose.userId);
            currentRoom.removePlayer(playerId);
            currentRoom.broadcast({ type: 'player_left', playerId, players: getPlayersInfo(currentRoom) });
            if (currentRoom.players.size === 0 && currentRoom.disconnectedPlayers.size === 0) {
                rooms.delete(currentRoom.roomId);
            }
            playerRooms.delete(playerId);
        }
    });
});

function getPlayersInfo(room) {
    const list = [];
    for (const [id, p] of room.players) {
        list.push({ id, username: p.username, characterId: p.characterId, color: p.color });
    }
    return list;
}

// ============================================================
// START SERVER
// ============================================================
initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`Dark Survivors server running on http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
