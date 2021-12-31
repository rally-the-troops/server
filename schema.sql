-- Blacklists --

create table if not exists blacklist_ip ( ip text primary key ) without rowid;
create table if not exists blacklist_mail ( mail text primary key ) without rowid;

-- Titles and roles --

create table if not exists titles (
	title_id text
		primary key,
	title_name text,
	bgg integer,
	is_hidden boolean
) without rowid;

create table if not exists roles (
	title_id text
		references titles,
	role text,
	unique (title_id, role)
);

-- Users --

create table if not exists logins (
	sid integer
		primary key,
	user_id integer
		references users
			on delete cascade,
	expires real
);

create table if not exists users (
	user_id integer
		primary key,
	name text
		unique
		collate nocase,
	mail text
		unique
		collate nocase,
	notify boolean
		default 0,
	is_banned boolean
		default 0,
	ctime timestamp
		default current_timestamp,
	password text,
	salt text,
	about text
);

create table if not exists user_last_seen (
	user_id integer
		primary key
		references users
			on delete cascade,
	atime timestamp,
	aip text
);

create table if not exists tokens (
	user_id integer
		primary key
		references users
			on delete cascade,
	token text,
	time timestamp
);

create table if not exists last_notified (
	game_id integer
		references games
			on delete cascade,
	user_id integer
		references users
			on delete cascade,
	time timestamp,
	primary key (game_id, user_id)
) without rowid;

drop view if exists user_view;
create view user_view as
	select
		user_id, name, mail, notify
	from
		users
	;

drop view if exists user_login_view;
create view user_login_view as
	select
		user_id, name, mail, notify, password, salt
	from
		users
	;

drop view if exists user_profile_view;
create view user_profile_view as
	select
		user_id, name, mail, notify, ctime, atime, about
	from
		users
		natural left join user_last_seen
	;

-- Messages --

create table if not exists messages (
	message_id integer
		primary key,
	is_deleted_from_inbox boolean
		default 0,
	is_deleted_from_outbox boolean
		default 0,
	from_id integer
		references users,
	to_id integer
		references users,
	time timestamp
		default current_timestamp,
	is_read boolean
		default 0,
	subject text,
	body text
);

drop view if exists message_view;
create view message_view as
	select
		messages.*,
		users_from.name as from_name,
		users_to.name as to_name
	from
		messages
		left join users as users_from
			on messages.from_id = users_from.user_id
		left join users as users_to
			on messages.to_id = users_to.user_id
	;

create index if not exists messages_inbox_idx
	on
		messages(to_id)
	where
		is_deleted_from_inbox = 0
	;

create index if not exists messages_inbox_unread_idx
	on
		messages(to_id)
	where
		is_read = 0 and is_deleted_from_inbox = 0
	;

-- Forum --

create table if not exists threads (
	thread_id integer
		primary key,
	author_id integer
		references users,
	subject text,
	is_locked boolean
		default 0
);

create table if not exists posts (
	post_id integer
		primary key,
	thread_id integer
		references threads
			on delete cascade,
	author_id integer
		references users,
	ctime timestamp
		default current_timestamp,
	mtime timestamp
		default current_timestamp,
	body text
);

drop view if exists thread_view;
create view thread_view as
	select
		threads.*,
		author.name as author_name,
		(
			select
				count(*) - 1
			from
				posts
			where
				posts.thread_id = threads.thread_id
		) as replies,
		(
			select
				max(posts.mtime)
			from
				posts
			where
				posts.thread_id = threads.thread_id
		) as mtime
	from
		threads
		left join users as author
			on threads.author_id = author.user_id
	;

drop view if exists post_view;
create view post_view as
	select
		posts.*,
		author.name as author_name
	from
		posts
		left join users as author
			on posts.author_id = author.user_id
	;

create index if not exists posts_thread_idx on posts(thread_id);

-- Games --

create table if not exists games (
	game_id integer
		primary key,
	title_id text
		references titles,
	scenario text,
	options text,
	owner_id integer
		references users,
	ctime timestamp
		default current_timestamp,
	is_private boolean
		default 0,
	is_random boolean
		default 0,
	description text,
	status integer
		default 0,
	result text
);

create index if not exists games_title_idx on games(title_id);
create index if not exists games_status_idx on games(status);

create table if not exists game_state (
	game_id integer
		primary key
		references games
			on delete cascade,
	mtime timestamp,
	active text,
	state text
);

create table if not exists game_chat (
	chat_id integer
		primary key,
	game_id integer
		references games
			on delete cascade,
	time timestamp
		default current_timestamp,
	user_id integer
		references users,
	message text
);

drop view if exists game_chat_view;
create view game_chat_view as
	select
		chat_id, game_id, time, name, message
	from
		game_chat
		natural join users
	;

create index if not exists game_chat_idx on game_chat(game_id);

create table if not exists game_replay (
	game_id integer
		references games
			on delete cascade,
	time timestamp
		default current_timestamp,
	role text,
	action text,
	arguments text
);

create table if not exists players (
	game_id integer
		references games
			on delete cascade,
	role text,
	user_id integer
		references users,
	primary key (game_id, role)
) without rowid;

create index if not exists player_user_idx on players(user_id);
create index if not exists player_game_user_idx on players(game_id, user_id);

drop view if exists game_view;
create view game_view as
	select
		games.*,
		titles.title_name,
		owner.name as owner_name,
		game_state.mtime,
		game_state.active
	from
		games
		natural left join game_state
		natural join titles
		join users as owner
			on owner.user_id = games.owner_id
	;

drop view if exists game_full_view;
create view game_full_view as
	select
		*,
		(
			select
				group_concat(name, ', ')
			from
				players
				natural join users
			where
				players.game_id = game_view.game_id
		) as player_names,
		(
			select
				count(distinct user_id) = 1
			from
				players
			where
				players.game_id = game_view.game_id
		) as is_solo
	from
		game_view
	;

drop view if exists opposed_games;
create view opposed_games as
	select
		*
	from
		games
	where
		status > 0
		and (
			select
				count(distinct user_id) > 1
			from
				players
			where
				players.game_id = games.game_id
		)
	;

drop view if exists your_turn_reminder;
create view your_turn_reminder as
	select
		game_id, role, user_id, name, mail, notify
	from
		game_full_view
		join players using(game_id)
		join users using(user_id)
	where
		status = 1
		and active in ('All', 'Both', role)
		and is_solo = 0
		and notify = 1
		and datetime('now') > datetime(mtime, '+1 hour')
	;

drop view if exists your_turn;
create view your_turn as
	select
		game_id, user_id, role
	from
		players
		join games using(game_id)
		join game_state using(game_id)
	where
		status = 1
		and active in ('All', 'Both', role)
	;

-- Triggers --

drop trigger if exists no_part_on_active_game;
create trigger no_part_on_active_game before delete on players
begin
	select
		raise(abort, 'Cannot remove players from started games.')
	where
		(select status from games where games.game_id = old.game_id) > 0
	;
end;

drop trigger if exists no_join_on_active_game;
create trigger no_join_on_active_game before insert on players
begin
	select
		raise(abort, 'Cannot add players to started games.')
	where
		(select status from games where games.game_id = new.game_id) > 0
	;
end;

drop trigger if exists must_be_valid_role;
create trigger must_be_valid_role before insert on players
begin
	select
		raise(abort, 'Invalid role.')
	where
		not exists (
			select
				1
			from
				roles
			where
				roles.title_id = (
					select
						title_id
					from
						games
					where
						games.game_id = new.game_id
				)
				and roles.role = new.role
		)
		and new.role != 'Random 1'
		and new.role != 'Random 2'
		and new.role != 'Random 3'
		and new.role != 'Random 4'
		and new.role != 'Random 5'
		and new.role != 'Random 6'
		and new.role != 'Random 7'
	;
end;

-- Manual key management if pragma foreign_keys = off
drop trigger if exists trigger_delete_on_games;
create trigger trigger_delete_on_games after delete on games
begin
	delete from game_state where game_id = old.game_id;
	delete from game_chat where game_id = old.game_id;
	delete from game_replay where game_id = old.game_id;
	delete from last_notified where game_id = old.game_id;
	delete from players where game_id = old.game_id;
end;

-- Game stats

drop view if exists role_index_view;
create view role_index_view (t, i, r) as
	select
		title_id,
		row_number() over (partition by title_id),
		role
	from
		roles
	;

drop view if exists game_stat_view;
create view game_stat_view as
	select
		title_name,
		null as scenario,
		null as total,
		(select r from role_index_view where t=title_id and i=1) as r1,
		(select r from role_index_view where t=title_id and i=2) as r2,
		(select r from role_index_view where t=title_id and i=3) as r3,
		(select r from role_index_view where t=title_id and i=4) as r4,
		(select r from role_index_view where t=title_id and i=5) as r5,
		(select r from role_index_view where t=title_id and i=6) as r6,
		(select r from role_index_view where t=title_id and i=7) as r7
	from
		titles
	where
		is_hidden = 0
	union
	select
		title_name,
		scenario,
		count(*) as total,
		sum((select i from role_index_view where t=title_id and r=result) = 1) as r1,
		sum((select i from role_index_view where t=title_id and r=result) = 2) as r2,
		sum((select i from role_index_view where t=title_id and r=result) = 3) as r3,
		sum((select i from role_index_view where t=title_id and r=result) = 4) as r4,
		sum((select i from role_index_view where t=title_id and r=result) = 5) as r5,
		sum((select i from role_index_view where t=title_id and r=result) = 6) as r6,
		sum((select i from role_index_view where t=title_id and r=result) = 7) as r7
	from
		games
		natural join titles
	where
		is_hidden = 0
		and status = 2
		and game_id in (select game_id from opposed_games)
	group by
		title_id,
		scenario
	order by
		title_name,
		total desc nulls first
	;
