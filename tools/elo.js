#!/usr/bin/env -S node

const sqlite3 = require("better-sqlite3")

const db = new sqlite3("db")

const SQL_SELECT_GAMES = db.prepare("select * from games where status>1 and user_count=player_count and player_count>1 order by xtime")
const SQL_SELECT_RATING = db.prepare("select * from player_rating_view where game_id=?")
const SQL_INSERT_RATING = db.prepare("insert or replace into ratings (title_id,user_id,rating,count,last) values (?,?,?,?,?)")

function elo_k(n) {
	return n < 10 ? 60 : 30
}

function elo_ev(a, players) {
	// Generalized formula for multiple players.
	// https://arxiv.org/pdf/2104.05422.pdf
	let sum = 0
	for (let p of players)
		sum += Math.pow(10, p.rating / 400)
	return Math.pow(10, a.rating / 400) / sum
}

function elo_change(a, players, s) {
	return Math.round(elo_k(a.count) * (s - elo_ev(a, players)))
}

function update_elo_ratings(game) {
	let players = SQL_SELECT_RATING.all(game.game_id)
	if (game.player_count !== players.length)
		return

	let winner = null
	for (let p of players)
		if (p.role === game.result)
			winner = p

	if (winner) {
		for (let p of players) {
			if (p === winner)
				p.change = elo_change(p, players, 1)
			else
				p.change = elo_change(p, players, 0)
		}
	} else {
		for (let p of players)
			p.change = elo_change(p, players, 1 / game.player_count)
	}

	for (let p of players)
		SQL_INSERT_RATING.run(game.title_id, p.user_id, p.rating + p.change, p.count+1, game.xtime)
}

db.exec("begin transaction")
db.exec("delete from ratings")
for (let game of SQL_SELECT_GAMES.all())
	update_elo_ratings(game)
db.exec("commit")
