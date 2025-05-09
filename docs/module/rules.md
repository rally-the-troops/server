# Rules Framework

The rules.js file contains the logic of the game!

This is exposed to the system via a handful of exported properties and functions.

All of the board state is represented as a plain JS object that is passed to
and returned from these functions.

See the [module overview](../overview/module.md) for the details.

## Copy & Paste

In order to simplify rules creation, there is a shared library of code that
does some of the work and provides a structured approach to handling control
flow through the game.

A copy of this code can be found in the server repository in
[public/common/framework.js](https://git.rally-the-troops.com/common/server/tree/public/common/framework.js)

This framework.js file provides implementations of all of the necessary exports,
a game state management system, random number generator, undo handling, and
several other useful functions.

Include a copy of this file at the end of rules.js to get started!

> Note: We can't "require" it as a module because it needs access to the rules.js specific scope;
> so unfortunately you'll just have to include a copy of it.

## Prolog

The framework uses several global variables that must be defined near the top of the file.


	var G, L, R, V

You also need to define the states and procedures tables.

	const S = {}
	const P = {}

The rules need a list of player roles. The index of each role in the array determines their numeric value.

	const ROLES = [ "White", "Black" ]

	// mnemonics for use in the rules
	const R_WHITE = 0
	const R_BLACK = 1

If there are multiple scenarios, define them in a list:

	const SCENARIOS = [
		"Wars of the Roses",
		"Kingmaker",
		"Richard III",
	]

## Globals

The framework uses four main global variables.

### R - who are you?

Whenever the system executes code to handle user actions or populate the user
view object, the R global is set to the index of the corresponding user. You
should rarely need to use this outside of on_view, but when multiple users are
active simultaneously, use R to distinguish between them in the action handlers.

### G - the (global) game state

This object contains the full representation of the game.
There are several properties here that are special!

	G.L		// local scope (aliased as L below)
	G.seed		// random number generator state
	G.log		// game log text
	G.undo		// undo stack
	G.active	// currently active role (or roles)

Add to G any data you need to represent the game board state.

The G.L, G.seed, G.log, and G.undo properties are automatically managed; you should never need to touch these.

The G.active is used to indicate whose turn it is to take an action.
It can be set to a single role index, or an array of multiple roles.

	G.active = R_WHITE
	G.active = [ R_WHITE, R_BLACK ]

###  L - the (local) game state

There is a local scope for storing data that is only used by a particular state.
This local scope has reserved properties ("P", "I", and "L") that you must not touch!
These properties are used to track the execution of scripts and where to go next.

### V - the view object

The view object that is being generated for the client is held in V during
the execution of the on_view hook and the state prompt functions (see below).

## Setup

You must provide the on_setup function to setup the game with the initial board state.

At the end of the function you must transition to the first game state by invoking call.

	function on_setup(scenario, options) {
		G.active = R_WHITE
		G.pieces = [ ... ]
		call("main")
	}

## View

The client needs a view object to display the game state. We can't send the
full game object to the client, because that would reveal information that
should be hidden to some or all players. Use the on_view function to populate
the V object with the data that should be presented to the player.

Use the R object to distinguish who the function is being called for.

	function on_view() {
		V.pieces = G.pieces
		if (R === R_BRITAIN)
			V.hand = G.hand[R_BRITAIN]
		if (R === R_FRANCE)
			V.hand = G.hand[R_FRANCE]
	}

## The Flow Chart

---

Consider the rules logic as a state machine, or a flow chart.

At each "box" it pauses and waits for the active player to take an action. Once
an action is taken, the game proceeds along the action "arrow", changing what
needs to be changed (like moving a piece) along the way, before stopping at the
next "box".

These "boxes" are game states, and the "arrows" are transitions between states.

In simple games that's all there is to it, but in more complicated games you
sometimes want to share logic at different points in the sequence of play (like
common handling of taking casualties whether it's from a battle or winter
attrition).

In order to support this, we can recursively "nest" the states.

---

The game is defined by a mix of states, scripts, and functions.

The basic game flow consists of a set of "procedures" which are
interrupted by "states" that prompt the players to perform actions.

The game stops at states, prompting the user for input.
When an action is chosen, the transition to another state can happen
in a few different ways:

End the current state and go back to the previous state or procedure that called this one.

Call another state or procedure.

Goto another state or procedure (combination of calling and ending).

The game holds a stack of states (and their environments).
Each state and procedure runs in its own scope (accessed via the L namespace).
There's also a global scope for the main game data (via the G namespace).

---

The state stack is implmented as a linked list (G.L is the head of the linked
list, and G.L.L is the next state down the stack, etc.) Invoking call pushes a
new state at the top of the stack; goto replaces the current top of the stack,
and end pops the stack.

## States

The "states" where we wait for user input are kept in the S table.

Each state is an object that provides several functions.

	S.place_piece = {
		prompt() {
			prompt("Select a piece to move.")
			for (var s = 0; s < 64; ++s)
				if (G.board[s] === 0)
					action("space", s)
			button("pass")
		},
		space(s) {
			log("Placed piece at " + s)
			G.board[s] = 1
			end()
		},
		pass() {
			log("Passed")
			end()
		},
	}

### S.state.prompt()

The prompt function is called for each active player to generate a list of
valid actions.

To show a text prompt to the user:

	prompt("Do something!")

To generate a valid action use one of the following functions:

	function action(name, value)

To generate a push button action:

	function button(name)
	function button(name, enabled)

To show an enabled/disabled push button, use a boolean in the second argument:

	button("pass", can_player_pass())

It's sometimes helpful to define simple wrapper functions to save on typing and
reduce the risk of introducing typos.

	function action_space(s) {
		action("space", s)
	}

> Note: The on_view function should NEVER change any game state!

### S.state.action()

When a player chooses a valid action, the function with the action name is
invoked!

Use the action handler function to perform the necessary changes to the game
state, and transition to the next state using one of the state transition
functions "call", "goto", or "end".

To add entries to the game log:

	log(ROLES[R] + " did something!")

Calling log with no arguments inserts a blank line:

	log()

### S.state._begin() and _resume() and _end()

These functions are invoked when the state is first entered, when control returns
to the state (from a nested state), and when the state is departed.

You can use this to do some house-keeping or initialize the L scope.

	S.remove_3_pieces = {
		_begin() {
			L.count = 3
		},
		prompt() {
			...
		},
		piece(p) {
			remove_piece(p)
			if (--L.count === 0)
				end()
		}
	}


## State transitions

When transitioning to another state in an action handler, it must be the last thing you do!

> You cannot sequence multiple invocations to "call" in a normal function!

See "procedures" below for a way to string together multiple states.

### call - enter another state

To recursively go to another state, use the call() function.

This will transfer control to the named state or procedure, and once that has
finished, control will come back to the current state.

The second argument (if present) can be an object with the initial scope.
The L scope for the new state is initialized with this data.

	call("remove_pieces", { count: 3 })

### end - return from whence we came

Calling end() will return control to the calling state/procedure.

If you pass an argument to end, that will be available to the caller as `L.$`.

### goto - exit this state to go to the next

The goto() function is like call() and end() combined. We exit the current state and jump to the next.
Use this to transition to another state when you don't need to return to the current state afterwards.

## Procedures

Sometimes state transitions can become complicated.

In order to make the code to deal with them easier, you can define procedures in the "P" table,

Procedures defined by the "script" function are executed by the framework.
They can sequence together states and other procedures.

Calling a state will enter that state, and execution of the caller will resume
where it left off when the called state ends. You can also recursively call other procedures.

	P.hammer_of_the_scots = script (`
		for G.year in 1 to 7 {
			call deal_cards
			for G.round in 1 to 5 {
				set G.active [ R_ENGLAND, R_SCOTLAND ]
				call choose_cards
				call reveal_cards
				set G.active G.p1
				call movement_phase
				set G.active G.p2
				call movement_phase
				set G.active G.p1
				call combat_phase
			}
			call winter_phase
		}
	`)

See [script syntax](script) for the commands available in this simple scripting language.

### Plain function procedures

Procedures can also be plain Javascript functions! There is normally no reason
to use a plain procedure over simply calling a function, but if you want them
to be part of a larger script sequence this can make it easier.

Note that a plain function procedure must transition somewhere else before it
returns, either via "goto" or "end".

It's also a neat way to define events; to dispatch based on a string.

	S.strategy_phase = {
		...
		play_event(c) {
			goto(data.events[c].event)
		},
	}

	P.the_war_ends_in_1781 = function () {
		G.war_ends = 1781
		end()
	}

	P.major_campaign = script (`
		call activate_general
		call activate_general
		call activate_general
	`)


## Ending the game

To signal the termination of a game, call the finish function.

	function finish(result, message)

The result must be either the index of the role that won, the string "Draw", 
or any other string to indicate that nobody won.

The message will both be logged and used as the text prompt.

	finish(R_WHITE, "White has won!")
	finish("Draw", "It's a tie!")
	finish("None", "Nobody won.")

Calling finish will abort the current scripts and/or states.

## Random number generator

There is a pseudo-random number generator included in the framework.

> Do NOT use Math.random!

Games must be reproducible for the replay and debugging to work, so
the system initializes the PRNG with a random seed on setup. The random
number generator state is stored in G.seed.

To generate a new random number between 0 and range:

	function random(range)

To shuffle an array (for example a deck of cards):

	function shuffle(list)

## Undo

Undo is handled by taking snapshots of the game state. Generating the undo
action and handling it is taken care of by the framework. You only need to
create and clear the checkpoints at suitable times.

Call push_undo at the top of each action you want to be able to undo.

Don't forget to call clear_undo whenever hidden information is revealed or any
random number is generated.

	function roll_die() {
		clear_undo()
		return random(6) + 1
	}

Whenever the active player changes, the undo stack is automatically cleared.

## Miscellaneous utility functions

The framework also includes a library of useful functions to work
with sorted sets, maps, etc.

See the [utility library](library) for how to use these.

