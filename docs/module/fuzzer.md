# Fuzzing the Troops!

We use [Jazzer.js](https://github.com/CodeIntelligenceTesting/jazzer.js/)
as a coverage-guided fuzzer for automatic testing of module rules.

## What is fuzzing?

Fuzzing or fuzz testing is an automated software testing technique that
involves providing invalid, unexpected, or random data as inputs to a computer
program. With the fuzzer you can test the rules for any RTT module. It will
play random moves and check for unexpected errors.

The fuzzer can detect the following types of errors:

* Any crashes in the rules.js module.
* Dead-end game states where no other actions are available (besides "undo").
* A game taking an excessive number of steps. This could indicate infinite loops and other logical flaws in the rules.

Work files are written to the "fuzzer" directory.

## Running

Start the fuzzer:

	bash tools/fuzz.sh title [ jazzer options... ]

This will run jazzer until you stop it or it has found too many errors.

To keep an eye on the crashes, you can watch the fuzzer/log-title.txt file:

	tail -f fuzzer/log-title.txt

Each fuzzed title gets its own "fuzzer/corpus-title" sub-directory.
The corpus helps the fuzzer find interesting game states in future runs.

To create a code coverage report pass the `--cov` option to fuzz.sh.

## Debug

When the fuzzer finds a crash, it saves the game state and replay log to a JSON file.
You can import the crashed game state like so:

	node tools/import-game.js fuzzer/dump-title-*.json

The imported games don't have snapshots. You can recreate them with the patch-game tool.

	node tools/patch-game.js game_id

## Avoidance

If your rules have actions or rules you don't want to test, guard the code
or action generation by checking if globalThis.RTT_FUZZER is true.

	if (globalThis.RTT_FUZZER) {
		// this code only runs in the fuzzer!
	} else {
		// this code never runs in the fuzzer!
	}
