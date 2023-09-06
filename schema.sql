-- Blacklists --

create table if not exists blacklist_mail ( mail text primary key ) without rowid;

-- Titles --

create table if not exists titles (
	title_id text primary key,
	title_name text,
	bgg integer,
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
	notify boolean default 0,
	is_banned boolean default 0,
	ctime datetime default current_timestamp,
	password text,
	salt text,
	about text
);

insert or ignore into
	users (user_id, name, mail, ctime)
	values (0, 'Deleted', 'deleted@rally-the-troops.com', null)
;

create table if not exists user_last_seen (
	user_id integer primary key,
	atime datetime
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
		natural left join user_last_seen
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
				join game_state using(game_id)
			where
				status = 1
				and players.user_id = users.user_id
				and active in ( players.role, 'Both', 'All' )
		) + (
			select
				count(*)
			from
				players
			where
				players.user_id = users.user_id
				and players.is_invite
		) as active,
		is_banned
	from
		users
	;

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

drop table if exists forum_search;
create virtual table forum_search using fts5(thread_id, post_id, text, tokenize='porter unicode61');
insert into forum_search(thread_id,post_id,text) select thread_id, 0, subject from threads;
insert into forum_search(thread_id,post_id,text) select thread_id, post_id, body from posts;

-- Games --

create table if not exists games (
	game_id integer primary key,
	title_id text,
	scenario text,
	options text,
	owner_id integer,
	ctime datetime default current_timestamp,
	is_private boolean default 0,
	is_random boolean default 0,
	notice text,
	status integer default 0,
	result text,
	xtime datetime
);

create index if not exists games_title_idx on games(title_id);
create index if not exists games_status_idx on games(status);

create table if not exists game_state (
	game_id integer primary key,
	mtime datetime,
	active text,
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
		natural join users
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
		coalesce(game_state.mtime, xtime) as mtime,
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
		and julianday() > julianday(mtime, '+1 hour')
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

-- Trigger to remove game data when filing a game as archived

drop trigger if exists trigger_archive_game;
create trigger trigger_archive_game after update on games when new.status = 3
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
	delete from players where user_id = old.user_id;
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
