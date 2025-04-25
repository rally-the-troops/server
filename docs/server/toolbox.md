# Toolbox

There are a few programs that help maintain the database and are useful to
develop and debug modules.

## Setup

These programs can be invoked from the command line by running the "rtt"
command that is found in the "bin" directory.
I suggest creating a symlink to the "rtt" command somewhere in your PATH.

	ln -s ~/server/bin/rtt ~/.local/bin

Alternatively, you can edit your .profile to add the server bin directory to your PATH.

	PATH=$PATH:$HOME/server/bin

## Commands

database management

	init	-- create database
	run	-- run server
	backup	-- backup database

game management

	export	-- export game
	import	-- import game
	patch	-- patch game state (using replay)
	undo	-- rewind game state (using replay)

module development

	foreach		-- run a command for each module
	fuzz		-- fuzz test a module

game debugging

	show-chat	-- show game chat (for moderation)
	show-game	-- show game state object
	show-replay	-- show game replay log

miscellaneous tools

	update-covers	-- generate cover thumbnails
	update-elo	-- recalculate Elo ratings

## Miscellaneous

The "tools" directory holds various useful bits and bobs.

