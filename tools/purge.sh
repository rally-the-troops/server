#!/bin/bash

# Clean out stale games from the database.

WHERE_TIMEOUT_OPEN="WHERE status = 0 AND mtime < datetime('now', '-7 days')"
WHERE_TIMEOUT_ACTIVE="WHERE status = 1 AND mtime < datetime('now', '-14 days')"

echo "--- TIMED OUT OPEN GAMES ---"
sqlite3 db "SELECT * FROM game_view $WHERE_TIMEOUT_OPEN"
sqlite3 db "DELETE FROM games $WHERE_TIMEOUT_OPEN"

echo "--- TIMED OUT ACTIVE GAMES ---"
sqlite3 db "SELECT * FROM game_view $WHERE_TIMEOUT_ACTIVE"
sqlite3 db "UPDATE games SET status = 3 $WHERE_TIMEOUT_ACTIVE"
