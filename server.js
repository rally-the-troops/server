"use strict"

/* global process, __dirname */

const fs = require("fs")
const crypto = require("crypto")
const http = require("http")
const { WebSocketServer } = require("ws")
const express = require("express")
const url = require("url")
const sqlite3 = require("better-sqlite3")

require("dotenv").config()

const DEBUG = process.env.DEBUG || 0

const HTTP_HOST = process.env.HTTP_HOST || "localhost"
const HTTP_PORT = process.env.HTTP_PORT || 8080

const SITE_NAME = process.env.SITE_NAME || "Localhost"
const SITE_URL = process.env.SITE_URL || "http://" + HTTP_HOST + ":" + HTTP_PORT

const LIMIT_WAITING_GAMES = (process.env.LIMIT_WAITING_GAMES | 0) || 3
const LIMIT_OPEN_GAMES = (process.env.LIMIT_OPEN_GAMES | 0) || 7
const LIMIT_ACTIVE_GAMES = (process.env.LIMIT_ACTIVE_GAMES | 0) || 29

const REGEX_MAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/
const REGEX_NAME = /^[\p{Alpha}\p{Number}'_-]+( [\p{Alpha}\p{Number}'_-]+)*$/u

const WEBHOOKS = process.env.WEBHOOKS | 0
if (WEBHOOKS)
	console.log("Webhook notifications enabled.")
else
	console.log("Webhook notifications disabled.")

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

/* CONNECTED CLIENT INFO */

var join_clients = {}
var game_clients = {}
var game_cookies = {}

/*
 * Main database.
 */

let db = new sqlite3(process.env.DATABASE || "./db")
db.pragma("synchronous = NORMAL")

const SQL_BEGIN = db.prepare("begin")
const SQL_COMMIT = db.prepare("commit")
const SQL_ROLLBACK = db.prepare("rollback")

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
			return parseInt(c.substring(i + COOKIE.length))
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
		res.setHeader("Cache-Control", "max-age=86400, must-revalidate")
	else
		res.setHeader("Cache-Control", "no-cache")
}

let app = express()

app.locals.DEBUG = DEBUG

app.locals.SITE_NAME = SITE_NAME
app.locals.SITE_NAME_P = SITE_NAME.endsWith("!") ? SITE_NAME : SITE_NAME + "."
app.locals.SITE_URL = SITE_URL
app.locals.SITE_THEME = process.env.SITE_THEME
app.locals.SITE_ICON = process.env.SITE_ICON
app.locals.ENABLE_MAIL = !!mailer
app.locals.ENABLE_WEBHOOKS = !!WEBHOOKS
app.locals.ENABLE_FORUM = process.env.FORUM | 0

app.locals.EMOJI_MATCH = "\u{1f3c6}"
app.locals.EMOJI_LIVE = "\u{1f465}"
app.locals.EMOJI_FAST = "\u{1f3c1}"
app.locals.EMOJI_SLOW = "\u{1f40c}"

app.set("x-powered-by", false)
app.set("etag", false)
app.set("view engine", "pug")

app.use(express.static("public", { redirect: false, etag: false, cacheControl: false, setHeaders: set_static_headers }))
app.use(express.urlencoded({ extended: false }))

let http_server = http.createServer(app)
let wss = new WebSocketServer({ server: http_server })
http_server.keepAliveTimeout = 0
http_server.listen(HTTP_PORT, HTTP_HOST, () => console.log(`Listening to HTTP on ${HTTP_HOST}:${HTTP_PORT}`))

/*
 * MISC FUNCTIONS
 */

function play_url(title_id, game_id, role, mode) {
	if (mode && role)
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

function shuffle(list) {
	// Fisher-Yates shuffle
	for (let i = list.length - 1; i > 0; --i) {
		let j = crypto.randomInt(i + 1)
		let tmp = list[j]
		list[j] = list[i]
		list[i] = tmp
	}
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
	if (typeof date === "string")
		date = julianday_from_epoch(Date.parse(date + "Z"))
	if (typeof date !== "number")
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

function is_valid_email(email) {
	return REGEX_MAIL.test(email)
}

function is_forbidden_mail(mail) {
	return SQL_BLACKLIST_MAIL.get(mail)
}

function clean_user_name(name) {
	name = name.replace(/^ */, "").replace(/ *$/, "").replace(/  */g, " ")
	if (name.length > 50)
		name = name.substring(0, 50)
	return name
}

function is_valid_user_name(name) {
	if (name.length < 2)
		return false
	if (name.length > 50)
		return false
	if (SQL_BLACKLIST_NAME.get(name))
		return false
	return REGEX_NAME.test(name)
}

function hash_password(password, salt) {
	let hash = crypto.createHash("sha256")
	hash.update(password)
	hash.update(salt)
	return hash.digest("hex")
}

/*
 * USER AUTHENTICATION
 */

const SQL_BLACKLIST_MAIL = SQL("select exists ( select 1 from blacklist_mail where ? like mail )").pluck()
const SQL_BLACKLIST_NAME = SQL("select exists ( select 1 from blacklist_name where ? like name )").pluck()

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
const SQL_SELECT_USER_ID = SQL("SELECT user_id FROM users WHERE name=?").pluck()

const SQL_SELECT_USER_NOTIFY = SQL("SELECT notify FROM users WHERE user_id=?").pluck()
const SQL_SELECT_USER_VERIFIED = SQL("SELECT is_verified FROM users WHERE user_id=?").pluck()
const SQL_UPDATE_USER_NOTIFY = SQL("UPDATE users SET notify=? WHERE user_id=?")
const SQL_UPDATE_USER_NAME = SQL("UPDATE users SET name=? WHERE user_id=?")
const SQL_UPDATE_USER_MAIL = SQL("UPDATE users SET mail=? WHERE user_id=?")
const SQL_UPDATE_USER_VERIFIED = SQL("UPDATE users SET is_verified=? WHERE user_id=?")
const SQL_UPDATE_USER_ABOUT = SQL("UPDATE users SET about=? WHERE user_id=?")
const SQL_UPDATE_USER_PASSWORD = SQL("UPDATE users SET password=?, salt=? WHERE user_id=?")
const SQL_UPDATE_USER_LAST_SEEN = SQL("INSERT OR REPLACE INTO user_last_seen (user_id,atime,ip) VALUES (?,datetime(),?)")
const SQL_UPDATE_USER_IS_BANNED = SQL("update users set is_banned=? where name=?")

const SQL_SELECT_WEBHOOK = SQL("SELECT * FROM webhooks WHERE user_id=?")
const SQL_SELECT_WEBHOOK_SEND = SQL("SELECT url, format, prefix FROM webhooks WHERE user_id=? AND error is null")
const SQL_UPDATE_WEBHOOK = SQL("INSERT OR REPLACE INTO webhooks (user_id, url, format, prefix, error) VALUES (?,?,?,?,null)")
const SQL_UPDATE_WEBHOOK_ERROR = SQL("UPDATE webhooks SET error=? WHERE user_id=?")
const SQL_UPDATE_WEBHOOK_SUCCESS = SQL("UPDATE webhooks SET error=null WHERE user_id=? AND error IS NOT NULL")
const SQL_DELETE_WEBHOOK = SQL("DELETE FROM webhooks WHERE user_id=?")

const SQL_FIND_TOKEN = SQL("SELECT token FROM tokens WHERE user_id=? AND julianday('now') < julianday(time, '+5 minutes')").pluck()
const SQL_CREATE_TOKEN = SQL("INSERT OR REPLACE INTO tokens (user_id,token,time) VALUES (?, lower(hex(randomblob(16))), datetime()) RETURNING token").pluck()
const SQL_VERIFY_TOKEN = SQL("SELECT EXISTS ( SELECT 1 FROM tokens WHERE user_id=? AND julianday('now') < julianday(time, '+20 minutes') AND token=? )").pluck()

app.use(function (req, res, next) {
	let ip = req.headers["x-real-ip"] || req.ip || req.connection.remoteAddress || "0.0.0.0"

	res.setHeader("Cache-Control", "no-store")
	let sid = login_cookie(req)
	if (sid) {
		let user_id = login_sql_select.get(sid)
		if (user_id) {
			login_touch(res, sid)
			req.user = SQL_SELECT_USER_DYNAMIC.get(user_id)
			SQL_UPDATE_USER_LAST_SEEN.run(user_id, ip)
			if (req.user.is_banned)
				return res.status(403).send("")
		}
	}

	// Log non-static accesses.
	let time = new Date().toISOString().substring(11, 19)
	let name = (req.user ? req.user.name : "guest").padEnd(20)
	ip = String(ip).padEnd(15)
	console.log(time, ip, name, req.method, req.url)

	return next()
})

function must_be_logged_in(req, res, next) {
	if (!req.user)
		return res.redirect("/login?redirect=" + encodeURIComponent(req.originalUrl))
	return next()
}

function must_be_administrator(req, res, next) {
	if (!req.user || req.user.user_id !== 1)
		return res.status(401).send("Not authorized")
	return next()
}

app.get("/", function (req, res) {
	res.render("index.pug", { user: req.user })
})

app.get("/clear-cache", function (req, res) {
	res.setHeader("Clear-Site-Data", `"cache"`)
	res.send("Did it work?")
})

app.get("/create", function (req, res) {
	res.render("create-index.pug", { user: req.user })
})

app.get("/about", function (req, res) {
	res.render("about.pug", { user: req.user })
})

app.post("/logout", function (req, res) {
	let sid = login_cookie(req)
	if (sid)
		login_delete(res, sid)
	res.redirect("/login")
})

app.get("/login", function (req, res) {
	if (req.user)
		return res.redirect("/")
	res.render("login.pug", { redirect: req.query.redirect })
})

app.post("/login", function (req, res) {
	let name_or_mail = req.body.username
	let password = req.body.password
	let redirect = req.body.redirect
	if (!is_valid_email(name_or_mail))
		name_or_mail = clean_user_name(name_or_mail)
	let user = SQL_SELECT_LOGIN_BY_NAME.get(name_or_mail)
	if (!user)
		user = SQL_SELECT_LOGIN_BY_MAIL.get(name_or_mail)
	if (!user || is_forbidden_mail(user.mail) || hash_password(password, user.salt) != user.password)
		return setTimeout(() => res.render("login.pug", { flash: "Invalid login." }), 1000)
	login_insert(res, user.user_id)
	res.redirect(redirect || "/profile")
})

app.get("/signup", function (req, res) {
	if (req.user)
		return res.redirect("/")
	res.render("signup.pug")
})

app.post("/signup", function (req, res) {
	function err(msg) {
		res.render("signup.pug", { flash: msg })
	}
	let name = req.body.username
	let mail = req.body.mail
	let password = req.body.password
	let notify = req.body.notify === "true"
	name = clean_user_name(name)
	if (!is_valid_user_name(name))
		return err("Invalid user name!")
	if (SQL_EXISTS_USER_NAME.get(name))
		return err("That name is already taken.")
	if (!is_valid_email(mail) || is_forbidden_mail(mail))
		return err("Invalid mail address!")
	if (SQL_EXISTS_USER_MAIL.get(mail))
		return err("That mail is already taken.")
	if (password.length < 4)
		return err("Password is too short!")
	if (password.length > 100)
		return err("Password is too long!")
	let salt = crypto.randomBytes(32).toString("hex")
	let hash = hash_password(password, salt)
	let user = SQL_INSERT_USER.get(name, mail, hash, salt, notify ? 1 : 0)
	login_insert(res, user.user_id)
	res.redirect("/profile")
})

function create_and_mail_verification_token(user) {
	if (!SQL_FIND_TOKEN.get(user.user_id))
		mail_verification_token(user, SQL_CREATE_TOKEN.get(user.user_id))
}

app.get("/verify-mail", must_be_logged_in, function (req, res) {
	if (SQL_SELECT_USER_VERIFIED.get(req.user.user_id))
		return res.redirect("/profile")
	create_and_mail_verification_token(req.user)
	res.render("verify_mail.pug", { user: req.user })
})

app.get("/verify-mail/:token", must_be_logged_in, function (req, res) {
	if (SQL_SELECT_USER_VERIFIED.get(req.user.user_id))
		return res.redirect("/profile")
	res.render("verify_mail.pug", { user: req.user, token: req.params.token })
})

app.post("/verify-mail", must_be_logged_in, function (req, res) {
	if (SQL_VERIFY_TOKEN.get(req.user.user_id, req.body.token)) {
		SQL_UPDATE_USER_VERIFIED.run(1, req.user.user_id)
		res.redirect("/profile")
	} else {
		create_and_mail_verification_token(req.user)
		res.render("verify_mail.pug", { user: req.user, flash: "Invalid or expired token!" })
	}
})

app.get("/forgot-password", function (req, res) {
	if (req.user)
		return res.redirect("/")
	res.render("forgot_password.pug")
})

app.post("/forgot-password", function (req, res) {
	let mail = req.body.mail
	let user = SQL_SELECT_LOGIN_BY_MAIL.get(mail)
	if (user) {
		let token = SQL_FIND_TOKEN.get(user.user_id)
		if (!token) {
			token = SQL_CREATE_TOKEN.get(user.user_id)
			mail_password_reset_token(user, token)
		}
		return res.redirect("/reset-password/" + mail)
	}
	res.render("forgot_password.pug", { flash: "User not found." })
})

app.get("/reset-password", function (req, res) {
	if (req.user)
		return res.redirect("/")
	res.render("reset_password.pug", { mail: "", token: "" })
})

app.get("/reset-password/:mail", function (req, res) {
	if (req.user)
		return res.redirect("/")
	let mail = req.params.mail
	res.render("reset_password.pug", { mail: mail, token: "" })
})

app.get("/reset-password/:mail/:token", function (req, res) {
	if (req.user)
		return res.redirect("/")
	let mail = req.params.mail
	let token = req.params.token
	res.render("reset_password.pug", { mail: mail, token: token })
})

app.post("/reset-password", function (req, res) {
	let mail = req.body.mail
	let token = req.body.token
	let password = req.body.password
	function err(msg) {
		res.render("reset_password.pug", { mail: mail, token: token, flash: msg })
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
	let salt = crypto.randomBytes(32).toString("hex")
	let hash = hash_password(password, salt)
	SQL_UPDATE_USER_PASSWORD.run(hash, salt, user.user_id)
	SQL_UPDATE_USER_VERIFIED.run(1, user.user_id)
	login_insert(res, user.user_id)
	return res.redirect("/profile")
})

app.get("/change-password", must_be_logged_in, function (req, res) {
	res.render("change_password.pug", { user: req.user })
})

app.post("/change-password", must_be_logged_in, function (req, res) {
	let oldpass = req.body.password
	let newpass = req.body.newpass
	// Get full user record including password and salt
	let user = SQL_SELECT_LOGIN.get(req.user.user_id)
	if (newpass.length < 4)
		return res.render("change_password.pug", { user: req.user, flash: "Password is too short!" })
	if (newpass.length > 100)
		return res.render("change_password.pug", { user: req.user, flash: "Password is too long!" })
	let oldhash = hash_password(oldpass, user.salt)
	if (oldhash !== user.password)
		return res.render("change_password.pug", { user: req.user, flash: "Wrong password!" })
	let salt = crypto.randomBytes(32).toString("hex")
	let hash = hash_password(newpass, salt)
	SQL_UPDATE_USER_PASSWORD.run(hash, salt, user.user_id)
	return res.redirect("/profile")
})

app.get("/delete-account", must_be_logged_in, function (req, res) {
	res.render("delete_account.pug", { user: req.user })
})

const SQL_SELECT_GAME_ROLE_FOR_DELETED_USER = SQL(`
	select game_id, role from players where user_id = ? and game_id in (select game_id from games where status <= 1)
	`)

app.post("/delete-account", must_be_logged_in, function (req, res) {
	let password = req.body.password
	// Get full user record including password and salt
	let user = SQL_SELECT_LOGIN.get(req.user.user_id)
	let hash = hash_password(password, user.salt)
	if (hash !== user.password)
		return res.render("delete_account.pug", { user: req.user, flash: "Wrong password!" })

	let list = SQL_SELECT_GAME_ROLE_FOR_DELETED_USER.all(req.user.user_id)
	for (let item of list)
		send_chat_message(item.game_id, null, null, `${user.name} (${item.role}) left the game.`)

	SQL_DELETE_USER.run(req.user.user_id)
	return res.send("Goodbye!")
})

app.get("/admin/ban-user/:who", must_be_administrator, function (req, res) {
	let who = req.params.who
	SQL_UPDATE_USER_IS_BANNED.run(1, who)
	return res.redirect("/user/" + who)
})

app.get("/admin/unban-user/:who", must_be_administrator, function (req, res) {
	let who = req.params.who
	SQL_UPDATE_USER_IS_BANNED.run(0, who)
	return res.redirect("/user/" + who)
})

/*
 * USER PROFILE
 */

app.get("/subscribe", must_be_logged_in, function (req, res) {
	SQL_UPDATE_USER_NOTIFY.run(1, req.user.user_id)
	res.redirect("/profile")
})

app.get("/unsubscribe", must_be_logged_in, function (req, res) {
	SQL_UPDATE_USER_NOTIFY.run(0, req.user.user_id)
	res.redirect("/profile")
})

app.get("/webhook", must_be_logged_in, function (req, res) {
	req.user.notify = SQL_SELECT_USER_NOTIFY.get(req.user.user_id)
	let webhook = SQL_SELECT_WEBHOOK.get(req.user.user_id)
	res.render("webhook.pug", { user: req.user, webhook: webhook })
})

app.post("/api/webhook/delete", must_be_logged_in, function (req, res) {
	SQL_DELETE_WEBHOOK.run(req.user.user_id)
	res.redirect("/webhook")
})

app.post("/api/webhook/update", must_be_logged_in, function (req, res) {
	let url = req.body.url
	let prefix = req.body.prefix
	let format = req.body.format
	SQL_UPDATE_WEBHOOK.run(req.user.user_id, url, format, prefix)
	const webhook = SQL_SELECT_WEBHOOK_SEND.get(req.user.user_id)
	if (webhook)
		send_webhook(req.user.user_id, webhook, "Test message!", 0)
	res.setHeader("refresh", "3; url=/webhook")
	res.send("Testing Webhook. Please wait...")
})

app.get("/change-name", must_be_logged_in, function (req, res) {
	res.render("change_name.pug", { user: req.user })
})

app.post("/change-name", must_be_logged_in, function (req, res) {
	let newname = clean_user_name(req.body.newname)
	if (!is_valid_user_name(newname))
		return res.render("change_name.pug", { user: req.user, flash: "Invalid user name!" })
	if (SQL_EXISTS_USER_NAME.get(newname))
		return res.render("change_name.pug", { user: req.user, flash: "That name is already taken!" })
	SQL_UPDATE_USER_NAME.run(newname, req.user.user_id)
	return res.redirect("/profile")
})

app.get("/change-mail", must_be_logged_in, function (req, res) {
	res.render("change_mail.pug", { user: req.user })
})

app.post("/change-mail", must_be_logged_in, function (req, res) {
	let newmail = req.body.newmail
	if (!is_valid_email(newmail) || is_forbidden_mail(newmail))
		return res.render("change_mail.pug", { user: req.user, flash: "Invalid mail address!" })
	if (SQL_EXISTS_USER_MAIL.get(newmail))
		return res.render("change_mail.pug", { user: req.user, flash: "That mail address is already taken!" })
	SQL_UPDATE_USER_MAIL.run(newmail, req.user.user_id)
	SQL_UPDATE_USER_VERIFIED.run(0, req.user.user_id)
	return res.redirect("/profile")
})

app.get("/change-about", must_be_logged_in, function (req, res) {
	let about = SQL_SELECT_USER_PROFILE.get(req.user.name).about
	res.render("change_about.pug", { user: req.user, about: about || "" })
})

app.post("/change-about", must_be_logged_in, function (req, res) {
	SQL_UPDATE_USER_ABOUT.run(req.body.about, req.user.user_id)
	return res.redirect("/profile")
})

app.get("/user/:who_name", function (req, res) {
	let who = SQL_SELECT_USER_PROFILE.get(req.params.who_name)
	if (who) {
		who.ctime = human_date(who.ctime)
		who.atime = human_date(who.atime)
		let games = QUERY_LIST_PUBLIC_GAMES_OF_USER.all({ user_id: who.user_id })
		annotate_games(games, 0, null)
		let relation = 0
		if (req.user)
			relation = SQL_SELECT_RELATION.get(req.user.user_id, who.user_id) | 0
		res.render("user.pug", { user: req.user, who, relation, games })
	} else {
		return res.status(404).send("Invalid user name.")
	}
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

app.get("/contacts", must_be_logged_in, function (req, res) {
	let contacts = SQL_SELECT_CONTACT_LIST.all(req.user.user_id)
	contacts.forEach(user => user.atime = human_date(user.atime))
	res.render("contacts.pug", {
		user: req.user,
		friends: contacts.filter(user => user.relation > 0),
		enemies: contacts.filter(user => user.relation < 0),
	})
})

app.get("/contacts/remove/:who_name", must_be_logged_in, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (!who)
		return res.status(404).send("User not found.")
	SQL_DELETE_CONTACT.run(req.user.user_id, who.user_id)
	return res.redirect("/contacts")
})

app.get("/contacts/add-friend/:who_name", must_be_logged_in, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (!who)
		return res.status(404).send("User not found.")
	SQL_INSERT_CONTACT.run(req.user.user_id, who.user_id, 1)
	return res.redirect("/user/" + who.name)
})

app.get("/contacts/add-enemy/:who_name", must_be_logged_in, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (!who)
		return res.status(404).send("User not found.")
	SQL_INSERT_CONTACT.run(req.user.user_id, who.user_id, -1)
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

app.get("/inbox", must_be_logged_in, function (req, res) {
	let messages = MESSAGE_LIST_INBOX.all(req.user.user_id)
	for (let i = 0; i < messages.length; ++i)
		messages[i].time = human_date(messages[i].time)
	res.render("message_inbox.pug", {
		user: req.user,
		messages: messages,
	})
})

app.get("/outbox", must_be_logged_in, function (req, res) {
	let messages = MESSAGE_LIST_OUTBOX.all(req.user.user_id)
	for (let i = 0; i < messages.length; ++i)
		messages[i].time = human_date(messages[i].time)
	res.render("message_outbox.pug", {
		user: req.user,
		messages: messages,
	})
})

app.get("/message/read/:message_id", must_be_logged_in, function (req, res) {
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
	res.render("message_read.pug", {
		user: req.user,
		message: message,
	})
})

app.get("/message/send", must_be_logged_in, function (req, res) {
	let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
	res.render("message_send.pug", {
		user: req.user,
		to_name: "",
		subject: "",
		body: "",
		friends,
	})
})

app.get("/message/send/:to_name", must_be_logged_in, function (req, res) {
	let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
	let to_name = req.params.to_name
	res.render("message_send.pug", {
		user: req.user,
		to_name: to_name,
		subject: "",
		body: "",
		friends,
	})
})

app.post("/message/send", must_be_logged_in, function (req, res) {
	let to_name = req.body.to.trim()
	let subject = req.body.subject.trim()
	let body = req.body.body.trim()
	let to_user = SQL_SELECT_USER_BY_NAME.get(to_name)
	if (!to_user) {
		let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
		return res.render("message_send.pug", {
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
	send_notification(to_user, message_link(info.lastInsertRowid), "New message from " + req.user.name)
	res.redirect("/inbox")
})

function quote_body(message) {
	let when = new Date(epoch_from_time(message.time)).toDateString()
	let who = message.from_name
	let what = message.body.split("\n").join("\n> ")
	return "\n\n" + "On " + when + " " + who + " wrote:\n> " + what + "\n"
}

app.get("/message/reply/:message_id", must_be_logged_in, function (req, res) {
	let message_id = req.params.message_id | 0
	let message = MESSAGE_FETCH.get(message_id, req.user.user_id, req.user.user_id)
	if (!message)
		return res.status(404).send("Invalid message ID.")
	let friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
	return res.render("message_send.pug", {
		user: req.user,
		to_id: message.from_id,
		to_name: message.from_name,
		subject: message.subject.startsWith("Re: ") ? message.subject : "Re: " + message.subject,
		body: quote_body(message),
		friends,
	})
})

app.get("/message/delete/outbox", must_be_logged_in, function (req, res) {
	MESSAGE_DELETE_ALL_OUTBOX.run(req.user.user_id)
	res.redirect("/outbox")
})

app.get("/message/delete/:message_id", must_be_logged_in, function (req, res) {
	let message_id = req.params.message_id | 0
	MESSAGE_DELETE_INBOX.run(message_id, req.user.user_id)
	MESSAGE_DELETE_OUTBOX.run(message_id, req.user.user_id)
	res.redirect("/inbox")
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
const FORUM_EDIT_POST = SQL("UPDATE posts SET body=?, mtime=datetime() WHERE post_id=? AND author_id=? RETURNING thread_id").pluck()
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
	res.render("forum_view.pug", {
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

app.get("/forum", function (req, res) {
	show_forum_page(req, res, 1)
})

app.get("/forum/page/:page", function (req, res) {
	show_forum_page(req, res, req.params.page | 0)
})

app.get("/forum/thread/:thread_id", function (req, res) {
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
	res.render("forum_thread.pug", {
		user: req.user,
		thread: thread,
		posts: posts,
	})
})

app.get("/admin/delete-thread/:thread_id", must_be_administrator, function (req, res) {
	let thread_id = req.params.thread_id
	res.send(JSON.stringify({
		posts: FORUM_DELETE_THREAD_POSTS.run(thread_id),
		thread: FORUM_DELETE_THREAD.run(thread_id),
	}))
})

app.get("/admin/delete-post/:post_id", must_be_administrator, function (req, res) {
	let post_id = req.params.post_id
	res.send(JSON.stringify(
		FORUM_DELETE_POST.run(post_id)
	))
})

app.get("/forum/post", must_be_logged_in, function (req, res) {
	res.render("forum_post.pug", {
		user: req.user,
	})
})

app.post("/forum/post", must_be_logged_in, function (req, res) {
	let user_id = req.user.user_id
	let subject = req.body.subject.trim()
	let body = req.body.body
	if (subject.length === 0)
		subject = "Untitled"
	let thread_id = FORUM_NEW_THREAD.run(user_id, subject).lastInsertRowid
	FORUM_NEW_POST.run(thread_id, user_id, body)
	res.redirect("/forum/thread/" + thread_id)
})

app.get("/forum/edit/:post_id", must_be_logged_in, function (req, res) {
	// TODO: edit subject if editing first post
	let post_id = req.params.post_id | 0
	let post = FORUM_GET_POST.get(post_id)
	if (!post || post.author_id != req.user.user_id)
		return res.status(404).send("Invalid post ID.")
	post.ctime = human_date(post.ctime)
	post.mtime = human_date(post.mtime)
	res.render("forum_edit.pug", {
		user: req.user,
		post: post,
	})
})

app.post("/forum/edit/:post_id", must_be_logged_in, function (req, res) {
	let user_id = req.user.user_id
	let post_id = req.params.post_id | 0
	let body = req.body.body
	let thread_id = FORUM_EDIT_POST.get(body, post_id, user_id)
	res.redirect("/forum/thread/" + thread_id)
})

app.get("/forum/reply/:post_id", must_be_logged_in, function (req, res) {
	let post_id = req.params.post_id | 0
	let post = FORUM_GET_POST.get(post_id)
	if (!post)
		return res.status(404).send("Invalid post ID.")
	let thread = FORUM_GET_THREAD.get(post.thread_id)
	post.body = linkify_post(post.body)
	post.edited = post.mtime !== post.ctime
	post.ctime = human_date(post.ctime)
	post.mtime = human_date(post.mtime)
	res.render("forum_reply.pug", {
		user: req.user,
		thread: thread,
		post: post,
	})
})

app.post("/forum/reply/:thread_id", must_be_logged_in, function (req, res) {
	let thread_id = req.params.thread_id | 0
	let user_id = req.user.user_id
	let body = req.body.body
	FORUM_NEW_POST.run(thread_id, user_id, body)
	res.redirect("/forum/thread/" + thread_id)
})

app.get("/forum/search", must_be_logged_in, function (req, res) {
	let search = req.query.q
	let results = []
	if (search)
		results = FORUM_SEARCH.all(search)
	res.render("forum_search.pug", { user: req.user, search, results })
})

/*
 * GAME LOBBY
 */

const SQL_SELECT_SETUPS = SQL("select * from setups where title_id=? order by setup_id")

let RULES = {}
let TITLE_TABLE = app.locals.TITLE_TABLE = {}
let TITLE_LIST = app.locals.TITLE_LIST = []
let TITLE_NAME = app.locals.TITLE_NAME = {}

const STATUS_OPEN = 0
const STATUS_ACTIVE = 1
const STATUS_FINISHED = 2
const STATUS_ARCHIVED = 3

const PACE_ANY = 0
const PACE_LIVE = 1
const PACE_FAST = 2
const PACE_SLOW = 3

const PACE_NAME = [ "Any", "Live", "Fast", "Slow" ]

const PARSE_OPTIONS_CACHE = {}

const HUMAN_OPTIONS_CACHE = {
	"{}": "None"
}

function parse_game_options(options_json) {
	if (options_json in PARSE_OPTIONS_CACHE)
		return PARSE_OPTIONS_CACHE[options_json]
	return PARSE_OPTIONS_CACHE[options_json] = Object.freeze(JSON.parse(options_json))
}

function option_to_english(k) {
	if (k === true || k === 1)
		return "yes"
	if (k === false)
		return "no"
	if (typeof k === "string")
		return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
	return k
}

function format_options(options_json, options) {
	if (options_json in HUMAN_OPTIONS_CACHE)
		return HUMAN_OPTIONS_CACHE[options_json]
	let text = Object.entries(options)
		.map(([ k, v ]) => {
			if (k === "players")
				return v + " Player"
			if (v === true || v === 1)
				return option_to_english(k)
			return option_to_english(k) + "=" + option_to_english(v)
		})
		.join(", ")
	return (HUMAN_OPTIONS_CACHE[options_json] = text)
}

function get_game_roles(title_id, scenario, options) {
	let roles = RULES[title_id].roles
	if (typeof roles === "function")
		return roles(scenario, options)
	return roles
}

function is_game_ready(player_count, players) {
	if (player_count !== players.length)
		return false
	for (let p of players)
		if (p.is_invite)
			return false
	return true
}

function unload_module(filename) {
	// Remove a module and its dependencies from require.cache so they can be reloaded.
	let mod = require.cache[filename]
	if (mod) {
		delete require.cache[filename]
		for (let child of mod.children)
			unload_module(child.filename)
	}
}

function load_rules(rules_dir, rules_file, title) {
	RULES[title.title_id] = require(rules_file)

	title.setups = SQL_SELECT_SETUPS.all(title.title_id)
	for (let setup of title.setups) {
		if (!setup.setup_name) {
			if (title.setups.length > 1 && setup.scenario !== "Standard")
				setup.setup_name = title.title_name + " - " + setup.scenario
			else
				setup.setup_name = title.title_name
		}
		setup.roles = get_game_roles(setup.title_id, setup.scenario, parse_game_options(setup.options))
	}

	title.about_html = fs.readFileSync(rules_dir + "/about.html")
	title.create_html = fs.readFileSync(rules_dir + "/create.html")
}

function watch_rules(rules_dir, rules_file, title) {
	let watch_list = [ rules_file ]

	let mod = require.cache[rules_file]
	if (mod) {
		for (let child of mod.children)
			watch_list.push(child.filename)
	}

	function reload_rules() {
		try {
			console.log("*** RELOAD", title.title_id, "***")
			unload_module(rules_file)
			load_rules(rules_dir, rules_file, title)
			sync_client_state_for_title(title.title_id)
		} catch (err) {
			console.log(err)
		}
	}

	// TODO: figure out why chokidar is unreliable on production server
	// chokidar.watch(watch_list, { ignoreInitial: true, awaitWriteFinish: true }).on("all", reload_rules)
	for (let file of watch_list)
		fs.watchFile(file, reload_rules)
}

function load_titles() {
	const SQL_SELECT_TITLES = SQL("select * from titles")
	for (let title of SQL_SELECT_TITLES.all()) {
		let title_id = title.title_id
		let rules_dir = __dirname + "/public/" + title_id
		let rules_file = rules_dir + "/rules.js"

		TITLE_LIST.push(title)
		TITLE_TABLE[title_id] = title
		TITLE_NAME[title_id] = title.title_name

		try {
			if (fs.existsSync(rules_file)) {
				console.log("Loading rules for " + title_id)
				load_rules(rules_dir, rules_file, title)
			} else {
				console.log("Cannot find rules for " + title_id)
			}
		} catch (err) {
			console.log(err)
		}

		watch_rules(rules_dir, rules_file, title)
	}
}

load_titles()

const SQL_INSERT_GAME = SQL("INSERT INTO games (owner_id,title_id,scenario,options,player_count,pace,is_private,is_random,notice,is_match) VALUES (?,?,?,?,?,?,?,?,?,?) returning game_id").pluck()
const SQL_DELETE_GAME_BY_OWNER = SQL("delete from games where game_id=? and owner_id=?")
const SQL_DELETE_GAME = SQL("delete from games where game_id=?")

const SQL_START_GAME = SQL(`
	update games set
		status = 1,
		is_private = (is_private or user_count = 1 or user_count < player_count),
		mtime = datetime(),
		active = ?
	where
		game_id = ?
`)

const SQL_FINISH_GAME = SQL(`
	update games set
		status = 2,
		mtime = datetime(),
		active = null,
		result = ?
	where
		game_id = ?
`)

const SQL_REWIND_GAME = SQL("update games set status=1,moves=?,active=?,mtime=datetime() where game_id=?")
const SQL_SELECT_REWIND = SQL("select snap_id, state->>'$.active' as active, state->>'$.state' as state from game_snap where game_id=? order by snap_id desc")

const SQL_UPDATE_GAME_ACTIVE = SQL("update games set active=?,mtime=datetime(),moves=moves+1 where game_id=?")
const SQL_UPDATE_GAME_MOVES = SQL("update games set moves=? where game_id=?")
const SQL_UPDATE_GAME_SCENARIO = SQL("update games set scenario=? where game_id=?")

const SQL_SELECT_GAME_STATE = SQL("select state from game_state where game_id=?").pluck()
const SQL_INSERT_GAME_STATE = SQL("insert or replace into game_state (game_id,state) values (?,?)")

const SQL_SELECT_UNREAD_CHAT_GAMES = SQL("select game_id from unread_chats where user_id = ?").pluck()
const SQL_SELECT_UNREAD_CHAT = SQL("select exists (select 1 from unread_chats where user_id = ? and game_id = ?)").pluck()
const SQL_INSERT_UNREAD_CHAT = SQL("insert or ignore into unread_chats (user_id,game_id) values (?,?)")
const SQL_DELETE_UNREAD_CHAT = SQL("delete from unread_chats where user_id = ? and game_id = ?")

const SQL_SELECT_GAME_CHAT = SQL("SELECT chat_id,unixepoch(time),name,message FROM game_chat_view WHERE game_id=? AND chat_id>?").raw()
const SQL_INSERT_GAME_CHAT = SQL("INSERT INTO game_chat (game_id,chat_id,user_id,message) VALUES (?, (select coalesce(max(chat_id), 0) + 1 from game_chat where game_id=?), ?,?)")

const SQL_SELECT_GAME_NOTE = SQL("SELECT note FROM game_notes WHERE game_id=? AND role=?").pluck()
const SQL_UPDATE_GAME_NOTE = SQL("INSERT OR REPLACE INTO game_notes (game_id,role,note) VALUES (?,?,?)")
const SQL_DELETE_GAME_NOTE = SQL("DELETE FROM game_notes WHERE game_id=? AND role=?")

const SQL_UPDATE_PLAYERS_ADD_TIME = SQL(`
	update players
		set time_added = min(time_used, time_added + 1.5)
	where
		players.game_id = ? and players.role = ?
`)

const SQL_INSERT_REPLAY = SQL("insert into game_replay (game_id,replay_id,role,action,arguments) values (?, (select coalesce(max(replay_id), 0) + 1 from game_replay where game_id=?) ,?,?,?) returning replay_id").pluck()

const SQL_INSERT_SNAP = SQL("insert into game_snap (game_id,snap_id,replay_id,state) values (?, (select coalesce(max(snap_id), 0) + 1 from game_snap where game_id=?), ?, ?) returning snap_id").pluck()
const SQL_SELECT_SNAP = SQL("select * from game_snap where game_id = ? and snap_id = ?")
const SQL_SELECT_SNAP_STATE = SQL("select state from game_snap where game_id = ? and snap_id = ?").pluck()
const SQL_SELECT_SNAP_COUNT = SQL("select max(snap_id) from game_snap where game_id=?").pluck()

const SQL_SELECT_LAST_SNAP = SQL("select * from game_snap where game_id = ? order by snap_id desc limit 1")

const SQL_DELETE_GAME_SNAP = SQL("delete from game_snap where game_id=? and snap_id > ?")
const SQL_DELETE_GAME_REPLAY = SQL("delete from game_replay where game_id=? and replay_id > ?")

const SQL_SELECT_REPLAY = SQL(`
	select
		json_object(
			'players',
				(select json_group_array(
						json_object('role', role, 'name', name)
					)
					from players
					left join users using(user_id)
					where game_id = outer.game_id
				),
			'state',
				(select json(state)
					from game_state
					where game_id = outer.game_id
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
					where game_id = outer.game_id
				)
		) as export
	from games as outer
	where game_id = ?
`).pluck()

const SQL_SELECT_EXPORT = SQL("select export from game_export_view where game_id=?").pluck()

const SQL_SELECT_GAME = SQL("SELECT * FROM games WHERE game_id=?")
const SQL_SELECT_GAME_VIEW = SQL("SELECT * FROM game_view WHERE game_id=?")
const SQL_SELECT_GAME_TITLE = SQL("SELECT title_id FROM games WHERE game_id=?").pluck()

const SQL_SELECT_PLAYERS = SQL("select * from players join user_view using(user_id) where game_id=?")
const SQL_SELECT_PLAYERS_WITH_NAME = SQL("select role, user_id, name from players join users using(user_id) where game_id=?")
const SQL_UPDATE_PLAYER_ACCEPT = SQL("UPDATE players SET is_invite=0 WHERE game_id=? AND role=? AND user_id=?")
const SQL_UPDATE_PLAYER_ROLE = SQL("UPDATE players SET role=? WHERE game_id=? AND role=? AND user_id=?")
const SQL_SELECT_PLAYER_ROLE = SQL("SELECT role FROM players WHERE game_id=? AND user_id=?").pluck()
const SQL_SELECT_PLAYER_NAME = SQL("SELECT name FROM players JOIN users using(user_id) WHERE game_id=? AND role=?").pluck()
const SQL_INSERT_PLAYER_ROLE = SQL("INSERT OR IGNORE INTO players (game_id,role,user_id,is_invite,time_used,time_added) VALUES (?,?,?,?,0,0)")
const SQL_DELETE_PLAYER_ROLE = SQL("DELETE FROM players WHERE game_id=? AND role=?")

const SQL_SELECT_PLAYER_VIEW = SQL("select * from player_view where game_id = ?")

const SQL_COUNT_OPEN_GAMES = SQL(`SELECT COUNT(*) FROM games WHERE owner_id=? AND status=${STATUS_OPEN}`).pluck()
const SQL_COUNT_ACTIVE_GAMES = SQL(`
	select count(*) from games
	where status < 2 and exists (
		select 1 from players where players.user_id=? and players.game_id=games.game_id
	)
`).pluck()

const SQL_SELECT_REMATCH = SQL(`SELECT game_id FROM games WHERE status < ${STATUS_FINISHED} AND notice=?`).pluck()
const SQL_INSERT_REMATCH = SQL(`
	insert or ignore into games
		(owner_id, title_id, scenario, options, player_count, pace, is_private, is_random, notice)
	select
		$owner_id, title_id, scenario, options, player_count, pace, is_private, $random, $magic
	from
		games
	where
		game_id = $old_game_id
		and not exists (
			select 1 from games where notice = $magic
		)
	returning
		game_id
`).pluck()

const QUERY_LIST_PUBLIC_GAMES_OPEN = SQL(`
	select * from game_view where status=0 and not is_private and join_count > 0 and join_count < player_count
	and not exists ( select 1 from contacts where me = owner_id and you = ? and relation < 0 )
	order by mtime desc, ctime desc
	`)

const QUERY_LIST_PUBLIC_GAMES_REPLACEMENT = SQL(`
	select * from game_view where status=1 and not is_private and join_count > 0 and join_count < player_count
	and not exists ( select 1 from contacts where me = owner_id and you = ? and relation < 0 )
	order by mtime desc, ctime desc
	`)

const QUERY_LIST_PUBLIC_GAMES_ACTIVE = SQL(`
	select * from game_view where status=1 and not is_private and join_count = player_count
	order by mtime desc, ctime desc
	limit 12
	`)

const QUERY_LIST_PUBLIC_GAMES_FINISHED = SQL(`
	select * from game_view where status=2 and not is_private
	order by mtime desc, ctime desc
	limit 12
	`)

const QUERY_LIST_GAMES_OF_TITLE_OPEN = SQL(`
	select * from game_view where title_id=? and not is_private and status=0 and join_count > 0 and join_count < player_count
	and not exists ( select 1 from contacts where me = owner_id and you = ? and relation < 0 )
	order by mtime desc, ctime desc
	`)

const QUERY_LIST_GAMES_OF_TITLE_READY = SQL(`
	select * from game_view where title_id=? and not is_private and status=0 and join_count = player_count
	order by mtime desc, ctime desc
	`)

const QUERY_LIST_GAMES_OF_TITLE_REPLACEMENT = SQL(`
	select * from game_view where title_id=? and not is_private and status=1 and join_count > 0 and join_count < player_count
	and not exists ( select 1 from contacts where me = owner_id and you = ? and relation < 0 )
	order by mtime desc, ctime desc
	`)

const QUERY_LIST_GAMES_OF_TITLE_ACTIVE = SQL(`
	select * from game_view where title_id=? and not is_private and status=1 and join_count = player_count
	order by mtime desc, ctime desc
	limit 12
	`)

const QUERY_LIST_GAMES_OF_TITLE_FINISHED = SQL(`
	select * from game_view where title_id=? and not is_private and status=2
	order by mtime desc, ctime desc
	limit 12
	`)

const QUERY_NEXT_GAME_OF_USER = SQL(`
	select title_id, game_id, role
	from games
	join players using(game_id)
	where
		status = ${STATUS_ACTIVE}
		and active in (role, 'Both')
		and user_id = ?
	order by mtime
	limit 1
	`)

const QUERY_LIST_PUBLIC_GAMES_OF_USER = SQL(`
	select * from game_view
	where
		( owner_id=$user_id or game_id in ( select game_id from players where players.user_id=$user_id ) )
		and
		( status <= ${STATUS_FINISHED} )
		and
		( not is_private or status = ${STATUS_ACTIVE} )
	order by status asc, mtime desc
	`)

const QUERY_LIST_ACTIVE_GAMES_OF_USER = SQL(`
	select * from game_view
	where
		( owner_id=$user_id or game_id in ( select game_id from players where players.user_id=$user_id ) )
		and
		( status <= ${STATUS_FINISHED} )
	order by status asc, mtime desc
	`)

const QUERY_LIST_FINISHED_GAMES_OF_USER = SQL(`
	select * from game_view
	where
		( owner_id=$user_id or game_id in ( select game_id from players where players.user_id=$user_id ) )
		and
		( status = ${STATUS_FINISHED} or status = ${STATUS_ARCHIVED} )
	order by status asc, mtime desc
	`)

function check_create_game_limit(user) {
	if (user.waiting > LIMIT_WAITING_GAMES)
		return "You have too many games waiting!"
	if (SQL_COUNT_OPEN_GAMES.get(user.user_id) >= LIMIT_OPEN_GAMES)
		return "You have too many open games!"
	if (SQL_COUNT_ACTIVE_GAMES.get(user.user_id) >= LIMIT_ACTIVE_GAMES)
		return "You cannot join any more games!"
	return null
}

function check_join_game_limit(user) {
	if (user.waiting > LIMIT_WAITING_GAMES + 1)
		return "You have too many games waiting!"
	if (SQL_COUNT_ACTIVE_GAMES.get(user.user_id) >= LIMIT_ACTIVE_GAMES)
		return "You cannot join any more games!"
	return null
}

function annotate_game_info(game, user_id, unread) {
	let options = parse_game_options(game.options)
	game.human_options = format_options(game.options, options)

	game.is_unread = set_has(unread, game.game_id)

	let your_count = 0
	let your_role = null
	let time_left = Infinity

	let roles = get_game_roles(game.title_id, game.scenario, options)

	game.players = SQL_SELECT_PLAYER_VIEW.all(game.game_id)
	for (let p of game.players)
		p.index = roles.indexOf(p.role)
	game.players.sort((a, b) => a.index - b.index)

	game.player_names = ""
	for (let p of game.players) {
		if (p.user_id === user_id) {
			your_role = p.role
			your_count++
			if (p.is_active && game.is_ready && game.status < 2)
				game.your_turn = true
			if (p.is_invite)
				game.your_turn = true
		}

		if (p.is_active)
			time_left = Math.min(time_left, p.time_left)

		let link
		if (p.is_invite)
			link = `<a class="is_invite" href="/user/${p.name}">${p.name}?</a>`
		else if (p.is_active)
			link = `<a class="is_active" href="/user/${p.name}">${p.name}</a>`
		else
			link = `<a href="/user/${p.name}">${p.name}</a>`

		if (game.player_names)
			game.player_names += ", " + link
		else
			game.player_names = link

		if (game.result === p.role)
			game.result = `<a href="/user/${p.name}">${p.name}</a> (${game.result})`
	}

	if (game.result && game.result.includes(",")) {
		game.result = game.result.split(", ").map(role => {
			for (let p of game.players)
				if (p.role === role)
					return `<a href="/user/${p.name}">${p.name}</a>`
			return role
		}).join(", ")
	}

	if (game.is_ready && game.status === 1)
		game.time_left = time_left

	if (your_count > 0) {
		game.is_yours = true
		if (your_count === 1)
			game.your_role = your_role
	}

	game.ctime = human_date(game.ctime)
	game.mtime = human_date(game.mtime)
}

function annotate_games(list, user_id, unread) {
	for (let game of list)
		annotate_game_info(game, user_id, unread)
	return list
}

app.get("/profile", must_be_logged_in, function (req, res) {
	req.user.notify = SQL_SELECT_USER_NOTIFY.get(req.user.user_id)
	req.user.is_verified = SQL_SELECT_USER_VERIFIED.get(req.user.user_id)
	req.user.webhook = SQL_SELECT_WEBHOOK.get(req.user.user_id)
	res.render("profile.pug", { user: req.user })
})

app.get("/games", function (req, res) {
	res.redirect("/games/public")
})

function sort_your_turn(a, b) {
	if (a.is_opposed && b.is_opposed) {
		if (a.your_turn && !b.your_turn) return -1
		if (!a.your_turn && b.your_turn) return 1
	}
	return 0
}

app.get("/games/next", must_be_logged_in, function (req, res) {
	let next = QUERY_NEXT_GAME_OF_USER.get(req.user.user_id)
	if (next !== undefined)
		res.redirect(play_url(next.title_id, next.game_id, next.role))
	else
		res.redirect(`/games/active`)
})

app.get("/games/active", must_be_logged_in, function (req, res) {
	let games = QUERY_LIST_ACTIVE_GAMES_OF_USER.all({ user_id: req.user.user_id })
	let unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
	annotate_games(games, req.user.user_id, unread)
	games.sort(sort_your_turn)
	res.render("games_active.pug", { user: req.user, who: req.user, games })
})

app.get("/games/finished", must_be_logged_in, function (req, res) {
	let games = QUERY_LIST_FINISHED_GAMES_OF_USER.all({ user_id: req.user.user_id })
	let unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
	annotate_games(games, req.user.user_id, unread)
	res.render("games_finished.pug", { user: req.user, who: req.user, games })
})

app.get("/games/finished/:who_name", function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (who) {
		let games = QUERY_LIST_FINISHED_GAMES_OF_USER.all({ user_id: who.user_id })
		annotate_games(games, 0, null)
		res.render("games_finished.pug", { user: req.user, who: who, games: games })
	} else {
		return res.status(404).send("Invalid user name.")
	}
})

app.get("/games/public", function (req, res) {
	let user_id = 0
	let unread = null
	if (req.user) {
		user_id = req.user.user_id
		unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
	}

	let open_games = QUERY_LIST_PUBLIC_GAMES_OPEN.all(user_id)
	let replacement_games = QUERY_LIST_PUBLIC_GAMES_REPLACEMENT.all(user_id)
	let active_games = QUERY_LIST_PUBLIC_GAMES_ACTIVE.all()
	let finished_games = QUERY_LIST_PUBLIC_GAMES_FINISHED.all()

	annotate_games(open_games, user_id, unread)
	annotate_games(replacement_games, user_id, unread)
	annotate_games(active_games, user_id, unread)
	annotate_games(finished_games, user_id, unread)

	res.render("games_public.pug", {
		user: req.user,
		open_games,
		replacement_games,
		active_games,
		finished_games,
	})
})

function get_title_page(req, res, title_id) {
	let title = TITLE_TABLE[title_id]
	if (!title)
		return res.status(404).send("Invalid title.")
	let unread = null
	if (req.user)
		unread = SQL_SELECT_UNREAD_CHAT_GAMES.all(req.user.user_id)
	let user_id = req.user ? req.user.user_id : 0

	let open_games = QUERY_LIST_GAMES_OF_TITLE_OPEN.all(title_id, user_id)
	let ready_games = QUERY_LIST_GAMES_OF_TITLE_READY.all(title_id)
	let replacement_games = QUERY_LIST_GAMES_OF_TITLE_REPLACEMENT.all(title_id, user_id)
	let active_games = QUERY_LIST_GAMES_OF_TITLE_ACTIVE.all(title_id)
	let finished_games = QUERY_LIST_GAMES_OF_TITLE_FINISHED.all(title_id)

	annotate_games(open_games, user_id, unread)
	annotate_games(ready_games, user_id, unread)
	annotate_games(replacement_games, user_id, unread)
	annotate_games(active_games, user_id, unread)
	annotate_games(finished_games, user_id, unread)

	res.render("info.pug", {
		user: req.user,
		title: title,
		open_games,
		ready_games,
		replacement_games,
		active_games,
		finished_games,
	})
}

for (let title of TITLE_LIST)
	app.get("/" + title.title_id, (req, res) => get_title_page(req, res, title.title_id))

app.get("/create/:title_id", function (req, res) {
	let title_id = req.params.title_id
	let title = TITLE_TABLE[title_id]
	if (!title)
		return res.status(404).send("Invalid title.")
	res.render("create.pug", {
		user: req.user,
		title: title,
		limit: req.user ? check_create_game_limit(req.user) : null,
		scenarios: RULES[title_id].scenarios,
	})
})

function options_json_replacer(key, value) {
	if (key === "scenario") return undefined
	if (key === "notice") return undefined
	if (key === "pace") return undefined
	if (key === "is_random") return undefined
	if (key === "is_private") return undefined
	if (value === "true") return true
	if (value === "false") return false
	if (value === "")
		return undefined
	if (typeof value === "string" && String(parseInt(value)) === value)
		return parseInt(value)
	return value
}

function is_random_scenario(title_id, scenario) {
	if (RULES[title_id].is_random_scenario)
		return RULES[title_id].is_random_scenario(scenario)
	return false
}

function select_random_scenario(title_id, scenario, seed) {
	if (RULES[title_id].select_random_scenario)
		return RULES[title_id].select_random_scenario(scenario, seed)
	return scenario
}

app.post("/create/:title_id", must_be_logged_in, function (req, res) {
	let title_id = req.params.title_id
	let priv = req.body.is_private === "true" ? 1 : 0
	let rand = req.body.is_random === "true" ? 1 : 0
	let pace = req.body.pace | 0
	let user_id = req.user.user_id
	let scenario = req.body.scenario
	let options = JSON.stringify(req.body, options_json_replacer)
	let notice = req.body.notice

	let limit = check_create_game_limit(req.user)
	if (limit)
		return res.send(limit)

	if (!(title_id in RULES))
		return res.send("Invalid title.")

	if (is_random_scenario(title_id, scenario))
		rand = 1

	let player_count = get_game_roles(title_id, scenario, parse_game_options(options)).length

	let game_id = SQL_INSERT_GAME.get(user_id, title_id, scenario, options, player_count, pace, priv, rand, notice, 0)
	res.redirect("/join/" + game_id)
})

app.get("/delete/:game_id", must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id
	let title_id = SQL_SELECT_GAME_TITLE.get(game_id)
	let info = SQL_DELETE_GAME_BY_OWNER.run(game_id, req.user.user_id)
	if (info.changes === 0)
		return res.send("Not authorized to delete that game ID.")
	if (info.changes === 1)
		update_join_clients_deleted(game_id)
	res.redirect("/" + title_id)
})

function insert_rematch_players(old_game_id, new_game_id, req_user_id, order) {
	let game = SQL_SELECT_GAME.get(old_game_id)
	let players = SQL_SELECT_PLAYERS.all(old_game_id)
	let roles = get_game_roles(game.title_id, game.scenario, parse_game_options(game.options))
	let n = roles.length

	if (players.length !== n)
		throw new Error("missing players")

	switch (order) {
	default:
	case "swap":
		players.sort((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role))
		for (let i = 0; i < n; ++i)
			players[i].role = roles[(i+1) % n]
		break
	case "keep":
		// do nothing
		break
	case "shuffle":
		// unused for now - random but known
		shuffle(players)
		for (let i = 0; i < n; ++i)
			players[i].role = roles[i]
		break
	case "random":
		for (let i = 0; i < n; ++i)
			players[i].role = "Random " + (i+1)
		break
	}

	for (let p of players)
		SQL_INSERT_PLAYER_ROLE.run(new_game_id, p.role, p.user_id, p.user_id !== req_user_id ? 1 : 0)
}

app.get("/rematch/:old_game_id", must_be_logged_in, function (req, res) {
	let old_game_id = req.params.old_game_id | 0
	let magic = "\u{1F503} " + old_game_id
	let new_game_id = SQL_SELECT_REMATCH.get(magic)
	if (new_game_id)
		return res.redirect("/join/" + new_game_id)

	let game = SQL_SELECT_GAME.get(old_game_id)
	let players = SQL_SELECT_PLAYERS_WITH_NAME.all(old_game_id)
	res.render("rematch.pug", {
		user: req.user,
		title: TITLE_TABLE[game.title_id],
		game,
		players,
	})
})

app.post("/rematch/:old_game_id", must_be_logged_in, function (req, res) {
	let old_game_id = req.params.old_game_id | 0
	let magic = "\u{1F503} " + old_game_id
	let new_game_id = 0
	let order = req.body.order

	SQL_BEGIN.run()
	try {
		new_game_id = SQL_INSERT_REMATCH.get({
			owner_id: req.user.user_id,
			random: order === "random" ? 1 : 0,
			old_game_id,
			magic,
		})
		if (new_game_id)
			insert_rematch_players(old_game_id, new_game_id, req.user.user_id, order)
		else
			new_game_id = SQL_SELECT_REMATCH.get(magic)
		SQL_COMMIT.run()
	} catch (err) {
		return res.send(err.toString())
	} finally {
		if (db.inTransaction)
			SQL_ROLLBACK.run()
	}

	return res.redirect("/join/" + new_game_id)
})

function update_join_clients_deleted(game_id) {
	let list = join_clients[game_id]
	if (list && list.length > 0) {
		for (let { res } of list) {
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
		for (let { res } of list) {
			res.write("retry: 15000\n")
			res.write("event: game\n")
			res.write("data: " + JSON.stringify(game) + "\n\n")
		}
	}
}

function update_join_clients_players(game_id) {
	let list = join_clients[game_id]
	if (list && list.length > 0) {
		let players = SQL_SELECT_PLAYER_VIEW.all(game_id)
		let ready = is_game_ready(list.player_count, players)
		for (let { res } of list) {
			res.write("retry: 15000\n")
			res.write("event: players\n")
			res.write("data: " + JSON.stringify(players) + "\n\n")
			res.write("event: ready\n")
			res.write("data: " + ready + "\n\n")
		}
	}
}

app.get("/join/:game_id", function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME_VIEW.get(game_id)
	if (!game)
		return res.status(404).send("Invalid game ID.")

	let options = parse_game_options(game.options)
	game.human_options = format_options(game.options, options)

	let roles = get_game_roles(game.title_id, game.scenario, options)
	let players = SQL_SELECT_PLAYER_VIEW.all(game_id)

	let whitelist = null
	let blacklist = null
	let friends = null
	let rewind = 0

	if (req.user) {
		whitelist = SQL_SELECT_CONTACT_WHITELIST.all(req.user.user_id)
		blacklist = SQL_SELECT_CONTACT_BLACKLIST.all(req.user.user_id)
		if (game.owner_id === req.user.user_id)
			friends = SQL_SELECT_CONTACT_FRIEND_NAMES.all(req.user.user_id)
		if (req.user.user_id === 1)
			rewind = SQL_SELECT_REWIND.all(game_id)
	}

	let ready = (game.status === STATUS_OPEN) && is_game_ready(game.player_count, players)
	game.ctime = human_date(game.ctime)
	game.mtime = human_date(game.mtime)
	res.render("join.pug", {
		user: req.user,
		game,
		roles,
		players,
		ready,
		whitelist,
		blacklist,
		friends,
		limit: req.user ? check_join_game_limit(req.user) : null,
		rewind
	})
})

app.get("/join-events/:game_id", must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME_VIEW.get(game_id)
	let players = SQL_SELECT_PLAYER_VIEW.all(game_id)

	res.setHeader("Content-Type", "text/event-stream")
	res.setHeader("Connection", "keep-alive")
	res.setHeader("X-Accel-Buffering", "no")

	if (!game) {
		return res.send("event: deleted\ndata: The game doesn't exist.\n\n")
	}
	if (!(game_id in join_clients)) {
		join_clients[game_id] = []
		join_clients[game_id].player_count = game.player_count
	}
	join_clients[game_id].push({ res: res, user_id: req.user.user_id })

	res.on("close", () => {
		let list = join_clients[game_id]
		if (list) {
			let i = list.findIndex(item => item.res === res)
			if (i >= 0)
				list.splice(i, 1)
		}
	})

	res.write("retry: 15000\n\n")
	res.write("event: game\n")
	res.write("data: " + JSON.stringify(game) + "\n\n")
	res.write("event: players\n")
	res.write("data: " + JSON.stringify(players) + "\n\n")
})

function do_join(res, game_id, role, user_id, user_name, is_invite) {
	let game = SQL_SELECT_GAME.get(game_id)
	let roles = get_game_roles(game.title_id, game.scenario, parse_game_options(game.options))
	if (game.is_random && game.status === STATUS_OPEN) {
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

		// send chat message about player joining a game in progress
		if (game.status > 0 && user_name && !is_invite) {
			send_chat_message(game_id, null, null, `${user_name} joined as ${role}.`)
		}
	} else {
		if (is_invite)
			res.send("Could not invite.")
		else
			res.send("Could not join game.")
	}
}

app.post("/join/:game_id/:role", must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	let limit = check_join_game_limit(req.user)
	if (limit)
		return res.send(limit)
	do_join(res, game_id, role, req.user.user_id, req.user.name, 0)
})

app.post("/invite/:game_id/:role/:user", must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	let user_id = SQL_SELECT_USER_ID.get(req.params.user)
	if (user_id)
		do_join(res, game_id, role, user_id, null, 1)
	else
		res.send("User not found.")
})

app.post("/accept/:game_id/:role", must_be_logged_in, function (req, res) {
	// TODO: check join game limit if inviting self...
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME.get(game_id)
	let role = req.params.role
	let info = SQL_UPDATE_PLAYER_ACCEPT.run(game_id, role, req.user.user_id)
	if (info.changes === 1) {
		update_join_clients_players(game_id)
		res.send("SUCCESS")

		// send chat message about player joining a game in progress
		if (game.status > 0)
			send_chat_message(game_id, null, null, `${req.user.name} joined as ${role}.`)
	} else {
		res.send("Could not accept invite.")
	}
})

app.post("/part/:game_id/:role", must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	let user_name = SQL_SELECT_PLAYER_NAME.get(game_id, role)
	let game = SQL_SELECT_GAME.get(game_id)
	SQL_DELETE_PLAYER_ROLE.run(game_id, role)
	update_join_clients_players(game_id)
	res.send("SUCCESS")

	// send chat message about player leaving a game in progress
	if (game.status > 0) {
		if (user_name !== req.user.name)
			send_chat_message(game_id, null, null, `${user_name} (${role}) left the game (kicked by ${req.user.name}).`)
		else
			send_chat_message(game_id, null, null, `${user_name} (${role}) left the game.`)
	}
})

function assign_random_roles(game, options, players) {
	function pick_random_item(list) {
		let k = crypto.randomInt(list.length)
		let r = list[k]
		list.splice(k, 1)
		return r
	}
	let roles = get_game_roles(game.title_id, game.scenario, options).slice()
	for (let p of players) {
		let old_role = p.role
		p.role = pick_random_item(roles)
		console.log("ASSIGN ROLE", "(" + p.name + ")", old_role, "->", p.role)
		SQL_UPDATE_PLAYER_ROLE.run(p.role, game.game_id, old_role, p.user_id)
	}
}

app.post("/start/:game_id", must_be_logged_in, function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME.get(game_id)
	if (game.owner_id !== req.user.user_id)
		return res.send("Not authorized to start that game ID.")
	if (game.status !== STATUS_OPEN)
		return res.send("The game is already started.")
	if (game.join_count !== game.player_count)
		return res.send("The game does not have enough players.")

	try {
		start_game(game)
	} catch (err) {
		console.log(err)
		return res.send(err.toString())
	}

	res.send("SUCCESS")
})

function start_game(game) {
	let options = parse_game_options(game.options)
	let seed = random_seed()
	let state = null

	console.log("STARTING GAME", game.game_id, game.title_id, game.scenario)

	SQL_BEGIN.run()
	try {
		if (is_random_scenario(game.title_id, game.scenario)) {
			game.scenario = select_random_scenario(game.title_id, game.scenario, seed)
			SQL_UPDATE_GAME_SCENARIO.run(game.scenario, game.game_id)
		}

		if (game.is_random)
			assign_random_roles(game, options, SQL_SELECT_PLAYERS.all(game.game_id))

		state = RULES[game.title_id].setup(seed, game.scenario, options)

		SQL_START_GAME.run(state.active, game.game_id)
		let replay_id = put_replay(game.game_id, null, ".setup", [ seed, game.scenario, options ])
		put_snap(game.game_id, replay_id, state)
		SQL_INSERT_GAME_STATE.run(game.game_id, JSON.stringify(state))

		SQL_COMMIT.run()
	} finally {
		if (db.inTransaction)
			SQL_ROLLBACK.run()
	}

	update_join_clients_players(game.game_id)
	update_join_clients_game(game.game_id)

	send_game_started_notification_to_offline_users(game.game_id)
	send_your_turn_notification_to_offline_users(game.game_id, null, state.active)
}

app.get("/play/:game_id/:role", function (req, res) {
	let game_id = req.params.game_id | 0
	let role = req.params.role
	let title = SQL_SELECT_GAME_TITLE.get(game_id)
	if (!title)
		return res.status(404).send("Invalid game ID.")
	res.redirect(play_url(title, game_id, role))
})

app.get("/play/:game_id", function (req, res) {
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

app.get("/api/replay/:game_id", function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME.get(game_id)
	if (!game)
		return res.status(404).send("Invalid game ID.")
	if (game.status < STATUS_FINISHED && (!req.user || req.user.user_id !== 1))
		return res.status(401).send("Not authorized to debug.")
	return res.type("application/json").send(SQL_SELECT_REPLAY.get(game_id))
})

app.get("/api/export/:game_id", function (req, res) {
	let game_id = req.params.game_id | 0
	let game = SQL_SELECT_GAME.get(game_id)
	if (!game)
		return res.status(404).send("Invalid game ID.")
	if (game.status < STATUS_FINISHED && (!req.user || req.user.user_id !== 1))
		return res.status(401).send("Not authorized to debug.")
	return res.type("application/json").send(SQL_SELECT_EXPORT.get(game_id))
})

app.get("/admin/rewind/:game_id/:snap_id", must_be_administrator, function (req, res) {
	let game_id = req.params.game_id | 0
	let snap_id = req.params.snap_id | 0
	let snap = SQL_SELECT_SNAP.get(game_id, snap_id)
	let game_state = JSON.parse(SQL_SELECT_GAME_STATE.get(game_id))
	let snap_state = JSON.parse(snap.state)
	snap_state.undo = []
	snap_state.log = game_state.log.slice(0, snap_state.log)

	SQL_BEGIN.run()
	try {
		SQL_DELETE_GAME_SNAP.run(game_id, snap_id)
		SQL_DELETE_GAME_REPLAY.run(game_id, snap.replay_id)
		SQL_INSERT_GAME_STATE.run(game_id, JSON.stringify(snap_state))

		SQL_REWIND_GAME.run(snap_id - 1, snap_state.active, game_id)

		update_join_clients_game(game_id)
		if (game_clients[game_id])
			for (let other of game_clients[game_id])
				send_state(other, snap_state)

		SQL_COMMIT.run()
	} catch (err) {
		return res.send(err.toString())
	} finally {
		if (db.inTransaction)
			SQL_ROLLBACK.run()
	}
	res.redirect("/join/" + game_id)
})

const SQL_CLONE_1 = SQL(`
	insert into games(status,owner_id,title_id,scenario,options,player_count,active,moves,notice)
	select 1,$owner_id,title_id,scenario,options,player_count,active,moves,'CLONE ' || cast($old_game_id as integer)
	from games where game_id=$old_game_id
	returning game_id
`).pluck()

const SQL_CLONE_2 = [
	SQL(`insert into players(game_id,role,user_id) select $new_game_id,role,user_id from players where game_id=$old_game_id`),
	SQL(`insert into game_state(game_id,state) select $new_game_id,state from game_state where game_id=$old_game_id`),
	SQL(`insert into game_replay(game_id,replay_id,role,action,arguments) select $new_game_id,replay_id,role,action,arguments from game_replay where game_id=$old_game_id`),
	SQL(`insert into game_snap(game_id,snap_id,replay_id,state) select $new_game_id,snap_id,replay_id,state from game_snap where game_id=$old_game_id`),
]

app.get("/admin/clone/:game_id", must_be_administrator, function (req, res) {
	let old_game_id = req.params.game_id | 0
	let new_game_id = 0

	SQL_BEGIN.run()
	try {
		new_game_id = SQL_CLONE_1.get({ owner_id: req.user.user_id, old_game_id })
		if (new_game_id) {
			for (let stmt of SQL_CLONE_2)
				stmt.run({ old_game_id, new_game_id })
		}
		SQL_COMMIT.run()
	} catch (err) {
		return res.send(err.toString())
	} finally {
		if (db.inTransaction)
			SQL_ROLLBACK.run()
	}
	res.redirect("/join/" + new_game_id)
})

/*
 * ELO RATINGS
 *
 * TODO:
 * use role ratings in asymmetric games based on title_id, scenario, player_count
 * add role_rating to Ev and update role_rating with low K-value
 */

const SQL_SELECT_RATING_GAME = SQL("select * from rated_games_view where game_id=?")
const SQL_SELECT_RATING_PLAYERS = SQL("select * from player_rating_view where game_id=?")
const SQL_INSERT_RATING = SQL("insert or replace into ratings (title_id,user_id,rating,count,last) values (?,?,?,?,?)")

function is_winner(role, result) {
	// NOTE: uses substring matching for multiple winners instead of splitting result on comma.
	return (result === "Draw" || result === role || result.includes(role))
}

function elo_k(a) {
	return a.count < 10 ? 60 : 30
}

function elo_ev(a, players) {
	// https://arxiv.org/pdf/2104.05422.pdf
	// original: 1 / ( 1 + 10**((Rb-Ra)/400) )
	// unoptimized: 10**(Ra/400) / ( 10**(Ra/400) + 10**(Rb/400) )
	// generalized: 10**(Ra/400) / ( 10**(Ra/400) + 10**(Rb/400) + 10**(Rc/400) + ... )
	let sum = 0
	for (let p of players)
		sum += 10**(p.rating/400)
	return 10**(a.rating/400) / sum
}

function elo_change(a, players, score) {
	return Math.round( elo_k(a) * ( score - elo_ev(a, players) ) )
}

function update_elo_ratings(game_id) {
	let game = SQL_SELECT_RATING_GAME.get(game_id)
	if (!game)
		return

	if (!game.result || game.result === "None")
		return

	let players = SQL_SELECT_RATING_PLAYERS.all(game_id)

	let winners = 0
	for (let p of players)
		if (is_winner(p.role, game.result))
			winners ++

	if (winners === 0)
		return

	for (let p of players)
		if (is_winner(p.role, game.result))
			p.change = elo_change(p, players, 1 / winners)
		else
			p.change = elo_change(p, players, 0)

	for (let p of players)
		SQL_INSERT_RATING.run(game.title_id, p.user_id, p.rating + p.change, p.count + 1, game.mtime)
}

/*
 * MAIL NOTIFICATIONS
 */

const MAIL_FROM = process.env.MAIL_FROM || "user@localhost"
const MAIL_FOOTER = "\n--\nYou can unsubscribe from notifications on your profile page:\n" + SITE_URL + "/profile\n"

function mail_callback(err) {
	if (err)
		console.log("MAIL ERROR", err)
}

function mail_addr(user) {
	return user.name + " <" + user.mail + ">"
}

function mail_password_reset_token(user, token) {
	if (mailer) {
		let subject = "Password reset request"
		let body =
			"Your password reset token is: " + token + "\n\n" +
			SITE_URL + "/reset-password/" + user.mail + "/" + token + "\n"
		console.log("SENT MAIL:", mail_addr(user), subject)
		mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
	}
}

function mail_verification_token(user, token) {
	if (mailer) {
		let subject = "Verify mail address"
		let body =
			"Your mail verification token is: " + token + "\n\n" +
			SITE_URL + "/verify-mail/" + token + "\n"
		console.log("SENT MAIL:", mail_addr(user), subject)
		mailer.sendMail({ from: MAIL_FROM, to: mail_addr(user), subject: subject, text: body }, mail_callback)
	}
}

/*
 * WEBHOOK NOTIFICATIONS
 */

const webhook_json_options = {
	"Content-Type": "application/json"
}

const webhook_text_options = {
	"Content-Type": "text/plain"
}

function on_webhook_success(user_id) {
	SQL_UPDATE_WEBHOOK_SUCCESS.run(user_id)
}

function on_webhook_error(user_id, error) {
	console.log("WEBHOOK FAIL", user_id, error)
	SQL_UPDATE_WEBHOOK_ERROR.run(error, user_id)
}

async function send_webhook(user_id, webhook, message, retry=2) {
	if (!WEBHOOKS)
		return
	try {
		const text = webhook.prefix + " " + message
		const data = webhook.format ? JSON.stringify({ [webhook.format]: text }) : text
		const headers = webhook.format ? webhook_json_options : webhook_text_options
		const res = await fetch(webhook.url, {
			method: "POST",
			signal: AbortSignal.timeout(6000),
			headers: headers,
			body: data
		})
		if (res.ok)
			on_webhook_success(user_id)
		else {
			if (retry > 0)
				retry_webhook(user_id, webhook, message, retry - 1)
			else
				on_webhook_error(user_id, res.status + ": " + res.statusText)
		}
	} catch (err) {
		if (retry > 0)
			retry_webhook(user_id, webhook, message, retry - 1)
		else
			on_webhook_error(user_id, err.message)
	}
}

function retry_webhook(user_id, webhook, message, retry) {
	console.log("WEBHOOK RETRY", user_id)
	setTimeout(() => send_webhook(user_id, webhook, message, retry), 3000 + Math.random() * 7000)
}

/*
 * NOTIFICATIONS
 */

const SQL_SELECT_NOTIFIED = SQL("SELECT julianday() < julianday(time, ?) FROM last_notified WHERE game_id=? AND user_id=?").pluck()
const SQL_INSERT_NOTIFIED = SQL("INSERT OR REPLACE INTO last_notified (game_id,user_id,time) VALUES (?,?,datetime())")
const SQL_DELETE_NOTIFIED = SQL("DELETE FROM last_notified WHERE game_id=? AND user_id=?")

function delete_last_notified(user, game_id) {
	SQL_DELETE_NOTIFIED.run(game_id, user.user_id)
}

function insert_last_notified(user, game_id) {
	SQL_INSERT_NOTIFIED.run(game_id, user.user_id)
}

function should_send_reminder(user, game_id) {
	if (!SQL_SELECT_NOTIFIED.get("+23 hours", game_id, user.user_id))
		return true
	return false
}

function game_play_link(game_id, title_id, user) {
	return SITE_URL + play_url(title_id, game_id, user.role)
}

function game_join_link(game_id) {
	return SITE_URL + "/join/" + game_id
}

function message_link(msg_id) {
	return SITE_URL + "/message/read/" + msg_id
}

function send_notification(user, link, message) {
	if (WEBHOOKS) {
		let webhook = SQL_SELECT_WEBHOOK_SEND.get(user.user_id)
		if (webhook) {
			console.log("WEBHOOK", user.name, link, message)
			send_webhook(user.user_id, webhook, link + " - " + message)
		}
	}
	if (mailer && user.notify) {
		console.log("MAIL", mail_addr(user), link, message)
		mailer.sendMail(
			{
				from: MAIL_FROM,
				to: mail_addr(user),
				subject: message,
				text: link + "\n" + MAIL_FOOTER,
			},
			mail_callback
		)
	}
}

function send_join_notification(user, game_id, message) {
	let title_id = SQL_SELECT_GAME_TITLE.get(game_id)
	let title_name = TITLE_NAME[title_id]
	send_notification(user, game_join_link(game_id), `${title_name} #${game_id} - ${message}`)
}

function send_play_notification(user, game_id, message) {
	let title_id = SQL_SELECT_GAME_TITLE.get(game_id)
	let title_name = TITLE_NAME[title_id]
	send_notification(user, game_play_link(game_id, title_id, user), `${title_name} #${game_id} (${user.role}) - ${message}`)
}

const QUERY_LIST_YOUR_TURN = SQL("SELECT * FROM your_turn_reminder")
const QUERY_LIST_INVITES = SQL("SELECT * FROM invite_reminder")

function send_chat_activity_notification(game_id, p) {
	send_play_notification(p, game_id, "Chat activity")
}

function send_your_turn_notification_to_offline_users(game_id, old_active, active) {
	// Only send notifications when the active player changes.
	if (old_active === active)
		return

	let players = SQL_SELECT_PLAYERS.all(game_id)
	for (let p of players) {
		let p_was_active = old_active === p.role || old_active === "Both"
		let p_is_active = active === p.role || active === "Both"
		if (!p_was_active && p_is_active) {
			if (!is_player_online(game_id, p.user_id)) {
				insert_last_notified(p, game_id)
				send_play_notification(p, game_id, "Your turn")
			} else {
				delete_last_notified(p, game_id)
			}
		} else {
			delete_last_notified(p, game_id)
		}
	}
}

function send_game_started_notification_to_offline_users(game_id) {
	let players = SQL_SELECT_PLAYERS.all(game_id)
	for (let p of players) {
		if (!is_player_online(game_id, p.user_id))
			send_play_notification(p, game_id, "Started")
		delete_last_notified(p, game_id)
	}
}

function send_game_finished_notification_to_offline_users(game_id, result) {
	let players = SQL_SELECT_PLAYERS.all(game_id)
	for (let p of players) {
		if (!is_player_online(game_id, p.user_id))
			send_play_notification(p, game_id, "Finished (" + result + ")")
		delete_last_notified(p, game_id)
	}
}

function notify_your_turn_reminder() {
	for (let item of QUERY_LIST_YOUR_TURN.all()) {
		if (should_send_reminder(item, item.game_id)) {
			insert_last_notified(item, item.game_id)
			send_play_notification(item, item.game_id, "Your turn")
		}
	}
}

function notify_invited_reminder() {
	for (let item of QUERY_LIST_INVITES.all()) {
		if (should_send_reminder(item, item.game_id)) {
			insert_last_notified(item, item.game_id)
			send_join_notification(item, item.game_id, "You have an invitation")
		}
	}
}

// Send "you've been invited" notifications every 5 minutes.
setInterval(notify_invited_reminder, 5 * 60 * 1000)

// Check and send daily your turn reminders every 17 minutes.
setInterval(notify_your_turn_reminder, 17 * 60 * 1000)

const QUERY_READY_TO_START = SQL(`
	select
		*
	from
		games
	where
		status = 0
		and not is_match
		and is_ready
		and julianday(mtime) < julianday('now', '-30 seconds')
`)

function ready_game_ticker() {
	for (let game of QUERY_READY_TO_START.all()) {
		try {
			start_game(game)
		} catch (err) {
			console.log(err)
		}
	}
}

setInterval(ready_game_ticker, 47 * 1000)

const QUERY_PURGE_OPEN_GAMES = SQL(`
	delete from
		games
	where
		status = 0
		and not is_match
		and not is_ready
		and julianday(ctime) < julianday('now', '-10 days')
`)

const QUERY_PURGE_ACTIVE_GAMES = SQL(`
	delete from
		games
	where
		status = 1
		and not is_match
		and not is_ready
		and julianday(mtime) < julianday('now', '-10 days')
`)

// don't keep solo games in archive
// don't keep games abandoned in the first turns
const QUERY_PURGE_FINISHED_GAMES = SQL(`
	delete from
		games
	where
		status > 1
		and ( not is_opposed or moves < player_count * 3 )
		and julianday(mtime) < julianday('now', '-10 days')
`)

const QUERY_PURGE_MESSAGES = SQL(`
	delete from
		messages
	where
		is_deleted_from_inbox and is_deleted_from_outbox
`)

function purge_game_ticker() {
	QUERY_PURGE_OPEN_GAMES.run()
	QUERY_PURGE_ACTIVE_GAMES.run()
	QUERY_PURGE_FINISHED_GAMES.run()
	QUERY_PURGE_MESSAGES.run()
}

// Purge abandoned games every 31 minutes.
setInterval(purge_game_ticker, 31 * 60 * 1000)
setTimeout(purge_game_ticker, 89 * 1000)

/*
 * TIME CONTROL
 */

const QUERY_LIST_TIME_CONTROL = SQL("select * from time_control_view join users using(user_id) where time_left < 0")

function time_control_ticker() {
	for (let item of QUERY_LIST_TIME_CONTROL.all()) {
		if (item.is_opposed) {
			console.log("TIMED OUT GAME:", item.game_id, item.name, item.time_left)
			do_resign(item.game_id, item.role, "timed out")
		} else {
			SQL_DELETE_GAME.run(item.game_id)
		}
	}
}

// Run time control checks every 13 minutes.
setInterval(time_control_ticker, 13 * 60 * 1000)
setTimeout(time_control_ticker, 13 * 1000)

/*
 * GAME SERVER
 */

function is_player_online(game_id, user_id) {
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
	socket.send(JSON.stringify([ cmd, arg ]))
}

function send_state(socket, state) {
	try {
		let view = RULES[socket.title_id].view(state, socket.role)
		if (socket.seen < view.log.length)
			view.log_start = socket.seen
		else
			view.log_start = view.log.length
		socket.seen = view.log.length
		view.log = view.log.slice(view.log_start)
		if (state.state === "game_over")
			view.game_over = 1
		let this_view = JSON.stringify(view)
		if (view.actions || socket.last_view !== this_view) {
			socket.send('["state",' + this_view + "," + game_cookies[socket.game_id] + "]")
			socket.last_view = this_view
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function get_game_state(game_id) {
	let game_state = SQL_SELECT_GAME_STATE.get(game_id)
	if (!game_state)
		throw new Error("No game with that ID")
	return JSON.parse(game_state)
}

function sync_client_state(game_id) {
	for (let socket of game_clients[game_id])
		send_state(socket, get_game_state(socket.game_id))
}

function sync_client_state_for_title(title_id) {
	for (let game_id in game_clients)
		for (let socket of game_clients[game_id])
			if (socket.title_id === title_id)
				send_state(socket, get_game_state(socket.game_id))
}

function snap_from_state(state) {
	// return JSON of game state without undo and with log replaced by log length
	let save_undo = state.undo
	let save_log = state.log
	state.undo = undefined
	state.log = save_log.length
	let snap = JSON.stringify(state)
	state.undo = save_undo
	state.log = save_log
	return snap
}

function put_replay(game_id, role, action, args) {
	if (args !== undefined && args !== null && typeof args !== "number")
		args = JSON.stringify(args)
	return SQL_INSERT_REPLAY.get(game_id, game_id, role, action, args)
}

function put_snap(game_id, replay_id, state) {
	let snap_id = SQL_INSERT_SNAP.get(game_id, game_id, replay_id, snap_from_state(state))
	if (game_clients[game_id])
		for (let other of game_clients[game_id])
			send_message(other, "snapsize", snap_id)
}

function put_game_state(game_id, state, old_active, current_role) {
	// TODO: separate state, undo, and log entries (and reuse "snap" json stringifaction?)

	SQL_INSERT_GAME_STATE.run(game_id, JSON.stringify(state))

	if (state.active !== old_active) {
		SQL_UPDATE_GAME_ACTIVE.run(state.active, game_id)

		// add time for the player who took the current action
		SQL_UPDATE_PLAYERS_ADD_TIME.run(game_id, current_role)
	}

	if (state.state === "game_over") {
		SQL_FINISH_GAME.run(state.result, game_id)
		if (state.result && state.result !== "None")
			update_elo_ratings(game_id)
	}
}

function put_new_state(game_id, state, old_active, role, action, args) {
	SQL_BEGIN.run()
	try {
		let replay_id = put_replay(game_id, role, action, args)

		if (state.active !== old_active)
			put_snap(game_id, replay_id, state)

		put_game_state(game_id, state, old_active, role)

		update_join_clients_game(game_id)
		if (game_clients[game_id])
			for (let other of game_clients[game_id])
				send_state(other, state)

		if (state.state === "game_over")
			send_game_finished_notification_to_offline_users(game_id, state.result)
		else
			send_your_turn_notification_to_offline_users(game_id, old_active, state.active)

		SQL_COMMIT.run()
	} finally {
		if (db.inTransaction)
			SQL_ROLLBACK.run()
	}
}

function on_action(socket, action, args, cookie) {
	if (args !== null)
		SLOG(socket, "ACTION", action, JSON.stringify(args))
	else
		SLOG(socket, "ACTION", action)

	if (game_cookies[socket.game_id] !== cookie) {
		send_state(socket, get_game_state(socket.game_id))
		send_message(socket, "warning", "Synchronization error!")
		return
	}

	try {
		let state = get_game_state(socket.game_id)
		let old_active = state.active

		// Don't update cookie during simultaneous turns, as it results
		// in many in-flight collisions.
		if (old_active !== "Both")
			game_cookies[socket.game_id] ++

		state = RULES[socket.title_id].action(state, socket.role, action, args)
		put_new_state(socket.game_id, state, old_active, socket.role, action, args)
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function on_resign(socket) {
	SLOG(socket, "RESIGN")
	try {
		do_resign(socket.game_id, socket.role, "resigned")
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function do_resign(game_id, role, how) {
	let game = SQL_SELECT_GAME_VIEW.get(game_id)
	let state = get_game_state(game_id)
	let old_active = state.active

	let result = "None"

	let roles = get_game_roles(game.title_id, game.scenario, parse_game_options(game.options))
	if (game.player_count === 2) {
		for (let r of roles)
			if (r !== role)
				result = r
	} else {
		result = roles.filter(r => r !== role).join(", ")
	}

	state.state = "game_over"
	state.active = "None"
	state.result = result
	state.victory = role + " " + how + "."
	state.log.push("")
	state.log.push(state.victory)

	put_new_state(game_id, state, old_active, role, ".resign", null)
}

function on_restore(socket, state_text) {
	if (!DEBUG)
		send_message(socket, "error", "Debugging is not enabled on this server.")
	SLOG(socket, "RESTORE")
	try {
		let state = JSON.parse(state_text)

		// reseed!
		state.seed = random_seed()

		// resend full log!
		for (let other of game_clients[socket.game_id])
			other.seen = 0

		put_new_state(socket.game_id, state, null, null, "$restore", state)
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function on_save(socket) {
	if (!DEBUG)
		send_message(socket, "error", "Debugging is not enabled on this server.")
	SLOG(socket, "SAVE")
	try {
		let game_state = SQL_SELECT_GAME_STATE.get(socket.game_id)
		if (!game_state)
			return send_message(socket, "error", "No game with that ID.")
		send_message(socket, "save", game_state)
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function on_query(socket, q, params) {
	SLOG(socket, "QUERY", q, JSON.stringify(params))
	try {
		if (RULES[socket.title_id].query) {
			let state = get_game_state(socket.game_id)
			let reply = RULES[socket.title_id].query(state, socket.role, q, params)
			send_message(socket, "reply", [ q, reply ])
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function on_query_snap(socket, snap_id, q, params) {
	SLOG(socket, "QUERYSNAP", snap_id, JSON.stringify(params))
	try {
		if (RULES[socket.title_id].query) {
			let state = JSON.parse(SQL_SELECT_SNAP_STATE.get(socket.game_id, snap_id))
			let reply = RULES[socket.title_id].query(state, socket.role, q, params)
			send_message(socket, "reply", [ q, reply ])
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function on_getnote(socket) {
	try {
		let note = SQL_SELECT_GAME_NOTE.get(socket.game_id, socket.role)
		if (note) {
			SLOG(socket, "GETNOTE", note.length)
			send_message(socket, "note", note)
		} else {
			SLOG(socket, "GETNOTE null")
			send_message(socket, "note", "")
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
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
		return send_message(socket, "error", err.toString())
	}
}

function on_getchat(socket, seen) {
	try {
		let chat = SQL_SELECT_GAME_CHAT.all(socket.game_id, seen)
		if (chat.length > 0)
			SLOG(socket, "GETCHAT", seen, chat.length)
		for (let i = 0; i < chat.length; ++i)
			send_message(socket, "chat", chat[i])
		SQL_DELETE_UNREAD_CHAT.run(socket.user.user_id, socket.game_id)
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function on_chat(socket, message) {
	message = message.substring(0, 4000)
	try {
		SLOG(socket, "CHAT")
		send_chat_message(socket.game_id, socket.user.user_id, socket.user.name, message)
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function send_chat_message(game_id, from_id, from_name, message) {
	SQL_INSERT_GAME_CHAT.run(game_id, game_id, from_id, message)

	let players = SQL_SELECT_PLAYERS.all(game_id)
	for (let p of players) {
		let unread = SQL_SELECT_UNREAD_CHAT.get(p.user_id, game_id)
		if (!unread) {
			SQL_INSERT_UNREAD_CHAT.run(p.user_id, game_id)
			if (!is_player_online(game_id, p.user_id))
				send_chat_activity_notification(game_id, p)
		}
	}

	if (game_clients[game_id]) {
		for (let other of game_clients[game_id])
			if (other.role !== "Observer")
				send_message(other, "newchat", 1)
	}
}

function on_snap(socket, snap_id) {
	SLOG(socket, "SNAP", snap_id)
	try {
		let snap_state = SQL_SELECT_SNAP_STATE.get(socket.game_id, snap_id)
		if (snap_state) {
			let state = JSON.parse(snap_state)
			let view = RULES[socket.title_id].view(state, socket.role)
			view.prompt = undefined
			view.actions = undefined
			view.log = state.log
			send_message(socket, "snap", [ snap_id, state.active, view ])
		}
	} catch (err) {
		console.log(err)
		return send_message(socket, "error", err.toString())
	}
}

function broadcast_presence(game_id) {
	let presence = []
	for (let socket of game_clients[game_id])
		if (!presence.includes(socket.role))
			presence.push(socket.role)
	for (let socket of game_clients[game_id])
		send_message(socket, "presence", presence)
}

function handle_player_message(socket, cmd, arg) {
	switch (cmd) {
	case "action":
		on_action(socket, arg[0], arg[1], arg[2])
		break
	case "query":
		on_query(socket, arg[0], arg[1])
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
	case "getsnap":
		on_snap(socket, arg | 0)
		break
	case "querysnap":
		on_query_snap(socket, arg[0], arg[1], arg[2])
		break
	case "save":
		on_save(socket)
		break
	case "restore":
		on_restore(socket, arg)
		break
	default:
		send_message(socket, "error", "Invalid server command: " + cmd)
		break
	}
}

function handle_observer_message(socket, cmd, arg) {
	switch (cmd) {
	case "getsnap":
		on_snap(socket, arg)
		break
	case "querysnap":
		on_query_snap(socket, arg[0], arg[1], arg[2])
		break
	case 'query':
		on_query(socket, arg[0], arg[1])
		break
	default:
		send_message(socket, "error", "Invalid server command: " + cmd)
		break
	}
}

wss.on("connection", (socket, req) => {
	let u = url.parse(req.url, true)
	if (u.pathname !== "/play-socket")
		return setTimeout(() => socket.close(1000, "Invalid request."), 30000)
	req.query = u.query

	let ip = req.headers["x-real-ip"] || req.ip || req.connection.remoteAddress || "0.0.0.0"

	let user_id = 0
	let sid = login_cookie(req)
	if (sid)
		user_id = login_sql_select.get(sid)
	if (user_id) {
		socket.user = SQL_SELECT_USER_VIEW.get(user_id)
		SQL_UPDATE_USER_LAST_SEEN.run(user_id, ip)
	}

	socket.ip = ip
	socket.title_id = req.query.title || "unknown"
	socket.game_id = req.query.game | 0
	socket.role = req.query.role
	socket.seen = req.query.seen | 0

	SLOG(socket, "OPEN " + socket.seen)

	try {
		let game = SQL_SELECT_GAME.get(socket.game_id)
		if (!game || game.title_id !== socket.title_id)
			return socket.close(1000, "Invalid game ID.")

		let players = socket.players = SQL_SELECT_PLAYERS_WITH_NAME.all(socket.game_id)

		if (socket.role !== "Observer") {
			if (!socket.user)
				return socket.close(1000, "You are not logged in!")

			if (socket.role && socket.role !== "undefined" && socket.role !== "null") {
				let me = players.find(p => p.user_id === socket.user.user_id && p.role === socket.role)
				if (!me)
					return socket.close(1000, "You aren't assigned that role!")
			} else {
				let me = players.find(p => p.user_id === socket.user.user_id)
				socket.role = me ? me.role : "Observer"
			}

			let new_chat = SQL_SELECT_UNREAD_CHAT.get(socket.user.user_id, socket.game_id)
			send_message(socket, "newchat", new_chat)
		}

		if (socket.seen === 0) {
			let roles = get_game_roles(game.title_id, game.scenario, parse_game_options(game.options))
			send_message(socket, "players", [
				socket.role,
				roles.map(r => ({ role: r, name: players.find(p => p.role === r)?.name }))
			])
		}

		if (game_clients[socket.game_id]) {
			game_clients[socket.game_id].push(socket)
		} else {
			game_clients[socket.game_id] = [ socket ]
			game_cookies[socket.game_id] = 1
		}

		socket.on("close", (code) => {
			SLOG(socket, "CLOSE " + code)
			game_clients[socket.game_id].splice(game_clients[socket.game_id].indexOf(socket), 1)
			if (game_clients[socket.game_id].length > 0) {
				broadcast_presence(socket.game_id)
			} else {
				delete game_clients[socket.game_id]
				delete game_cookies[socket.game_id]
			}
		})

		socket.on("error", (err) => {
			SLOG(socket, "ERROR" + err)
			socket.close(1000, err.toString())
		})

		socket.on("message", (data) => {
			try {
				let [ cmd, arg ] = JSON.parse(data)
				if (socket.role !== "Observer")
					handle_player_message(socket, cmd, arg)
				else
					handle_observer_message(socket, cmd, arg)
			} catch (err) {
				send_message(socket, "error", err.toString())
			}
		})

		broadcast_presence(socket.game_id)

		let snapsize = SQL_SELECT_SNAP_COUNT.get(socket.game_id)
		if (snapsize > 0)
			send_message(socket, "snapsize", snapsize)

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
		title_id, player_count, scenario,
		group_concat(result, '%') as result_role,
		group_concat(n, '%') as result_count,
		sum(n) as total
	from
		(
			select
				title_id,
				player_count,
				scenario,
				result,
				count(1) as n
			from
				rated_games_view
			where
				( title_id not in ( select title_id from titles where is_symmetric ) )
			group by
				title_id,
				player_count,
				scenario,
				result
			order by
				n desc
		)
	group by
		title_id, player_count, scenario
	having
		total > 12
	`)

app.get("/stats", function (req, res) {
	let stats = SQL_GAME_STATS.all()
	stats.forEach(row => {
		row.title_name = TITLE_NAME[row.title_id]
		row.result_role = row.result_role.split("%")
		row.result_count = row.result_count.split("%").map(Number)
	})
	res.render("stats.pug", {
		user: req.user,
		stats: stats,
	})
})

const SQL_USER_STATS = SQL(`
	select
		titles.title_name,
		scenario,
		role,
		sum(score) / 2 as won,
		count(*) as total
	from
		players
		join game_view using(game_id)
		join titles using(title_id)
	where
		not is_symmetric
		and user_id = ?
		and is_opposed
		and ( status = ${STATUS_FINISHED} or status = ${STATUS_ARCHIVED} )
	group by
		titles.title_name,
		scenario,
		role
	union
	select
		titles.title_name,
		scenario,
		null as role,
		sum(score) / 2 as won,
		count(*) as total
	from
		players
		join game_view using(game_id)
		join titles using(title_id)
	where
		is_symmetric
		and user_id = ?
		and is_opposed
		and ( status = ${STATUS_FINISHED} or status = ${STATUS_ARCHIVED} )
	group by
		titles.title_name,
		scenario
	`)

const SQL_USER_RATINGS = SQL(`
	select title_name, rating, count, date(last) as last
	from ratings
	join titles using(title_id)
	where user_id = ?
	and count >= 5
	order by rating desc
	`)

const SQL_GAME_RATINGS = SQL(`
	select name, rating, count, date(last) as last
	from ratings
	join users using(user_id)
	where title_id = ? and rating >= 1600 and count >= 10
	order by rating desc
	limit 50
	`)

app.get("/user-stats/:who_name", must_be_administrator, function (req, res) {
	let who = SQL_SELECT_USER_BY_NAME.get(req.params.who_name)
	if (who) {
		let stats = SQL_USER_STATS.all(who.user_id, who.user_id)
		let ratings = SQL_USER_RATINGS.all(who.user_id)
		res.render("user_stats.pug", { user: req.user, who, stats, ratings })
	} else {
		return res.status(404).send("Invalid user name.")
	}
})

app.get("/game-stats/:title_id", must_be_administrator, function (req, res) {
	let title_id = req.params.title_id
	if (title_id in TITLE_TABLE) {
		let title_name = TITLE_NAME[title_id]
		let ratings = SQL_GAME_RATINGS.all(title_id)
		res.render("game_stats.pug", { user: req.user, title_name, ratings })
	} else {
		return res.status(404).send("Invalid title.")
	}
})
