#!/bin/bash
if [ -n "$1" ]
then
	if [ -n "$2" ]
	then
		COUNT=$2
	else
		COUNT=$(sqlite3 db "select coalesce(max(replay_id),0) from game_replay where game_id=$1")
		echo Game has $COUNT actions.
	fi
	sqlite3 db "delete from game_replay where game_id=$1 and replay_id>=$COUNT"
	node tools/patchgame.js $1 '{"validate_actions":false}'
else
	echo "usage: bash tools/undo.sh GAME"
fi
