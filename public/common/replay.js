/* POST-GAME REPLAY & DEBUG MODE */

"use strict"

var replay_query = null

;(function () {

/* global view, player, params, roles, game_log, replay_panel */

var rules = null
var replay = null
var viewpoint = params.role
var viewpoint_buttons = []

var replay_this = 0
var replay_state = {}

const CRC32C_TABLE = new Int32Array([
	0x00000000, 0xf26b8303, 0xe13b70f7, 0x1350f3f4, 0xc79a971f, 0x35f1141c, 0x26a1e7e8, 0xd4ca64eb,
	0x8ad958cf, 0x78b2dbcc, 0x6be22838, 0x9989ab3b, 0x4d43cfd0, 0xbf284cd3, 0xac78bf27, 0x5e133c24,
	0x105ec76f, 0xe235446c, 0xf165b798, 0x030e349b, 0xd7c45070, 0x25afd373, 0x36ff2087, 0xc494a384,
	0x9a879fa0, 0x68ec1ca3, 0x7bbcef57, 0x89d76c54, 0x5d1d08bf, 0xaf768bbc, 0xbc267848, 0x4e4dfb4b,
	0x20bd8ede, 0xd2d60ddd, 0xc186fe29, 0x33ed7d2a, 0xe72719c1, 0x154c9ac2, 0x061c6936, 0xf477ea35,
	0xaa64d611, 0x580f5512, 0x4b5fa6e6, 0xb93425e5, 0x6dfe410e, 0x9f95c20d, 0x8cc531f9, 0x7eaeb2fa,
	0x30e349b1, 0xc288cab2, 0xd1d83946, 0x23b3ba45, 0xf779deae, 0x05125dad, 0x1642ae59, 0xe4292d5a,
	0xba3a117e, 0x4851927d, 0x5b016189, 0xa96ae28a, 0x7da08661, 0x8fcb0562, 0x9c9bf696, 0x6ef07595,
	0x417b1dbc, 0xb3109ebf, 0xa0406d4b, 0x522bee48, 0x86e18aa3, 0x748a09a0, 0x67dafa54, 0x95b17957,
	0xcba24573, 0x39c9c670, 0x2a993584, 0xd8f2b687, 0x0c38d26c, 0xfe53516f, 0xed03a29b, 0x1f682198,
	0x5125dad3, 0xa34e59d0, 0xb01eaa24, 0x42752927, 0x96bf4dcc, 0x64d4cecf, 0x77843d3b, 0x85efbe38,
	0xdbfc821c, 0x2997011f, 0x3ac7f2eb, 0xc8ac71e8, 0x1c661503, 0xee0d9600, 0xfd5d65f4, 0x0f36e6f7,
	0x61c69362, 0x93ad1061, 0x80fde395, 0x72966096, 0xa65c047d, 0x5437877e, 0x4767748a, 0xb50cf789,
	0xeb1fcbad, 0x197448ae, 0x0a24bb5a, 0xf84f3859, 0x2c855cb2, 0xdeeedfb1, 0xcdbe2c45, 0x3fd5af46,
	0x7198540d, 0x83f3d70e, 0x90a324fa, 0x62c8a7f9, 0xb602c312, 0x44694011, 0x5739b3e5, 0xa55230e6,
	0xfb410cc2, 0x092a8fc1, 0x1a7a7c35, 0xe811ff36, 0x3cdb9bdd, 0xceb018de, 0xdde0eb2a, 0x2f8b6829,
	0x82f63b78, 0x709db87b, 0x63cd4b8f, 0x91a6c88c, 0x456cac67, 0xb7072f64, 0xa457dc90, 0x563c5f93,
	0x082f63b7, 0xfa44e0b4, 0xe9141340, 0x1b7f9043, 0xcfb5f4a8, 0x3dde77ab, 0x2e8e845f, 0xdce5075c,
	0x92a8fc17, 0x60c37f14, 0x73938ce0, 0x81f80fe3, 0x55326b08, 0xa759e80b, 0xb4091bff, 0x466298fc,
	0x1871a4d8, 0xea1a27db, 0xf94ad42f, 0x0b21572c, 0xdfeb33c7, 0x2d80b0c4, 0x3ed04330, 0xccbbc033,
	0xa24bb5a6, 0x502036a5, 0x4370c551, 0xb11b4652, 0x65d122b9, 0x97baa1ba, 0x84ea524e, 0x7681d14d,
	0x2892ed69, 0xdaf96e6a, 0xc9a99d9e, 0x3bc21e9d, 0xef087a76, 0x1d63f975, 0x0e330a81, 0xfc588982,
	0xb21572c9, 0x407ef1ca, 0x532e023e, 0xa145813d, 0x758fe5d6, 0x87e466d5, 0x94b49521, 0x66df1622,
	0x38cc2a06, 0xcaa7a905, 0xd9f75af1, 0x2b9cd9f2, 0xff56bd19, 0x0d3d3e1a, 0x1e6dcdee, 0xec064eed,
	0xc38d26c4, 0x31e6a5c7, 0x22b65633, 0xd0ddd530, 0x0417b1db, 0xf67c32d8, 0xe52cc12c, 0x1747422f,
	0x49547e0b, 0xbb3ffd08, 0xa86f0efc, 0x5a048dff, 0x8ecee914, 0x7ca56a17, 0x6ff599e3, 0x9d9e1ae0,
	0xd3d3e1ab, 0x21b862a8, 0x32e8915c, 0xc083125f, 0x144976b4, 0xe622f5b7, 0xf5720643, 0x07198540,
	0x590ab964, 0xab613a67, 0xb831c993, 0x4a5a4a90, 0x9e902e7b, 0x6cfbad78, 0x7fab5e8c, 0x8dc0dd8f,
	0xe330a81a, 0x115b2b19, 0x020bd8ed, 0xf0605bee, 0x24aa3f05, 0xd6c1bc06, 0xc5914ff2, 0x37faccf1,
	0x69e9f0d5, 0x9b8273d6, 0x88d28022, 0x7ab90321, 0xae7367ca, 0x5c18e4c9, 0x4f48173d, 0xbd23943e,
	0xf36e6f75, 0x0105ec76, 0x12551f82, 0xe03e9c81, 0x34f4f86a, 0xc69f7b69, 0xd5cf889d, 0x27a40b9e,
	0x79b737ba, 0x8bdcb4b9, 0x988c474d, 0x6ae7c44e, 0xbe2da0a5, 0x4c4623a6, 0x5f16d052, 0xad7d5351
])

function crc32c(data) {
	let x = 0
	for (let i = 0, n = data.length; i < n; ++i)
		x = CRC32C_TABLE[(x ^ data.charCodeAt(i)) & 0xff] ^ (x >>> 8)
	return x ^ -1
}

async function require(path) {
	let cache = {}

	if (!path.endsWith(".js"))
		path = path + ".js"
	if (path.startsWith("./"))
		path = path.substring(2)

	console.log("REQUIRE", path)

	let response = await fetch(path)
	let source = await response.text()

	for (let [_, subpath] of source.matchAll(/require\(['"]([^)]*)['"]\)/g))
		if (cache[subpath] === undefined)
			cache[subpath] = await require(subpath)

	let module = { exports: {} }
	Function("module", "exports", "require", source)(module, module.exports, path => cache[path])
	return module.exports
}

function snap_from_state(state) {
	// return JSON of game state without undo and with log replaced by log length
	let save_undo = state.undo
	let save_log = state.log
	state.undo = undefined
	state.log = save_log.length
	let snap = JSON.stringify(state)
	state.undo = save_undo
	state.log = save_log
	return snap
}

function eval_action(s, item, p) {
	let [ item_role, item_action, item_arguments ] = item
	switch (item_action) {
	case ".setup":
		return rules.setup(item_arguments[0], item_arguments[1], item_arguments[2])
	case ".resign":
		if (params.mode === "debug")
			s.log.push([p, item_role.substring(0,2), item_action, null])

		s.state = "game_over"
		s.active = "None"
		s.victory = item_role + " resigned."
		s.log.push("")
		s.log.push(s.victory)
		return s
	default:
		if (params.mode === "debug")
			s.log.push([p, item_role.substring(0,2), item_action, item_arguments])
		return rules.action(s, item_role, item_action, item_arguments)
	}
}

function on_click_viewpoint(evt) {
	for (let button of viewpoint_buttons)
		button.classList.toggle("selected", button === evt.target)
	viewpoint = evt.target.my_role
	update_replay_view()
}

function create_viewpoint_button(parent, text, role) {
	let button = document.createElement("button")
	if (role === viewpoint)
		button.className = "viewpoint_button selected"
	else
		button.className = "viewpoint_button"
	button.onclick = on_click_viewpoint
	button.textContent = text
	button.my_role = role
	parent.appendChild(button)
	viewpoint_buttons.push(button)
}

function update_replay_view() {
	player = viewpoint

	if (viewpoint === "Active") {
		player = replay_state.active
		if (player === "All" || player === "Both" || player === "None" || !player)
			player = "Observer"
	}

	document.body.classList.toggle("Observer", player === "Observer")
	for (let r in roles)
		document.body.classList.toggle(roles[r].class_name, player === r)

	view = rules.view(replay_state, player)
	if (params.mode !== "debug")
		view.actions = null

	if (viewpoint === "Observer")
		view.game_over = 1
	if (replay_state.state === "game_over")
		view.game_over = 1

	if (replay.length > 0) {
		if (document.body.classList.contains("shift")) {
			view.prompt = `[${replay_this}/${replay.length}] ${replay_state.active} / ${replay_state.state}`
			if (replay_this < replay.length)
				view.prompt += ` / ${replay[replay_this][1]} ${replay[replay_this][2]}`
		} else {
			view.prompt = "[" + replay_this + "/" + replay.length + "] " + view.prompt
		}
	}

	if (game_log.length > view.log.length)
		game_log.length = view.log.length
	let log_start = game_log.length
	for (let i = log_start; i < view.log.length; ++i)
		game_log.push(view.log[i])

	on_update_header()
	on_update()
	on_update_log(log_start, game_log.length)
}

replay_query = function replay_query(query, params) {
	on_reply(query, rules.query(replay_state, player, query, params))
}

function goto_replay(np) {
	if (np < 1)
		np = 1
	if (np > replay.length)
		np = replay.length
	set_hash(np)
	if (replay_this > np)
		replay_this = 0, replay_state = {}
	while (replay_this < np) {
		replay_state = eval_action(replay_state, replay[replay_this], replay_this)
		++replay_this;
	}
	update_replay_view()
}

function set_hash(n) {
	history.replaceState(null, "", window.location.pathname + window.location.search + "#" + n)
}

function on_hash_change() {
	goto_replay(parseInt(window.location.hash.slice(1)) || 1)
}

function on_replay_first() {
	goto_replay(1)
}

function on_replay_last() {
	goto_replay(replay.length)
}

function on_replay_step_prev() {
	goto_replay(replay_this-1)
}

function on_replay_step_next() {
	goto_replay(replay_this+1)
}

function on_replay_jump_prev() {
	for (let i = replay_this - 1; i > 1; --i)
		if (replay[i].is_checkpoint)
			return goto_replay(i)
	goto_replay(1)
}

function on_replay_jump_next() {
	for (let i = replay_this + 1; i < replay.length; ++i)
		if (replay[i].is_checkpoint)
			return goto_replay(i)
	goto_replay(replay.length)
}

let replay_timer = 0
function on_replay_play_pause() {
	if (replay_timer === 0) {
		document.getElementById("replay_stop").classList.remove("hide")
		document.getElementById("replay_play").classList.add("hide")
		replay_timer = setInterval(() => {
			if (replay_this < replay.length)
				on_replay_step_next()
			else
				on_replay_play_pause()
		}, 1000)
	} else {
		document.getElementById("replay_stop").classList.add("hide")
		document.getElementById("replay_play").classList.remove("hide")
		clearInterval(replay_timer)
		replay_timer = 0
	}
}

async function load_replay() {
	document.getElementById("prompt").textContent = "Loading replay..."

	remove_resign_menu()

	console.log("LOADING RULES")
	rules = await require("rules.js")

	console.log("LOADING REPLAY")
	let response = await fetch("/api/replay/" + params.game_id)
	if (!response.ok) {
		let text = await response.text()
		document.getElementById("prompt").textContent = "ERROR " + response.status + ": " + text
		return
	}
	let body = await response.json()
	replay = body.replay

	init_player_names(body.players)

	console.log("PROCESSING REPLAY")
	let old_active = null
	let s = null
	for (let p = 0; p < replay.length; ++p) {
		try {
			s = eval_action(s, replay[p], p)
			if (p + 1 < replay.length)
				replay[p+1].is_checkpoint = (old_active !== s.active)
			old_active = s.active
		} catch (err) {
			console.log("ERROR IN REPLAY", JSON.stringify(replay[p]))
			console.log(err)
			if (params.mode === "debug")
				replay.length = p
			else
				replay.length = 0
			break
		}

		if (params.mode !== "debug") {
			replay[p].digest = crc32c(snap_from_state(s))
			for (let k = p - 1; k > 0; --k) {
				if (replay[k].digest === replay[p].digest && !replay[k].remove) {
					for (let a = k + 1; a <= p; ++a)
						replay[a].remove = true
					break
				}
			}
		}
	}

	replay = replay.filter(x => !x.remove)

	if (replay.length > 0) {
		console.log("REPLAY READY")
		if (window.location.hash === "")
			set_hash(replay.length)
		on_hash_change()
		window.addEventListener("hashchange", on_hash_change)
		document.body.appendChild(replay_panel)
	} else {
		console.log("REPLAY NOT AVAILABLE")
		replay_state = body.state
		update_replay_view()
	}

	// Build viewpoint panel
	let viewpoint_panel = document.createElement("div")
	viewpoint_panel.id = "viewpoint_panel"
	create_viewpoint_button(viewpoint_panel, "Active", "Active")
	for (let r in roles)
		create_viewpoint_button(viewpoint_panel, r, r)
	create_viewpoint_button(viewpoint_panel, "Observer", "Observer")
	document.getElementById("actions").appendChild(viewpoint_panel)

	// Adjust replay panel
	document.getElementById("replay_step_prev").classList.remove("hide")
	document.getElementById("replay_step_next").classList.remove("hide")
	document.getElementById("replay_last").classList.remove("hide")

	document.getElementById("replay_first").onclick = on_replay_first
	document.getElementById("replay_prev").onclick = on_replay_jump_prev
	document.getElementById("replay_step_prev").onclick = on_replay_step_prev
	document.getElementById("replay_step_next").onclick = on_replay_step_next
	document.getElementById("replay_next").onclick = on_replay_jump_next
	document.getElementById("replay_last").onclick = on_replay_last
	document.getElementById("replay_stop").onclick = on_replay_play_pause
	document.getElementById("replay_play").onclick = on_replay_play_pause
}

load_replay()

})()
