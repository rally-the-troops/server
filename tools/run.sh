#!/bin/bash
while true
do
	nodemon --exitcrash server.js
	echo Restarting soon...
	sleep 3
done
