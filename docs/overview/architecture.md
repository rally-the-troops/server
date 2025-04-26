# Architecture Overview

The basic architecture of Rally the Troops is a single server process storing all data in an sqlite database.
This server handles both HTTP requests for the "meta-site" and websocket requests for the rules when playing a game.

## Meta-site

The meta-site consists of all the web pages showing the login, signup, active game lists, the create a game page, forum, etc.
These pages are all created using PUG templates in the "view" directory.
The "join" page is the most complicated, and also uses javascript and server sent events for live updates.

## Database

See the [database overview](database.md) for a brief introduction to the tables involved.

## Client/Server

When playing a game, the browser (client) connects to the server with a web socket.
The query string indicates which game and role to connect to.

The game state is stored in a JSON object. A redacted version of this game state is sent to the clients, which then update the game display in real time.
One part of the view object is a list of possible actions a player can take.
When a player clicks on a possible action, a message is sent to the server with this action.
The server then processes the action, updates the game state, and sends out a new view object to all the clients that are connected to the game.

The client code for connecting to the server, sending actions, and managing the player list, game log, chat, and notes is shared between all modules.
The following files contain the code and styling for the client display:

* <a href="https://git.rally-the-troops.com/common/server/tree/public/fonts/fonts.css">public/fonts/fonts.css</a>
* <a href="https://git.rally-the-troops.com/common/server/tree/public/common/client.css">public/common/client.css</a>
* <a href="https://git.rally-the-troops.com/common/server/tree/public/common/client.js">public/common/client.js</a>

## Tools

The "tools" directory holds a number of other useful scripts for administrating the server and debugging modules.

	bash tools/export-game.sh game_id > file.json
		Export full game state to a JSON file.

	node tools/import-game.js file.json
		Import a game from an export JSON file.

	node tools/patchgame.js game_id
		Patch game state for one game (by replaying the action log).

	node tools/patchgame.js title_id
		Patch game state for all active games of one module.

	bash tools/undo.sh game_id
		Undo an action by removing the last entry in the replay log and running patchgame.js

	bash tools/showgame.sh game_id
		Print game state JSON object for debugging.

<!--
	bash tools/gencovers.sh
		Generate cover images and thumbnails. Requires imagemagick.
-->
