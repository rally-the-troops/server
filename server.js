"use strict";

const fs = require('fs');
const express = require('express');
const express_session = require('express-session');
const passport = require('passport');
const passport_local = require('passport-local');
const passport_socket = require('passport.socketio');
const body_parser = require('body-parser');
const connect_flash = require('connect-flash');
const crypto = require('crypto');
const sqlite3 = require('better-sqlite3');
const SQLiteStore = require('./connect-better-sqlite3')(express_session);

require('dotenv').config();

const SESSION_SECRET = "Caesar has a big head!";

const MAX_OPEN_GAMES = 3;

let session_store = new SQLiteStore();
let db = new sqlite3(process.env.DATABASE || "./db");
let app = express();
let http_port = process.env.PORT || 8080;
let https_port = process.env.HTTPS_PORT || 8443;
let http = require('http').createServer(app);
let https = require('https').createServer({
	key: fs.readFileSync(process.env.SSL_KEY || "key.pem"),
	cert: fs.readFileSync(process.env.SSL_CERT || "cert.pem")
	}, app);
let socket_io = require('socket.io');
let io1 = socket_io(http);
let io2 = socket_io(https);
let io = {
	use: function (fn) { io1.use(fn); io2.use(fn); },
	on: function (ev,fn) { io1.on(ev,fn); io2.on(ev,fn); },
};

let mailer = null;
if (process.env.MAIL_HOST && process.env.MAIL_PORT) {
	mailer = require('nodemailer').createTransport({
		host: process.env.MAIL_HOST,
		port: process.env.MAIL_PORT,
		ignoreTLS: true
	});
	console.log("Mail notifications enabled: ", mailer.options);
} else {
	console.log("Mail notifications disabled.");
}

const morgan = require('morgan');
const rfs = require('rotating-file-stream');
const log_file = rfs.createStream('access.log', { interval: '1d', path: 'log' });
app.use(morgan('combined', {stream: log_file}));

app.disable('etag');
app.set('view engine', 'ejs');
app.use(body_parser.urlencoded({extended:false}));
app.use(express_session({
	secret: SESSION_SECRET,
	resave: false,
	rolling: true,
	saveUninitialized: false,
	store: session_store,
	cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'strict' }
}));
app.use(connect_flash());

io.use(passport_socket.authorize({
	key: 'connect.sid',
	secret: SESSION_SECRET,
	store: session_store,
}));

const is_immutable = /\.(svg|png|jpg|jpeg|woff2)$/;

function setHeaders(res, path) {
        if (is_immutable.test(path))
                res.set("Cache-Control", "public, max-age=86400, immutable");
}

app.use(express.static('public', { setHeaders: setHeaders }));

function LOG(req, ...msg) {
	let name;
	if (req.isAuthenticated())
		name = req.user.mail;
	else
		name = "guest";
	let time = new Date().toISOString().substring(0,19).replace("T", " ");
	console.log(time, req.connection.remoteAddress, name, ...msg);
}

function SLOG(socket, ...msg) {
	let name = socket.request.user.mail;
	let time = new Date().toISOString().substring(0,19).replace("T", " ");
	console.log(time, socket.request.connection.remoteAddress, name,
		socket.id, socket.title_id, socket.game_id, socket.role, ...msg);
}

function human_date(time) {
	var date = time ? new Date(time + " UTC") : new Date(0);
	var seconds = (Date.now() - date.getTime()) / 1000;
	var days = Math.floor(seconds / 86400);
	if (days == 0) {
		if (seconds < 60) return "now";
		if (seconds < 120) return "1 minute ago";
		if (seconds < 3600) return Math.floor(seconds / 60) + " minutes ago";
		if (seconds < 7200) return "1 hour ago";
		if (seconds < 86400) return Math.floor(seconds / 3600) + " hours ago";
	}
	if (days == 1) return "Yesterday";
	if (days < 14) return days + " days ago";
	if (days < 31) return Math.ceil(days / 7) + " weeks ago";
	return date.toISOString().substring(0,10);
}

function humanize(rows) {
	for (let row of rows) {
		row.ctime = human_date(row.ctime);
		row.mtime = human_date(row.mtime);
	}
}

function is_email(email) {
	return email.match(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/);
}

function clean_user_name(name) {
	name = name.replace(/^ */,'').replace(/ *$/,'').replace(/  */g,' ');
	if (name.length > 50)
		name = name.substring(0, 50);
	return name;
}

const USER_NAME_RE = /^[\p{Alpha}\p{Number}'_-]+( [\p{Alpha}\p{Number}'_-]+)*$/u;

function is_valid_user_name(name) {
	if (name.length < 2)
		return false;
	if (name.length > 50)
		return false;
	return USER_NAME_RE.test(name);
}

function hash_password(password, salt) {
	let hash = crypto.createHash('sha256');
	hash.update(password);
	hash.update(salt);
	return hash.digest('hex');
}

function get_avatar(mail) {
	if (!mail)
		mail = "foo@example.com";
	let digest = crypto.createHash('md5').update(mail.trim().toLowerCase()).digest('hex');
	return '//www.gravatar.com/avatar/' + digest + '?d=mp';
}

/*
 * USER PROFILES
 */

const sql_blacklist_ip = db.prepare("SELECT COUNT(*) FROM blacklist_ip WHERE ip = ?").raw();
const sql_blacklist_mail = db.prepare("SELECT COUNT(*) AS count FROM blacklist_mail WHERE ? LIKE mail").raw();

function is_blacklisted(ip, mail) {
	if (sql_blacklist_ip.get(ip)[0] != 0)
		return true;
	if (sql_blacklist_mail.get(mail)[0] != 0)
		return true;
	return false;
}

const sql_deserialize_user = db.prepare("SELECT user_id, name, mail, notifications FROM users WHERE user_id = ?");
const sql_update_last_seen = db.prepare("UPDATE users SET aip = ?, atime = datetime('now') WHERE user_id = ?");
const sql_login_select = db.prepare("SELECT user_id, name, mail, password, salt FROM users WHERE name = ? OR mail = ?");

const sql_subscribe = db.prepare("UPDATE users SET notifications = 1 WHERE user_id = ?");
const sql_unsubscribe = db.prepare("UPDATE users SET notifications = 0 WHERE user_id = ?");

passport.serializeUser(function (user, done) {
	return done(null, user.user_id);
});

passport.deserializeUser(function (user_id, done) {
	try {
		let row = sql_deserialize_user.get(user_id);
		if (!row)
			return done(null, false);
		return done(null, row);
	} catch (err) {
		console.log(err);
		return done(null, false);
	}
});

function local_login(req, name_or_mail, password, done) {
	try {
		if (!is_email(name_or_mail))
			name_or_mail = clean_user_name(name_or_mail);
		LOG(req, "POST /login", name_or_mail);
		let row = sql_login_select.get(name_or_mail, name_or_mail);
		if (!row)
			return setTimeout(() => done(null, false, req.flash('message', "User not found.")), 1000);
		if (is_blacklisted(req.connection.remoteAddress, row.mail))
			return setTimeout(() => done(null, false, req.flash('message', "Sorry, but this IP or account has been banned.")), 1000);
		let hash = hash_password(password, row.salt);
		if (hash != row.password)
			return setTimeout(() => done(null, false, req.flash('message', "Wrong password.")), 1000);
		sql_update_last_seen.run(req.connection.remoteAddress, row.user_id);
		done(null, row);
	} catch (err) {
		done(null, false, req.flash('message', err.toString()));
	}
}

const sql_signup_check = db.prepare("SELECT user_id, name FROM users WHERE name = ? OR mail = ?");
const sql_signup_insert = db.prepare("INSERT INTO users (name, mail, password, salt, ctime, cip, atime, aip, notifications) VALUES (?,?,?,?,datetime('now'),?,datetime('now'),?,0)");
const sql_signup_login = db.prepare("SELECT user_id, name FROM users WHERE name = ? AND password = ?");

function local_signup(req, name, password, done) {
	try {
		let mail = req.body.mail;
		name = clean_user_name(name);
		if (!is_valid_user_name(name))
			return done(null, false, req.flash('message', "Invalid user name!"));
		LOG(req, "POST /signup", name, mail);
		if (is_blacklisted(req.connection.remoteAddress, mail))
			return setTimeout(() => done(null, false, req.flash('message', "Sorry, but this IP or account has been banned.")), 1000);
		if (password.length < 4)
			return done(null, false, req.flash('message', "Password is too short!"));
		if (password.length > 100)
			return done(null, false, req.flash('message', "Password is too long!"));
		// TODO: actual verification if process.env.VERIFY_EMAIL
		if (!is_email(mail))
			return done(null, false, req.flash('message', "Invalid mail address!"));
		let row = sql_signup_check.get(name, mail);
		if (row)
			return done(null, false, req.flash('message', "User name or mail is already taken."));
		let salt = crypto.randomBytes(32).toString('hex');
		let hash = hash_password(password, salt);
		let ip = req.connection.remoteAddress;
		sql_signup_insert.run(name, mail, hash, salt, ip, ip);
		row = sql_signup_login.get(name, hash);
		done(null, row);
	} catch (err) {
		done(null, false, req.flash('message', err.toString()));
	}
}

passport.use('local-login', new passport_local.Strategy({ passReqToCallback: true }, local_login));
passport.use('local-signup', new passport_local.Strategy({ passReqToCallback: true }, local_signup));

app.use(passport.initialize());
app.use(passport.session());

function update_last_seen(req) {
	sql_update_last_seen.run(req.connection.remoteAddress, req.user.user_id);
}

function must_be_logged_in(req, res, next) {
	if (!req.isAuthenticated())
		return res.redirect('/login');
	if (sql_blacklist_ip.get(req.connection.remoteAddress)[0] != 0)
		return res.redirect('/banned');
	if (sql_blacklist_mail.get(req.user.mail)[0] != 0)
		return res.redirect('/banned');
	update_last_seen(req);
	return next();
}

app.get('/favicon.ico', function (req, res) {
	res.status(204).send();
});

app.get('/about', function (req, res) {
	res.render('about.ejs', { user: req.user });
});

app.get('/logout', function (req, res) {
	LOG(req, "GET /logout");
	req.logout();
	res.redirect('/login');
});

app.get('/banned', function (req, res) {
	LOG(req, "GET /banned");
	res.render('banned.ejs', { user: req.user, message: req.flash('message') });
});

app.get('/login', function (req, res) {
	LOG(req, "GET /login");
	res.render('login.ejs', { user: req.user, message: req.flash('message') });
});

app.get('/signup', function (req, res) {
	LOG(req, "GET /signup");
	res.render('signup.ejs', { user: req.user, message: req.flash('message') });
});

app.post('/login',
	passport.authenticate('local-login', {
		successRedirect: '/profile',
		failureRedirect: '/login',
		failureFlash: true
	})
);

app.post('/signup',
	passport.authenticate('local-signup', {
		successRedirect: '/profile',
		failureRedirect: '/signup',
		failureFlash: true
	})
);

app.get('/users', function (req, res) {
	LOG(req, "GET /users");
	let rows = db.prepare("SELECT name, mail, ctime, atime FROM users ORDER BY atime DESC").all();
	rows.forEach(row => {
		row.avatar = get_avatar(row.mail);
		row.ctime = human_date(row.ctime);
		row.atime = human_date(row.atime);
	});
	res.render('users.ejs', { user: req.user, message: req.flash('message'), userList: rows });
});

const QUERY_STATS = db.prepare(`
	SELECT title_name, scenario, result, count(*) AS count
	FROM games
	JOIN titles ON games.title_id=titles.title_id
	WHERE status=2 AND private=0
	GROUP BY title_name, scenario, result
	`);

app.get('/stats', function (req, res) {
	LOG(req, "GET /stats");
	let stats = QUERY_STATS.all();
	res.render('stats.ejs', { user: req.user, message: req.flash('message'), stats: stats });
});

app.get('/change_password', must_be_logged_in, function (req, res) {
	LOG(req, "GET /change_password");
	res.render('change_password.ejs', { user: req.user, message: req.flash('message') });
});

app.get('/subscribe', must_be_logged_in, function (req, res) {
	LOG(req, "GET /subscribe");
	sql_subscribe.run(req.user.user_id);
	res.redirect('/profile');
});

app.get('/unsubscribe', must_be_logged_in, function (req, res) {
	LOG(req, "GET /unsubscribe");
	sql_unsubscribe.run(req.user.user_id);
	res.redirect('/profile');
});

/*
 * FORGOT AND CHANGE PASSWORD
 */

const sql_select_salt = db.prepare("SELECT salt FROM users WHERE user_id = ?").pluck();
const sql_find_user_by_mail = db.prepare("SELECT user_id FROM users WHERE mail = ?").pluck();

const sql_find_token = db.prepare(`
	SELECT token FROM tokens WHERE user_id = ? AND datetime('now') < datetime(time, '+5 minutes')
	`).pluck();
const sql_verify_token = db.prepare(`
	SELECT COUNT(*) FROM tokens WHERE user_id = ? AND datetime('now') < datetime(time, '+20 minutes') AND token = ?
	`).pluck();
const sql_create_token = db.prepare(`
	INSERT OR REPLACE INTO tokens VALUES ( ?, lower(hex(randomblob(16))), datetime('now') )
	`);

app.get('/forgot_password', function (req, res) {
	LOG(req, "GET /forgot_password");
	res.render('forgot_password.ejs', { user: req.user, message: req.flash('message') });
});

app.get('/reset_password', function (req, res) {
	LOG(req, "GET /reset_password");
	res.render('reset_password.ejs', { user: null, mail: "", token: "", message: req.flash('message') });
});

app.get('/reset_password/:mail', function (req, res) {
	let mail = req.params.mail;
	LOG(req, "GET /reset_password", mail);
	res.render('reset_password.ejs', { user: null, mail: mail, token: "", message: req.flash('message') });
});

app.get('/reset_password/:mail/:token', function (req, res) {
	let mail = req.params.mail;
	let token = req.params.token;
	LOG(req, "GET /reset_password", mail, token);
	res.render('reset_password.ejs', { user: null, mail: mail, token: token, message: req.flash('message') });
});

app.post('/forgot_password', function (req, res) {
	LOG(req, "POST /forgot_password");
	try {
		if (sql_blacklist_ip.get(req.connection.remoteAddress)[0] != 0)
			return res.redirect('/banned');
		let mail = req.body.mail;
		let user_id = sql_find_user_by_mail.get(mail);
		if (user_id) {
			let token = sql_find_token.get(user_id);
			if (!token) {
				sql_create_token.run(user_id);
				token = sql_find_token.get(user_id);
				console.log("FORGOT - create and mail token", token);
				mail_password_reset_token(mail, token);
			} else {
				console.log("FORGOT - existing token - ignore request", token);
			}
			req.flash('message', "A password reset token has been sent to " + mail + ".");
			if (is_email(mail))
				return res.redirect('/reset_password/' + mail);
			return res.redirect('/reset_password/');
		}
		req.flash('message', "User not found.");
		return res.redirect('/forgot_password');
	} catch (err) {
		console.log(err);
		req.flash('message', err.message);
		return res.redirect('/forgot_password');
	}
});

app.post('/reset_password', function (req, res) {
	let mail = req.body.mail;
	let token = req.body.token;
	let password = req.body.password;
	try {
		LOG(req, "POST /reset_password", mail, token);
		let user_id = sql_find_user_by_mail.get(mail);
		if (!user_id) {
			req.flash('message', "User not found.");
			return res.redirect('/reset_password/'+mail+'/'+token);
		}
		if (password.length < 4) {
			req.flash('message', "Password is too short!");
			return res.redirect('/reset_password/'+mail+'/'+token);
		}
		if (!sql_verify_token.get(user_id, token)) {
			req.flash('message', "Invalid or expired token!");
			return res.redirect('/reset_password/'+mail);
		}
		let salt = sql_select_salt.get(user_id);
		if (!salt) {
			req.flash('message', "User not found.");
			return res.redirect('/reset_password/'+mail+'/'+token);
		}
		let hash = hash_password(password, salt);
		db.prepare("UPDATE users SET password = ? WHERE user_id = ?").run(hash, user_id);
		req.flash('message', "Your password has been updated.");
		return res.redirect('/login');
	} catch (err) {
		console.log(err);
		req.flash('message', err.message);
		return res.redirect('/reset_password/'+mail+'/'+token);
	}
});

app.post('/change_password', must_be_logged_in, function (req, res) {
	try {
		let password = req.body.password;
		let newpass = req.body.newpass;
		LOG(req, "POST /change_password", name);
		if (newpass.length < 4) {
			req.flash('message', "Password is too short!");
			return res.redirect('/change_password');
		}
		let salt = sql_select_salt.get(req.user.user_id);
		if (!salt) {
			req.flash('message', "User not found.");
			return res.redirect('/change_password');
		}
		let hash = hash_password(password, salt);
		let user_row = db.prepare("SELECT user_id, name FROM users WHERE name = ? AND password = ?").get(name, hash);
		if (!user_row) {
			req.flash('message', "Wrong password.");
			return res.redirect('/change_password');
		}
		hash = hash_password(newpass, salt);
		db.prepare("UPDATE users SET password = ? WHERE user_id = ?").run(hash, user_row.user_id);
		req.flash('message', "Your password has been updated.");
		return res.redirect('/profile');
	} catch (err) {
		console.log(err);
		req.flash('message', err.message);
		return res.redirect('/change_password');
	}
});

/*
 * GAME LOBBY
 */

let RULES = {};
let PLAYER_COUNT = {};
let QUERY_PLAYER_COUNT = db.prepare("SELECT COUNT(*) FROM roles WHERE title_id = ?").pluck();
for (let title_id of db.prepare("SELECT * FROM titles").pluck().all()) {
	console.log("Loading rules for " + title_id);
	try {
		RULES[title_id] = require("./public/" + title_id + "/rules.js");
		PLAYER_COUNT[title_id] = QUERY_PLAYER_COUNT.get(title_id);
	} catch (err) {
		console.log(err);
	}
}

const QUERY_GAME = db.prepare(`
	SELECT
		games.game_id,
		games.title_id AS title_id,
		titles.title_name AS title_name,
		games.scenario AS scenario,
		games.owner AS owner_id,
		users.name AS owner_name,
		games.ctime,
		games.mtime,
		games.description,
		games.status,
		games.private,
		games.random,
		games.result,
		games.active
	FROM games
	JOIN users ON games.owner = users.user_id
	JOIN titles ON games.title_id = titles.title_id
	WHERE game_id = ?
`);

const QUERY_LIST_GAMES = db.prepare(`
	SELECT
		games.game_id,
		games.title_id AS title_id,
		games.scenario AS scenario,
		games.owner AS owner_id,
		users.name AS owner_name,
		games.ctime,
		games.mtime,
		games.description,
		games.status,
		games.result,
		games.active,
		titles.title_name
	FROM games
	LEFT JOIN users ON games.owner = users.user_id
	LEFT JOIN titles ON games.title_id = titles.title_id
	WHERE private = 0 AND status < 2
`);

const QUERY_LIST_GAMES_OF_TITLE = db.prepare(`
	SELECT
		games.game_id,
		games.title_id AS title_id,
		games.scenario AS scenario,
		games.owner AS owner_id,
		users.name AS owner_name,
		games.ctime,
		games.mtime,
		games.description,
		games.status,
		games.result,
		games.active
	FROM games
	JOIN users ON games.owner = users.user_id
	WHERE title_id = ? AND private = 0
	ORDER BY status ASC, mtime DESC
`);

const QUERY_LIST_GAMES_OF_USER = db.prepare(`
	SELECT DISTINCT
		games.game_id,
		games.title_id,
		titles.title_name,
		games.scenario AS scenario,
		users.name AS owner_name,
		games.description,
		games.ctime,
		games.mtime,
		games.status,
		games.result,
		games.active
	FROM games
	LEFT JOIN players ON games.game_id = players.game_id
	LEFT JOIN users ON games.owner = users.user_id
	LEFT JOIN titles ON games.title_id = titles.title_id
	WHERE games.owner = ? OR players.user_id = ?
	ORDER BY status ASC, mtime DESC
`);

const QUERY_PLAYERS = db.prepare(`
	SELECT
		players.user_id,
		players.role,
		users.name
	FROM players
	JOIN users ON players.user_id = users.user_id
	WHERE players.game_id = ?
`);

const QUERY_PLAYERS_FULL = db.prepare(`
	SELECT
		players.user_id,
		players.role,
		users.name,
		users.mail,
		users.notifications
	FROM players
	JOIN users ON players.user_id = users.user_id
	WHERE players.game_id = ?
`);

const QUERY_PLAYER_NAMES = db.prepare(`
	SELECT
		users.name AS name
	FROM players
	JOIN users ON players.user_id = users.user_id
	WHERE players.game_id = ?
	ORDER BY players.role
`).pluck();

const QUERY_TITLE = db.prepare("SELECT * FROM titles WHERE title_id = ?");
const QUERY_ROLES = db.prepare("SELECT role FROM roles WHERE title_id = ?").pluck();
const QUERY_GAME_OWNER = db.prepare("SELECT * FROM games WHERE game_id = ? AND owner = ?");
const QUERY_TITLE_FROM_GAME = db.prepare("SELECT title_id FROM games WHERE game_id = ?").pluck();
const QUERY_ROLE_FROM_GAME_AND_USER = db.prepare("SELECT role FROM players WHERE game_id = ? AND user_id = ?").pluck();
const QUERY_IS_SOLO = db.prepare("SELECT COUNT(DISTINCT user_id) = 1 FROM players WHERE game_id = ?").pluck();

const QUERY_JOIN_GAME = db.prepare("INSERT INTO players (user_id, game_id, role) VALUES (?,?,?)");
const QUERY_PART_GAME = db.prepare("DELETE FROM players WHERE game_id = ? AND role = ?");
const QUERY_START_GAME = db.prepare("UPDATE games SET status = 1, state = ?, active = ? WHERE game_id = ?");
const QUERY_CREATE_GAME = db.prepare(`
	INSERT INTO games
	(owner,title_id,scenario,private,random,ctime,mtime,description,status,state)
	VALUES
	(?,?,?,?,?,datetime('now'),datetime('now'),?,0,NULL)
`);
const QUERY_UPDATE_GAME_SET_PRIVATE = db.prepare("UPDATE games SET private = 1 WHERE game_id = ?");
const QUERY_ASSIGN_ROLE = db.prepare("UPDATE players SET role = ? WHERE game_id = ? AND user_id = ? AND role = ?");

const QUERY_IS_PLAYER = db.prepare("SELECT COUNT(*) FROM players WHERE game_id = ? AND user_id = ?").pluck();
const QUERY_IS_ACTIVE = db.prepare("SELECT COUNT(*) FROM players WHERE game_id = ? AND role = ? AND user_id = ?").pluck();
const QUERY_COUNT_OPEN_GAMES = db.prepare("SELECT COUNT(*) FROM games WHERE owner = ? AND status = 0").pluck();
const QUERY_DELETE_GAME = db.prepare("DELETE FROM games WHERE game_id = ?");

const QUERY_REMATCH_FIND = db.prepare(`
	SELECT game_id FROM games WHERE status<3 AND description=?
`).pluck();

const QUERY_REMATCH_CREATE = db.prepare(`
	INSERT INTO games
		(owner, title_id, scenario, private, random, ctime, mtime, description, status, state)
	SELECT
		$user_id, title_id, scenario, private, random, datetime('now'), datetime('now'), $magic, 0, NULL
	FROM games
	WHERE game_id = $game_id AND NOT EXISTS (
		SELECT * FROM games WHERE description=$magic
	)
`);

app.get('/', function (req, res) {
	res.render('index.ejs', { user: req.user, message: req.flash('message') });
});

function is_your_turn(game, user) {
	if (!game.active || game.active == "None")
		return false;
	if (game.active == "All" || game.active == "Both")
		return QUERY_IS_PLAYER.get(game.game_id, user.user_id);
	return QUERY_IS_ACTIVE.get(game.game_id, game.active, user.user_id);
}

app.get('/profile', must_be_logged_in, function (req, res) {
	LOG(req, "GET /profile");
	let avatar = get_avatar(req.user.mail);
	let games = QUERY_LIST_GAMES_OF_USER.all(req.user.user_id, req.user.user_id);
	humanize(games);
	for (let game of games) {
		game.players = QUERY_PLAYER_NAMES.all(game.game_id);
		game.your_turn = is_your_turn(game, req.user);
	}
	let open_games = games.filter(game => game.status == 0);
	let active_games = games.filter(game => game.status == 1);
	let finished_games = games.filter(game => game.status == 2);
	res.set("Cache-Control", "no-store");
	res.render('profile.ejs', { user: req.user, avatar: avatar,
		open_games: open_games,
		active_games: active_games,
		finished_games: finished_games,
		message: req.flash('message')
	});
});

app.get('/games', must_be_logged_in, function (req, res) {
	LOG(req, "GET /join");
	let games = QUERY_LIST_GAMES.all();
	humanize(games);
	for (let game of games) {
		game.players = QUERY_PLAYER_NAMES.all(game.game_id);
		game.your_turn = is_your_turn(game, req.user);
	}
	let open_games = games.filter(game => game.status == 0);
	let active_games = games.filter(game => game.status == 1);
	res.set("Cache-Control", "no-store");
	res.render('games.ejs', { user: req.user,
		open_games: open_games,
		active_games: active_games,
		message: req.flash('message')
	});
});

app.get('/info/:title_id', function (req, res) {
	LOG(req, "GET /info/" + req.params.title_id);
	let title_id = req.params.title_id;
	let title = QUERY_TITLE.get(title_id);
	if (!title) {
		req.flash('message', 'That title does not exist.');
		return res.redirect('/');
	}
	if (req.isAuthenticated()) {
		let games = QUERY_LIST_GAMES_OF_TITLE.all(title_id);
		humanize(games);
		let open_games = games.filter(game => game.status == 0);
		let active_games = games.filter(game => game.status == 1);
		for (let game of active_games) {
			game.players = QUERY_PLAYER_NAMES.all(game.game_id);
			game.your_turn = is_your_turn(game, req.user);
		}
		let finished_games = games.filter(game => game.status == 2);
		for (let game of finished_games)
			game.players = QUERY_PLAYER_NAMES.all(game.game_id);
		res.set("Cache-Control", "no-store");
		res.render('info.ejs', { user: req.user, title: title,
			open_games: open_games,
			active_games: active_games,
			finished_games: finished_games,
			message: req.flash('message')
		});
	} else {
		res.set("Cache-Control", "no-store");
		res.render('info.ejs', { user: req.user, title: title,
			open_games: [],
			active_games: [],
			finished_games: [],
			message: req.flash('message')
		});
	}
});

app.get('/create/:title_id', must_be_logged_in, function (req, res) {
	LOG(req, "GET /create/" + req.params.title_id);
	let title_id = req.params.title_id;
	let title = QUERY_TITLE.get(title_id);
	if (!title) {
		req.flash('message', 'That title does not exist.');
		return res.redirect('/');
	}
	res.render('create.ejs', { user: req.user, message: req.flash('message'), title: title, scenarios: RULES[title_id].scenarios });
});

app.post('/create/:title_id', must_be_logged_in, function (req, res) {
	let title_id = req.params.title_id;
	let descr = req.body.description;
	let priv = req.body.private == 'private';
	let rand = req.body.random == 'random';
	let scenario = req.body.scenario;
	let user_id = req.user.user_id;
	LOG(req, "POST /create/" + req.params.title_id, scenario, priv, JSON.stringify(descr));
	try {
		let count = QUERY_COUNT_OPEN_GAMES.get(user_id);
		if (count >= MAX_OPEN_GAMES) {
			req.flash('message', "You have too many open games!");
			return res.redirect('/create/'+title_id);
		}
		if (!(title_id in RULES)) {
			req.flash('message', "That title doesn't exist.");
			return res.redirect('/');
		}
		if (!RULES[title_id].scenarios.includes(scenario)) {
			req.flash('message', "That scenario doesn't exist.");
			return res.redirect('/create/'+title_id);
		}
		let info = QUERY_CREATE_GAME.run(user_id, title_id, scenario, priv ? 1 : 0, rand ? 1 : 0, descr);
		res.redirect('/join/'+info.lastInsertRowid);
	} catch (err) {
		req.flash('message', err.toString());
		return res.redirect('/create/'+title_id);
	}
});

app.get('/delete/:game_id', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id;
	LOG(req, "GET /delete/" + game_id);
	try {
		let game = QUERY_GAME_OWNER.get(game_id, req.user.user_id);
		if (!game) {
			req.flash('message', "Only the game owner can delete the game!");
			return res.redirect('/join/'+game_id);
		}
		QUERY_DELETE_GAME.run(game_id);
		update_join_clients_deleted(game_id);
		res.redirect('/info/'+game.title_id);
	} catch (err) {
		req.flash('message', err.toString());
		return res.redirect('/join/'+game_id);
	}
});

app.get('/rematch/:old_game_id', must_be_logged_in, function (req, res) {
	LOG(req, "GET /rematch/" + req.params.old_game_id);
	let old_game_id = req.params.old_game_id | 0;
	try {
		let magic = "\u{1F503} " + old_game_id;
		let info = QUERY_REMATCH_CREATE.run({user_id: req.user.user_id, game_id: old_game_id, magic: magic});
		if (info.changes == 1)
			return res.redirect('/join/'+info.lastInsertRowid);
		let new_game_id = QUERY_REMATCH_FIND.get(magic);
		if (new_game_id)
			return res.redirect('/join/'+new_game_id);
		req.flash('message', "Can't create or find rematch game!");
		return res.redirect('/join/'+old_game_id);
	} catch (err) {
		req.flash('message', err.toString());
		return res.redirect('/join/'+old_game_id);
	}
});

let join_clients = {};

function update_join_clients_deleted(game_id) {
	let list = join_clients[game_id];
	if (list && list.length > 0) {
		console.log("UPDATE JOIN DELETED", game_id, list.length)
		for (let res of list) {
			console.log("PUSH JOIN DELETED", game_id);
			res.write("retry: 15000\n");
			res.write("event: deleted\n");
			res.write("data: The game doesn't exist.\n\n");
		}
	}
}

function update_join_clients_game(game_id) {
	let list = join_clients[game_id];
	if (list && list.length > 0) {
		console.log("UPDATE JOIN GAME", game_id, list.length)
		let game = QUERY_GAME.get(game_id);
		for (let res of list) {
			console.log("PUSH JOIN GAME", game_id);
			res.write("retry: 15000\n");
			res.write("event: game\n");
			res.write("data: " + JSON.stringify(game) + "\n\n");
		}
	}
}

function update_join_clients_players(game_id) {
	let list = join_clients[game_id];
	if (list) {
		console.log("UPDATE JOIN PLAYERS", game_id, list.length)
		let players = QUERY_PLAYERS.all(game_id);
		let ready = RULES[list.title_id].ready(list.scenario, players);
		for (let res of list) {
			console.log("PUSH JOIN PLAYERS", game_id);
			res.write("retry: 15000\n");
			res.write("event: players\n");
			res.write("data: " + JSON.stringify(players) + "\n\n");
			res.write("event: ready\n");
			res.write("data: " + ready + "\n\n");
		}
	}
}

app.get('/join/:game_id', must_be_logged_in, function (req, res) {
	LOG(req, "GET /join/" + req.params.game_id);
	let game_id = req.params.game_id | 0;
	let game = QUERY_GAME.get(game_id);
	if (!game) {
		req.flash('message', "That game doesn't exist.");
		return res.redirect('/');
	}
	let roles = QUERY_ROLES.all(game.title_id);
	let players = QUERY_PLAYERS.all(game_id);
	let ready = (game.status == 0) && RULES[game.title_id].ready(game.scenario, players);
	res.set("Cache-Control", "no-store");
	res.render('join.ejs', {
		user: req.user,
		game: game,
		roles: roles,
		players: players,
		solo: players.every(p => p.user_id == req.user.user_id),
		ready: players.length == roles.length,
		message: req.flash('message')
	});
});

app.get('/join-events/:game_id', must_be_logged_in, function (req, res) {
	LOG(req, "GET /join-events/" + req.params.game_id);
	let game_id = req.params.game_id | 0;
	let players = QUERY_PLAYERS.all(game_id);
	let game = QUERY_GAME.get(game_id);

	res.setHeader("Cache-Control", "no-store");
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Connection", "keep-alive");

	if (!game) {
		req.flash('message', "That game doesn't exist.");
		return res.send("event: deleted\ndata: The game doesn't exist.\n\n");
	}
	if (!(game_id in join_clients)) {
		join_clients[game_id] = [];
		join_clients[game_id].title_id = game.title_id;
		join_clients[game_id].scenario = game.scenario;
	}
	join_clients[game_id].push(res);

	res.on('close', err => {
		console.log("CLOSE JOIN EVENTS", err);
		let list = join_clients[game_id];
		let i = list.indexOf(res);
		if (i >= 0)
			list.splice(i, 1);
	});

	res.write("retry: 15000\n\n");
	res.write("event: game\n");
	res.write("data: " + JSON.stringify(game) + "\n\n");
	res.write("event: players\n");
	res.write("data: " + JSON.stringify(players) + "\n\n");
});

app.get('/join/:game_id/:role', must_be_logged_in, function (req, res) {
	LOG(req, "GET /join/" + req.params.game_id + "/" + req.params.role);
	let game_id = req.params.game_id | 0;
	let role = req.params.role;
	try {
		QUERY_JOIN_GAME.run(req.user.user_id, game_id, role);
		update_join_clients_players(game_id);
		res.send("SUCCESS");
	} catch (err) {
		console.log(err);
		res.send(err.toString());
	}
});

app.get('/part/:game_id/:role', must_be_logged_in, function (req, res) {
	LOG(req, "GET /part/" + req.params.game_id + "/" + req.params.role);
	let game_id = req.params.game_id | 0;
	let role = req.params.role;
	try {
		QUERY_PART_GAME.run(game_id, role);
		update_join_clients_players(game_id);
		res.send("SUCCESS");
	} catch (err) {
		console.log(err);
		res.send(err.toString());
	}
});

function assign_random_roles(game, players) {
	function pick_random_item(list) {
		let k = Math.floor(Math.random() * list.length);
		let r = list[k];
		list.splice(k, 1);
		return r;
	}
	let roles = QUERY_ROLES.all(game.title_id);
	for (let p of players) {
		let old_role = p.role;
		p.role = pick_random_item(roles);
		console.log("ASSIGN ROLE", "(" + p.name + ")", old_role, "->", p.role);
		QUERY_ASSIGN_ROLE.run(p.role, game.game_id, p.user_id, old_role);
	}
}

app.get('/start/:game_id', must_be_logged_in, function (req, res) {
	LOG(req, "GET /start/" + req.params.game_id);
	let game_id = req.params.game_id | 0;
	try {
		let game = QUERY_GAME_OWNER.get(game_id, req.user.user_id);
		if (!game)
			return res.send("Only the game owner can start the game!");
		if (game.status != 0)
			return res.send("The game is already started!");
		let players = QUERY_PLAYERS.all(game_id);
		if (!RULES[game.title_id].ready(game.scenario, players))
			return res.send("Invalid player configuration!");
		if (game.random) {
			assign_random_roles(game, players);
			update_join_clients_players(game_id);
		}
		let state = RULES[game.title_id].setup(game.scenario, players);
		QUERY_START_GAME.run(JSON.stringify(state), state.active, game_id);
		let is_solo = players.every(p => p.user_id == players[0].user_id);
		if (is_solo)
			QUERY_UPDATE_GAME_SET_PRIVATE.run(game_id);
		update_join_clients_game(game_id);
		res.send("SUCCESS");
	} catch (err) {
		console.log(err);
		res.send(err.toString());
	}
});

app.get('/play/:game_id/:role', must_be_logged_in, function (req, res) {
	LOG(req, "GET /play/" + req.params.game_id + "/" + req.params.role);
	let game_id = req.params.game_id | 0;
	let role = req.params.role;
	try {
		let title = QUERY_TITLE_FROM_GAME.get(game_id);
		if (!title)
			return res.redirect('/join/'+game_id);
		res.redirect('/'+title+'/play.html?game='+game_id+'&role='+role);
	} catch (err) {
		req.flash('message', err.toString());
		return res.redirect('/join/'+game_id);
	}
});

app.get('/play/:game_id', must_be_logged_in, function (req, res) {
	LOG(req, "GET /play/" + req.params.game_id);
	let game_id = req.params.game_id | 0;
	let user_id = req.user.user_id | 0;
	try {
		let role = QUERY_ROLE_FROM_GAME_AND_USER.get(game_id, user_id);
		if (!role)
			return res.redirect('/play/'+game_id+'/Observer');
		return res.redirect('/play/'+game_id+'/'+role);
	} catch (err) {
		req.flash('message', err.toString());
		return res.redirect('/join/'+game_id);
	}
});

/*
 * MAIL NOTIFICATIONS
 */

const MAIL_FROM = process.env.MAIL_FROM || "Rally the Troops! <notifications@rally-the-troops.com>";
const MAIL_FOOTER = "You can unsubscribe from notifications on your profile page:\n\nhttps://rally-the-troops.com/unsubscribe\n";

const sql_notify_too_soon = db.prepare("SELECT datetime('now') < datetime(time, ?) FROM notifications WHERE user_id = ? AND game_id = ?").pluck();
const sql_notify_update = db.prepare("INSERT OR REPLACE INTO notifications VALUES ( ?, ?, datetime('now') )");
const sql_offline_user = db.prepare("SELECT * FROM users WHERE user_id = ? AND datetime('now') > datetime(atime, ?)");

const QUERY_LIST_YOUR_TURN = db.prepare(`
	SELECT games.game_id, games.title_id, players.user_id, users.name, users.mail, users.notifications
	FROM games
	JOIN players ON games.game_id = players.game_id AND ( games.active = players.role OR games.active = 'All' OR games.active = 'Both' )
	JOIN users ON users.user_id = players.user_id
	WHERE games.status = 1 AND datetime('now') > datetime(games.mtime, '+1 hour')
`);

const QUERY_LIST_READY_TO_START = db.prepare(`
	SELECT games.game_id, games.title_id, games.owner, COUNT(*) AS joined
	FROM games
	JOIN players ON games.game_id = players.game_id
	WHERE games.status = 0
	GROUP BY games.game_id
`);

function mail_callback(err, info) {
	console.log("MAIL SENT", err, info);
}

function mail_password_reset_token(mail, token) {
	let subject = "Rally the Troops - Password reset request";
	let body =
		"Your password reset token is: " + token + "\n\n" +
		"https://rally-the-troops.com/reset_password/" + mail + "/" + token + "\n\n" +
		"If you did not request a password reset you can ignore this mail.\n";
	mailer.sendMail({ from: MAIL_FROM, to: mail, subject: subject, text: body }, mail_callback);
}

function mail_your_turn_notification(user, game_id, interval) {
	let too_soon = sql_notify_too_soon.get(interval, user.user_id, game_id);
	console.log("YOUR TURN (OFFLINE):", game_id, user.name, user.mail, too_soon);
	if (!too_soon) {
		sql_notify_update.run(user.user_id, game_id);
		let game = QUERY_GAME.get(game_id);
		let subject = game.title_name + " - " + game_id + " - Your turn!";
		let body =
			"It's your turn.\n\n" +
			"https://rally-the-troops.com/play/" + game_id + "\n\n" +
			MAIL_FOOTER;
		mailer.sendMail({ from: MAIL_FROM, to: user.mail, subject: subject, text: body }, mail_callback);
	}
}

function reset_your_turn_notification(user, game_id) {
	console.log("YOUR TURN (ONLINE):", game_id, user.name, user.mail);
	sql_notify_update.run(user.user_id, game_id);
}

function mail_ready_to_start_notification(user, game_id, interval) {
	let too_soon = sql_notify_too_soon.get(interval, user.user_id, game_id);
	console.log("READY TO START:", game_id, user.name, user.mail, too_soon);
	if (!too_soon) {
		sql_notify_update.run(user.user_id, game_id);
		let game = QUERY_GAME.get(game_id);
		let subject = game.title_name + " - " + game_id + " - Ready to start!";
		let body =
			"Your game is ready to start.\n\n" +
			"https://rally-the-troops.com/join/" + game_id + "\n\n" +
			MAIL_FOOTER;
		mailer.sendMail({ from: MAIL_FROM, to: user.mail, subject: subject, text: body }, mail_callback);
	}
}

function mail_your_turn_notification_to_offline_users(game_id, old_active, new_active) {
	if (!mailer)
		return;
	if (new_active == old_active)
		return;

	function is_active(active, role) {
		return active == "Both" || active == "All" || active == role;
	}

	function is_online(game_id, user_id) {
		for (let other of clients[game_id])
			if (other.user_id == user_id)
				return true;
		return false;
	}

	let users = {};
	let online = {};
	for (let p of QUERY_PLAYERS_FULL.all(game_id)) {
		if (p.notifications && !is_active(old_active, p.role) && is_active(new_active, p.role)) {
			users[p.user_id] = p;
			if (is_online(game_id, p.user_id))
				online[p.user_id] = 1;
		}
	}

	for (let u in users) {
		if (online[u])
			reset_your_turn_notification(users[u], game_id);
		else
			mail_your_turn_notification(users[u], game_id, '+1 minute');
	}
}

function notify_your_turn_reminder() {
	for (let item of QUERY_LIST_YOUR_TURN.all()) {
		if (!QUERY_IS_SOLO.get(item.game_id)) {
			console.log("REMINDER: YOUR TURN", item.title_id, item.game_id, item.name, item.mail, item.notifications);
			if (item.notifications)
				mail_your_turn_notification(item, item.game_id, '+25 hours');
		}
	}
}

function notify_ready_to_start_reminder() {
	for (let game of QUERY_LIST_READY_TO_START.all()) {
		if (game.joined == PLAYER_COUNT[game.title_id]) {
			let owner = sql_offline_user.get(game.owner, '+3 minutes');
			if (owner) {
				console.log("REMINDER: READY TO START", game.title_id, game.game_id, owner.name, owner.mail, owner.notifications);
				if (owner.notifications)
					mail_ready_to_start_notification(owner, game.game_id, '+25 hours');
			}
		}
	}
}

// Check and send 'your turn' reminders quarterly.
setInterval(notify_your_turn_reminder, 15 * 60 * 1000);

// Check and send ready to start notifications once a minute.
setInterval(notify_ready_to_start_reminder, 60 * 1000);

/*
 * GAME PLAYING
 */

const QUERY_SELECT_CHAT = db.prepare("SELECT chat FROM chats WHERE game_id = ?").pluck();
const QUERY_UPDATE_CHAT = db.prepare("INSERT OR REPLACE INTO chats ( game_id, time, chat ) VALUES ( ?, datetime('now'), ? )");
const QUERY_SELECT_GAME_STATE = db.prepare("SELECT state FROM games WHERE game_id = ?");
const QUERY_UPDATE_GAME_STATE = db.prepare("UPDATE games SET state = ?, active = ?, status = ?, result = ?, mtime = datetime('now') WHERE game_id = ?");
const QUERY_CONNECT_GAME = db.prepare("SELECT title_id, state FROM games WHERE title_id = ? AND game_id = ?");
const QUERY_RESTART_GAME = db.prepare("UPDATE games SET state = ?, mtime = datetime('now') WHERE game_id = ?");

let clients = {};

function send_state(socket, state) {
	try {
		let view = socket.rules.view(state, socket.role);
		if (socket.log_length < view.log.length)
			view.log_start = socket.log_length;
		else
			view.log_start = view.log.length;
		socket.log_length = view.log.length;
		view.log = view.log.slice(view.log_start);
		socket.emit('state', view, state.state == 'game_over');
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function get_game_state(game_id) {
	let row = QUERY_SELECT_GAME_STATE.get(game_id);
	if (!row)
		throw new Error("No game with that ID");
	return JSON.parse(row.state);
}

function put_game_state(game_id, state, old_active) {
	let status = 1;
	let result = null;
	if (state.state == 'game_over') {
		status = 2;
		result = state.result;
	}
	QUERY_UPDATE_GAME_STATE.run(JSON.stringify(state), state.active, status, result, game_id);
	for (let other of clients[game_id])
		send_state(other, state);
	update_join_clients_game(game_id);
	mail_your_turn_notification_to_offline_users(game_id, old_active, state.active);
}

function on_action(socket, action, arg) {
	SLOG(socket, "--> ACTION", action, arg);
	try {
		let state = get_game_state(socket.game_id);
		let old_active = state.active;
		socket.rules.action(state, socket.role, action, arg);
		put_game_state(socket.game_id, state, old_active);
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function on_resign(socket) {
	SLOG(socket, "--> RESIGN");
	try {
		let state = get_game_state(socket.game_id);
		let old_active = state.active;
		socket.rules.resign(state, socket.role);
		put_game_state(socket.game_id, state, old_active);
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function send_chat(socket, chat) {
	if (socket.role == "Observer")
		return;
	if (chat && socket.chat_length < chat.length) {
		SLOG(socket, "<-- CHAT LOG", socket.chat_length, "..", chat.length);
		socket.emit('chat', socket.chat_length, chat.slice(socket.chat_length));
		socket.chat_length = chat.length;
	}
}

function on_getchat(socket, old_len) {
	try {
		socket.chat_length = old_len;
		let chat = QUERY_SELECT_CHAT.get(socket.game_id);
		if (!chat)
			chat = [];
		else
			chat = JSON.parse(chat);
		send_chat(socket, chat);
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function on_chat(socket, message) {
	message = message.substring(0,4096);
	SLOG(socket, "--> CHAT");
	try {
		let chat = QUERY_SELECT_CHAT.get(socket.game_id);
		if (!chat)
			chat = [];
		else
			chat = JSON.parse(chat);
		chat.push([new Date(), socket.user_name, message]);
		QUERY_UPDATE_CHAT.run(socket.game_id, JSON.stringify(chat));
		for (let other of clients[socket.game_id])
			send_chat(other, chat);
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function on_debug(socket) {
	SLOG(socket, "<-- DEBUG");
	try {
		let row = QUERY_SELECT_GAME_STATE.get(socket.game_id);
		if (!row)
			return socket.emit('error', "No game with that ID.");
		socket.emit('debug', row.state);
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function on_save(socket) {
	SLOG(socket, "<-- SAVE");
	try {
		let row = QUERY_SELECT_GAME_STATE.get(socket.game_id);
		if (!row)
			return socket.emit('error', "No game with that ID.");
		socket.emit('save', row.state);
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function on_restore(socket, state_text) {
	SLOG(socket, '--> RESTORE', state_text);
	try {
		let state = JSON.parse(state_text);
		QUERY_UPDATE_GAME_STATE.run(state_text, state.active, 1, null, socket.game_id);
		for (let other of clients[socket.game_id])
			send_state(other, state);
	} catch (err) {
		console.log(err);
		return socket.emit('error', err.toString());
	}
}

function broadcast_presence(game_id) {
	let presence = {};
	for (let socket of clients[game_id])
		presence[socket.role] = true;
	for (let socket of clients[game_id])
		socket.emit('presence', presence);
}

io.on('connection', (socket) => {
	socket.title_id = socket.handshake.query.title;
	socket.game_id = socket.handshake.query.game | 0;
	socket.user_id = socket.request.user.user_id | 0;
	socket.user_name = socket.request.user.name;
	socket.role = socket.handshake.query.role;
	socket.log_length = 0;
	socket.chat_length = 0;
	socket.rules = RULES[socket.title_id];

	SLOG(socket, "CONNECT");

	try {
		let game = QUERY_CONNECT_GAME.get(socket.title_id, socket.game_id);
		if (!game)
			return socket.emit('error', "That game does not exist.");

		let players = QUERY_PLAYERS.all(socket.game_id);

		if (socket.role != "Observer") {
			let me;
			if (socket.role && socket.role != 'undefined' && socket.role != 'null') {
				me = players.find(p => p.user_id == socket.user_id && p.role == socket.role);
				if (!me) {
					socket.role = "Observer";
					return socket.emit('error', "You aren't assigned that role!");
				}
			} else {
				me = players.find(p => p.user_id == socket.user_id);
				socket.role = me ? me.role : "Observer";
			}
		}

		socket.emit('roles', socket.role, players);

		if (clients[socket.game_id])
			clients[socket.game_id].push(socket);
		else
			clients[socket.game_id] = [ socket ];

		socket.on('disconnect', () => {
			SLOG(socket, "DISCONNECT");
			clients[socket.game_id].splice(clients[socket.game_id].indexOf(socket), 1);
			if (socket.role != "Observer")
				broadcast_presence(socket.game_id);
		});

		if (socket.role != "Observer") {
			socket.on('action', (action, arg) => on_action(socket, action, arg));
			socket.on('resign', () => on_resign(socket));
			socket.on('getchat', (old_len) => on_getchat(socket, old_len));
			socket.on('chat', (message) => on_chat(socket, message));

			socket.on('debug', () => on_debug(socket));
			socket.on('save', () => on_save(socket));
			socket.on('restore', (state) => on_restore(socket, state));
			socket.on('restart', (scenario) => {
				try {
					let state = socket.rules.setup(scenario, players);
					for (let other of clients[socket.game_id]) {
						other.log_length = 0;
						send_state(other, state);
					}
					let state_text = JSON.stringify(state);
					QUERY_RESTART_GAME.run(state_text, socket.game_id);
				} catch (err) {
					console.log(err);
					return socket.emit('error', err.toString());
				}
			});
		}

		broadcast_presence(socket.game_id);

		send_state(socket, JSON.parse(game.state));

	} catch (err) {
		console.log(err);
		socket.emit('error', err.message);
	}
});

http.listen(http_port, '0.0.0.0', () => { console.log('listening HTTP on *:' + http_port); });
https.listen(https_port, '0.0.0.0', () => { console.log('listening HTTPS on *:' + https_port); });
