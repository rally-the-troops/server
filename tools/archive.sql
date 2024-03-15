-- Make a copy of finished games in a separate archive database.

attach database 'db' as live;
attach database 'archive.db' as archive;

-- List finished (and rated) games in live that are not in archive.
create temporary view candidates as
	select
		game_id
	from
		live.rated_games_view
	where
		game_id not in (select game_id from archive.games)
;

create table if not exists archive.users (
	user_id integer primary key,
	name text unique collate nocase
);

create table if not exists archive.players (
	game_id integer,
	role text,
	user_id integer,
	primary key (game_id, role)
) without rowid;

create table if not exists archive.games (
	game_id integer primary key,
	title_id text,
	scenario text,
	options text,
	player_count integer,
	ctime datetime,
	mtime datetime,
	moves integer,
	result text
);

create table if not exists archive.game_state (
	game_id integer primary key,
	state text
);

create table if not exists archive.game_replay (
	game_id integer,
	replay_id integer,
	role text,
	action text,
	arguments json,
	primary key (game_id, replay_id)
) without rowid;

create table if not exists archive.game_chat (
	game_id integer,
	chat_id integer,
	user_id integer,
	time datetime,
	message text,
	primary key (game_id, chat_id)
) without rowid;

drop trigger if exists archive.trigger_delete;
create trigger archive.trigger_delete after delete on archive.games
begin
	delete from players where game_id = old.game_id;
	delete from game_state where game_id = old.game_id;
	delete from game_replay where game_id = old.game_id;
	delete from game_chat where game_id = old.game_id;
end;

begin immediate;

select 'ARCHIVING ' || count(*) || ' GAMES' from candidates;

insert or ignore into archive.users (user_id, name) select user_id, name
	from live.users;

insert into archive.players (game_id, role, user_id)
	select game_id, role, user_id
	from candidates join live.players using(game_id);

insert into archive.game_state (game_id, state)
	select game_id, state
	from candidates join live.game_state using(game_id);

insert into archive.game_replay (game_id, replay_id, role, action, arguments)
	select game_id, replay_id, role, action, arguments
	from candidates join live.game_replay using(game_id);

insert into archive.game_chat (game_id, chat_id, user_id, time, message)
	select game_id, chat_id, user_id, time, message
	from candidates join live.game_chat using(game_id);

insert into archive.games (game_id, title_id, scenario, options, player_count, ctime, mtime, moves, result)
	select game_id, title_id, scenario, options, player_count, ctime, mtime, moves, result
	from candidates join live.games using(game_id);

commit;
