/*
 * connect-better-sqlite3
 *
 * Copyright (c) 2010-2020 TJ Holowaychuk <tj@vision-media.ca>
 * Copyright (c) 2011 tnantoka <bornneet@livedoor.com>
 * Copyright (c) 2012 David Feinberg
 * Copyright (c) 2021 Tor Andersson <tor@ccxvii.net>
 *
 * MIT Licensed
 */

"use strict";

module.exports = function (session) {
	const SQLite = require('better-sqlite3');

	function noop() {}
	function now() { return Math.ceil(Date.now() / 1000); }
	function seconds(date) { return Math.ceil(new Date(date).getTime() / 1000); }

	class SQLiteStore extends session.Store {

		constructor(options = {}) {
			super(options);

			let table = options.table || 'sessions';
			let db_path = options.db || table;
			if (db_path !== ':memory:')
				db_path = (options.dir || '.') + '/' + db_path;

			let db = new SQLite(db_path, options.mode);
			db.pragma("journal_mode = WAL");
			db.pragma("synchronous = OFF");
			db.exec("CREATE TABLE IF NOT EXISTS "+table+" (sid PRIMARY KEY, expires INTEGER, sess TEXT)");
			db.exec("DELETE FROM "+table+" WHERE "+now()+" > expires");
			db.exec("VACUUM");
			db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

			this.sql_destroy = db.prepare("DELETE FROM "+table+" WHERE sid = ?");
			this.sql_get = db.prepare("SELECT sess FROM "+table+" WHERE sid = ? AND ? <= expires");
			this.sql_set = db.prepare("INSERT OR REPLACE INTO "+table+" VALUES (?,?,?)");
			this.sql_touch = db.prepare("UPDATE "+table+" SET expires = ? WHERE sid = ? AND expires < ?");
		}

		destroy(sid, cb = noop) {
			try {
				this.sql_destroy.run(sid);
				cb(null);
			} catch (err) {
				cb(err);
			}
		}

		get(sid, cb = noop) {
			try {
				let sess = this.sql_get.get(sid, now());
				if (sess)
					return cb(null, JSON.parse(sess.sess));
				return cb(null, null);
			} catch (err) {
				return cb(err, null);
			}
		}

		set(sid, sess, cb = noop) {
			try {
				let expires;
				if (sess && sess.cookie && sess.cookie.expires)
					expires = seconds(sess.cookie.expires);
				else
					expires = now() + 86400;
				this.sql_set.run(sid, expires, JSON.stringify(sess));
				cb(null);
			} catch (err) {
				cb(err);
			}
		}

		touch(sid, sess, cb = noop) {
			try {
				if (sess && sess.cookie && sess.cookie.expires) {
					let expires = seconds(sess.cookie.expires);
					let limit = expires - 3600;
					this.sql_touch.run(expires, sid, limit);
					cb(null);
				} else {
					cb(null);
				}
			} catch (err) {
				cb(err);
			}
		}

	}

	return SQLiteStore;
}
