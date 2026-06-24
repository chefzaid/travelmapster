const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'travelmapster-dev-secret';
const VALID_MARKER_TYPES = new Set(['visited', 'wishlist']);
const VALID_MARKER_CATEGORIES = new Set(['Country', 'City']);
const db = new DatabaseSync(path.join(__dirname, 'markers.db'));

app.use(express.json());
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// Serve static files
app.use(express.static(path.join(__dirname, '.')));

// Initialize the users and markers table
db.exec(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    oauth_provider TEXT DEFAULT NULL,
    oauth_id TEXT DEFAULT NULL
)`);

db.exec(`CREATE TABLE IF NOT EXISTS markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    lat REAL,
    lng REAL,
    type TEXT,
    name TEXT,
    category TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

// Migration: Add name and category columns if they don't exist
const columns = db.prepare("PRAGMA table_info(markers)").all();
const columnNames = columns.map(c => c.name);
if (!columnNames.includes('name')) {
    db.exec("ALTER TABLE markers ADD COLUMN name TEXT");
}
if (!columnNames.includes('category')) {
    db.exec("ALTER TABLE markers ADD COLUMN category TEXT");
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function parseMarkerPayload(body) {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const type = normalizeText(body.type);
    const name = normalizeText(body.name);
    const category = normalizeText(body.category);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return { error: 'Latitude must be a number between -90 and 90.' };
    }

    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        return { error: 'Longitude must be a number between -180 and 180.' };
    }

    if (!VALID_MARKER_TYPES.has(type)) {
        return { error: 'Marker type must be visited or wishlist.' };
    }

    if (!VALID_MARKER_CATEGORIES.has(category)) {
        return { error: 'Marker category must be Country or City.' };
    }

    if (!name) {
        return { error: 'Marker name is required.' };
    }

    return { marker: { lat, lng, type, name, category } };
}

// Passport Local Strategy for username/password authentication
passport.use(new LocalStrategy((username, password, done) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user) return done(null, false, { message: 'Incorrect username.' });
        bcrypt.compare(password, user.password, (err, res) => {
            if (err) return done(err);
            if (res) return done(null, user);
            return done(null, false, { message: 'Incorrect password.' });
        });
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    try {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }

    return res.status(401).json({ error: 'Not logged in' });
}

// Register route
app.post('/register', async (req, res) => {
    const username = normalizeText(req.body.username);
    const password = normalizeText(req.body.password);

    if (username.length < 3) {
        return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hashedPassword);
        res.status(201).json({ message: 'Registered' });
    } catch (err) {
        console.error(err);
        if (err.message && err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Username already exists.' });
        }
        res.status(500).json({ error: 'Error registering' });
    }
});

// Login route
app.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user) => {
        if (err) return next(err);
        if (!user) return res.status(401).json({ error: 'Invalid username or password.' });

        req.login(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            return res.json({ id: user.id, username: user.username });
        });
    })(req, res, next);
});

// Logout route
app.post('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.status(204).send();
    });
});

// Get current user
app.get('/current_user', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ id: req.user.id, username: req.user.username });
    } else {
        res.status(401).json({});
    }
});

// Add a single marker
app.post('/addMarker', isAuthenticated, (req, res) => {
    const userId = req.user.id;
    const { marker, error } = parseMarkerPayload(req.body);

    if (error) {
        return res.status(400).json({ error });
    }

    try {
        const result = db.prepare("INSERT INTO markers (user_id, lat, lng, type, name, category) VALUES (?, ?, ?, ?, ?, ?)").run(userId, marker.lat, marker.lng, marker.type, marker.name, marker.category);
        const markerId = typeof result.lastInsertRowid === 'bigint' ? Number(result.lastInsertRowid) : result.lastInsertRowid;
        res.status(200).json({ id: markerId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error saving marker' });
    }
});

// Delete a marker
app.delete('/deleteMarker/:id', isAuthenticated, (req, res) => {
    const userId = req.user.id;
    const markerId = Number(req.params.id);

    if (!Number.isInteger(markerId) || markerId < 1) {
        return res.status(400).json({ error: 'Invalid marker id.' });
    }

    try {
        db.prepare("DELETE FROM markers WHERE id = ? AND user_id = ?").run(markerId, userId);
        res.status(204).send();
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error deleting marker' });
    }
});

// Get markers for the logged in user
app.get('/getMarkers', isAuthenticated, (req, res) => {
    const userId = req.user.id;
    try {
        const rows = db.prepare("SELECT id, lat, lng, type, name, category FROM markers WHERE user_id = ?").all(userId);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error retrieving markers' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
