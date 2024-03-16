-- Blacklists --

create table if not exists blacklist_mail ( mail text primary key collate nocase ) without rowid;
create table if not exists blacklist_name ( name text primary key collate nocase ) without rowid;

insert or ignore into blacklist_mail (mail) values
	('%@example.com')
;

insert or ignore into blacklist_name (name) values
	('None'),
	('System'),
	('Deleted'),
	('null')
;

-- Titles --

create table if not exists titles (
	title_id text primary key,
	title_name text,
	bgg integer,
	is_symmetric boolean default 0,
	is_hidden boolean default 0
) without rowid;

-- Users --

create table if not exists logins (
	sid integer primary key,
	user_id integer,
	expires real -- julianday
);

create table if not exists users (
	user_id integer primary key,
	name text unique collate nocase,
	mail text unique collate nocase,
	notify integer default 0,
	is_verified boolean default 0,
	is_banned boolean default 0,
	ctime datetime default current_timestamp,
	password text,
	salt text,
	about text
);

insert or ignore into
	users (user_id, name, mail, ctime)
	values (0, 'Deleted', 'deleted@nowhere', null)
;

create table if not exists user_last_seen (
	user_id integer primary key,
	atime datetime,
	ip text
);

create table if not exists tokens (
	user_id integer primary key,
	token text,
	time datetime
);

create table if not exists last_notified (
	game_id integer,
	user_id integer,
	time datetime,
	primary key (game_id, user_id)
) without rowid;

create table if not exists webhooks (
	user_id integer primary key,
	url text,
	format text,
	prefix text,
	error text
);

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
		user_id, name, mail, notify, ctime, atime, about, is_banned
	from
		users
		left join user_last_seen using(user_id)
	;

drop view if exists user_dynamic_view;
create view user_dynamic_view as
	select
		user_id,
		name,
		mail,
		(
			select
				count(*)
			from
				messages
			where
				to_id = user_id
				and is_read = 0
				and is_deleted_from_inbox = 0
		) as unread,
		(
			select
				count(*)
			from
				players
				join games using(game_id)
			where
				status = 1
				and user_count = player_count
				and players.user_id = users.user_id
				and active in ( players.role, 'Both' )
		) + (
			select
				count(*)
			from
				players
			where
				players.user_id = users.user_id and players.is_invite
		) + (
			select
				count(*)
			from
				games
			where
				owner_id = users.user_id
				and status = 0
				and (
					join_count = 0
					or (
						join_count = player_count
						and not exists (
							select 1 from players where players.game_id = games.game_id and players.is_invite
						)
					)
				)
		) as waiting,
		is_banned
	from
		users
	;

-- Elo ratings & match making --

drop view if exists rated_games_view;
create view rated_games_view as
	select
		game_id, title_id, player_count, scenario, result, mtime
	from
		games
	where
		status > 1
		and moves >= player_count * 3
		and user_count = player_count
		and player_count > 1
		and not exists (
			select 1 from players where players.game_id = games.game_id and user_id = 0
		)
;

create table if not exists ratings (
	title_id integer,
	user_id integer,
	rating integer,
	count integer,
	last datetime,
	primary key (title_id, user_id)
) without rowid;

drop view if exists rating_view;
create view rating_view as
	select
		title_id, name, rating, count, last
	from
		ratings
		join users using(user_id)
	order by
		title_id,
		rating desc
;

drop view if exists player_rating_view;
create view player_rating_view as
	select
		games.game_id,
		players.user_id,
		players.role,
		coalesce(rating, 1500) as rating,
		coalesce(count, 0) as count
	from players
	join games using(game_id)
	left join ratings using(title_id, user_id)
;

create table if not exists setups (
	setup_id integer primary key,
	setup_name text,
	title_id text,
	player_count integer,
	scenario text,
	options text,
	unique (title_id, player_count, scenario)
);

-- Friend and Block Lists --

create table if not exists contacts (
	me integer,
	you integer,
	relation integer,
	primary key (me, you)
) without rowid;

drop view if exists contact_view;
create view contact_view as
	select
		contacts.me,
		users.user_id,
		users.name,
		user_last_seen.atime,
		contacts.relation
	from
		contacts
		left join users on contacts.you = users.user_id
		left join user_last_seen on contacts.you = user_last_seen.user_id
	order by
		users.name
;

-- Messages --

create table if not exists messages (
	message_id integer primary key,
	is_deleted_from_inbox boolean default 0,
	is_deleted_from_outbox boolean default 0,
	from_id integer,
	to_id integer,
	time datetime default current_timestamp,
	is_read boolean default 0,
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
	thread_id integer primary key,
	author_id integer,
	subject text,
	is_locked boolean default 0
);

create table if not exists posts (
	post_id integer primary key,
	thread_id integer,
	author_id integer,
	ctime datetime default current_timestamp,
	mtime datetime default current_timestamp,
	body text
);

create table if not exists read_threads (
	user_id integer,
	thread_id integer,
	primary key (user_id, thread_id)
) without rowid;

drop view if exists thread_view;
create view thread_view as
	select
		threads.*,
		author.name as author_name,
		(
			select
				count(*)
			from
				posts
			where
				posts.thread_id = threads.thread_id
		) as count,
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

-- Forum Search (FTS5) --

-- drop table if exists forum_search;
create virtual table if not exists forum_search using fts5(thread_id, post_id, text, tokenize='porter unicode61');
-- insert into forum_search(thread_id,post_id,text) select thread_id, 0, subject from threads;
-- insert into forum_search(thread_id,post_id,text) select thread_id, post_id, body from posts;

-- Games --

create table if not exists games (
	game_id integer primary key,
	status integer default 0,

	title_id text,
	scenario text,
	options text,

	player_count integer default 2,
	join_count integer default 0,
	invite_count integer default 0,
	user_count integer default 0,

	owner_id integer default 0,
	notice text,
	pace integer default 0,
	is_private boolean default 0,
	is_random boolean default 0,
	is_match boolean default 0,

	ctime datetime default current_timestamp,
	mtime datetime default current_timestamp,
	moves integer default 0,
	active text,
	result text,

	is_opposed boolean generated as ( user_count = join_count and join_count > 1 ),
	is_ready boolean generated as ( player_count = join_count and invite_count = 0 )
);

create index if not exists games_title_idx on games(title_id);
create index if not exists games_status_idx on games(status);

create table if not exists game_state (
	game_id integer primary key,
	state text
);

create table if not exists game_chat (
	game_id integer,
	chat_id integer,
	user_id integer,
	time datetime default current_timestamp,
	message text,
	primary key (game_id, chat_id)
) without rowid;

create table if not exists unread_chats (
	user_id integer,
	game_id integer,
	primary key (user_id, game_id)
) without rowid;

drop view if exists game_chat_view;
create view game_chat_view as
	select
		game_id, chat_id, time, name, message
	from
		game_chat
		left join users using(user_id)
	;

create table if not exists game_replay (
	game_id integer,
	replay_id integer,
	role text,
	action text,
	arguments json,
	primary key (game_id, replay_id)
) without rowid;

create table if not exists game_snap (
	game_id integer,
	snap_id integer,
	replay_id integer,
	state text,
	primary key (game_id, snap_id)
);

create table if not exists game_notes (
	game_id integer,
	role text,
	note text,
	primary key (game_id, role)
) without rowid;

create table if not exists players (
	game_id integer,
	role text,
	user_id integer,
	is_invite integer,
	time_used real,
	time_added real,
	score integer,
	primary key (game_id, role)
) without rowid;

create index if not exists player_user_idx on players(user_id);
create index if not exists player_game_user_idx on players(game_id, user_id);

drop view if exists game_view;
create view game_view as
	select
		games.*,
		titles.title_name,
		owner.name as owner_name
	from
		games
		join titles using(title_id)
		left join users as owner
			on owner.user_id = games.owner_id
	;

drop view if exists player_view;
create view player_view as
	select
		game_id,
		user_id,
		name,
		role,
		is_invite,
		(
			case status
			when 0 then
				owner_id = user_id
			when 1 then
				active in ( 'Both', role )
			else
				0
			end
		) as is_active,
		(
			case when pace = 0 then
				21.0 - (julianday() - julianday(mtime))
			else
				case when active in ( 'Both', role ) then
					10.0 - ((julianday() - julianday(mtime)) + time_used - time_added)
				else
					10.0 - (time_used - time_added)
				end
			end
		) as time_left
	from
		games
		join players using(game_id)
		join users using(user_id)
	;

drop view if exists time_control_view;
create view time_control_view as
	select
		game_id,
		user_id,
		role,
		(
			case when pace = 0 then
				21.0 - (julianday() - julianday(mtime))
			else
				10.0 - ((julianday() - julianday(mtime)) + time_used - time_added)
			end
		) as time_left,
		is_opposed
	from
		games
		join players using(game_id)
	where
		status = 1
		and active in ( 'Both', role )
	;

drop view if exists your_turn_reminder;
create view your_turn_reminder as
	select
		game_id, role, user_id, name, mail, notify
	from
		games
		join players using(game_id)
		join users using(user_id)
	where
		status = 1
		and active in (role, 'Both')
		and user_count > 1
		and julianday() > julianday(mtime, '+1 hour')
	;

drop view if exists invite_reminder;
create view invite_reminder as
	select
		game_id, role, user_id, name, mail, notify
	from
		players
		join users using(user_id)
	where
		is_invite = 1
	;

-- Export game state as JSON

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
					'player_count', player_count,
					'notice', notice
				),
			'players',
				(select json_group_array(
						json_object('role', role, 'name', name)
					)
					from players
					join users using(user_id)
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
				),
			'snaps',
				(select json_group_array(
						json_array(replay_id, json(state))
					)
					from game_snap
					where game_id = outer.game_id
				)
		) as export
	from games as outer
	;

-- Trigger to update player counts when players join and part games

drop trigger if exists trigger_join_game;
create trigger trigger_join_game after insert on players
begin
	update
		games
	set
		join_count = ( select count(1) from players where players.game_id = new.game_id ),
		user_count = ( select count(distinct user_id) from players where players.game_id = new.game_id ),
		invite_count = ( select count(1) from players where players.game_id = new.game_id and players.is_invite ),
		mtime = datetime()
	where
		games.game_id = new.game_id;
end;

drop trigger if exists trigger_part_game;
create trigger trigger_part_game after delete on players
begin
	update
		games
	set
		join_count = ( select count(1) from players where players.game_id = old.game_id ),
		user_count = ( select count(distinct user_id) from players where players.game_id = old.game_id ),
		invite_count = ( select count(1) from players where players.game_id = old.game_id and players.is_invite ),
		mtime = datetime()
	where
		games.game_id = old.game_id;
end;

drop trigger if exists trigger_accept_invite;
create trigger trigger_accept_invite after update of is_invite on players
begin
	update
		games
	set
		invite_count = ( select count(1) from players where players.game_id = new.game_id and players.is_invite ),
		mtime = datetime()
	where
		games.game_id = old.game_id;
end;

-- Trigger to update player score when game ends.

drop trigger if exists trigger_update_score;
create trigger trigger_update_score after update of result on games
begin
	update players
		set score = (
			case
				when new.result is null then null
				when new.result = role then 2
				when new.result = 'Draw' then 1
				when instr(new.result, role) then 1
				else 0
			end
		)
	where
		players.game_id = new.game_id
	;
end;

-- Trigger to track time spent!

drop trigger if exists trigger_time_used_update;
create trigger trigger_time_used_update before update of active on games
begin
	update players
		set time_used = time_used + (julianday() - julianday(old.mtime))
	where
		players.game_id = old.game_id and players.role in ( 'Both', old.active );
end;

-- Trigger to remove game data when filing a game as archived

drop trigger if exists trigger_archive_game;
create trigger trigger_archive_game after update of status on games when new.status = 3
begin
	delete from game_state where game_id = old.game_id;
	delete from game_chat where game_id = old.game_id;
	delete from game_replay where game_id = old.game_id;
	delete from game_snap where game_id = old.game_id;
	delete from game_notes where game_id = old.game_id;
	delete from last_notified where game_id = old.game_id;
	delete from unread_chats where game_id = old.game_id;
end;

-- Triggers to clean up without relying on foreign key cascades

drop trigger if exists trigger_delete_on_games;
create trigger trigger_delete_on_games after delete on games
begin
	delete from game_state where game_id = old.game_id;
	delete from game_chat where game_id = old.game_id;
	delete from game_replay where game_id = old.game_id;
	delete from game_snap where game_id = old.game_id;
	delete from game_notes where game_id = old.game_id;
	delete from last_notified where game_id = old.game_id;
	delete from unread_chats where game_id = old.game_id;
	delete from players where game_id = old.game_id;
end;

drop trigger if exists trigger_delete_on_users;
create trigger trigger_delete_on_users after delete on users
begin
	delete from logins where user_id = old.user_id;
	delete from tokens where user_id = old.user_id;
	delete from webhooks where user_id = old.user_id;
	delete from user_last_seen where user_id = old.user_id;
	delete from last_notified where user_id = old.user_id;
	delete from read_threads where user_id = old.user_id;
	delete from unread_chats where user_id = old.user_id;
	delete from contacts where me = old.user_id or you = old.user_id;
	delete from messages where from_id = old.user_id or to_id = old.user_id;
	delete from posts where author_id = old.user_id;
	delete from threads where author_id = old.user_id;
	delete from game_chat where user_id = old.user_id;
	delete from ratings where user_id = old.user_id;
	delete from players where user_id = old.user_id and game_id in (select game_id from games where status <= 1);
	update players set user_id = 0 where user_id = old.user_id;
	update games set owner_id = 0 where owner_id = old.user_id;
end;

drop trigger if exists trigger_delete_on_threads;
create trigger trigger_delete_on_threads after delete on threads
begin
	delete from posts where thread_id = old.thread_id;
	delete from read_threads where thread_id = old.thread_id;
end;

drop trigger if exists trigger_mark_threads_as_unread1;
create trigger trigger_mark_threads_as_unread1 after insert on posts
begin
	delete from read_threads where user_id != new.author_id and thread_id = new.thread_id;
end;

drop trigger if exists trigger_mark_threads_as_unread2;
create trigger trigger_mark_threads_as_unread2 after update on posts
	when new.body != old.body
begin
	delete from read_threads where user_id != new.author_id and thread_id = new.thread_id;
end;

create table if not exists deleted_users (
	user_id integer,
	name text collate nocase,
	mail text collate nocase,
	time datetime default current_timestamp
);

drop trigger if exists trigger_log_deleted_users;
create trigger trigger_log_deleted_users before delete on users begin
	insert into deleted_users (user_id, name, mail) values (old.user_id, old.name, old.mail);
end;

-- Triggers to keep FTS search index up to date

drop trigger if exists trigger_search_insert_thread;
create trigger trigger_search_insert_thread after insert on threads
begin
	insert into forum_search(thread_id, post_id, text) values(new.thread_id, 0, new.subject);
end;

drop trigger if exists trigger_search_update_thread;
create trigger trigger_search_update_thread after update on threads
begin
	delete from forum_search where thread_id=old.thread_id and post_id=0;
	insert into forum_search(thread_id, post_id, text) values(new.thread_id, 0, new.subject);
end;

drop trigger if exists trigger_search_delete_thread;
create trigger trigger_search_delete_thread after delete on threads
begin
	delete from forum_search where thread_id=old.thread_id and post_id=0;
end;

drop trigger if exists trigger_search_insert_post;
create trigger trigger_search_insert_post after insert on posts
begin
	insert into forum_search(thread_id, post_id, text) values(new.thread_id, new.post_id, new.body);
end;

drop trigger if exists trigger_search_update_post;
create trigger trigger_search_update_post after update on posts
begin
	delete from forum_search where post_id=old.post_id;
	insert into forum_search(thread_id, post_id, text) values(new.thread_id, new.post_id, new.body);
end;

drop trigger if exists trigger_search_delete_post;
create trigger trigger_search_delete_post after delete on posts
begin
	delete from forum_search where post_id=old.post_id;
end;
