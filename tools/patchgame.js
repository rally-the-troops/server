#!/usr/bin/env node

const fs = require('fs');
const sqlite3 = require('better-sqlite3');

if (process.argv.length !== 3) {
       process.stderr.write("usage: ./tools/patchgame.js <game_id>\n");
       process.exit(1);
}

let db = new sqlite3("./db");

let game_id = process.argv[2];
let title_id = db.prepare("select title_id from games where game_id=?").pluck().get(game_id);
let rules = require("../public/" + title_id + "/rules.js");
let log = db.prepare("select * from game_replay where game_id=?").all(game_id);

let save = db.prepare("select state from game_state where game_id=?").pluck().get(game_id);
fs.writeFileSync("backup-" + game_id + ".txt", save);

let game = { state: null, active: null }
log.forEach(item => {
       let args = JSON.parse(item.arguments);
       if (item.action === 'setup')
               game = rules.setup(args[0], args[1], args[2]);
       else if (item.action === 'resign')
               game = rules.resign(game, item.role);
       else
               game = rules.action(game, item.role, item.action, args);
});

db.prepare("update game_state set active=?, state=? where game_id=?").run(game.active, JSON.stringify(game), game_id);
