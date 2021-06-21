#!/bin/bash

# Clean out stale games from the database.

sqlite3 db "DELETE FROM games WHERE status = 0 AND mtime < datetime('now', '-7 days')"
sqlite3 db "UPDATE games SET status = 3 WHERE status = 1 AND mtime < datetime('now', '-14 days')"
