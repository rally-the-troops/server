#!/bin/bash
if [ -n "$1" -a -f "$2" ]
then
	sqlite3 db "update game_state set state=readfile('$2') where game_id = $1"
else
	echo "usage: bash tools/writegame.sh GAME state.json"
fi
