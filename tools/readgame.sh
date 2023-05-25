#!/bin/bash
if [ -n "$1" -a -n "$2" ]
then
	sqlite3 db "select writefile('$2',state) from game_state where game_id = $1"
elif [ -n "$1" ]
then
	sqlite3 db "select state from game_state where game_id = $1"
else
	echo "usage: bash tools/readgame.sh GAME [ state.json ]"
fi
