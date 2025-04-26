"use strict"

const crypto = require('crypto')
const fs = require("fs")
const path = require("path")
const { FuzzedDataProvider } = require("@jazzer.js/core")

const RULES_JS_FILE = process.env.RULES || "rules.js"
const MAX_ERRORS = parseInt(process.env.MAX_ERRORS || 100)
const MAX_STEPS = parseInt(process.env.MAX_STEPS || 10000)
const TIMEOUT = parseInt(process.env.TIMEOUT || 250)

console.log(`Loading fuzzer ${RULES_JS_FILE}`)

const rules = require(RULES_JS_FILE)
const title_id = path.basename(path.dirname(RULES_JS_FILE))

var error_count = 0

globalThis.RTT_FUZZER = true

exports.fuzz = function (fuzzerInputData) {
	var data = new FuzzedDataProvider(fuzzerInputData)
	if (data.remainingBytes < 16) {
		// insufficient bytes to start
		return
	}

	var scenarios = Array.isArray(rules.scenarios) ? rules.scenarios : Object.values(rules.scenarios).flat()
	var scenario = data.pickValue(scenarios)
	if (scenario.startsWith("Random"))
		return

	var timeout = Date.now() + TIMEOUT

	var options = {} // TODO: randomize options

	var roles = rules.roles
	if (typeof roles === "function")
		roles = roles(scenario, options)

	var seed = data.consumeIntegralInRange(1, 2 ** 35 - 31)

	var ctx = {
		player_count: roles.length,
		players: roles.map((r, ix) => ({ role: r, name: "rtt-fuzzer-" + (ix+1) })),
		scenario,
		options,
		replay: [],
		state: {},
		active: null,
		step: 0,
	}

	ctx.replay.push([ null, ".setup", [ seed, scenario, options ] ])
	ctx.state = rules.setup(seed, scenario, options)

	while (ctx.state.active && ctx.state.active !== "None") {

		// insufficient bytes to continue
		if (data.remainingBytes < 16)
			return

		ctx.active = ctx.state.active

		// If multiple players can act, we'll pick a random player to go first.
		if (Array.isArray(ctx.active))
			ctx.active = data.pickValue(ctx.active)
		if (ctx.active === "Both")
			ctx.active = data.pickValue(roles)

		try {
			ctx.view = rules.view(ctx.state, ctx.active)
		} catch (e) {
			return log_crash(e, ctx)
		}

		if (ctx.step > MAX_STEPS)
			return log_crash("MaxSteps", ctx)
		if (Date.now() > timeout)
			return log_crash("Timeout", ctx)

		if (ctx.view.prompt && ctx.view.prompt.startsWith("TODO:"))
			return log_crash(ctx.view.prompt, ctx)

		if (!ctx.view.actions)
			return log_crash("NoMoreActions", ctx)

		var actions = Object.entries(ctx.view.actions).filter(([ action, args ]) => {
			// remove undo from action list (useful to test for dead-ends)
			if (action === "undo")
				return false
			// remove disabled buttons from action list
			if (args === 0 || args === false)
				return false
			return true
		})

		if (actions.length === 0)
			return log_crash("NoMoreActions", ctx)

		var [ action, args ] = data.pickValue(actions)
		var arg = undefined
		if (Array.isArray(args)) {
			for (arg of args) {
				if (typeof arg !== "number")
					return log_crash(`BadActionArgs: ${action} ${JSON.stringify(args)}`, ctx)
			}
			arg = data.pickValue(args)
		} else if (args !== 1 && args !== true) {
			return log_crash(`BadActionArgs: ${action} ${JSON.stringify(args)}`, ctx)
		}

		var prev_state = object_copy(ctx.state)

		try {
			ctx.state = rules.action(ctx.state, ctx.active, action, arg)
			if (typeof rules.assert === "function")
				rules.assert(ctx.state)
		} catch (e) {
			ctx.state = prev_state
			return log_crash(e, ctx, action, arg)
		}

		ctx.replay.push([ ctx.active, action, arg ])

		if (ctx.state.undo.length > 0) {
			if (String(prev_state.active) !== String(ctx.state.active))
				return log_crash("UndoAfterActiveChange", ctx, action, arg)
			if (prev_state.seed !== ctx.state.seed)
				return log_crash("UndoAfterRandom", ctx, action, arg)
		}

		ctx.step += 1
	}
}

function log_crash(message, ctx, action = undefined, arg = undefined) {
	if (message instanceof Error)
		message = message.stack

	var line = `ERROR=${message}`
	line += `\n\tTITLE=${title_id} ACTIVE=${ctx.active} STATE=${ctx.state?.state ?? ctx.state?.L?.P} STEP=${ctx.step}`
	line += "SETUP=" + JSON.stringify(ctx.replay[0][2])
	if (action !== undefined) {
		line += `\n\t\tACTION=${action}`
		if (arg !== undefined)
			line += JSON.stringify(arg)
	}

	var game = {
		setup: {
			title_id,
			scenario: ctx.scenario,
			options: ctx.options,
			player_count: ctx.player_count,
		},
		players: ctx.players,
		state: ctx.state,
		replay: ctx.replay,
	}

	var json = JSON.stringify(game)
	var hash = crypto.createHash("sha1").update(json).digest("hex")
	var dump = `fuzzer/dump-${title_id}-${hash}.json`

	line += "\n\tDUMP=" + dump

	if (!fs.existsSync(dump)) {
		console.log(line)
		fs.writeFileSync(dump, json)
	} else {
		console.log(line)
	}

	if (++error_count >= MAX_ERRORS)
		throw new Error("too many errors")
}

function object_copy(original) {
	var copy, i, n, v
	if (Array.isArray(original)) {
		n = original.length
		copy = new Array(n)
		for (i = 0; i < n; ++i) {
			v = original[i]
			if (typeof v === "object" && v !== null)
				copy[i] = object_copy(v)
			else
				copy[i] = v
		}
		return copy
	} else {
		copy = {}
		for (i in original) {
			v = original[i]
			if (typeof v === "object" && v !== null)
				copy[i] = object_copy(v)
			else
				copy[i] = v
		}
		return copy
	}
}
