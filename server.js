"use strict"

const fs = require('fs')
const crypto = require('crypto')
const http = require('http')
const https = require('https') // for webhook requests
const { WebSocketServer } = require('ws')
const express = require('express')
const url = require('url')
const sqlite3 = require('better-sqlite3')

require('dotenv').config()

const DEBUG = process.env.DEBUG || 0

const HTTP_HOST = process.env.HTTP_HOST || "localhost"
const HTTP_PORT = process.env.HTTP_PORT || 8080

const SITE_NAME = process.env.SITE_NAME || "Localhost"
const SITE_URL = process.env.SITE_URL || "http://" + HTTP_HOST + ":" + HTTP_PORT

function LOG_STATS() {
	// Count clients connected to join page events
	let num_joins = 0
	for (let id in join_clients)
		num_joins += join_clients[id].length

	// Count clients connected to game websockets
	let num_games = 0
	let num_sockets = 0
	for (let id in game_clients) {
		num_games ++
		num_sockets += game_clients[id].length
	}

	if (num_games > 0 || num_sockets > 0 || num_joins > 0)
		console.log(`>>> games=${num_games} sockets=${num_sockets} joins=${num_joins}`)
}

setInterval(LOG_STATS, 60 * 1000)

/*
 * Main database.
 */

let db = new sqlite3(process.env.DATABASE || "./db")
db.pragma("synchronous = NORMAL")

db.exec("delete from logins where julianday() > julianday(expires)")
db.exec("delete from tokens where julianday() > julianday(time, '+1 days')")

function SQL(s) {
	return db.prepare(s)
}

function set_has(set, item) {
	if (!set)
		return false
	let a = 0
	let b = set.length - 1
	while (a <= b) {
		let m = (a + b) >> 1
		let x = set[m]
		if (item < x)
			b = m - 1
		else if (item > x)
			a = m + 1
		else
			return true
	}
	return false
}

/*
 * Notification mail setup.
 */

let mailer = null
if (process.env.MAIL_HOST && process.env.MAIL_PORT && process.env.MAIL_FROM) {
	mailer = require("nodemailer").createTransport({
		host: process.env.MAIL_HOST,
		port: process.env.MAIL_PORT,
		ignoreTLS: true
	})
	console.log("Mail notifications enabled: ", mailer.options)
} else {
	console.log("Mail notifications disabled.")
	mailer = {
		sendMail(obj, callback) {
			callback("DID NOT SEND: " + JSON.stringify(obj,0,4))
		}
	}
}

/*
 * Login session management.
 */

const COOKIE = (process.env.COOKIE || "login") + "="

const login_sql_select = SQL("select user_id from logins where sid = ? and expires > julianday()").pluck()
const login_sql_insert = SQL("insert into logins values (abs(random()) % (1<<48), ?, julianday() + 28) returning sid").pluck()
const login_sql_delete = SQL("delete from logins where sid = ?")
const login_sql_touch = SQL("update logins set expires = julianday() + 28 where sid = ? and expires < julianday() + 27")

function make_cookie(sid, age) {
	return `${COOKIE}${sid}; Path=/; Max-Age=${age}; HttpOnly`
}

function login_cookie(req) {
	let c = req.headers.cookie
	if (c) {
		let i = c.indexOf(COOKIE)
		if (i >= 0)
			return parseInt(c.substring(i+COOKIE.length))
	}
	return 0
}

function login_insert(res, user_id) {
	let sid = login_sql_insert.get(user_id)
	res.setHeader("Set-Cookie", make_cookie(sid, 2419200))
}

function login_touch(res, sid) {
	if (login_sql_touch.run(sid).changes === 1)
		res.setHeader("Set-Cookie", make_cookie(sid, 2419200))
}

function login_delete(res, sid) {
	login_sql_delete.run(sid)
	res.setHeader("Set-Cookie", make_cookie("", 0))
}

/*
 * Web server setup.
 */

function set_static_headers(res, path) {
	if (path.match(/\.(jpg|png|svg|webp|ico|woff2)$/))
		res.setHeader("Cache-Control", "max-age=86400")
	else
		res.setHeader("Cache-Control", "max-age=60")
}

let app = express()
app.locals.SITE_NAME = SITE_NAME
app.locals.SITE_URL = SITE_URL
app.set('x-powered-by', false)
app.set('etag', false)
app.set('view engine', 'pug')

app.use(express.static('public', { redirect: false, etag: false, cacheControl: false, setHeaders: set_static_headers }))
app.use(express.urlencoded({extended:false}))

let http_server = http.createServer(app)
let wss = new WebSocketServer({server: http_server})
http_server.keepAliveTimeout = 0
http_server.listen(HTTP_PORT, HTTP_HOST, () => console.log(`Listening to HTTP on ${HTTP_HOST}:${HTTP_PORT}`))

/*
 * MISC FUNCTIONS
 */

function play_url(title_id, game_id, role, mode) {
	if (mode && mode)
		return `/${title_id}/play.html?mode=${mode}&game=${game_id}&role=${encodeURIComponent(role)}`
	else if (mode)
		return `/${title_id}/play.html?mode=${mode}&game=${game_id}`
	else if (role)
		return `/${title_id}/play.html?game=${game_id}&role=${encodeURIComponent(role)}`
	else
		return `/${title_id}/play.html?mode=${mode}`
}

function random_seed() {
	return crypto.randomInt(1, 2**35-31)
}

function epoch_from_julianday(x) {
	return (x - 2440587.5) * 86400000
}

function julianday_from_epoch(x) {
	return x / 86400000 + 2440587.5
}

function epoch_from_time(x) {
	if (typeof x === "string")
		return Date.parse(x)
	return epoch_from_julianday(x)
}

function julianday_from_time(x) {
	if (typeof x === "string")
		return julianday_from_epoch(Date.parse(x))
	return x
}

function SLOG(socket, ...msg) {
	let time = new Date().toISOString().substring(11,19)
	let name = (socket.user ? socket.user.name : "guest").padEnd(20)
	let ip = String(socket.ip).padEnd(15)
	let ws = "----------"
	console.log(time, ip, ws, name, "WS",
		socket.title_id,
		socket.game_id,
		socket.role,
		...msg)
}

function human_date(date) {
	if (typeof date === 'string')
		date = julianday_from_epoch(Date.parse(date))
	if (typeof date !== 'number')
		return "never"
	var days = julianday_from_epoch(Date.now()) - date
	var seconds = days * 86400
	if (days < 1) {
		if (seconds < 60) return "now"
		if (seconds < 120) return "1 minute ago"
		if (seconds < 3600) return Math.floor(seconds / 60) + " minutes ago"
		if (seconds < 7200) return "1 hour ago"
		if (seconds < 86400) return Math.floor(seconds / 3600) + " hours ago"
	}
	if (days < 2) return "yesterday"
	if (days < 14) return Math.floor(days) + " days ago"
	if (days < 31) return Math.floor(days / 7) + " weeks ago"
	return new Date(epoch_from_julianday(date)).toISOString().substring(0,10)
}

function is_email(email) {
	return email.match(/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/)
}

function clean_user_name(name) {
	name = name.replace(/^ */,'').replace(/ *$/,'').replace(/  */g,' ')
	if (name.length > 50)
		name = name.substring(0, 50)
	return name
}

const USER_NAME_RE = /^[\p{Alpha}\p{Number}'_-]+( [\p{Alpha}\p{Number}'_-]+)*$/u

function is_valid_user_name(name) {
	if (name.length < 2)
		return false
	if (name.length > 50)
		return false
	return USER_NAME_RE.test(name)
}

function hash_password(password, salt) {
	let hash = crypto.createHash('sha256')
	hash.update(password)
	hash.update(salt)
	return hash.digest('hex')
}

/*
 * USER AUTHENTICATION
 */

const SQL_BLACKLIST_MAIL = SQL("SELECT EXISTS ( SELECT 1 FROM blacklist_mail WHERE ? LIKE mail )").pluck()

const SQL_EXISTS_USER_NAME = SQL("SELECT EXISTS ( SELECT 1 FROM users WHERE name=? )").pluck()
const SQL_EXISTS_USER_MAIL = SQL("SELECT EXISTS ( SELECT 1 FROM users WHERE mail=? )").pluck()

const SQL_INSERT_USER = SQL("INSERT INTO users (name,mail,password,salt,notify) VALUES (?,?,?,?,?) RETURNING user_id,name,mail,notify")
const SQL_DELETE_USER = SQL("DELETE FROM users WHERE user_id = ?")

const SQL_SELECT_LOGIN = SQL("SELECT * FROM user_login_view WHERE user_id=?")
const SQL_SELECT_USER_VIEW = SQL("SELECT * FROM user_view WHERE user_id=?")
const SQL_SELECT_USER_BY_NAME = SQL("SELECT * FROM user_view WHERE name=?")
const SQL_SELECT_LOGIN_BY_MAIL = SQL("SELECT * FROM user_login_view WHERE mail=?")
const SQL_SELECT_LOGIN_BY_NAME = SQL("SELECT * FROM user_login_view WHERE name=?")
const SQL_SELECT_USER_PROFILE = SQL("SELECT * FROM user_profile_view WHERE name=?")
const SQL_SELECT_USER_DYNAMIC = SQL("select * from user_dynamic_view where user_id=?")
const SQL_SELECT_USER_NAME = SQL("SELECT name FROM users WHERE user_id=?").pluck()
const SQL_SELECT_USER_ID = SQL("SELECT user_id FROM users WHERE name=?").pluck()

const SQL_OFFLINE_USER = SQL("SELECT * FROM user_view NATURAL JOIN user_last_seen WHERE user_id=? AND julianday() > julianday(atime, ?)")

const SQL_SELECT_USER_NOTIFY = SQL("SELECT notify FROM users WHERE user_id=?").pluck()
const SQL_UPDATE_USER_NOTIFY = SQL("UPDATE users SET notify=? WHERE user_id=?")
const SQL_UPDATE_USER_NAME = SQL("UPDATE users SET name=? WHERE user_id=?")
const SQL_UPDATE_USER_MAIL = SQL("UPDATE users SET mail=? WHERE user_id=?")
const SQL_UPDATE_USER_ABOUT = SQL("UPDATE users SET about=? WHERE user_id=?")
const SQL_UPDATE_USER_PASSWORD = SQL("UPDATE users SET password=?, salt=? WHERE user_id=?")
const SQL_UPDATE_USER_LAST_SEEN = SQL("INSERT OR REPLACE INTO user_last_seen (user_id,atime) VALUES (?,julianday())")
const SQL_UPDATE_USER_IS_BANNED = SQL("update users set is_banned=? where name=?")

const SQL_SELECT_WEBHOOK = SQL("SELECT * FROM webhooks WHERE user_id=?")
const SQL_SELECT_WEBHOOK_SEND = SQL("SELECT url, format, prefix FROM webhooks WHERE user_id=? AND error is null")
const SQL_UPDATE_WEBHOOK = SQL("INSERT OR REPLACE INTO webhooks (user_id, url, format, prefix, error) VALUES (?,?,?,?,null)")
const SQL_UPDATE_WEBHOOK_ERROR = SQL("UPDATE webhooks SET error=? WHERE user_id=?")
const SQL_DELETE_WEBHOOK = SQL("DELETE FROM webhooks WHERE user_id=?")

const SQL_FIND_TOKEN = SQL("SELECT token FROM tokens WHERE user_id=? AND julianday('now') < julianday(time, '+5 minutes')").pluck()
const SQL_CREATE_TOKEN = SQL("INSERT OR REPLACE INTO tokens (user_id,token,time) VALUES (?, lower(hex(randomblob(16))), julianday()) RETURNING token").pluck()
const SQL_VERIFY_TOKEN = SQL("SELECT EXISTS ( SELECT 1 FROM tokens WHERE user_id=? AND julianday('now') < julianday(time, '+20 minutes') AND token=? )").pluck()

function is_blacklisted(mail) {
	if (SQL_BLACKLIST_MAIL.get(mail) === 1)
		return true
	return false
}

function parse_user_agent(req) {
	let user_agent = req.headers["user-agent"]
	if (!user_agent)
		return "Browser"
	let agent = user_agent
	if (user_agent.indexOf("Firefox/") >= 0)
		agent = "Firefox"
	else if (user_agent.indexOf("Chrome/") >= 0)
		agent = "Chrome"
	else if (user_agent.indexOf("Safari/") >= 0)
		agent = "Safari"
	else if (user_agent.indexOf("Edg/") >= 0)
		agent = "Edge"
	else if (user_agent.indexOf("OPR/") >= 0)
		agent = "Opera"
	else if (user_agent.indexOf("Opera") >= 0)
		agent = "Opera"
	else if (user_agent.indexOf("Googlebot") >= 0)
		agent = "Googlebot"
	else if (user_agent.indexOf("bingbot") >= 0)
		agent = "Bingbot"
	else if (user_agent.indexOf("; MSIE") >= 0)
		agent = "MSIE"
	else if (user_agent.indexOf("Trident/") >= 0)
		agent = "MSIE"
	else if (user_agent.indexOf("AppleWebKit/") >= 0)
		agent = "AppleWebKit"
	if (user_agent.indexOf("Mobile") >= 0)
		return agent + "/M"
	return agent
}

app.use(function (req, res, next) {
	req.user_agent = parse_user_agent(req)
	if (req.user_agent === "MSIE")
		return res.redirect("/msie.html")

	let ip = req.headers["x-real-ip"] || req.ip || req.connection.remoteAddress || "0.0.0.0"

	res.setHeader('Cache-Control', 'no-store')
	let sid = login_cookie(req)
	if (sid) {
		let user_id = login_sql_select.get(sid)
		if (user_id) {
			login_touch(res, sid)
			req.user = SQL_SELECT_USER_DYNAMIC.get(user_id)
			SQL_UPDATE_USER_LAST_SEEN.run(user_id)
			if (req.user.is_banned)
				return res.status(403).send("")
		}
	}

	// Log non-static accesses.
	let time = new Date().toISOString().substring(11,19)
	let name = (req.user ? req.user.name : "guest").padEnd(20)
	let ua = req.user_agent.padEnd(10)
	ip = String(ip).padEnd(15)
	console.log(time, ip, ua, name, req.method, req.url)

	return next()
})

function must_be_logged_in(req, res, next) {
	if (!req.user)
		return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl))
	return next()
}

function must_be_administrator(req, res, next) {
	if (!req.user || req.user.user_id !== 1)
		return res.status(401).send("Not authorized")
	return next()
}

app.get('/', function (req, res) {
	res.render('index.pug', { user: req.user, titles: TITLES })
})

app.get('/create', must_be_logged_in, function (req, res) {
	res.render('create-index.pug', { user: req.user, titles: TITLES })
})

app.get('/about', function (req, res) {
	res.render('about.pug', { user: req.user })
})

app.post('/logout', function (req, res) {
	let sid = login_cookie(req)
	if (sid)
		login_delete(res, sid)
	res.redirect('/login')
})

app.get('/login', function (req, res) {
	if (req.user)
		return res.redirect('/')
	res.render('login.pug', { redirect: req.query.redirect || '/profile' })
})

app.post('/login', function (req, res) {
	let name_or_mail = req.body.username
	let password = req.body.password
	let redirect = req.body.redirect
	if (!is_email(name_or_mail))
		name_or_mail = clean_user_name(name_or_mail)
	let user = SQL_SELECT_LOGIN_BY_NAME.get(name_or_mail)
	if (!user)
		user = SQL_SELECT_LOGIN_BY_MAIL.get(name_or_mail)
	if (!user || is_blacklisted(user.mail) || hash_password(password, user.salt) != user.password)
		return setTimeout(() => res.render('login.pug', { flash: "Invalid login." }), 1000)
	login_insert(res, user.user_id)
	res.redirect(redirect)
})

app.get('/signup', function (req, res) {
	if (req.user)
		return res.redirect('/')
	res.render('signup.pug')
})

app.post('/signup', function (req, res) {
	function err(msg) {
		res.render('signup.pug', { flash: msg })
	}
	let name = req.body.username
	let mail = req.body.mail
	let password = req.body.password
	let notify = req.body.notify === 'true'
	name = clean_user_name(name)
	if (!is_valid_user_name(name))
		return err("Invalid user name!")
	if (SQL_EXISTS_USER_NAME.get(name))
		return err("That name is already taken.")
	if (!is_email(mail) || is_blacklisted(mail))
		return err("Invalid mail address!")
	if (SQL_EXISTS_USER_MAIL.get(mail))
		return err("That mail is already taken.")
	if (password.length < 4)
		return err("Password is too short!")
	if (password.length > 100)
		return err("Password is too long!")
	let salt = crypto.randomBytes(32).toString('hex')
	let hash = hash_password(password, salt)
	let user = SQL_INSERT_USER.get(name, mail, hash, salt, notify ? 1 : 0)
	login_insert(res, user.user_id)
	res.redirect('/profile')
})

app.get('/forgot-password', function (req, res) {
	if (req.user)
		return res.redirect('/')
	res.render('forgot_password.pug')
})

app.post('/forgot-password', function (req, res) {
	let mail = req.body.mail
	let user = SQL_SELECT_LOGIN_BY_MAIL.get(mail)
	if (user) {
		let token = SQL_FIND_TOKEN.get(user.user_id)
		if (!token) {
			token = SQL_CREATE_TOKEN.get(user.user_id)
			mail_password_reset_token(user, token)
		}
		return res.redirect('/reset-password/' + mail)
	}
	res.render('forgot_password.pug', { flash: "User not found." })
})

app.get('/reset-password', function (req, res) {
	if (req.user)
		return res.redirect('/')
	res.render('reset_password.pug', { mail: "", token: "" })
})

app.get('/reset-password/:mail', function (req, res) {
	if (req.user)
		return res.redirect('/')
	let mail = req.params.mail
	res.render('reset_password.pug', { mail: mail, token: "" })
})

app.get('/reset-password/:mail/:token', function (req, res) {
	if (req.user)
		return res.redirect('/')
	let mail = req.params.mail
	let token = req.params.token
	res.render('reset_password.pug', { mail: mail, token: token })
})

app.post('/reset-password', function (req, res) {
	let mail = req.body.mail
	let token = req.body.token
	let password = req.body.password
	function err(msg) {
		res.render('reset_password.pug', { mail: mail, token: token })
	}
	let user = SQL_SELECT_LOGIN_BY_MAIL.get(mail)
	if (!user)
		return err("User not found.")
	if (password.length < 4)
		return err("Password is too short!")
	if (password.length > 100)
		return err("Password is too long!")
	if (!SQL_VERIFY_TOKEN.get(user.user_id, token))
		return err("Invalid or expired token!")
	let salt = crypto.randomBytes(32).toString('hex')
	let hash = hash_password(password, salt)
	SQL_UPDATE_USER_PASSWORD.run(hash, salt, user.user_id)
	login_insert(res, user.user_id)
	return res.redirect('/profile')
})

app.get('/change-password', must_be_logged_in, function (req, res) {
	res.render('change_password.pug', { user: req.user })
})

app.post('/change-password', must_be_logged_in, function (req, res) {
	let oldpass = req.body.password
	let newpass = req.body.newpass
	// Get full user record including password and salt
	let user = SQL_SELECT_LOGIN.get(req.user.user_id)
	if (newpass.length < 4)
		return res.render('change_password.pug', { user: req.user, flash: "Password is too short!" })
	if (newpass.length > 100)
		return res.render('change_password.pug', { user: req.user, flash: "Password is too long!" })
	let oldhash = hash_password(oldpass, user.salt)
	if (oldhash !== user.password)
		return res.render('change_password.pug', { user: req.user, flash: "Wrong password!" })
	let salt = crypto.randomBytes(32).toString('hex')
	let hash = hash_password(newpass, salt)
	SQL_UPDATE_USER_PASSWORD.run(hash, salt, user.user_id)
	return res.redirect('/profile')
})

app.get('/delete-account', must_be_logged_in, function (req, res) {
	res.render('delete_account.pug', { user: req.user })
})

app.post('/delete-account', must_be_logged_in, function (req, res) {
	let password = req.body.password
	// Get full user record including password and salt
	let user = SQL_SELECT_LOGIN.get(req.user.user_id)
	let hash = hash_password(password, user.salt)
	if (hash !== user.password)
		return res.render('delete_account.pug', { user: req.user, flash: "Wrong password!" })
	SQL_DELETE_USER.run(req.user.user_id)
	return res.send("Goodbye!")
})

app.get('/admin/ban-user/:who', must_be_administrator, function (req, res) {
	let who = req.params.who
	SQL_UPDATE_USER_IS_BANNED.run(1, who)
	return res.redirect('/user/' + who)
})

app.get('/admin/unban-user/:who', must_be_administrator, function (req, res) {
	let who = req.params.who
	SQL_UPDATE_USER_IS_BANNED.run(0, who)
	return res.redirect('/user/' + who)
})

/*
 * USER PROFILE
 */

app.get('/subscribe', must_be_logged_in, function (req, res) {
	SQL_UPDATE_USER_NOTIFY.run(1, req.user.user_id)
	res.redirect('/profile')
})

app.get('/unsubscribe', must_be_logged_in, function (req, res) {
	SQL_UPDATE_USER_NOTIFY.run(0, req.user.user_id)
	res.redirect('/profile')
})

app.get('/webhook', must_be_logged_in, function (req, res) {
	req.user.notify = SQL_SELECT_USER_NOTIFY.get(req.user.user_id)
	let webhook = SQL_SELECT_WEBHOOK.get(req.user.user_id)
	res.render('webhook.pug', { user: req.user, webhook: webhook })
})

app.post("/delete-webhook", must_be_logged_in, function (req, res) {
	SQL_DELETE_WEBHOOK.run(req.user.user_id)
	res.redirect("/webhook")
})

app.post("/update-webhook", must_be_logged_in, function (req, res) {
	let url = req.body.url
	let prefix = req.body.prefix
	let format = req.body.format
	SQL_UPDATE_WEBHOOK.run(req.user.user_id, url, format, prefix)
	const webhook = SQL_SELECT_WEBHOOK_SEND.get(req.user.user_id)
	if (webhook)
		send_webhook(req.user.user_id, webhook, "Test message!")
	res.setHeader("refresh", "3; url=/webhook")
	res.send("Testing Webhook. Please wait...")
})

app.get('/change-name', must_be_logged_in, function (req, res) {
	res.render('change_name.pug', { user: req.user })
})

app.post('/change-name', must_be_logged_in, function (req, res) {
	let newname = clean_user_name(req.body.newname)
	if (!is_valid_user_name(newname))
		return res.render('change_name.pug', { user: req.user, flash: "Invalid user name!" })
	if (SQL_EXISTS_USER_NAME.get(newname))
		return res.render('change_name.pug', { user: req.user, flash: "That name is already taken!" })
	SQL_UPDATE_USER_NAME.run(newname, req.user.user_id)
	return res.redirect('/profile')
})

app.get('/change-mail', must_be_logged_in, function (req, res) {
	res.render('change_mail.pug', { user: req.user })
})

app.post('/change-mail', must_be_logged_in, function (req, res) {
	let newmail = req.body.newmail
	if (!is_email(newmail))
		return res.render('change_mail.pug', { user: req.user, flash: "Invalid mail address!" })
	if (SQL_EXISTS_USER_MAIL.get(newmail))
		return res.render('change_mail.pug', { user: req.user, flash: "That mail address is already taken!" })
	SQL_UPDATE_USER_MAIL.run(newmail, req.user.user_id)
	return res.redirect('/profile')
})

app.get('/change-about', must_be_logged_in, function (req, res) {
	let about = SQL_SELECT_USER_PROFILE.get(req.user.name).about
	res.render('change_about.pug', { user: req.user, about: about || "" })
})

app.post('/change-about', must_be_logged_in, function (req, res) {
	SQL_UPDATE_USER_ABOUT.run(req.body.about, req.user.user_id)
	return res.redirect('/profile')
})

app.get('/user/:who_name', function (req, res) {
	let who = SQL_SELECT_USER_PROFILE.get(req.params.who_name)
	if (who) {
		who.ctime = human_date(who.ctime)
		who.atime = human_date(who.atime)
		let games = QUERY_LIST_ACTIVE_GAMES_OF_USER.all({ user_id: who.user_id })
		annotate_games(games, 0, null)
		let relation = 0
		if (req.user)
			relation = SQL_SELECT_RELATION.get(req.user.user_id, who.user_id) | 0
		res.render('user.pug', { user: req.user, who, relation, games })
	} else {
		return res.status(404).send("Invalid user name.")
	}
})

app.get('/users', function (req, res) {
	let rows = SQL("SELECT * FROM user_profile_view ORDER BY atime DESC").all()
	rows.forEach(row => {
		row.ctime = human_date(row.ctime)
		row.atime = human_date(row.atime)
	})
	res.render('user_list.pug', { user: req.user, user_list: rows })
})

/*
 * CONTACTS
 */

const SQL_SELECT_CONTACT_BLACKLIST = SQL("select you from contacts where me=? and relation<0").pluck()
const SQL_SELECT_CONTACT_WHITELIST = SQL("select you from contacts where me=? and relation>0").pluck()
const SQL_SELECT_CONTACT_FRIEND_NAMES = SQL("select name from contact_view where me=? and relation>0").pluck()
const SQL_SELECT_CONTACT_LIST = SQL("select * from contact_view where me=?")
const SQL_INSERT_CONTACT = SQL("insert into contacts (me,you,relation) values (?,?,?)")
const SQL_DELETE_CONTACT = SQL("delete from contacts where me=? and you=?")
const SQL_SELECT_RELATION = SQL("select relation from contacts where me=? and you=?").pluck()

app.get('/contacts', must_be_logged_in, function (req, res) {
	let contacts = SQL_SELECT_CONTACT_LIST.all(req.user.user_id)
	contacts.forEach(user => user.atime = human_date(user.atime))
	res.render('contacts.pug', {
		user: req.user,
		friends: contacts.filter(user => user.relation > 0),
		enemies: contacts.filter(user => user.relation < 0),
	})
})

app.get("/contact/remove/:who_name", must_be_logged_in, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (!who)
		return res.status(404).send("User not found.")
	SQL_DELETE_CONTACT.run(req.user.user_id, who.user_id)
	return res.redirect("/contacts")
})

app.get("/contact/add-friend/:who_name", must_be_logged_in, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (!who)
		return res.status(404).send("User not found.")
	SQL_INSERT_CONTACT.run(req.user.user_id, who.user_id, 1)
	return res.redirect("/user/" + who.name)
})

app.get("/contact/add-enemy/:who_name", must_be_logged_in, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (!who)
		return res.status(404).send("User not found.")
	SQL_INSERT_CONTACT.run(req.user.user_id, who.user_id, -1)
	return res.redirect("/user/" + who.name)
})

app.get("/contact/remove-user/:who_name", must_be_logged_in, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (!who)
		return res.status(404).send("User not found.")
	SQL_DELETE_CONTACT.run(req.user.user_id, who.user_id)
	return res.redirect("/user/" + who.name)
})

/*
 * MESSAGES
 */

const MESSAGE_LIST_INBOX = SQL(`
	SELECT message_id, from_name, subject, time, is_read
	FROM message_view
	WHERE to_id=? AND is_deleted_from_inbox=0
	ORDER BY message_id DESC`)

const MESSAGE_LIST_OUTBOX = SQL(`
	SELECT message_id, to_name, subject, time, 1 as is_read
	FROM message_view
	WHERE from_id=? AND is_deleted_from_outbox=0
	ORDER BY message_id DESC`)

const MESSAGE_FETCH = SQL("SELECT * FROM message_view WHERE message_id=? AND ( from_id=? OR to_id=? )")
const MESSAGE_SEND = SQL("INSERT INTO messages (from_id,to_id,subject,body) VALUES (?,?,?,?)")
const MESSAGE_MARK_READ = SQL("UPDATE messages SET is_read=1 WHERE message_id=? AND is_read = 0")
const MESSAGE_DELETE_INBOX = SQL("UPDATE messages SET is_deleted_from_inbox=1 WHERE message_id=? AND to_id=?")
const MESSAGE_DELETE_OUTBOX = SQL("UPDATE messages SET is_deleted_from_outbox=1 WHERE message_id=? AND from_id=?")
const MESSAGE_DELETE_ALL_OUTBOX = SQL("UPDATE messages SET is_deleted_from_outbox=1 WHERE from_id=?")

app.get('/inbox', must_be_logged_in, function (req, res) {
	let messages = MESSAGE_LIST_INBOX.all(req.user.user_id)
	for (let i = 0; i < messages.length; ++i)
		messages[i].time = human_date(messages[i].time)
	res.render('message_inbox.pug', {
		user: req.user,
		messages: messages,
	})
})

app.get('/outbox', must_be_logged_in, function (req, res) {
	let messages = MESSAGE_LIST_OUTBOX.all(req.user.user_id)
	for (let i = 0; i < messages.length; ++i)
		messages[i].time = human_date(messages[i].time)
	res.render('message_outbox.pug', {
		user: req.user,
		messages: messages,
	})
})

app.get('/message/read/:message_id', must_be_logged_in, function (req, res) {
	let message_id = req.params.message_id | 0
	let message = MESSAGE_FETCH.get(message_id, req.user.user_id, req.user.user_id)
	if (!message)
		return res.status(404).send("Invalid message ID.")
	if (message.to_id === req.user.user_id && message.is_read === 0) {
		MESSAGE_MARK_READ.run(message_id)
		req.user.unread --
	}
	message.time = human_date(message.time)
	message.body = linkify_post(message.body)
	res.render('message_read.pug', {
		user: req.user,
		message: message,
	})
})

app.get('/message/send', must_be_logged_in, function (req, res) {
	let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
	res.render('message_send.pug', {
		user: req.user,
		to_name: "",
		subject: "",
		body: "",
		friends,
	})
})

app.get('/message/send/:to_name', must_be_logged_in, function (req, res) {
	let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
	let to_name = req.params.to_name
	res.render('message_send.pug', {
		user: req.user,
		to_name: to_name,
		subject: "",
		body: "",
		friends,
	})
})

app.post('/message/send', must_be_logged_in, function (req, res) {
	let to_name = req.body.to.trim()
	let subject = req.body.subject.trim()
	let body = req.body.body.trim()
	let to_user = SQL_SELECT_USER_BY_NAME.get(to_name)
	if (!to_user) {
		let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
		return res.render('message_send.pug', {
			user: req.user,
			to_id: 0,
			to_name: to_name,
			subject: subject,
			body: body,
			friends,
			flash: "Cannot find that user.",
		})
	}
	let info = MESSAGE_SEND.run(req.user.user_id, to_user.user_id, subject, body)
	if (to_user.notify)
		mail_new_message(to_user, info.lastInsertRowid, req.user.name)
	res.redirect('/inbox')
})

function quote_body(message) {
	let when = new Date(epoch_from_time(message.time)).toDateString()
	let who = message.from_name
	let what = message.body.split("\n").join("\n> ")
	return "\n\n" + "On " + when + " " + who + " wrote:\n> " + what + "\n"
}

app.get('/message/reply/:message_id', must_be_logged_in, function (req, res) {
	let message_id = req.params.message_id | 0
	let message = MESSAGE_FETCH.get(message_id, req.user.user_id, req.user.user_id)
	if (!message)
		return res.status(404).send("Invalid message ID.")
	let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
	return res.render('message_send.pug', {
		user: req.user,
		to_id: message.from_id,
		to_name: message.from_name,
		subject: message.subject.startsWith("Re: ") ? message.subject : "Re: " + message.subject,
		body: quote_body(message),
		friends,
	})
})

app.get('/message/delete/:message_id', must_be_logged_in, function (req, res) {
	let message_id = req.params.message_id | 0
	MESSAGE_DELETE_INBOX.run(message_id, req.user.user_id)
	MESSAGE_DELETE_OUTBOX.run(message_id, req.user.user_id)
	res.redirect('/inbox')
})

app.get('/outbox/delete', must_be_logged_in, function (req, res) {
	MESSAGE_DELETE_ALL_OUTBOX.run(req.user.user_id)
	res.redirect('/outbox')
})

/*
 * FORUM
 */

const FORUM_PAGE_SIZE = 15

const FORUM_COUNT_THREADS = SQL("SELECT COUNT(*) FROM threads").pluck()
const FORUM_LIST_THREADS_USER = SQL("SELECT *, (exists (select 1 from read_threads where user_id=? and read_threads.thread_id=thread_view.thread_id)) as is_read FROM thread_view ORDER BY mtime DESC LIMIT ? OFFSET ?")
const FORUM_LIST_THREADS = SQL("SELECT *, 1 as is_read FROM thread_view ORDER BY mtime DESC LIMIT ? OFFSET ?")
const FORUM_GET_THREAD = SQL("SELECT * FROM thread_view WHERE thread_id=?")
const FORUM_LIST_POSTS = SQL("SELECT * FROM post_view WHERE thread_id=?")
const FORUM_GET_POST = SQL("SELECT * FROM post_view WHERE post_id=?")
const FORUM_NEW_THREAD = SQL("INSERT INTO threads (author_id,subject) VALUES (?,?)")
const FORUM_NEW_POST = SQL("INSERT INTO posts (thread_id,author_id,body) VALUES (?,?,?)")
const FORUM_EDIT_POST = SQL("UPDATE posts SET body=?, mtime=julianday() WHERE post_id=? AND author_id=? RETURNING thread_id").pluck()
const FORUM_MARK_READ = SQL("insert or ignore into read_threads (user_id,thread_id) values (?,?)")

const FORUM_DELETE_THREAD_POSTS = SQL("delete from posts where thread_id=?")
const FORUM_DELETE_THREAD = SQL("delete from threads where thread_id=?")
const FORUM_DELETE_POST = SQL("delete from posts where post_id=?")

const FORUM_SEARCH = SQL(`
	select
		forum_search.thread_id,
		forum_search.post_id,
		threads.subject,
		coalesce(pusers.name, tusers.name) as author,
		snippet(forum_search, -1, '', '', '...', 18) as snippet
	from
		forum_search
		join threads on threads.thread_id = forum_search.thread_id
		left join posts on posts.post_id = forum_search.post_id
		left join users as pusers on pusers.user_id = posts.author_id
		left join users as tusers on tusers.user_id = threads.author_id
	where
		forum_search match ?
	order by
		forum_search.thread_id desc,
		forum_search.post_id desc
`)

function show_forum_page(req, res, page) {
	let thread_count = FORUM_COUNT_THREADS.get()
	let page_count = Math.ceil(thread_count / FORUM_PAGE_SIZE)
	let threads
	if (req.user)
		threads = FORUM_LIST_THREADS_USER.all(req.user.user_id, FORUM_PAGE_SIZE, FORUM_PAGE_SIZE * (page - 1))
	else
		threads = FORUM_LIST_THREADS.all(FORUM_PAGE_SIZE, FORUM_PAGE_SIZE * (page - 1))
	for (let thread of threads)
		thread.mtime = human_date(thread.mtime)
	res.render('forum_view.pug', {
		user: req.user,
		threads: threads,
		current_page: page,
		page_count: page_count,
	})
}

function linkify_post(text) {
	text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
	text = text.replace(/https?:\/\/\S+/g, (match) => {
		if (match.endsWith(".jpg") || match.endsWith(".png") || match.endsWith(".svg"))
			return `<a href="${match}"><img src="${match}"></a>`
		return `<a href="${match}">${match}</a>`
	})
	return text
}

app.get('/forum', function (req, res) {
	show_forum_page(req, res, 1)
})

app.get('/forum/page/:page', function (req, res) {
	show_forum_page(req, res, req.params.page | 0)
})

app.get('/forum/thread/:thread_id', function (req, res) {
	let thread_id = req.params.thread_id | 0
	let thread = FORUM_GET_THREAD.get(thread_id)
	let posts = FORUM_LIST_POSTS.all(thread_id)
	if (!thread)
		return res.status(404).send("Invalid thread ID.")
	for (let i = 0; i < posts.length; ++i) {
		posts[i].body = linkify_post(posts[i].body)
		posts[i].edited = posts[i].mtime !== posts[i].ctime
		posts[i].ctime = human_date(posts[i].ctime)
		posts[i].mtime = human_date(posts[i].mtime)
	}
	if (req.user)
		FORUM_MARK_READ.run(req.user.user_id, thread_id)
	res.render('forum_thread.pug', {
		user: req.user,
		thread: thread,
		posts: posts,
	})
})

app.get('/admin/delete-thread/:thread_id', must_be_administrator, function (req, res) {
	let thread_id = req.params.thread_id
	res.send(JSON.stringify({
		posts: FORUM_DELETE_THREAD_POSTS.run(thread_id),
		thread: FORUM_DELETE_THREAD.run(thread_id),
	}))
})

app.get('/admin/delete-post/:post_id', must_be_administrator, function (req, res) {
	let post_id = req.params.post_id
	res.send(JSON.stringify(
		FORUM_DELETE_POST.run(post_id)
	))
})

app.get('/forum/post', must_be_logged_in, function (req, res) {
	res.render('forum_post.pug', {
		user: req.user,
	})
})

app.post('/forum/post', must_be_logged_in, function (req, res) {
	let user_id = req.user.user_id
	let subject = req.body.subject.trim()
	let body = req.body.body
	if (subject.length === 0)
		subject = "Untitled"
	let thread_id = FORUM_NEW_THREAD.run(user_id, subject).lastInsertRowid
	FORUM_NEW_POST.run(thread_id, user_id, body)
	res.redirect('/forum/thread/'+thread_id)
})

app.get('/forum/edit/:post_id', must_be_logged_in, function (req, res) {
	// TODO: edit subject if editing first post
	let post_id = req.params.post_id | 0
	let post = FORUM_GET_POST.get(post_id)
	if (!post || post.author_id != req.user.user_id)
		return res.status(404).send("Invalid post ID.")
	post.ctime = human_date(post.ctime)
	post.mtime = human_date(post.mtime)
	res.render('forum_edit.pug', {
		user: req.user,
		post: post,
	})
})

app.post('/forum/edit/:post_id', must_be_logged_in, function (req, res) {
	let user_id = req.user.user_id
	let post_id = req.params.post_id | 0
	let body = req.body.body
	let thread_id = FORUM_EDIT_POST.get(body, post_id, user_id)
	res.redirect('/forum/thread/'+thread_id)
})

app.get('/forum/reply/:post_id', must_be_logged_in, function (req, res) {
	let post_id = req.params.post_id | 0
	let post = FORUM_GET_POST.get(post_id)
	if (!post)
		return res.status(404).send("Invalid post ID.")
	let thread = FORUM_GET_THREAD.get(post.thread_id)
	post.body = linkify_post(post.body)
	post.edited = post.mtime !== post.ctime
	post.ctime = human_date(post.ctime)
	post.mtime = human_date(post.mtime)
	res.render('forum_reply.pug', {
		user: req.user,
		thread: thread,
		post: post,
	})
})

app.post('/forum/reply/:thread_id', must_be_logged_in, function (req, res) {
	let thread_id = req.params.thread_id | 0
	let user_id = req.user.user_id
	let body = req.body.body
	FORUM_NEW_POST.run(thread_id, user_id, body)
	res.redirect('/forum/thread/'+thread_id)
})

app.get('/forum/search', must_be_logged_in, function (req, res) {
	let search = req.query.q
	let results = []
	if (search)
		results = FORUM_SEARCH.all(search)
	res.render('forum_search.pug', { user: req.user, search, results })
})

/*
 * GAME LOBBY
 */

let TITLES = {}
let RULES = {}
let HTML_ABOUT = {}
let HTML_CREATE = {}

function load_rules() {
	const SQL_SELECT_TITLES = SQL("SELECT * FROM titles")
	for (let title of SQL_SELECT_TITLES.all()) {
		let title_id = title.title_id
		if (fs.existsSync(__dirname + "/public/" + title_id + "/rules.js")) {
			console.log("Loading rules for " + title_id)
			try {
				TITLES[title_id] = title
				RULES[title_id] = require("./public/" + title_id + "/rules.js")
				HTML_ABOUT[title_id] = fs.readFileSync("./public/" + title_id + "/about.html")
				HTML_CREATE[title_id] = fs.readFileSync("./public/" + title_id + "/create.html")
			} catch (err) {
				console.log(err)
			}
		} else {
			console.log("Cannot find rules for " + title_id)
		}
	}
}

function get_game_roles(title_id, scenario, options) {
	let roles = RULES[title_id].roles
	if (typeof roles === 'function')
		return roles(scenario, options)
	return roles
}

function is_game_full(title_id, scenario, options, players) {
	return get_game_roles(title_id, scenario, options).length === players.length
}

function is_game_ready(title_id, scenario, options, players) {
	for (let p of players)
		if (p.is_invite)
			return false
	return is_game_full(title_id, scenario, options, players)
}

load_rules()

const SQL_INSERT_GAME = SQL("INSERT INTO games (owner_id,title_id,scenario,options,is_private,is_random,description) VALUES (?,?,?,?,?,?,?)")
const SQL_DELETE_GAME = SQL("DELETE FROM games WHERE game_id=? AND owner_id=?")

const SQL_SELECT_UNREAD_CHAT_GAMES = SQL("select game_id from unread_chats where user_id = ?").pluck()
const SQL_INSERT_UNREAD_CHAT = SQL("insert or ignore into unread_chats (user_id,game_id) values (?,?)")
const SQL_DELETE_UNREAD_CHAT = SQL("delete from unread_chats where user_id = ? and game_id = ?")

const SQL_SELECT_GAME_CHAT = SQL("SELECT chat_id,unixepoch(time),name,message FROM game_chat_view WHERE game_id=? AND chat_id>?").raw()
const SQL_INSERT_GAME_CHAT = SQL("INSERT INTO game_chat (game_id,user_id,message) VALUES (?,?,?) RETURNING chat_id,unixepoch(time),NULL,message").raw()

const SQL_SELECT_GAME_NOTE = SQL("SELECT note FROM game_notes WHERE game_id=? AND role=?").pluck()
const SQL_UPDATE_GAME_NOTE = SQL("INSERT OR REPLACE INTO game_notes (game_id,role,note) VALUES (?,?,?)")
const SQL_DELETE_GAME_NOTE = SQL("DELETE FROM game_notes WHERE game_id=? AND role=?")

const SQL_SELECT_GAME_STATE = SQL("SELECT state FROM game_state WHERE game_id=?").pluck()
const SQL_UPDATE_GAME_STATE = SQL("INSERT OR REPLACE INTO game_state (game_id,state,active,mtime) VALUES (?,?,?,julianday())")
const SQL_UPDATE_GAME_RESULT = SQL("UPDATE games SET status=?, result=? WHERE game_id=?")
const SQL_UPDATE_GAME_PRIVATE = SQL("UPDATE games SET is_private=1 WHERE game_id=?")

const SQL_INSERT_REPLAY = SQL("INSERT INTO game_replay (game_id,role,action,arguments) VALUES (?,?,?,?)")

const SQL_SELECT_REPLAY = SQL(`
	select json_object(
			'title', title_id,
			'scenario', scenario,
			'options', json(options),
			'players',
				(select json_group_array(
						json_object('role', role, 'name', name)
					)
					from players
					natural join users
					where game_id = :game_id
				),
			'state',
				(select json(state)
					from game_state
					where game_id = :game_id
				),
			'replay',
				(select json_group_array(
						case when arguments is null then
							json_array(role, action)
						else
							json_array(role, action, json(arguments))
						end
					)
					from game_replay
					where game_id = :game_id
				)
	)
	from games
	where game_id = :game_id
`).pluck()

const SQL_SELECT_GAME = SQL("SELECT * FROM games WHERE game_id=?")
const SQL_SELECT_GAME_VIEW = SQL("SELECT * FROM game_view WHERE game_id=?")
const SQL_SELECT_GAME_FULL_VIEW = SQL("SELECT * FROM game_full_view WHERE game_id=?")
const SQL_SELECT_GAME_TITLE = SQL("SELECT title_id FROM games WHERE game_id=?").pluck()
const SQL_SELECT_GAME_RANDOM = SQL("SELECT is_random FROM games WHERE game_id=?").pluck()

const SQL_SELECT_GAME_HAS_TITLE_AND_STATUS = SQL("SELECT 1 FROM games WHERE game_id=? AND title_id=? AND status=?")

const SQL_SELECT_PLAYERS_ID = SQL("SELECT DISTINCT user_id FROM players WHERE game_id=?").pluck()
const SQL_SELECT_PLAYERS = SQL("SELECT * FROM players NATURAL JOIN user_view WHERE game_id=?")
const SQL_SELECT_PLAYERS_JOIN = SQL("SELECT role, user_id, name, is_invite FROM players NATURAL JOIN users WHERE game_id=?")
const SQL_UPDATE_PLAYER_ACCEPT = SQL("UPDATE players SET is_invite=0 WHERE game_id=? AND role=? AND user_id=?")
const SQL_UPDATE_PLAYER_ROLE = SQL("UPDATE players SET role=? WHERE game_id=? AND role=? AND user_id=?")
const SQL_SELECT_PLAYER_ROLE = SQL("SELECT role FROM players WHERE game_id=? AND user_id=?").pluck()
const SQL_INSERT_PLAYER_ROLE = SQL("INSERT OR IGNORE INTO players (game_id,role,user_id,is_invite) VALUES (?,?,?,?)")
const SQL_DELETE_PLAYER_ROLE = SQL("DELETE FROM players WHERE game_id=? AND role=?")

const SQL_AUTHORIZE_GAME_ROLE = SQL("SELECT 1 FROM players NATURAL JOIN games WHERE title_id=? AND game_id=? AND role=? AND user_id=?").pluck()

const SQL_SELECT_OPEN_GAMES = SQL("SELECT * FROM games WHERE status=0")
const SQL_COUNT_OPEN_GAMES = SQL("SELECT COUNT(*) FROM games WHERE owner_id=? AND status=0").pluck()

const SQL_SELECT_REMATCH = SQL("SELECT game_id FROM games WHERE status < 3 AND description=?").pluck()
const SQL_INSERT_REMATCH = SQL(`
	INSERT INTO games
		(owner_id, title_id, scenario, options, is_private, is_random, description)
	SELECT
		$user_id, title_id, scenario, options, is_private, 0, $magic
	FROM games
	WHERE game_id = $game_id AND NOT EXISTS (
		SELECT * FROM games WHERE description=$magic
	)
`)

const SQL_INSERT_REMATCH_PLAYERS = SQL("insert into players (game_id, user_id, role, is_invite) select ?, user_id, role, user_id!=? from players where game_id=?")

const QUERY_LIST_PUBLIC_GAMES = SQL(`
	SELECT * FROM game_view
	WHERE is_private=0 AND status = ?
	AND EXISTS ( SELECT 1 FROM players WHERE players.game_id = game_view.game_id AND players.user_id = game_view.owner_id )
	ORDER BY mtime DESC, ctime DESC
	LIMIT ?
	`)

const QUERY_LIST_GAMES_OF_TITLE = SQL(`
	SELECT * FROM game_view
	WHERE is_private=0 AND title_id=? AND status=?
	AND EXISTS ( SELECT 1 FROM players WHERE players.game_id = game_view.game_id AND players.user_id = game_view.owner_id )
	ORDER BY mtime DESC, ctime DESC
	LIMIT ?
	`)

const QUERY_NEXT_GAME_OF_USER = SQL(`
	select title_id, game_id, role
	from games
	join game_state using(game_id)
	join players using(game_id)
	where
		status = 1
		and active in ('All', 'Both', role)
		and user_id = ?
	order by mtime
	limit 1
	`)

const QUERY_LIST_ACTIVE_GAMES_OF_USER = SQL(`
	select * from game_view
	where
		( owner_id=$user_id or game_id in ( select game_id from players where players.user_id=$user_id ) )
		and
		( status < 2 or julianday(mtime) > julianday('now', '-7 days') )
	order by status asc, mtime desc
	`)

const QUERY_LIST_FINISHED_GAMES_OF_USER = SQL(`
	select * from game_view
	where
		( owner_id=$user_id or game_id in ( select game_id from players where players.user_id=$user_id ) )
		and
		status = 2
	order by status asc, mtime desc
	`)

function is_active(game, players, user_id) {
	if (game.status !== 1 || user_id === 0)
		return false
	let active = game.active
	for (let i = 0; i < players.length; ++i) {
		let p = players[i]
		if ((p.user_id === user_id) && (active === 'All' || active === 'Both' || active === p.role))
			return true
	}
	return false
}

function is_solo(players) {
	return players.every(p => p.user_id === players[0].user_id)
}

function format_options(options) {
	function to_english(k) {
		if (k === true || k === 1) return 'yes'
		if (k === false) return 'no'
		return k.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())
	}
	return Object.entries(options||{}).map(([k,v]) => (v === true || v === 1) ? to_english(k) : `${to_english(k)}=${to_english(v)}`).join(", ")
}

function annotate_game(game, user_id, unread) {
	let players = SQL_SELECT_PLAYERS_JOIN.all(game.game_id)
	let options = JSON.parse(game.options)
	let roles = get_game_roles(game.title_id, game.scenario, options)

	if (game.options === '{}')
		game.human_options = "None"
	else
		game.human_options = format_options(options)

	for (let i = 0; i < players.length; ++i)
		players[i].index = roles.indexOf(players[i].role)
	players.sort((a, b) => a.index - b.index)

	game.is_full = is_game_full(game.title_id, game.scenario, options, players)
	game.is_ready = is_game_ready(game.title_id, game.scenario, options, players)
	game.is_unread = set_has(unread, game.game_id)

	let your_count = 0
	let your_role = null
	game.player_names = ""
	for (let i = 0; i < players.length; ++i) {
		let p = players[i]

		let p_is_owner = false
		if (game.status === 0 && (game.owner_id === p.user_id))
			p_is_owner = true

		let p_is_active = false
		if (game.status === 1 && (game.active === p.role || game.active === "Both" || game.active === "All"))
			p_is_active = true

		if (p.user_id === user_id) {
			your_role = p.role
			your_count++
			if ((p_is_active || p_is_owner) && game.is_ready)
				game.your_turn = true
			if (p.is_invite)
				game.your_turn = true
		}

		let link
		if (p.is_invite)
			link = `<span class="is_invite"><a href="/user/${p.name}">${p.name}?</a></span>`
		else if (p_is_active || p_is_owner)
			link = `<span class="is_active"><a href="/user/${p.name}">${p.name}</a></span>`
		else
			link = `<a href="/user/${p.name}">${p.name}</a>`

		if (game.player_names.length > 0)
			game.player_names += ", "
		game.player_names += link

		if (game.active === p.role)
			game.active = link
		if (game.result === p.role)
			game.result = `${link} (${game.result})`
	}

	if (your_count > 0) {
		game.is_yours = true
		if (your_count === 1)
			game.your_role = your_role
	}

	game.ctime = human_date(game.ctime)
	game.mtime = human_date(game.mtime)
}

function annotate_games(games, user_id, unread) {
	for (let i = 0; i < games.length; ++i)
		annotate_game(games[i], user_id, unread)
}

app.get('/profile', must_be_logged_in, function (req, res) {
	req.user.notify = SQL_SELECT_USER_NOTIFY.get(req.user.user_id)
	req.user.webhook = SQL_SELECT_WEBHOOK.get(req.user.user_id)
	res.render('profile.pug', { user: req.user })
})

app.get('/games', function (req, res) {
	res.redirect('/games/public')
})

function sort_your_turn(a, b) {
	if (a.your_turn && !b.your_turn) return -1
	if (!a.your_turn && b.your_turn) return 1
	return 0
}

app.get('/games/next', must_be_logged_in, function (req, res) {
	let next = QUERY_NEXT_GAME_OF_USER.get(req.user.user_id)
	if (next !== undefined)
		res.redirect(play_url(next.title_id, next.game_id, next.role))
	else
		res.redirect(`/games/active`)
})

app.get('/games/active', must_be_logged_in, function (req, res) {
	let games = QUERY_LIST_ACTIVE_GAMES_OF_USER.all({ user_id: req.user.user_id })
	let unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
	annotate_games(games, req.user.user_id, unread)
	games.sort(sort_your_turn)
	res.render('games_active.pug', { user: req.user, who: req.user, games })
})

app.get('/games/finished', must_be_logged_in, function (req, res) {
	let games = QUERY_LIST_FINISHED_GAMES_OF_USER.all({user_id: req.user.user_id})
	let unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
	annotate_games(games, req.user.user_id, unread)
	res.render('games_finished.pug', { user: req.user, who: req.user, games })
})

app.get('/games/finished/:who_name', function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (who) {
		let games = QUERY_LIST_FINISHED_GAMES_OF_USER.all({ user_id: who.user_id })
		annotate_games(games, 0, null)
		res.render('games_finished.pug', { user: req.user, who: who, games: games })
	} else {
		return res.status(404).send("Invalid user name.")
	}
})

app.get('/games/public', function (req, res) {
	let games0 = QUERY_LIST_PUBLIC_GAMES.all(0, 1000)
	let games1 = QUERY_LIST_PUBLIC_GAMES.all(1, 48)
	if (req.user) {
		let unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
		annotate_games(games0, req.user.user_id, unread)
		annotate_games(games1, req.user.user_id, unread)
	} else {
		annotate_games(games0, 0, null)
		annotate_games(games1, 0, null)
	}
	res.render('games_public.pug', { user: req.user, games0, games1 })
})

app.get('/info/:title_id', function (req, res) {
	return res.redirect('/' + req.params.title_id)
})

function get_title_page(req, res, title_id) {
	let title = TITLES[title_id]
	if (!title)
		return res.status(404).send("Invalid title.")
	let unread = null
	if (req.user)
		unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
	let games0 = QUERY_LIST_GAMES_OF_TITLE.all(title_id, 0, 1000)
	let games1 = QUERY_LIST_GAMES_OF_TITLE.all(title_id, 1, 1000)
	let games2 = QUERY_LIST_GAMES_OF_TITLE.all(title_id, 2, 24)
	annotate_games(games0, req.user ? req.user.user_id : 0, unread)
	annotate_games(games1, req.user ? req.user.user_id : 0, unread)
	annotate_games(games2, req.user ? req.user.user_id : 0, unread)
	res.render('info.pug', {
		user: req.user,
		title: title,
		about_html: HTML_ABOUT[title_id],
		games0, games1, games2
	})
}

for (let title_id in TITLES)
	app.get('/' + title_id, (req, res) => get_title_page(req, res, title_id))

app.get('/create/:title_id', must_be_logged_in, function (req, res) {
	let title_id = req.params.title_id
	let title = TITLES[title_id]
	if (!title)
		return res.status(404).send("Invalid title.")
	res.render('create.pug', {
		user: req.user,
		title: title,
		scenarios: RULES[title_id].scenarios,
		create_html: HTML_CREATE[title_id],
	})
})

function options_json_replacer(key, value) {
	if (key === 'scenario') return undefined
	if (key === 'description') return undefined
	if (key === 'is_random') return undefined
	if (key === 'is_private') return undefined
	if (value === 'true') return true
	if (value === 'false') return false
	if (value === '') return undefined
	return value
}

app.post('/create/:title_id', must_be_logged_in, function (req, res) {
	let title_id = req.params.title_id
	let descr = req.body.description
	let priv = req.body.is_private === 'true'
	let rand = req.body.is_random === 'true'
	let user_id = req.user.user_id
	let scenario = req.body.scenario
	let options = JSON.stringify(req.body, options_json_replacer)
	let count = SQL_COUNT_OPEN_GAMES.get(user_id)
	if (count >= 5)
		return res.send("You have too many open games!")
	if (!(title_id in RULES))
		return res.send("Invalid title.")
	if (!RULES[title_id].scenarios.includes(scenario))
		return res.send("Invalid scenario.")
	let info = SQL_INSERT_GAME.run(user_id, title_id, scenario, options, priv ? 1 : 0, rand ? 1 : 0, descr)
	res.redirect('/join/'+info.lastInsertRowid)
})

app.get('/delete/:game_id', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id
	let title_id = SQL_SELECT_GAME_TITLE.get(game_id)
	let info = SQL_DELETE_GAME.run(game_id, req.user.user_id)
	if (info.changes === 0)
		return res.send("Not authorized to delete that game ID.")
	if (info.changes === 1)
		update_join_clients_deleted(game_id)
	res.redirect('/'+title_id)
})

app.get('/rematch/:old_game_id', must_be_logged_in, function (req, res) {
	let old_game_id = req.params.old_game_id | 0
	let magic = "\u{1F503} " + old_game_id
	let new_game_id = 0
	let info = SQL_INSERT_REMATCH.run({user_id: req.user.user_id, game_id: old_game_id, magic: magic})
	if (info.changes === 1) {
		new_game_id = info.lastInsertRowid
		SQL_INSERT_REMATCH_PLAYERS.run(new_game_id, req.user.user_id, old_game_id)
	} else {
		new_game_id = SQL_SELECT_REMATCH.get(magic)
	}
	return res.redirect('/join/'+new_game_id)
})

var join_clients = {}

function update_join_clients_deleted(game_id) {
	let list = join_clients[game_id]
	if (list && list.length > 0) {
		for (let {res} of list) {
			res.write("retry: 15000\n")
			res.write("event: deleted\n")
			res.write("data: The game doesn't exist.\n\n")
		}
	}
	delete join_clients[game_id]
}

function update_join_clients_game(game_id) {
	let list = join_clients[game_id]
	if (list && list.length > 0) {
		let game = SQL_SELECT_GAME_VIEW.get(game_id)
		for (let {res} of list) {
			res.write("retry: 15000\n")
			res.write("event: game\n")
			res.write("data: " + JSON.stringify(game) + "\n\n")
		}
	}
}

function update_join_clients_players(game_id) {
	let list = join_clients[game_id]
	if (list && list.length > 0) {
		let players = SQL_SELECT_PLAYERS_JOIN.all(game_id)
		let ready = is_game_ready(list.title_id, list.scenario, list.options, players)
		for (let {res} of list) {
			res.write("retry: 15000\n")
			res.write("event: players\n")
			res.write("data: " + JSON.stringify(players) + "\n\n")
			res.write("event: ready\n")
			res.write("data: " + ready + "\n\n")
		}
	}
}

app.get('/join/:game_id', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME_VIEW.get(game_id)
	if (!game)
		return res.status(404).send("Invalid game ID.")

	let options = JSON.parse(game.options)
	if (game.options === '{}')
		game.human_options = "None"
	else
		game.human_options = format_options(options)

	let roles = get_game_roles(game.title_id, game.scenario, game.options)
	let players = SQL_SELECT_PLAYERS_JOIN.all(game_id)
	let whitelist = SQL_SELECT_CONTACT_WHITELIST.all(req.user.user_id)
	let blacklist = SQL_SELECT_CONTACT_BLACKLIST.all(req.user.user_id)
	let friends = null
	if (game.owner_id === req.user.user_id)
		friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
	let ready = (game.status === 0) && is_game_ready(game.title_id, game.scenario, game.options, players)
	res.render('join.pug', {
		user: req.user, game, roles, players, ready, whitelist, blacklist, friends
	})
})

app.get('/join-events/:game_id', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME_VIEW.get(game_id)
	let players = SQL_SELECT_PLAYERS_JOIN.all(game_id)

	res.setHeader("Content-Type", "text/event-stream")
	res.setHeader("Connection", "keep-alive")
	res.setHeader("X-Accel-Buffering", "no")

	if (!game) {
		return res.send("event: deleted\ndata: The game doesn't exist.\n\n")
	}
	if (!(game_id in join_clients)) {
		join_clients[game_id] = []
		join_clients[game_id].title_id = game.title_id
		join_clients[game_id].scenario = game.scenario
		join_clients[game_id].options = JSON.parse(game.options)
	}
	join_clients[game_id].push({ res: res, user_id: req.user.user_id})

	res.on('close', () => {
		let list = join_clients[game_id]
		let i = list.findIndex(item => item.res === res)
		if (i >= 0)
			list.splice(i, 1)
	})

	res.write("retry: 15000\n\n")
	res.write("event: game\n")
	res.write("data: " + JSON.stringify(game) + "\n\n")
	res.write("event: players\n")
	res.write("data: " + JSON.stringify(players) + "\n\n")
})

function do_join(res, game_id, role, user_id, is_invite) {
	let game = SQL_SELECT_GAME.get(game_id)
	let roles = get_game_roles(game.title_id, game.scenario, game.options)
	if (game.is_random && game.status === 0) {
		let m = role.match(/^Random (\d+)$/)
		if (!m || Number(m[1]) < 1 || Number(m[1]) > roles.length)
			return res.status(404).send("Invalid role.")
	} else {
		if (!roles.includes(role))
			return res.status(404).send("Invalid role.")
	}
	let info = SQL_INSERT_PLAYER_ROLE.run(game_id, role, user_id, is_invite)
	if (info.changes === 1) {
		update_join_clients_players(game_id)
		res.send("SUCCESS")
	} else {
		if (is_invite)
			res.send("Could not invite.")
		else
			res.send("Could not join game.")
	}
}

app.post('/join/:game_id/:role', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	do_join(res, game_id, role, req.user.user_id, 0)
})

app.post('/invite/:game_id/:role/:user', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	let user_id = SQL_SELECT_USER_ID.get(req.params.user)
	if (user_id)
		do_join(res, game_id, role, user_id, 1)
	else
		res.send("User not found.")
})

app.post('/accept/:game_id/:role', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	let info = SQL_UPDATE_PLAYER_ACCEPT.run(game_id, role, req.user.user_id)
	if (info.changes === 1) {
		update_join_clients_players(game_id)
		res.send("SUCCESS")
	} else {
		res.send("Could not accept invite.")
	}
})

app.post('/part/:game_id/:role', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	SQL_DELETE_PLAYER_ROLE.run(game_id, role)
	update_join_clients_players(game_id)
	res.send("SUCCESS")
})

function assign_random_roles(game, players) {
	function pick_random_item(list) {
		let k = crypto.randomInt(list.length)
		let r = list[k]
		list.splice(k, 1)
		return r
	}
	let roles = get_game_roles(game.title_id, game.scenario, game.options).slice()
	for (let p of players) {
		let old_role = p.role
		p.role = pick_random_item(roles)
		console.log("ASSIGN ROLE", "(" + p.name + ")", old_role, "->", p.role)
		SQL_UPDATE_PLAYER_ROLE.run(p.role, game.game_id, old_role, p.user_id)
	}
}

function start_game(game_id, game) {
	let players = SQL_SELECT_PLAYERS.all(game_id)
	if (!is_game_ready(game.title_id, game.scenario, game.options, players))
		return res.send("Invalid scenario/options/player configuration!")
	if (game.is_random) {
		assign_random_roles(game, players)
		players = SQL_SELECT_PLAYERS.all(game_id)
		update_join_clients_players(game_id)
	}
	let options = game.options ? JSON.parse(game.options) : {}
	let seed = random_seed()
	let state = RULES[game.title_id].setup(seed, game.scenario, options)
	put_replay(game_id, null, 'setup', [seed, game.scenario, options])
	SQL_UPDATE_GAME_RESULT.run(1, null, game_id)
	SQL_UPDATE_GAME_STATE.run(game_id, JSON.stringify(state), state.active)
	if (is_solo(players))
		SQL_UPDATE_GAME_PRIVATE.run(game_id)
	update_join_clients_game(game_id)
	mail_game_started_notification_to_offline_users(game_id, game.owner_id)
	mail_your_turn_notification_to_offline_users(game_id, null, state.active)
}

app.post('/start/:game_id', must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME.get(game_id)
	if (game.owner_id !== req.user.user_id)
		return res.send("Not authorized to start that game ID.")
	if (game.status !== 0)
		return res.send("The game is already started.")
	start_game(game_id, game)
	res.send("SUCCESS")
})

app.get('/play/:game_id/:role', function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	let title = SQL_SELECT_GAME_TITLE.get(game_id)
	if (!title)
		return res.status(404).send("Invalid game ID.")
	res.redirect(play_url(title, game_id, role))
})

app.get('/play/:game_id', function (req, res) {
	let game_id = req.params.game_id | 0
	let user_id = req.user ? req.user.user_id : 0
	let title = SQL_SELECT_GAME_TITLE.get(game_id)
	if (!title)
		return res.status(404).send("Invalid game ID.")
	let role = SQL_SELECT_PLAYER_ROLE.get(game_id, user_id)
	if (role)
		res.redirect(play_url(title, game_id, role))
	else
		res.redirect(play_url(title, game_id, "Observer"))
})

app.get('/:title_id/play\::game_id\::role', must_be_logged_in, function (req, res) {
	let user_id = req.user ? req.user.user_id : 0
	let title_id = req.params.title_id
	let game_id = req.params.game_id
	let role = req.params.role
	return res.redirect(play_url(title_id, game_id, role))
})

app.get('/:title_id/play\::game_id', function (req, res) {
	let title_id = req.params.title_id
	let game_id = req.params.game_id
	return res.redirect(play_url(title_id, game_id, "Observer"))
})

app.get('/:title_id/replay\::game_id', function (req, res) {
	let title_id = req.params.title_id
	let game_id = req.params.game_id
	return res.redirect(play_url(title_id, game_id, "Observer", "replay"))
})

app.get('/api/replay/:game_id', function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME.get(game_id)
	if (!game)
		return res.status(404).send("Invalid game ID.")
	if (game.status < 2 && (!req.user || req.user.user_id !== 1))
		return res.status(401).send("Not authorized to debug.")
	return res.send(SQL_SELECT_REPLAY.get({game_id}))
})

/*
 * WEBHOOK NOTIFICATIONS
 */

const webhook_json_options = {
	method: "POST",
	timeout: 6000,
	headers: {
		"Content-Type": "application/json"
	}
}

const webhook_text_options = {
	method: "POST",
	timeout: 6000,
	headers: {
		"Content-Type": "text/plain"
	}
}

function on_webhook_success(user_id) {
	console.log("WEBHOOK SENT", user_id)
}

function on_webhook_error(user_id, error) {
	console.log("WEBHOOK FAIL", user_id, error)
	SQL_UPDATE_WEBHOOK_ERROR.run(error, user_id)
}

function send_webhook(user_id, webhook, message) {
	try {
		const text = webhook.prefix + " " + message
		const data = webhook.format ? JSON.stringify({ [webhook.format]: text }) : text
		const options = webhook.format ? webhook_json_options : webhook_text_options
		const req = https.request(webhook.url, options, res => {
			if (res.statusCode === 200 || res.statusCode === 204)
				on_webhook_success(user_id)
			else
				on_webhook_error(user_id, res.statusCode + " " + http.STATUS_CODES[res.statusCode])
		})
		req.on("timeout", () => {
			on_webhook_error(user_id, "Timeout")
			req.abort()
		})
		req.on("error", (err) => {
			on_webhook_error(user_id, err.toString())
		})
		req.write(data)
		req.end()
	} catch (err) {
		on_webhook_error(user_id, err.message)
	}
}

function webhook_game_link(game, user) {
	if (user.role)
		return SITE_URL + play_url(game.title_id, game.game_id, user.role)
	return SITE_URL + "/join/" + game.game_id
}

function webhook_game_started(user, game_id) {
	let webhook = SQL_SELECT_WEBHOOK_SEND.get(user.user_id)
	if (webhook) {
		let game = SQL_SELECT_GAME_VIEW.get(game_id)
		let message = webhook_game_link(game, user) + " - Started!"
		send_webhook(user.user_id, webhook, message)
	}
}

function webhook_game_over(user, game_id) {
	let webhook = SQL_SELECT_WEBHOOK_SEND.get(user.user_id)
	if (webhook) {
		let game = SQL_SELECT_GAME_VIEW.get(game_id)
		let message = webhook_game_link(game, user) + " - Finished!"
		send_webhook(user.user_id, webhook, message)
	}
}

function webhook_your_turn(user, game_id) {
	let webhook = SQL_SELECT_WEBHOOK_SEND.get(user.user_id)
	if (webhook) {
		let game = SQL_SELECT_GAME_VIEW.get(game_id)
		let message = webhook_game_link(game, user) + " - Your turn!"
		send_webhook(user.user_id, webhook, message)
	}
}

/*
 * MAIL NOTIFICATIONS
 */

const MAIL_FROM = process.env.MAIL_FROM || "user@localhost"
const MAIL_FOOTER = "\n--\nYou can unsubscribe from notifications on your profile page:\n" + SITE_URL + "/profile\n"

const SQL_SELECT_NOTIFIED = SQL("SELECT julianday() < julianday(time, ?) FROM last_notified WHERE game_id=? AND user_id=?").pluck()
const SQL_INSERT_NOTIFIED = SQL("INSERT OR REPLACE INTO last_notified (game_id,user_id,time) VALUES (?,?,julianday())")
const SQL_DELETE_NOTIFIED = SQL("DELETE FROM last_notified WHERE game_id=? AND user_id=?")
const SQL_DELETE_NOTIFIED_ALL = SQL("DELETE FROM last_notified WHERE game_id=?")

const QUERY_LIST_YOUR_TURN = SQL("SELECT * FROM your_turn_reminder")

function mail_callback(err, info) {
	if (err)
		console.log("MAIL ERROR", err)
}

function mail_addr(user) {
	return user.name + " <" + user.mail + ">"
}

function mail_game_info(game) {
	let desc = `Game: ${game.title_name}\n`
	desc += `Scenario: ${game.scenario}\n`
	desc += `Players: ${game.player_names}\n`
	if (game.description.length > 0)
		desc += `Description: ${game.description}\n`
	return desc + "\n"
}

function mail_game_link(game, user) {
	return SITE_URL + "/" + game.title_id + "/play.html?game=" + game.game_id + "&role=" + encodeURIComponent(user.role) + "\n"
}

function mail_password_reset_token(user, token) {
	if (mailer) {
		let subject = "Password reset request"
		let body =
			"Your password reset token is: " + token + "\n\n" +
			SITE_URL + "/reset-password/" + user.mail + "/" + token + "\n\n" +
			"If you did not request a password reset you can ignore this mail.\n"
		console.log("SENT MAIL:", mail_addr(user), subject)
		mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
	}
}

function mail_new_message(user, msg_id, msg_from) {
	if (mailer) {
		let subject = "You have a new message from " + msg_from + "."
		let body =
			"Read the message here:\n" +
			SITE_URL + "/message/read/" + msg_id + "\n" +
			MAIL_FOOTER
		console.log("SENT MAIL:", mail_addr(user), subject)
		mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
	}
}

function mail_game_started_notification(user, game_id) {
	if (mailer) {
		let game = SQL_SELECT_GAME_FULL_VIEW.get(game_id)
		let subject = `${game.title_name} #${game_id} (${user.role}) - Started!`
		let body = mail_game_info(game) +
			"The game has started!\n\n" +
			mail_game_link(game, user) +
			MAIL_FOOTER
		console.log("SENT MAIL:", mail_addr(user), subject)
		mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
	}
}

function mail_game_over_notification(user, game_id, result, victory) {
	if (mailer) {
		let game = SQL_SELECT_GAME_FULL_VIEW.get(game_id)
		let subject = `${game.title_name} #${game_id} (${user.role}) - Finished!`
		let body = mail_game_info(game) +
			victory + "\n\n" +
			mail_game_link(game, user) +
			MAIL_FOOTER
		console.log("SENT MAIL:", mail_addr(user), subject)
		mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
	}
}

function mail_your_turn_notification(user, game_id, interval) {
	if (mailer) {
		let too_soon = SQL_SELECT_NOTIFIED.get(interval, game_id, user.user_id)
		if (!too_soon) {
			SQL_INSERT_NOTIFIED.run(game_id, user.user_id)
			let game = SQL_SELECT_GAME_FULL_VIEW.get(game_id)
			let subject = `${game.title_name} #${game_id} (${user.role}) - Your turn!`
			let body = mail_game_info(game) +
				"It's your turn.\n\n" +
				mail_game_link(game, user) +
				MAIL_FOOTER
			console.log("SENT MAIL:", mail_addr(user), subject)
			mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
		}
	}
}

function reset_your_turn_notification(user, game_id) {
	SQL_DELETE_NOTIFIED.run(game_id, user.user_id)
}

function mail_ready_to_start_notification(user, game_id, interval) {
	if (mailer) {
		let too_soon = SQL_SELECT_NOTIFIED.get(interval, game_id, user.user_id)
		if (!too_soon) {
			SQL_INSERT_NOTIFIED.run(game_id, user.user_id)
			let game = SQL_SELECT_GAME_FULL_VIEW.get(game_id)
			let subject = `${game.title_name} #${game_id} - Ready to start!`
			let body = mail_game_info(game) +
				"Your game is ready to start.\n\n" +
				SITE_URL + "/join/" + game_id + "\n" +
				MAIL_FOOTER
			console.log("SENT MAIL:", mail_addr(user), subject)
			mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
		}
	}
}

function mail_your_turn_notification_to_offline_users(game_id, old_active, active) {
	// Only send notifications when the active player changes.
	if (old_active === active)
		return

	let players = SQL_SELECT_PLAYERS.all(game_id)
	for (let p of players) {
		let p_was_active = (old_active === p.role || old_active === 'Both' || old_active === 'All')
		let p_is_active = (active === p.role || active === 'Both' || active === 'All')
		if (!p_was_active && p_is_active) {
			if (is_online(game_id, p.user_id)) {
				if (p.notify)
					reset_your_turn_notification(p, game_id)
			} else {
				if (p.notify)
					mail_your_turn_notification(p, game_id, '+15 minutes')
				webhook_your_turn(p, game_id)
			}
		} else {
			if (p.notify)
				reset_your_turn_notification(p, game_id)
		}
	}
}

function mail_game_started_notification_to_offline_users(game_id, owner_id) {
	let players = SQL_SELECT_PLAYERS.all(game_id)
	for (let p of players) {
		if (!is_online(game_id, p.user_id)) {
			if (p.notify)
				mail_game_started_notification(p, game_id)
			webhook_game_started(p, game_id)
		}
	}
}

function mail_game_over_notification_to_offline_users(game_id, result, victory) {
	let players = SQL_SELECT_PLAYERS.all(game_id)
	for (let p of players) {
		if (!is_online(game_id, p.user_id)) {
			if (p.notify)
				mail_game_over_notification(p, game_id, result, victory)
			webhook_game_over(p, game_id)
		}
	}
}

function notify_your_turn_reminder() {
	for (let item of QUERY_LIST_YOUR_TURN.all()) {
		mail_your_turn_notification(item, item.game_id, '+25 hours')
	}
}

function notify_ready_to_start_reminder() {
	for (let game of SQL_SELECT_OPEN_GAMES.all()) {
		let players = SQL_SELECT_PLAYERS.all(game.game_id)
		if (is_game_ready(game.title_id, game.scenario, game.options, players)) {
			let owner = SQL_OFFLINE_USER.get(game.owner_id, '+3 minutes')
			if (owner) {
				if (owner.notify)
					mail_ready_to_start_notification(owner, game.game_id, '+25 hours')
			}
		}
	}
}

// Check and send daily 'your turn' reminders every 15 minutes.
setInterval(notify_your_turn_reminder, 15 * 60 * 1000)

// Check and send ready to start notifications every 5 minutes.
setInterval(notify_ready_to_start_reminder, 5 * 60 * 1000)

/*
 * GAME SERVER
 */

var game_clients = {}

function is_online(game_id, user_id) {
	if (game_clients[game_id])
		for (let other of game_clients[game_id])
			if (other.user && other.user.user_id === user_id)
				return true
	if (join_clients[game_id])
		for (let other of join_clients[game_id])
			if (other.user_id === user_id)
				return true
	return false
}

function send_message(socket, cmd, arg) {
	socket.send(JSON.stringify([cmd, arg]))
}

function send_state(socket, state) {
	try {
		let view = socket.rules.view(state, socket.role)
		if (socket.seen < view.log.length)
			view.log_start = socket.seen
		else
			view.log_start = view.log.length
		socket.seen = view.log.length
		view.log = view.log.slice(view.log_start)
		if (state.state === 'game_over')
			view.game_over = 1
		view = JSON.stringify(['state', view])
		if (socket.last_view !== view) {
			socket.send(view)
			socket.last_view = view
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function get_game_state(game_id) {
	let game_state = SQL_SELECT_GAME_STATE.get(game_id)
	if (!game_state)
		throw new Error("No game with that ID")
	return JSON.parse(game_state)
}

function put_game_state(game_id, state, old_active) {
	if (state.state === 'game_over') {
		SQL_UPDATE_GAME_RESULT.run(2, state.result, game_id)
		SQL_DELETE_NOTIFIED_ALL.run(game_id)
		mail_game_over_notification_to_offline_users(game_id, state.result, state.victory)
	}
	SQL_UPDATE_GAME_STATE.run(game_id, JSON.stringify(state), state.active)
	for (let other of game_clients[game_id])
		send_state(other, state)
	update_join_clients_game(game_id)
	mail_your_turn_notification_to_offline_users(game_id, old_active, state.active)
}

function put_replay(game_id, role, action, args) {
	if (args !== undefined && args !== null)
		args = JSON.stringify(args)
	SQL_INSERT_REPLAY.run(game_id, role, action, args)
}

function on_action(socket, action, arg) {
	if (arg !== undefined)
		SLOG(socket, "ACTION", action, JSON.stringify(arg))
	else
		SLOG(socket, "ACTION", action)
	try {
		let state = get_game_state(socket.game_id)
		let old_active = state.active
		state = socket.rules.action(state, socket.role, action, arg)
		put_game_state(socket.game_id, state, old_active)
		put_replay(socket.game_id, socket.role, action, arg)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_query(socket, q) {
	let params = undefined
	if (Array.isArray(q)) {
		params = q[1]
		q = q[0]
	}
	if (params !== undefined)
		SLOG(socket, "QUERY", q, JSON.stringify(params))
	else
		SLOG(socket, "QUERY", q)
	try {
		if (socket.rules.query) {
			let state = get_game_state(socket.game_id)
			let reply = socket.rules.query(state, socket.role, q, params)
			send_message(socket, 'reply', [q, reply])
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_resign(socket) {
	SLOG(socket, "RESIGN")
	try {
		let state = get_game_state(socket.game_id)
		let old_active = state.active
		// TODO: shared "resign" function
		state = socket.rules.resign(state, socket.role)
		put_game_state(socket.game_id, state, old_active)
		put_replay(socket.game_id, socket.role, 'resign', null)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_getnote(socket) {
	try {
		let note = SQL_SELECT_GAME_NOTE.get(socket.game_id, socket.role)
		if (note) {
			SLOG(socket, "GETNOTE", note.length)
			send_message(socket, 'note', note)
		} else {
			SLOG(socket, "GETNOTE null")
			send_message(socket, 'note', "")
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_putnote(socket, note) {
	try {
		SLOG(socket, "PUTNOTE", note.length)
		if (note.length > 0)
			SQL_UPDATE_GAME_NOTE.run(socket.game_id, socket.role, note)
		else
			SQL_DELETE_GAME_NOTE.run(socket.game_id, socket.role)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_getchat(socket, seen) {
	try {
		let chat = SQL_SELECT_GAME_CHAT.all(socket.game_id, seen)
		if (chat.length > 0)
			SLOG(socket, "GETCHAT", seen, chat.length)
		for (let i = 0; i < chat.length; ++i)
			send_message(socket, 'chat', chat[i])
		SQL_DELETE_UNREAD_CHAT.run(socket.user.user_id, socket.game_id)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_chat(socket, message) {
	message = message.substring(0,4000)
	try {
		let chat = SQL_INSERT_GAME_CHAT.get(socket.game_id, socket.user.user_id, message)
		chat[2] = socket.user.name
		SLOG(socket, "CHAT")
		for (let other of game_clients[socket.game_id])
			if (other.role !== "Observer")
				send_message(other, 'chat', chat)

		let users = SQL_SELECT_PLAYERS_ID.all(socket.game_id)
		for (let user_id of users) {
			let found = false
			for (let other of game_clients[socket.game_id])
				if (other.user.user_id === user_id)
					found = true
			if (!found)
				SQL_INSERT_UNREAD_CHAT.run(user_id, socket.game_id)
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_debug(socket) {
	if (!DEBUG)
		send_message(socket, 'error', "Debugging is not enabled on this server.")
	SLOG(socket, "DEBUG")
	try {
		let game_state = SQL_SELECT_GAME_STATE.get(socket.game_id)
		if (!game_state)
			return send_message(socket, 'error', "No game with that ID.")
		send_message(socket, 'debug', game_state)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_save(socket) {
	if (!DEBUG)
		send_message(socket, 'error', "Debugging is not enabled on this server.")
	SLOG(socket, "SAVE")
	try {
		let game_state = SQL_SELECT_GAME_STATE.get(socket.game_id)
		if (!game_state)
			return send_message(socket, 'error', "No game with that ID.")
		send_message(socket, 'save', game_state)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function on_restore(socket, state_text) {
	if (!DEBUG)
		send_message(socket, 'error', "Debugging is not enabled on this server.")
	SLOG(socket, "RESTORE")
	try {
		let state = JSON.parse(state_text)
		state.seed = random_seed() // reseed!
		state_text = JSON.stringify(state)
		SQL_UPDATE_GAME_RESULT.run(1, null, socket.game_id)
		SQL_UPDATE_GAME_STATE.run(socket.game_id, state_text, state.active)
		put_replay(socket.game_id, null, 'debug-restore', state_text)
		for (let other of game_clients[socket.game_id])
			send_state(other, state)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function broadcast_presence(game_id) {
	let presence = []
	for (let socket of game_clients[game_id])
		if (!presence.includes(socket.role))
			presence.push(socket.role)
	for (let socket of game_clients[game_id])
		send_message(socket, 'presence', presence)
}

function on_restart(socket, scenario) {
	if (!DEBUG)
		send_message(socket, 'error', "Debugging is not enabled on this server.")
	try {
		let seed = random_seed()
		let options = JSON.parse(SQL_SELECT_GAME.get(socket.game_id).options)
		let state = socket.rules.setup(seed, scenario, options)
		put_replay(socket.game_id, null, 'setup', [seed, scenario, options])
		for (let other of game_clients[socket.game_id]) {
			other.seen = 0
			send_state(other, state)
		}
		let state_text = JSON.stringify(state)
		SQL_UPDATE_GAME_RESULT.run(1, null, socket.game_id)
		SQL_UPDATE_GAME_STATE.run(socket.game_id, state_text, state.active)
	} catch (err) {
		console.log(err)
		return send_message(socket, 'error', err.toString())
	}
}

function handle_player_message(socket, cmd, arg) {
	switch (cmd) {
	case "action":
		on_action(socket, arg[0], arg[1])
		break
	case "query":
		on_query(socket, arg)
		break
	case "resign":
		on_resign(socket)
		break
	case "getnote":
		on_getnote(socket)
		break
	case "putnote":
		on_putnote(socket, arg)
		break
	case "getchat":
		on_getchat(socket, arg)
		break
	case "chat":
		on_chat(socket, arg)
		break
	case "debug":
		on_debug(socket)
		break
	case "save":
		on_save(socket)
		break
	case "restore":
		on_restore(socket, arg)
		break
	case "restart":
		on_restart(socket, arg)
		break
	}
}

function handle_observer_message(socket, cmd, arg) {
	switch (cmd) {
	case 'query':
		on_query(socket, arg)
		break
	}
}

wss.on('connection', (socket, req, client) => {
	let u = url.parse(req.url, true)
	if (u.pathname !== '/play-socket')
		return setTimeout(() => socket.close(1000, "Invalid request."), 30000)
	req.query = u.query

	let user_id = 0
	let sid = login_cookie(req)
	if (sid)
		user_id = login_sql_select.get(sid)
	if (user_id)
		socket.user = SQL_SELECT_USER_VIEW.get(user_id)

	socket.ip = req.headers["x-real-ip"] || req.ip || req.connection.remoteAddress || "0.0.0.0"
	socket.title_id = req.query.title || "unknown"
	socket.game_id = req.query.game | 0
	socket.role = req.query.role
	socket.seen = req.query.seen | 0
	socket.rules = RULES[socket.title_id]

	SLOG(socket, "OPEN " + socket.seen)

	try {
		let title_id = SQL_SELECT_GAME_TITLE.get(socket.game_id)
		if (title_id !== socket.title_id)
			return socket.close(1000, "Invalid game ID.")

		let players = socket.players = SQL_SELECT_PLAYERS_JOIN.all(socket.game_id)

		if (socket.role !== "Observer") {
			if (!socket.user)
				return socket.close(1000, "You are not logged in!")
			if (socket.role && socket.role !== 'undefined' && socket.role !== 'null') {
				let me = players.find(p => p.user_id === socket.user.user_id && p.role === socket.role)
				if (!me)
					return socket.close(1000, "You aren't assigned that role!")
			} else {
				let me = players.find(p => p.user_id === socket.user.user_id)
				socket.role = me ? me.role : "Observer"
			}
		}

		if (socket.seen === 0)
			send_message(socket, 'players', [socket.role, players.map(p => ({ name: p.name, role: p.role }))])

		if (game_clients[socket.game_id])
			game_clients[socket.game_id].push(socket)
		else
			game_clients[socket.game_id] = [ socket ]

		socket.on('close', (code, reason) => {
			SLOG(socket, "CLOSE " + code)
			game_clients[socket.game_id].splice(game_clients[socket.game_id].indexOf(socket), 1)
			if (game_clients[socket.game_id].length > 0)
				broadcast_presence(socket.game_id)
			else
				delete game_clients[socket.game_id]
		})

		socket.on('message', (data) => {
			try {
				let [ cmd, arg ] = JSON.parse(data)
				if (socket.role !== "Observer")
					handle_player_message(socket, cmd, arg)
				else
					handle_observer_message(socket, cmd, arg)
			} catch (err) {
				send_message(socket, 'error', err)
			}
		})

		broadcast_presence(socket.game_id)
		send_state(socket, get_game_state(socket.game_id))
	} catch (err) {
		console.log(err)
		socket.close(1000, err.message)
	}
})

/*
 * HIDDEN EXTRAS
 */

const SQL_GAME_STATS = SQL(`
	select
		title_id, scenario, options,
		group_concat(result) as result_role,
		group_concat(n) as result_count,
		sum(n) as total
	from
		(
			select
				title_id, scenario, options,
				result,
				count(1) as n
			from
				opposed_games
				natural join game_state
			where
				status=2
			group by
				title_id,
				scenario,
				options,
				result
		)
	group by
		title_id, scenario, options
	having
		total > 12
	`)

app.get('/stats', function (req, res) {
	let stats = SQL_GAME_STATS.all()
	stats.forEach(row => {
		row.title_name = TITLES[row.title_id].title_name
		row.options = format_options(JSON.parse(row.options))
		row.result_role = row.result_role.split(",")
		row.result_count = row.result_count.split(",").map(Number)
	})
	res.render('stats.pug', {
		user: req.user,
		stats: stats,
	})
})

const SQL_USER_STATS = SQL(`
	select
		title_name,
		scenario,
		role,
		sum(role=result) as won,
		count(*) as total
	from
		players
		natural join games
		natural join titles
	where
		user_id = ?
		and status = 2
		and game_id in (select game_id from opposed_games)
	group by
		title_name,
		scenario,
		role
	`)

app.get('/user-stats/:who_name', function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (who) {
		let stats = SQL_USER_STATS.all(who.user_id)
		res.render('user_stats.pug', { user: req.user, who: who, stats: stats })
	} else {
		return res.status(404).send("Invalid user name.")
	}
})
