attach database 'old.db' as old;

pragma foreign_keys = on;

.read tools/sql/schema.txt

-- Drop triggers while migrating data:
drop trigger no_join_on_active_game;

BEGIN;

.read tools/sql/data-300-ew.txt
.read tools/sql/data-caesar.txt
.read tools/sql/data-crusader.txt
.read tools/sql/data-hammer.txt
.read tools/sql/data-richard.txt
.read tools/sql/data-tripoli.txt

insert into users
        (user_id,name,mail,notify,password,salt,ctime,about)
values
	(0, 'Deleted', 'deleted@rally-the-troops.com', 0, '', '', '1970-01-01 00:00:00', 'Deleted user.');

-- Users

insert into users (
        user_id,name,mail,notify,password,salt,ctime,about
) select
        user_id,name,mail,notifications,password,salt,ctime,about
from old.users;

insert into user_last_seen (
        user_id,atime,aip
) select
        user_id,atime,aip
from old.users;

insert into tokens (
        user_id,token,time
) select
        user_id,token,time
from old.tokens;

-- Messages and Forum

insert into messages (
        message_id,from_id,to_id,time,subject,body,read,deleted_from_inbox,deleted_from_outbox
) select
        message_id,from_id,to_id,time,subject,body,read,deleted_from_inbox,deleted_from_outbox
from old.messages;

insert into threads (
	thread_id,author_id,subject,locked
) select
	thread_id,author_id,subject,locked
from old.threads;

insert into posts (
	post_id,thread_id,author_id,ctime,mtime,body
) select
	post_id,thread_id,author_id,ctime,mtime,body
from old.posts;

-- Games

insert into games (
	game_id,title_id,scenario,options,owner_id,ctime,private,random,description,status,result
) select
	game_id,title_id,scenario,options,owner_id,ctime,private,random,description,status,result
from old.games;

insert into game_state (
	game_id,mtime,active,state
) select
	game_id,mtime,active,state
from old.games;

insert into game_chat (
	game_id,time,user_id,message
) select
	game_id
	, datetime(json_extract(value,'$[0]')) AS time
	, (select user_id from old.users where name=json_extract(value,'$[1]'))
	, json_extract(value,'$[2]')
from old.chats, json_each(chat,'$')
order by time;

insert into game_replay (
	game_id,time,role,action,arguments
) select
	game_id,time,role,action,arguments
from old.replay;

insert into players (
	user_id,game_id,role
) select
	user_id,game_id,role
from old.players;

-- Foo

insert into last_notified (
        game_id,user_id,time
) select
        game_id,user_id,time
from old.notifications;

COMMIT;

-- re-enable triggers
.read tools/sql/schema.txt
