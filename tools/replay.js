#!/usr/bin/env node

const sqlite3 = require('better-sqlite3');

if (process.argv.length !== 3) {
	process.stderr.write("usage: ./tools/replay.js <game_id>\n");
	process.exit(1);
}

let game_id = process.argv[2] | 0;

let db = new sqlite3("./db");
let title_id = db.prepare("SELECT title_id FROM games WHERE game_id = ?").pluck().get(game_id);
let rules = require("../public/" + title_id + "/rules");
let log = db.prepare("SELECT * FROM replay WHERE game_id = ?").all(game_id);

let replay = new sqlite3("./replay.db");
replay.pragma("synchronous = off");
replay.prepare("create table if not exists replay ( game_id int, time, role, action, arguments, state )").run();
replay.prepare("delete from replay where game_id = ?").run(game_id);
let replay_insert = replay.prepare("insert into replay (game_id,time,role,action,arguments,state) VALUES (?,?,?,?,?,?)");

process.stdout.write(`// REPLAY ${title_id} ${game_id}\n`)
let game = { state: "null", active: "None" }
log.forEach(item => {
	process.stdout.write(`${game.state} ${game.active}\n`);
	process.stdout.write(`\t${item.time} ${item.role} ${item.action} ${item.arguments}\n`);
	let args = JSON.parse(item.arguments);
	if (item.action === 'setup')
		game = rules.setup(args[0], args[1], args[2]);
	else if (item.action === 'resign')
		game = rules.resign(game, item.role);
	else
		game = rules.action(game, item.role, item.action, args);
	replay_insert.run(game_id, item.time, item.role, item.action, item.arguments, JSON.stringify(game));
});
process.stdout.write(`${game.state} ${game.active}\n`);
