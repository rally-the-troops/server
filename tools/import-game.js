#!/usr/bin/env -S node

const fs = require("fs")
const sqlite3 = require("better-sqlite3")

var options = {}
var input = null

for (let i = 2; i < process.argv.length; ++i) {
	let opt = process.argv[i]
	if (opt.includes("=")) {
		let [key, val] = opt.split("=", 2)
		options[key] = val
	} else {
		input = opt
	}
}

if (!input) {
	console.error("usage: node tools/import-game.js [title_id=value] [notice=value] game.json")
	process.exit(1)
}

var game = JSON.parse(fs.readFileSync(input, "utf8"))

if (options.title_id)
	game.setup.title_id = options.title_id
if (options.notice)
	game.setup.notice = options.notice

if (game.setup.notice === undefined)
	game.setup.notice = ""
if (game.setup.options === undefined)
	game.setup.options = "{}"

game.setup.active = game.state.active
game.setup.moves = game.snaps && game.snaps.length > 0 ? game.snaps.length - 1 : 0

let db = new sqlite3("db")

let insert_game = db.prepare("insert into games(status,owner_id,title_id,scenario,options,player_count,active,moves,notice) values (1,1,:title_id,:scenario,:options,:player_count,:active,:moves,:notice) returning game_id").pluck()
let insert_player = db.prepare("insert into players(game_id,role,user_id) values (?,?,?)")
let insert_state = db.prepare("insert into game_state(game_id,state) values (?,?)")

let select_user = db.prepare("select user_id from users where name=?").pluck()

db.exec("begin")

game.setup.options = JSON.stringify(game.setup.options)

function find_user(name) {
	return select_user.get(name) || 1
}

let game_id = insert_game.get(game.setup)
for (let p of game.players)
	insert_player.run(game_id, p.role, find_user(p.name))
insert_state.run(game_id, JSON.stringify(game.state))

if (game.replay) {
	let insert_replay = db.prepare("insert into game_replay(game_id,replay_id,role,action,arguments) values (?,?,?,?,?)")
	game.replay.forEach(([role, action, args], i) => {
		insert_replay.run(game_id, i+1, role, action, JSON.stringify(args))
	})
}

if (game.snaps) {
	let insert_snap = db.prepare("insert into game_snap(game_id,snap_id,replay_id,state) values (?,?,?,?)")
	game.snaps.forEach(([replay_id, state], i) => {
		insert_snap.run(game_id, i+1, replay_id, JSON.stringify(state))
	})
}

console.log(game_id)

db.exec("commit")
