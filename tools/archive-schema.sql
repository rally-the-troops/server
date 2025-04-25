-- schema for archive.db containing limited game and user data

create table if not exists users (
	user_id integer primary key,
	name text unique collate nocase
);

create table if not exists players (
	game_id integer,
	role text,
	user_id integer,
	primary key (game_id, role)
) without rowid;

create table if not exists games (
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

create table if not exists game_state (
	game_id integer primary key,
	state text
);

create table if not exists game_replay (
	game_id integer,
	replay_id integer,
	role text,
	action text,
	arguments json,
	primary key (game_id, replay_id)
) without rowid;

create table if not exists game_chat (
	game_id integer,
	chat_id integer,
	user_id integer,
	time datetime,
	message text,
	primary key (game_id, chat_id)
) without rowid;

drop trigger if exists trigger_delete;
create trigger trigger_delete after delete on games
begin
	delete from players where game_id = old.game_id;
	delete from game_state where game_id = old.game_id;
	delete from game_replay where game_id = old.game_id;
	delete from game_chat where game_id = old.game_id;
end;

drop view if exists game_export_view;
create view game_export_view as
	select
		game_id,
		json_object(
			'setup', json_object(
					'game_id', game_id,
					'title_id', title_id,
					'scenario', scenario,
					'options', json(options),
					'player_count', player_count
				),
			'players',
				(select json_group_array(
						json_object('role', role, 'name', name)
					)
					from players
					left join users using(user_id)
					where game_id = outer.game_id
				),
			'state',
				(select json(state)
					from game_state
					where game_id = outer.game_id
				),
			'replay',
				(select json_group_array(
						case when arguments is null then
							json_array(role, action)
						else
							json_array(role, action, json(arguments))
						end
					)
					from game_replay
					where game_id = outer.game_id
				)
		) as export
	from games as outer
;
