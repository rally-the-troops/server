const sqlite3 = require('better-sqlite3');

let db = new sqlite3("./db");
let game_id = process.argv[2] | 0;
let title_id = db.prepare("SELECT title_id FROM games WHERE game_id = ?").pluck().get(game_id);
let rules = require("./public/" + title_id + "/rules.js");

console.log("// TITLE", title_id)
let log = db.prepare("SELECT * FROM game_log WHERE game_id = ?").all(game_id);
let game = null;
log.forEach(item => {
	let args = JSON.parse(item.arguments);
	if (item.action === 'setup') {
		console.log("// SETUP", item.arguments)
		game = rules.setup(args[0], args[1], args[2]);
	} else if (item.action === 'resign') {
		console.log("// RESIGN", item.role);
		game = rules.resign(game, item.role);
	} else {
		console.log("// ACTION", item.role, item.action, item.arguments);
		game = rules.action(game, item.role, item.action, args);
	}
	console.log(JSON.stringify(game));
});
