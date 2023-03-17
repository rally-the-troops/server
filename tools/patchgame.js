#!/usr/bin/env node

const VERIFY = true

const fs = require('fs')
const sqlite3 = require('better-sqlite3')

if (process.argv.length !== 3) {
       process.stderr.write("usage: ./tools/patchgame.js <game_id>\n")
       process.exit(1)
}

let db = new sqlite3("./db")

let game_id = process.argv[2]
let title_id = db.prepare("select title_id from games where game_id=?").pluck().get(game_id)
let rules = require("../public/" + title_id + "/rules.js")
let log = db.prepare("select * from game_replay where game_id=?").all(game_id)

let save = db.prepare("select state from game_state where game_id=?").pluck().get(game_id)
fs.writeFileSync("backup-" + game_id + ".txt", save)

function is_valid_action(rules, game, role, action, a) {
	if (action !== 'undo')
		if (game.active !== role && game.active !== "Both" && game.active !== "All")
			return false
	let view = rules.view(game, role)
	let va = view.actions[action]
	if (va === undefined)
		return false
	if (a === undefined || a === null)
		return (va === 1) || (typeof va === 'string')
	if (Array.isArray(a))
		a = a[0]
	if (!Array.isArray(va))
		throw new Error("action list not array:" + JSON.stringify(view.actions))
	return va.includes(a)
}

let game = { state: null, active: null }
let view = null
let i = 0
try {
	log.forEach(item => {
		let args = JSON.parse(item.arguments)
		if (item.action === 'setup')
			game = rules.setup(args[0], args[1], args[2])
		else if (item.action === 'resign')
			game = rules.resign(game, item.role)
		else {
			console.log("ACTION", i, game.state, game.active, ">", item.role, item.action, item.arguments)
			if (VERIFY) {
				if (!is_valid_action(rules, game, item.role, item.action, args)) {
					console.log(`invalid action: ${item.role} ${item.action} ${item.arguments}`)
					console.log("\t", game.state, game.active, JSON.stringify(rules.view(game, item.role).actions))
					throw "invalid action"
				}
			}
			game = rules.action(game, item.role, item.action, args)
		}
		++i
	})
	console.log("SUCCESS %d", log.length)
	db.prepare("update game_state set active=?, state=? where game_id=?").run(game.active, JSON.stringify(game), game_id)
} catch (err) {
	console.log("FAILED %d/%d", i+1, log.length)
	console.log(err)
	delete game.log
	delete game.undo
	console.log(game)
}

if (i < log.length) {
	console.log("BROKEN ENTRIES: %d", log.length-i)
	console.log(`sqlite3 db "delete from game_replay where game_id=${game_id} and replay_id>=${log[i].replay_id}"`)
}
