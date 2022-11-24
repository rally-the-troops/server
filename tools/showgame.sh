#!/bin/bash
if [ -n "$1" ]
then
	sqlite3 db "select json_remove(json_remove(state, '$.undo'), '$.log') from game_state where game_id = $1"
else
	echo "usage: bash tools/showgame.sh GAME"
fi
