# Module Overview

A module consists of a directory containing certain mandatory files which are loaded by the server.
All the other resources needed for a module are also put in this directory.
Note that all of the files in the module will be available on the web.

The module must be put in the server "public" directory, matching the name of title_id.
If our example game has the title "My Example Module" and a title_id of "example",
the module directory should be "public/example/".

## Two halves make one

A module consists of two separate parts:

1. The rules work with actions and their consequences.
2. The client present the game and possible actions to the players.

The rules run on the server. The client runs in the player's browser.
The rules create a view object that is passed to the client, containing the visible game state
and a list of possible actions. The client presents this to the players, and sends the chosen
actions back to the rules for execution.


## Metadata

Each module needs to be registered in the database so that the system can find it.
To do this we create a title.sql file that we source to register the module.

	insert or replace into titles
		( title_id, title_name, bgg )
	values
		( 'example', 'Example', 123 )
	;

The bgg column should have the <a href="httsp://www.boardgamegeek.com/">boardgamegeek.com</a> game id.

After creating this file, source it into the database and restart the server program.

	$ sqlite3 db < public/example/title.sql

## Cover image

Each game needs a cover image! Create a file containing the high resolution cover image named cover.png or cover.jpg. After you have created or modified the cover image, run the following script to generate the small cover images and thumbnails that the site uses.

	$ bash tools/gencovers.sh

<i>This script requires ImageMagick (convert), netpbm (pngtopnm), and libjpeg (cjpeg) tools to be installed.</i>

## About text

The game landing page on the server has a bit of text introducing the game, and links to rules and other reference material.

Put the about text in the about.html file.

	<p>
	Dolorum fugiat dolor temporibus. Debitis ea non illo sed
	debitis cupiditate ipsum illo. Eos eos molestias illo
	quisquam dicta.

	<ul>
	<li> <a href="info/rules.html">Rules</a>
	</ul>

## Options

When creating a game, the scenarios and common options are handled by the system.
However, if your game uses custom options these need to be added as form fields.

Add a create.html file to inject form fields into the create game page.

	<p>
	Player count:
	<br>
	<select name="players">
		<option value="2">2 Player</option>
		<option value="3">3 Player</option>
		<option value="4">4 Player</option>
	</select>

	<p>
	<label>
		<input type="checkbox" value="true" name="house_rule">
		House rule
	</label>

This file may be empty if your game doesn't have any custom options.

## Client HTML

The game needs a play.html file using the following template:

	<!doctype html>
	<html lang="en">
	<head>
		<meta name="viewport" content="width=device-width,
			height=device-height,
			user-scalable=no,
			interactive-widget=resizes-content,
			viewport-fit=cover">
		<meta name="theme-color" content="#444">
		<meta charset="UTF-8">
		<title>
			GAME TITLE
		</title>
		<link rel="icon" href="favicon.svg">
		<link rel="stylesheet" href="/fonts/fonts.css">
		<link rel="stylesheet" href="/common/client.css">
		<link rel="stylesheet" href="play.css">
		<script defer src="/common/client.js"></script>
		<script defer src="play.js"></script>
	</head>
	<body>

	<header>
		<div id="toolbar">
			<details>
				<summary><img src="/images/cog.svg"></summary>
				<menu>
					<li><a href="info/rules.html" target="_blank">Rules</a>
					<li class="separator">
				</menu>
			</details>
		</div>
	</header>

	<aside>
		<div id="roles"></div>
		<div id="log"></div>
	</aside>

	<main data-min-zoom="0.5" data-max-zoom="2.0">
		GAME AREA
	</main>

	<footer id="status"></footer>

	</body>

## Client CSS

Put the game specific stylesheet in play.css.

If the stylesheet is very small you could also include it inline in play.html.

## Client Program

As you saw above, the client page references a play.js script which should
contain the code for updating the game. This script must provide a couple of
functions that are called by the common client code whenever the game state
changes.

### The view object

The view object is passed from the server rules module to the client!

It must contain both some common properties that you shouldn't touch ("log" and
"prompt" and "actions") and all the information you need to display the current
board state.

### Client script globals

These global variables are provided by the framework for use with your code.

<dl>

<dt>var player
<dd>This variable holds the name of the current role the player has in this browser window.
The value may change if the client is in replay mode.

<dt>var view
<dd>This object contains the view for the role as returned by the rules view method.

</dl>

### Client script functions

These functions are provided to your client code to build the game interface and communicate with the server.

<dl>

<dt>function send_action(verb, noun)
<dd>Call this when player performs an action (such as clicking on a piece).
If the action is not in the legal list of actions in the view object,
this function does nothing and returns false. Returns true if the action
is legal.

<dt>function action_button(verb, label)
<dd>Show a push button in the top bar for a simple action (if the action is legal).

<dt>function action_button_with_argument(verb, noun, label)
<dd>Show a push button in the top bar for an action taking a specific argument (if the action with the argument is legal).


<dt>function confirm_send_action(verb, noun, question)
<dd>Same as send_action but pop up a confirmation dialog first.

<dt>function confirm_action_button(verb, label, question)
<dd>Same as action_button but pop up a confirmation dialog first.

<dt>function send_query(what)
<dd>Send a "query" message to the rules. The result will be passed to on_reply.

</dl>

### function on_update()

This function is called whenever the "view" object has updated.
It should update the visible game representation and highlight possible actions.

The client code has already updated the prompt message and log when this is called.

The view.actions object contains the list of legal actions to present.

### function on_prompt(text)

Optional function to implement custom HTML formatting of the prompt text.
If present, this function must return an HTML _string_.

### function on_log(text)

Optional function to implement custom HTML formatting of log messages.
If present, this function must return an HTML _element_ representing the given text.

### function on_reply(what, response)

This function is invoked with the result of send_query.
The what parameter matches the argument to send_query and is used to identify different queries.

See rommel-in-the-desert and wilderness-war for examples of using the query mechanism.

## Rules Program

The rules.js script is loaded by the server.
Certain properties and functions must be provided by the rules module.

> NOTE: See the [module rules](../module/rules.md) documentation if you want to
> use the shared rules framework that provides a structured approach to
> implementing game rules.


### Scenarios

A list of scenarios! If there are no scenarios, it should be a list with one element "Standard".

	exports.scenarios = [ "Standard" ]

### Roles

A list of roles, or a function returning a list of roles.

	exports.roles = [ "White", "Black" ]

	exports.roles = function (scenario, options) {
		if (scenario === "3P")
			return [ "White", "Black", "Red" ]
		else
			return [ "White", "Black" ]
	}

### Setup

	exports.setup = function (seed, scenario, options) {
		var game = {
			seed: seed,
			log: [],
			undo: [],
			active: "White",
		}
		...
		return game
	}

Create the initial game object with a random number seed, scenario, and options object.

The "setup" function takes three parameters provided by the server: the random seed (generated by the server when starting the game), the scenario (a string with the scenario name) and options (a plain javascript object with key/value pairs for the options chosen by the user when creating the game).

The options object is filled in with values from the create.html form fields.

### View

	exports.view = function (game, player) {
		var view = {
			log: game.log,
			...
		}
		if (game.active === player) {
			view.actions = {}
			// generate list of actions
		}
		return view
	}

Given a game object, a player role, return the view object that is used by the client to display the game state.
This should contain game state known to the player.

### Action

	exports.action = function (game, player, verb, noun) {
		// handle action
		return game
	}

Perform an action taken by a player. Return a game object representing the new state. It's okay to mutate the input game object.

### Query

	exports.query = function (game, player, what) {
		if (what === "discard")
			return game.discard[player]
		return null
	}

A custom query for information that is normally not presented.
For example showing a supply line overview, or a list of cards in a discard pile.
