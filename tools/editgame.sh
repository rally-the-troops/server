#!/bin/bash
if [ -n "$1" -a -n "$VISUAL" ]
then
	sqlite3 db "update games set state=edit(state) where game_id = $1"
else
	echo "usage: bash tools/editgame.sh GAME"
	echo "note: \$VISUAL must be set to your preferred editor"
fi
