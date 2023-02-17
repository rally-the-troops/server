#!/bin/bash
if [ -n "$1" ]
then
	RID=$(sqlite3 db "select replay_id from game_replay where game_id=$1 order by replay_id desc limit 1")
	echo $RID
	sqlite3 db "delete from game_replay where game_id=$1 and replay_id=$RID"
	node tools/patchgame.js $1
else
	echo "usage: bash tools/undo.sh GAME"
fi
