#!/bin/bash
# Restore purged game state from archive.

if [ -z "$1" ]
then
        echo 'usage: bash tools/unarchive.sh <gameid>'
        exit 1
fi

sqlite3 db << EOF

attach database 'archive.db' as archive;

begin;

select 'RESTORE ' || $1 || ' FROM ARCHIVE';

.mode table
select * from archive.games where game_id = $1;

insert or replace into game_state (game_id, state)
	select game_id, state
	from archive.game_state where game_id = $1;

insert or replace into game_replay (game_id, replay_id, role, action, arguments)
	select game_id, replay_id, role, action, arguments
	from archive.game_replay where game_id = $1;

insert or replace into game_chat (game_id, chat_id, user_id, time, message)
	select game_id, chat_id, user_id, time, message
	from archive.game_chat where game_id = $1;

commit;

EOF
