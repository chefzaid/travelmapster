const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');
const session = require('express-session');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;

const app = express();
const db = new sqlite3.Database('./markers.db');

app.use(bodyParser.json());
app.use(session({ secret: 'your-secret-key', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

// Initialize the users and markers table
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        oauth_provider TEXT DEFAULT NULL,
        oauth_id TEXT DEFAULT NULL
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS markers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        lat REAL,
        lng REAL,
        type TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
});

// Passport Local Strategy for username/password authentication
passport.use(new LocalStrategy((username, password, done) => {
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return done(err);
        if (!user) return done(null, false, { message: 'Incorrect username.' });
        bcrypt.compare(password, user.password, (err, res) => {
            if (res) return done(null, user);
            return done(null, false, { message: 'Incorrect password.' });
        });
    });
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
        done(err, user);
    });
});

// Register route
app.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);

    db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], (err) => {
        if (err) return res.status(500).send('Error registering');
        res.redirect('/login');
    });
});

// Login route
app.post('/login', passport.authenticate('local', {
    successRedirect: '/profile',
    failureRedirect: '/login',
    failureFlash: true
}));

// Save markers to DB
app.post('/saveMarkers', (req, res) => {
    const { userId, markers } = req.body;
    const stmt = db.prepare("INSERT INTO markers (user_id, lat, lng, type) VALUES (?, ?, ?, ?)");
    markers.forEach(marker => {
        stmt.run(userId, marker.lat, marker.lng, marker.type);
    });
    stmt.finalize();
    res.status(200).send('Markers saved');
});

// Get markers from DB
app.get('/getMarkers', (req, res) => {
    const userId = req.query.userId;
    db.all("SELECT lat, lng, type FROM markers WHERE user_id = ?", [userId], (err, rows) => {
        if (err) res.status(500).send("Error retrieving markers");
        else res.json(rows);
    });
});

// Google OAuth configuration
passport.use(new GoogleStrategy({
    clientID: 'YOUR_GOOGLE_CLIENT_ID',
    clientSecret: 'YOUR_GOOGLE_CLIENT_SECRET',
    callbackURL: '/auth/google/callback'
}, (token, tokenSecret, profile, done) => {
    db.get('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?', ['google', profile.id], (err, user) => {
        if (user) return done(null, user);
        db.run('INSERT INTO users (username, oauth_provider, oauth_id) VALUES (?, ?, ?)', 
            [profile.displayName, 'google', profile.id], function(err) {
                return done(null, { id: this.lastID });
        });
    });
}));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/login' }), (req, res) => {
    res.redirect('/profile');
});

// Facebook OAuth configuration
passport.use(new FacebookStrategy({
    clientID: 'YOUR_FACEBOOK_APP_ID',
    clientSecret: 'YOUR_FACEBOOK_APP_SECRET',
    callbackURL: '/auth/facebook/callback'
}, (token, tokenSecret, profile, done) => {
    db.get('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?', ['facebook', profile.id], (err, user) => {
        if (user) return done(null, user);
        db.run('INSERT INTO users (username, oauth_provider, oauth_id) VALUES (?, ?, ?)', 
            [profile.displayName, 'facebook', profile.id], function(err) {
                return done(null, { id: this.lastID });
        });
    });
}));

app.get('/auth/facebook', passport.authenticate('facebook'));
app.get('/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/login' }), (req, res) => {
    res.redirect('/profile');
});

app.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});
