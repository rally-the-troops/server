#!/bin/bash
forever start -a --uid rally --killSignal=SIGTERM -c 'nodemon --exitcrash' server.js
