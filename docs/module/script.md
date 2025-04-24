# Script Syntax

The script function compiles a simple scripting language to a list of
instructions that are executed by the framework.
The argument to the script function is a plain text string,
so use multiline backtick string quotes.

The script language syntax is very similar to Tcl and is based on space
separated list of "words".

A word can be any sequential string of non-whitespace characters.
Words can also be "quoted", ( parenthesized ), { bracketed } or [ braced ].
Any whitespace characters (including line breaks) are permitted within these quoted strings.
Parenthesises, brackets, and braces must be balanced!

Each line of words is parsed as a command.
The first word defines a command, and the remaining words are arguments to that command.

Control flow commands can take "blocks" as arguments. These words are parsed
recursively to form further lists of commands.

Some commands take "expressions" as arguments.
These words are included verbatim as Javascript snippets.

## Eval

To run any snippet of Javascript, you can include it verbatim with the eval command.

	eval <expr>

Example:

	eval {
		do_stuff()
	}

## Variables

The set, incr, and decr commands set, increment, and decrement a variable.
This can be done with the eval command, but using these commands is shorter.

	set <lhs> <expr>
	incr <lhs>
	decr <lhs>

Example:

	set G.active P_ROME
	set G.active (1 - G.active)
	incr G.turn
	decr L.count

## Log

A shorter way to print a log message to the game log:

	log <expr>

	log "Hello, world!"

## State transitions

Use call to invoke another state or procedure (with an optional environment scope).

	call <name> <env>
	call <name>

Use goto to jump to another state or procedure without coming back (a tail call).

	goto <name> <env>
	goto <name>

Use return to exit the current procedure.
This is equivalent to the end function used in states and function procedures.

	return <expr>
	return

Examples:

	call movement { mp: 4 }
	goto combat_phase
	return L.who


## Loops

Loops come in three flavors:

	while <expr> <block>
	for <lhs> in <expr> <block>
	for <lhs> in <expr> to <expr> <block>

A while loop has full control:

	set G.turn 1
	while (G.turn <= 3) {
		call turn
		incr G.turn
	}

Iterating over a range with for is easiest:

	for G.turn in 1 to 3 {
		call turn
	}

Note that the list expression in a for statement is re-evaluated each iteration!

	for G.turn in [1, 2, 3] {
		call turn
	}

## Branches

The if-else command is used for branching code.

	if <expr> <block> else <block>
	if <expr> <block>

Example:

	if (G.month < 12) {
		call normal_turn
	} else {
		call winter_turn
	}

## Return

Use return (or the end() function in states and function procedures) to
pass information up the call chain.

	S.greeting = {
		prompt() {
			button("hello")
			button("goodbye")
		},
		hello() {
			end("hello")
		},
		goodbye() {
			end("goodbye")
		},
	}

	P.example = script (`
		call greeting
		if (L.$ === "hello") {
			goto hello_world
		}
		if (L.$ === "goodbye") {
			goto goodbye_cruel_world
		}
	`)
