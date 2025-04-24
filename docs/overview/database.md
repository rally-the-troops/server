# Database Overview

The database uses the following schemas, somewhat simplified and redacted to highlight the important bits.

## Users

The user table is pretty simple, it just holds the user name and e-mail.

	create table users (
		user_id integer primary key,
		name text unique collate nocase,
		mail text unique collate nocase
	);

Passwords are hashed and salted with SHA-256.

	create table user_password (
		user_id integer primary key,
		password text,
		salt text
	);

The login session cookie is a 48-bit random number.

	create table logins (
		sid integer primary key,
		user_id integer,
		expires real -- julianday
	);

Webhook notification settings are kept in the webhooks table.
The error column keeps any error message such as timeouts or HTTP failure statuses.
It is null if the hook is operational.

	create table webhooks (
		user_id integer primary key,
		url text,
		format text,
		prefix text,
		error text
	);

The contact list keeps track of friends (positive relation) and blacklisted users (negative relation).

	create table contacts (
		me integer,
		you integer,
		relation integer,
		primary key (me, you)
	);


## Modules

The game modules to load are registered in the titles table. The title_id must match the directory name for the module.

	create table titles (
		title_id text primary key,
		title_name text,
		bgg integer,
		is_symmetric boolean
	);

## Games

Each game session uses a handful of tables.
The main table holds the status (open/active/finished), setup information (scenario, options), whose turn it is (active), and the final result.

	create table games (
		game_id integer primary key,
		status integer,

		title_id text,
		scenario text,
		options text,

		player_count integer,
		join_count integer,
		invite_count integer,
		user_count integer,

		owner_id integer,
		notice text,
		pace integer,
		is_private boolean,
		is_random boolean,
		is_match boolean,

		ctime datetime,
		mtime datetime,
		moves integer,
		active text,
		result text,

		is_opposed boolean generated as ( user_count = join_count and join_count > 1 ),
		is_ready boolean generated as ( player_count = join_count and invite_count = 0 )
	);

The players table connects users to the games they play.

	create table players (
		game_id integer,
		role text,
		user_id integer,
		is_invite integer,
		is_active boolean,
		primary key (game_id, role)
	);

The game state is represented by a JSON blob.

	create table game_state (
		game_id integer primary key,
		state text
	);

Each action taken in stored in the game_replay log. This is primarily used for
the detailed "Sherlock" replay view, but is also used to patch running games when
fixing bugs.

	create table game_replay (
		game_id integer,
		replay_id integer,
		role text,
		action text,
		arguments json,
		primary key (game_id, replay_id)
	);

Whenever who is active changes, we take a snapshot of the game state
so we can provide the coarse turn-by-turn rewind view that is available when
playing. This table is also used when rewinding games. The replay_id syncs each
snapshot with the corresponding action in the game_replay table.

	create table game_snap (
		game_id integer,
		snap_id integer,
		replay_id integer,
		state text,
		primary key (game_id, snap_id)
	);

Game chat is kept in another table, and there's also a table to track whether a
user has any unread in-game chat messages, and one table to track finished but not yet
seen games.

	create table game_chat (
		game_id integer,
		chat_id integer,
		user_id integer,
		time datetime,
		message text,
		primary key (game_id, chat_id)
	);

	create table unread_chats (
		user_id integer,
		game_id integer,
		primary key (user_id, game_id)
	);

	create table unseen_games (
		user_id integer,
		game_id integer,
		primary key (user_id, game_id)
	);

## Other tables

There are several other tables to deal with tournaments, password reset tokens, email
notifications, messages, and the forum.

See the full 
[schema.sql](https://git.rally-the-troops.com/common/server/tree/schema.sql)
for more details on these.
