#!/bin/bash
if [ -n "$1" ]
then
	sqlite3 db "select export from game_export_view where game_id=$1"
else
	echo "usage: bash tools/export-game.sh GAME > game.json"
fi

