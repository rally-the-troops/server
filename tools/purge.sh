#!/bin/bash

# Clean out stale games from the database.

WHERE_TIMEOUT_OPEN="WHERE status = 0 AND mtime < datetime('now', '-7 days')"
WHERE_TIMEOUT_ACTIVE="WHERE status = 1 AND mtime < datetime('now', '-14 days')"
WHERE_TIMEOUT_SOLO="WHERE status = 2 AND mtime < datetime('now', '-3 months') AND is_solo=1"

echo "--- TIMED OUT OPEN GAMES ---"
sqlite3 db -cmd "pragma foreign_keys=1" "SELECT * FROM game_view $WHERE_TIMEOUT_OPEN"
sqlite3 db -cmd "pragma foreign_keys=1" "DELETE FROM games WHERE game_id IN ( SELECT game_id FROM game_view $WHERE_TIMEOUT_OPEN )"

echo "--- TIMED OUT ACTIVE GAMES ---"
sqlite3 db -cmd "pragma foreign_keys=1" "SELECT * FROM game_view $WHERE_TIMEOUT_ACTIVE"
sqlite3 db -cmd "pragma foreign_keys=1" "UPDATE games SET status = 3 WHERE game_id IN ( SELECT game_id FROM game_view $WHERE_TIMEOUT_ACTIVE )"

echo "--- ANCIENT SOLO GAMES ---"
sqlite3 db -cmd "pragma foreign_keys=1" "SELECT * FROM game_full_view $WHERE_TIMEOUT_SOLO"
sqlite3 db -cmd "pragma foreign_keys=1" "UPDATE games SET status = 3 WHERE game_id IN ( SELECT game_id FROM game_full_view $WHERE_TIMEOUT_SOLO )"

echo "--- DELETED MESSAGES ---"
sqlite3 db -cmd "pragma foreign_keys=1" "SELECT message_id, from_name, to_name, subject FROM message_view WHERE is_deleted_from_inbox=1 AND is_deleted_from_outbox=1"
sqlite3 db -cmd "pragma foreign_keys=1" "DELETE FROM messages WHERE is_deleted_from_inbox=1 AND is_deleted_from_outbox=1"

sqlite3 db -cmd "pragma foreign_keys=1" "DELETE FROM game_replay WHERE game_id < 1346"
