"use strict"

const fs = require("node:fs")
const crypto = require("node:crypto")

var MAX_TIMEOUT = parseInt(process.env.MAX_TIMEOUT || 250)
var MAX_ERRORS = parseInt(process.env.MAX_ERRORS || 100)
var MAX_STEPS = parseInt(process.env.MAX_STEPS || 10000)
var TITLE = process.env.TITLE
var SCENARIO = process.env.SCENARIO
var scenarios

var rules = require("../public/" + TITLE + "/rules.js")
if (Array.isArray(rules.scenarios))
	scenarios = rules.scenarios.filter(n => !n.startsWith("Random"))
else
	scenarios = Object.values(rules.scenarios).flat().filter(n => !n.startsWith("Random"))

var errors = 0

console.log("Fuzzing", { TITLE, MAX_TIMEOUT, MAX_ERRORS, MAX_STEPS })

globalThis.RTT_FUZZER = true

class MyRandomProvider {
	constructor(seed) {
		this.seed = seed
	}
	get remainingBytes() {
		return 1 << 20
	}
	consumeIntegralInRange(min, max) {
		var range = max - min + 1
		this.seed = Number(BigInt(this.seed) * 5667072534355537n % 9007199254740881n)
		// this.seed = this.seed * 200105 % 34359738337
		return min + this.seed % range
	}
	pickValue(array) {
		return array[this.consumeIntegralInRange(0, array.length - 1)]
	}
}

class MyBufferProvider {
	constructor(data) {
		this.data = data
		this.offset = 0
	}
	get remainingBytes() {
		return this.data.length - this.offset
	}
	consumeIntegralInRange(min, max) {
		if (min >= max) return min
		if (this.offset >= this.data.length) return min
		var range = max - min + 1
		var n = Math.min(this.data.length - this.offset, Math.ceil(Math.log2(range) / 8))
		var result = this.data.readUIntBE(this.offset, n)
		this.offset += n
		return min + (result % range)
	}
	pickValue(array) {
		return array[this.consumeIntegralInRange(0, array.length - 1)]
	}
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

function list_roles(scenario, options) {
	if (typeof rules.roles === "function")
		return rules.roles(scenario, options)
	return rules.roles
}

function list_actions(R, V) {
	var actions = []
	if (V.actions) {
		for (var act in V.actions) {
			var arg = V.actions[act]
			if (act === "undo" || act === "ping") {
				// never undo
				// never ping
			} else if (arg === 0 || arg === false) {
				// disabled button
			} else if (arg === 1 || arg === true) {
				// enabled button
				actions.push([ R, act ])
			} else if (Array.isArray(arg)) {
				// action with arguments
				for (arg of arg) {
					if (typeof arg !== "number" && typeof arg !== "string")
						throw new Error("invalid action: " + act + " " + arg)
					actions.push([ R, act, arg ])
				}
			} else if (typeof arg === "string") {
				// julius caesar string-button
				actions.push([ R, act ])
			} else {
				throw new Error("invalid action: " + act + " " + arg)
			}
		}
	}
	return actions
}

function fuzz(input) {
	var timeout = Date.now() + MAX_TIMEOUT
	var steps = 0

	var data
	if (typeof input === "number")
		data = new MyRandomProvider(input)
	else
		data = new MyBufferProvider(input)

	var seed = data.consumeIntegralInRange(1, 2 ** 35 - 31)
	var scenario = SCENARIO ?? data.pickValue(scenarios)
	var options = {} // TODO: select random options

	var roles = list_roles(scenario, options)
	var ctx = {
		seed: input,
		setup: {
			title_id: TITLE,
			scenario,
			options,
			player_count: roles.length,
		},
		players: roles.map((r, ix) => ({ role: r, name: "Fuzz" + (ix+1) })),
		scenario,
		options,
		state: null,
		replay: [],
	}

	var G, R, V, actions, action, prev_G

	try {
		ctx.state = G = rules.setup(seed, scenario, options)
	} catch (e) {
		return log_crash(e, ctx)
	}

	ctx.replay.push([ null, ".setup", [ seed, scenario, options ] ])

	while (G.active && G.active !== "None" && data.remainingBytes > 0) {

		// If multiple players can act, we'll pick a random player to go first.
		if (Array.isArray(G.active))
			R = data.pickValue(G.active)
		else if (G.active === "Both")
			R = data.pickValue(roles)
		else
			R = G.active

		try {
			V = rules.view(G, R)
			if (V.prompt && V.prompt.startsWith("TODO:"))
				throw new Error(V.prompt)
			actions = list_actions(R, V)
			if (actions.length === 0)
				throw new Error("NoMoreActions")
		} catch (e) {
			return log_crash(e, ctx)
		}

		action = data.pickValue(actions)
		prev_G = object_copy(G)
		try {
			ctx.state = G = rules.action(G, action[0], action[1], action[2])
			ctx.replay.push(action)
			if (typeof rules.assert === "function")
				rules.assert(G)
		} catch (e) {
			return log_crash(e, ctx, action)
		}

		if (G.undo.length > 0) {
			if (String(prev_G.active) !== String(G.active))
				return log_crash("BadUndo (active " + prev_G.active + " to " + G.active + ", " + G.undo.length + ")", ctx, action)
			if (prev_G.seed !== G.seed)
				return log_crash("BadUndo (seed " + prev_G.seed + " to " + G.seed + ", " + G.undo.length + ")", ctx, action)
		}

		if (++steps > MAX_STEPS)
			return log_crash("MaxSteps", ctx)

		if (Date.now() > timeout)
			return log_crash("Timeout at " + steps + " steps", ctx)
	}
}

function log_crash(message, ctx, action) {
	console.log("ERROR", message)
	console.log("\tSETUP", JSON.stringify(ctx.replay[0][2]))
	console.log("\tSTATE", JSON.stringify(ctx.state?.state ?? ctx.state?.L?.P ?? null))
	if (ctx.state.L !== void 0)
		console.log("\tSTACK", JSON.stringify(ctx.state.L))
	if (action !== void 0)
		console.log("\tACTION", JSON.stringify(action))

	var hash
	if (typeof ctx.seed === "number")
		hash = String(ctx.seed)
	else
		hash = crypto.createHash("sha1").update(ctx.seed).digest("hex")

	var json = JSON.stringify({
		setup: ctx.setup,
		players: ctx.players,
		state: ctx.state,
		replay: ctx.replay,
	})

	var dump = `fuzzer/${TITLE}-${hash}.json`
	fs.writeFileSync(dump, json)
	console.log("rtt import", dump)
	console.log("")

	if (++errors >= MAX_ERRORS)
		throw new Error("too many errors")
}

exports.fuzz = fuzz
