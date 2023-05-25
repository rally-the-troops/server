#!/bin/bash
sqlite3 db "select * from game_replay where game_id=$1"
