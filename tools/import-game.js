#!/usr/bin/env -S node

const fs = require("fs")
const sqlite3 = require("better-sqlite3")

if (process.argv.length !== 3) {
	console.error("usage: node tools/import-game.js game.json")
	process.exit(1)
}

var game = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))

game.setup.active = game.state.active
game.setup.moves = game.snaps && game.snaps.length > 0 ? game.snaps.length - 1 : 0

let db = new sqlite3("db")

let insert_game = db.prepare("insert into games(status,title_id,scenario,options,player_count,active,moves,notice) values (1,:title_id,:scenario,:options,:player_count,:active,:moves,:notice) returning game_id").pluck()
let insert_player = db.prepare("insert into players(game_id,role,user_id) values (?,?,1)")
let insert_state = db.prepare("insert into game_state(game_id,state) values (?,?)")

db.exec("begin")

game.setup.options = JSON.stringify(game.setup.options)

let game_id = insert_game.get(game.setup)
for (let p of game.players)
	insert_player.run(game_id, p.role)
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
