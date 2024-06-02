"use strict"

/* global on_update, on_reply, on_log */

/* PUBLIC GLOBALS */

var roles = null
var player = "Observer"
var view = null

/* PRIVATE GLOBALS */

var search_params = new URLSearchParams(window.location.search)
var params = {
	title_id: window.location.pathname.split("/")[1],
	game_id: search_params.get("game") || 0,
	role: search_params.get("role") || "Observer",
	mode: search_params.get("mode") || "play",
}

let socket = null

let game_log = []
let game_cookie = 0

let snap_active = []
let snap_cache = []
let snap_count = 0
let snap_this = 0
let snap_view = null

var replay_panel = null

/* PUBLIC UTILITY FUNCTIONS */

function scroll_into_view(e) {
	if (window.innerWidth <= 800)
		document.querySelector("aside").classList.add("hide")
	setTimeout(function () {
		e.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" })
	}, 0)
}

function scroll_into_view_if_needed(e) {
	if (window.innerWidth <= 800) {
		setTimeout(function () {
			e.scrollIntoView({ block: "start", inline: "center", behavior: "smooth" })
		}, 0)
	} else {
		setTimeout(function () {
			e.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })
		}, 0)
	}
}

function scroll_with_middle_mouse(panel_sel, multiplier) {
	let panel = document.querySelector(panel_sel)
	let down_x, down_y, scroll_x, scroll_y
	if (!multiplier)
		multiplier = 1
	function md(e) {
		if (e.button === 1) {
			down_x = e.clientX
			down_y = e.clientY
			scroll_x = panel.scrollLeft
			scroll_y = panel.scrollTop
			window.addEventListener("mousemove", mm)
			window.addEventListener("mouseup", mu)
			e.preventDefault()
		}
	}
	function mm(e) {
		let dx = down_x - e.clientX
		let dy = down_y - e.clientY
		panel.scrollLeft = scroll_x + dx * multiplier
		panel.scrollTop = scroll_y + dy * multiplier
		e.preventDefault()
	}
	function mu(e) {
		if (e.button === 1) {
			window.removeEventListener("mousemove", mm)
			window.removeEventListener("mouseup", mu)
			e.preventDefault()
		}
	}
	panel.addEventListener("mousedown", md)
}

function drag_element_with_mouse(element_sel, grabber_sel) {
	let element = document.querySelector(element_sel)
	let grabber = document.querySelector(grabber_sel) || element
	let save_x, save_y
	function md(e) {
		if (e.button === 0) {
			save_x = e.clientX
			save_y = e.clientY
			window.addEventListener("mousemove", mm)
			window.addEventListener("mouseup", mu)
			e.preventDefault()
		}
	}
	function mm(e) {
		let dx = save_x - e.clientX
		let dy = save_y - e.clientY
		save_x = e.clientX
		save_y = e.clientY
		element.style.left = (element.offsetLeft - dx) + "px"
		element.style.top = (element.offsetTop - dy) + "px"
		e.preventDefault()
	}
	function mu(e) {
		if (e.button === 0) {
			window.removeEventListener("mousemove", mm)
			window.removeEventListener("mouseup", mu)
			e.preventDefault()
		}
	}
	grabber.addEventListener("mousedown", md)
}

/* TITLE BLINKER */

let blink_title = document.title
let blink_timer = 0

function start_blinker(message) {
	let tick = false
	if (blink_timer)
		stop_blinker()
	if (!document.hasFocus()) {
		document.title = message
		blink_timer = setInterval(function () {
			document.title = tick ? message : blink_title
			tick = !tick
		}, 1000)
	}
}

function stop_blinker() {
	document.title = blink_title
	clearInterval(blink_timer)
	blink_timer = 0
}

window.addEventListener("focus", stop_blinker)

/* CHAT */

let chat = null

function init_chat() {
	if (chat !== null) {
		return
	}

	let chat_window = document.createElement("div")
	chat_window.id = "chat_window"
	chat_window.innerHTML = `
		<div id="chat_header">Chat</div>
		<div id="chat_x" onclick="toggle_chat()">\u274c</div>
		<div id="chat_text"></div>
		<form id="chat_form" action=""><input id="chat_input" autocomplete="off"></form>
		`
	document.body.appendChild(chat_window)

	let chat_button = document.getElementById("chat_button")
	chat_button.classList.remove("hide")

	chat = {
		is_visible: false,
		text_element: document.getElementById("chat_text"),
		last_day: null,
		log: 0
	}

	drag_element_with_mouse("#chat_window", "#chat_header")

	document.getElementById("chat_form").addEventListener("submit", e => {
		let input = document.getElementById("chat_input")
		e.preventDefault()
		if (input.value) {
			send_message("chat", input.value)
			input.value = ""
		} else {
			hide_chat()
		}
	})

	document.body.addEventListener("keydown", e => {
		if (e.key === "Escape") {
			if (chat.is_visible) {
				e.preventDefault()
				hide_chat()
			}
		}
		if (e.key === "Enter") {
			let chat_input = document.getElementById("chat_input")
			let notepad_input = document.getElementById("notepad_input")
			if (document.activeElement !== chat_input && document.activeElement !== notepad_input) {
				e.preventDefault()
				show_chat()
			}
		}
	})
}

function update_chat(chat_id, raw_date, user, message) {
	function format_time(date) {
		let mm = date.getMinutes()
		let hh = date.getHours()
		if (mm < 10) mm = "0" + mm
		if (hh < 10) hh = "0" + hh
		return hh + ":" + mm
	}
	function add_date_line(date) {
		let line = document.createElement("div")
		line.className = "date"
		line.textContent = "~ " + date + " ~"
		chat.text_element.appendChild(line)
	}
	function add_chat_line(time, user, message) {
		let line = document.createElement("div")
		if (user)
			line.textContent = "[" + time + "] " + user + " \xbb " + message
		else
			line.textContent = "[" + time + "] " + message
		chat.text_element.appendChild(line)
		chat.text_element.scrollTop = chat.text_element.scrollHeight
	}
	if (chat_id > chat.log) {
		chat.log = chat_id
		let date = new Date(raw_date * 1000)
		let day = date.toDateString()
		if (day !== chat.last_day) {
			add_date_line(day)
			chat.last_day = day
		}
		add_chat_line(format_time(date), user, message)
	}
}

function fetch_chat() {
	send_message("getchat", chat.log)
}

function update_chat_new() {
	let button = document.getElementById("chat_button")
	start_blinker("NEW MESSAGE")
	if (chat && chat.is_visible)
		fetch_chat()
	else
		button.classList.add("new")
}

function update_chat_old() {
	let button = document.getElementById("chat_button")
	document.getElementById("chat_button").classList.remove("new")
}

function show_chat() {
	if (!chat.is_visible) {
		document.getElementById("chat_button").classList.remove("new")
		document.getElementById("chat_window").classList.add("show")
		document.getElementById("chat_input").focus()
		chat.is_visible = true
		fetch_chat()
	}
}

function hide_chat() {
	if (chat.is_visible) {
		document.getElementById("chat_window").classList.remove("show")
		document.getElementById("chat_input").blur()
		chat.is_visible = false
	}
}

function toggle_chat() {
	if (chat.is_visible)
		hide_chat()
	else
		show_chat()
}

/* NOTEPAD */

let notepad = null

function init_notepad() {
	if (notepad !== null)
		return

	add_main_menu_item("Notepad", toggle_notepad)

	let notepad_window = document.createElement("div")
	notepad_window.id = "notepad_window"
	notepad_window.innerHTML = `
		<div id="notepad_header">Notepad: ${player}</div>
		<div id="notepad_x" onclick="toggle_notepad()">\u274c</div>
		<textarea id="notepad_input" maxlength="16000" oninput="dirty_notepad()"></textarea>
		<div id="notepad_footer"><button id="notepad_save" onclick="save_notepad()" disabled>Save</button></div>
		`
	document.body.appendChild(notepad_window)

	notepad = {
		is_visible: false,
		is_dirty: false,
	}

	drag_element_with_mouse("#notepad_window", "#notepad_header")
}

function dirty_notepad() {
	if (!notepad.is_dirty) {
		notepad.is_dirty = true
		document.getElementById("notepad_save").disabled = false
	}
}

function save_notepad() {
	if (notepad.is_dirty) {
		let text = document.getElementById("notepad_input").value
		send_message("putnote", text)
		notepad.is_dirty = false
		document.getElementById("notepad_save").disabled = true
	}
}

function load_notepad() {
	send_message("getnote")
}

function update_notepad(text) {
	document.getElementById("notepad_input").value = text
}

function show_notepad() {
	if (!notepad.is_visible) {
		load_notepad()
		document.getElementById("notepad_window").classList.add("show")
		document.getElementById("notepad_input").focus()
		notepad.is_visible = true
	}
}

function hide_notepad() {
	if (notepad.is_visible) {
		save_notepad()
		document.getElementById("notepad_window").classList.remove("show")
		document.getElementById("notepad_input").blur()
		notepad.is_visible = false
	}
}

function toggle_notepad() {
	if (notepad.is_visible)
		hide_notepad()
	else
		show_notepad()
}

/* REMATCH & REPLAY BUTTONS WHEN GAME OVER */

function on_game_over() {
	remove_resign_menu()

	add_icon_button(1, "replay_button", "sherlock-holmes-mirror",
		function goto_replay() {
			search_params.delete("role")
			search_params.set("mode", "replay")
			window.location.search = search_params
		}
	)

	if (player !== "Observer") {
		add_icon_button(1, "rematch_button", "cycle",
			function goto_rematch() {
				window.location = "/rematch/" + params.game_id
			}
		)
	}
}

/* PLAYER ROLE LIST */

function init_role_element(role_id, role_name) {
	let e_role = document.createElement("div")
	e_role.id = role_id
	e_role.className = "role"
	e_role.innerHTML =
		`<div class="role_name"><span>${role_name}</span></div>` +
		`<div class="role_stat"></div>` +
		`<div class="role_user"></div>` +
		`<div class="role_info"></div>`
	document.getElementById("roles").appendChild(e_role)
	return e_role
}

function init_player_names(players) {
	roles = {}
	for (let pp of players) {
		let class_name = pp.role.replace(/\W/g, "_")
		let id = "role_" + class_name
		let e = document.getElementById(id)
		if (!e)
			e = init_role_element(id, pp.role)
		let obj = roles[pp.role] = {
			class_name: class_name,
			id: id,
			element: e,
			name: e.querySelector(".role_name"),
			stat: e.querySelector(".role_stat"),
			user: e.querySelector(".role_user"),
		}
		if (pp.name)
			obj.user.innerHTML = `<a href="/user/${pp.name}" target="_blank">${pp.name}</a>`
		else
			obj.user.textContent = 'NONE'
	}
}

/* CONNECT TO GAME SERVER */

function send_message(cmd, arg) {
	let data = JSON.stringify([ cmd, arg ])
	console.log("SEND %s %s", cmd, arg)
	socket.send(data)
}

let reconnect_count = 0
let reconnect_max = 10

function connect_play() {
	if (reconnect_count >= reconnect_max) {
		document.title = "DISCONNECTED"
		document.getElementById("prompt").textContent = "Disconnected."
		return
	}

	let protocol = (window.location.protocol === "http:") ? "ws" : "wss"
	let seen = document.getElementById("log").children.length
	let url = `${protocol}://${window.location.host}/play-socket?title=${params.title_id}&game=${params.game_id}&role=${encodeURIComponent(params.role)}&seen=${seen}`

	console.log("CONNECTING", url)
	document.getElementById("prompt").textContent = "Connecting... "

	socket = new WebSocket(url)

	window.addEventListener("beforeunload", function () {
		socket.close(1000)
	})

	socket.onopen = function (evt) {
		console.log("OPEN")
		document.querySelector("header").classList.remove("disconnected")
		reconnect_count = 0
	}

	socket.onclose = function (evt) {
		console.log("CLOSE %d", evt.code)
		game_cookie = 0
		if (evt.code === 1000 && evt.reason !== "") {
			document.getElementById("prompt").textContent = "Disconnected: " + evt.reason
			document.title = "DISCONNECTED"
		}
		if (evt.code !== 1000) {
			document.querySelector("header").classList.add("disconnected")
			document.getElementById("prompt").textContent = `Reconnecting soon... (${reconnect_count+1}/${reconnect_max})`
			let wait = 1000 * (Math.random() + 0.5) * Math.pow(2, reconnect_count++)
			console.log("WAITING %.1f TO RECONNECT", wait/1000)
			setTimeout(connect_play, wait)
		}
	}

	socket.onmessage = function (evt) {
		let msg_data = JSON.parse(evt.data)
		let cmd = msg_data[0]
		let arg = msg_data[1]
		console.log("MESSAGE", cmd)
		switch (cmd) {
		case "warning":
			document.getElementById("prompt").textContent = arg
			document.querySelector("header").classList.add("disconnected")
			setTimeout(() => {
				document.querySelector("header").classList.remove("disconnected")
				on_update_header()
			}, 1000)
			break

		case "error":
			document.getElementById("prompt").textContent = arg
			if (view) {
				view.actions = null
				on_update()
			}
			break

		case "newchat":
			init_chat()
			if (arg > 0)
				update_chat_new()
			else
				update_chat_old()
			break

		case "chat":
			update_chat(arg[0], arg[1], arg[2], arg[3])
			break

		case "note":
			update_notepad(arg)
			break

		case "players":
			player = arg[0]
			init_player_names(arg[1])
			document.body.classList.add(player.replace(/\W/g, "_"))
			if (player !== "Observer") {
				init_notepad()
				add_resign_menu()
			} else {
				remove_resign_menu()
			}
			break

		case "presence":
			for (let role in roles)
				roles[role].element.classList.toggle("present", arg.includes(role))
			break

		case "state":
			game_cookie = msg_data[2]

			if (snap_view)
				on_snap_stop()

			view = arg

			game_log.length = view.log_start
			for (let line of view.log)
				game_log.push(line)

			on_update_header()
			on_update_roles()
			if (typeof on_update === "function")
				on_update()
			on_update_log(view.log_start, game_log.length)
			if (view.game_over)
				on_game_over()
			break

		case "snapsize":
			snap_count = arg
			if (snap_count === 0)
				replay_panel.remove()
			else
				document.body.appendChild(replay_panel)
			break

		case "snap":
			snap_active[arg[0]] = arg[1]
			snap_cache[arg[0]] = arg[2]
			show_snap(arg[0])
			break

		case "reply":
			if (typeof on_reply === "function")
				on_reply(arg[0], arg[1])
			break

		case "save":
			window.localStorage[params.title_id + "/save"] = arg
			break
		}
	}
}

/* HEADER */

let is_your_turn = false
let old_active = null

function on_update_header() {
	if (typeof on_prompt === "function")
		document.getElementById("prompt").innerHTML = on_prompt(view.prompt)
	else
		document.getElementById("prompt").textContent = view.prompt
	if (params.mode === "replay")
		return
	if (snap_view)
		document.querySelector("header").classList.add("replay")
	else
		document.querySelector("header").classList.remove("replay")
	if (view.actions) {
		document.querySelector("header").classList.add("your_turn")
		if (!is_your_turn || old_active !== view.active)
			start_blinker("YOUR TURN")
		is_your_turn = true
	} else {
		document.querySelector("header").classList.remove("your_turn")
		is_your_turn = false
	}
	old_active = view.active
}

function on_update_roles() {
	if (view.active !== undefined)
		for (let role in roles)
			roles[role].element.classList.toggle("active", view.active === role)
}

/* LOG */

function on_update_log(change_start, end) {
	let div = document.getElementById("log")

	let to_delete = div.children.length - change_start
	while (to_delete-- > 0)
		div.removeChild(div.lastChild)

	for (let i = div.children.length; i < end; ++i) {
		let text = game_log[i]
		if (params.mode === "debug" && typeof text === "object") {
			let entry = document.createElement("a")
			entry.href = "#" + text[0]
			if (text[3] !== null)
				entry.textContent = "\u25b6 " + text[1] + " " + text[2] + " " + text[3]
			else
				entry.textContent = "\u25b6 " + text[1] + " " + text[2]
			entry.style.display = "block"
			entry.style.textDecoration = "none"
			div.appendChild(entry)
		} else if (typeof on_log === "function") {
			div.appendChild(on_log(text, i))
		} else {
			let entry = document.createElement("div")
			entry.textContent = text
			div.appendChild(entry)
		}
	}
	scroll_log_to_end()
}

function scroll_log_to_end() {
	let div = document.getElementById("log")
	div.scrollTop = div.scrollHeight
}

try {
	new ResizeObserver(scroll_log_to_end).observe(document.getElementById("log"))
} catch (err) {
	window.addEventListener("resize", scroll_log_to_end)
}

/* ACTIONS */

function action_button_with_argument(verb, noun, label) {
	if (params.mode === "replay")
		return
	let id = verb + "_" + noun + "_button"
	let button = document.getElementById(id)
	if (!button) {
		button = document.createElement("button")
		button.id = id
		button.textContent = label
		button.addEventListener("click", evt => send_action(verb, noun))
		document.getElementById("actions").prepend(button)
	}
	if (view.actions && view.actions[verb] && view.actions[verb].includes(noun)) {
		button.classList.remove("hide")
	} else {
		button.classList.add("hide")
	}
}

function action_button_imp(action, label, callback) {
	if (params.mode === "replay")
		return
	let id = action + "_button"
	let button = document.getElementById(id)
	if (!button) {
		button = document.createElement("button")
		button.id = id
		button.textContent = label
		button.addEventListener("click", callback)
		document.getElementById("actions").prepend(button)
	}
	if (view.actions && action in view.actions) {
		button.classList.remove("hide")
		if (view.actions[action]) {
			if (label === undefined)
				button.textContent = view.actions[action]
			button.disabled = false
		} else {
			button.disabled = true
		}
	} else {
		button.classList.add("hide")
	}
}

function action_button(action, label) {
	action_button_imp(action, label, evt => send_action(action))
}

function confirm_action_button(action, label, message) {
	action_button_imp(action, label, evt => confirm_action(message, action))
}

function send_action(verb, noun) {
	if (params.mode === "replay" || params.mode === "debug")
		return false
	// Reset action list here so we don't send more than one action per server prompt!
	if (noun !== undefined) {
		let realnoun = Array.isArray(noun) ? noun[0] : noun
		if (view.actions && view.actions[verb] && view.actions[verb].includes(realnoun)) {
			view.actions = null
			send_message("action", [ verb, noun, game_cookie ])
			return true
		}
	} else {
		if (view.actions && view.actions[verb]) {
			view.actions = null
			send_message("action", [ verb, null, game_cookie ])
			return true
		}
	}
	return false
}

function confirm_action(message, verb, noun) {
	if (window.confirm(message))
		send_action(verb, noun)
}

function send_query(q, param) {
	if (typeof replay_query === "function")
		replay_query(q, param)
	else if (snap_view)
		send_message("querysnap", [ snap_this, q, param ])
	else
		send_message("query", [ q, param ])
}

function send_save() {
	send_message("save")
}

function send_restore() {
	send_message("restore", window.localStorage[params.title_id + "/save"])
}

/* REPLAY */

function init_replay() {
	let script = document.createElement("script")
	script.src = "/common/replay.js"
	document.body.appendChild(script)
}

/* MAIN MENU */

function confirm_resign() {
	if (window.confirm("Are you sure that you want to resign?"))
		send_message("resign")
}

function add_resign_menu() {
	if (Object.keys(roles).length <= 2) {
		let popup = document.querySelector("#toolbar details menu")
		popup.insertAdjacentHTML("beforeend", '<li class="resign separator">')
		popup.insertAdjacentHTML("beforeend", '<li class="resign" onclick="confirm_resign()">Resign')
	}
}

function remove_resign_menu() {
	for (let e of document.querySelectorAll(".resign"))
		e.remove()
}

function add_icon_button(where, id, img, fn) {
	let button = document.getElementById(id)
	if (!button) {
		button = document.createElement("button")
		button.id = id
		button.innerHTML = '<img src="/images/' + img + '.svg">'
		button.addEventListener("click", fn)
		if (where)
			document.querySelector("#toolbar").appendChild(button)
		else
			document.querySelector("#toolbar details").after(button)
	}
	return button
}

/* avoid margin collapse at bottom of main */
document.querySelector("main").insertAdjacentHTML("beforeend", "<div style='height:1px'></div>")

document.querySelector("header").insertAdjacentHTML("beforeend", "<div id='actions'>")
document.querySelector("header").insertAdjacentHTML("beforeend", "<div id='prompt'>")

add_icon_button(0, "chat_button", "chat-bubble", toggle_chat).classList.add("hide")
add_icon_button(0, "zoom_button", "magnifying-glass", () => toggle_zoom())
add_icon_button(0, "log_button", "scroll-quill", toggle_log)

function add_main_menu_separator() {
	let popup = document.querySelector("#toolbar details menu")
	let sep = document.createElement("li")
	sep.className = "separator"
	popup.insertBefore(sep, popup.firstChild)
}

function add_main_menu_item(text, onclick) {
	let popup = document.querySelector("#toolbar details menu")
	let sep = popup.querySelector(".separator")
	let item = document.createElement("li")
	item.onclick = onclick
	item.textContent = text
	popup.insertBefore(item, sep)
}

function add_main_menu_item_link(text, url) {
	let popup = document.querySelector("#toolbar details menu")
	let sep = popup.querySelector(".separator")
	let item = document.createElement("li")
	let a = document.createElement("a")
	a.href = url
	a.textContent = text
	item.appendChild(a)
	popup.insertBefore(item, sep)
}

add_main_menu_separator()
if (params.mode === "play" && params.role !== "Observer") {
	add_main_menu_item_link("Go home", "/games/active")
	add_main_menu_item_link("Go to next game", "/games/next")
} else {
	add_main_menu_item_link("Go home", "/")
}

function close_toolbar_menus(self) {
	for (let node of document.querySelectorAll("#toolbar > details"))
		if (node !== self)
			node.removeAttribute("open")
}

/* close menu if opening another */
for (let node of document.querySelectorAll("#toolbar > details")) {
	node.onclick = function () { close_toolbar_menus(node) }
}

/* close menu after selecting something */
for (let node of document.querySelectorAll("#toolbar > details > menu")) {
	node.onclick = function () { close_toolbar_menus(null) }
}

/* click anywhere else than menu to close it */
window.addEventListener("mousedown", function (evt) {
	let e = evt.target
	while (e) {
		if (e.tagName === "DETAILS")
			return
		e = e.parentElement
	}
	close_toolbar_menus(null)
})

/* close menus if window loses focus */
window.addEventListener("blur", function (evt) {
	close_toolbar_menus(null)
})

/* FULLSCREEN TOGGLE */

function toggle_fullscreen() {
	// Safari on iPhone doesn't support Fullscreen
	if (typeof document.documentElement.requestFullscreen !== "function")
		return

	if (document.fullscreenElement)
		document.exitFullscreen()
	else
		document.documentElement.requestFullscreen()

	event.preventDefault()
}

if ("ontouchstart" in window) {
	document.querySelector("header").ondblclick = toggle_fullscreen
}

/* SNAPSHOT VIEW */

replay_panel = document.createElement("div")
replay_panel.id = "replay_panel"

function add_replay_button(id, callback) {
	let button = document.createElement("div")
	button.className = "replay_button"
	button.id = id
	button.onclick = callback
	replay_panel.appendChild(button)
	return button
}

add_replay_button("replay_first", on_snap_first)
add_replay_button("replay_prev", on_snap_prev)
add_replay_button("replay_step_prev", null).classList.add("hide")
add_replay_button("replay_step_next", null).classList.add("hide")
add_replay_button("replay_next", on_snap_next)
add_replay_button("replay_last", null).classList.add("hide")
add_replay_button("replay_play", on_snap_stop)
add_replay_button("replay_stop", null).classList.add("hide")

function request_snap(snap_id) {
	if (snap_id >= 1 && snap_id <= snap_count) {
		snap_this = snap_id
		if (snap_cache[snap_id])
			show_snap(snap_id)
		else
			send_message("getsnap", snap_id)
	}
}

function show_snap(snap_id) {
	if (snap_view === null)
		snap_view = view
	view = snap_cache[snap_id]
	view.prompt = "Replay " + snap_id + " / " + snap_count + " \u2013 " + snap_active[snap_id]
	on_update_header()
	on_update_roles()
	on_update()
	on_update_log(view.log, view.log)
}

function on_snap_first() {
	request_snap(1)
}

function on_snap_prev() {
	if (!snap_view)
		request_snap(snap_count)
	else if (snap_this > 1)
		request_snap(snap_this - 1)
}

function on_snap_next() {
	if (!snap_view)
		on_snap_stop()
	else if (snap_this < snap_count)
		request_snap(snap_this + 1)
	else
		on_snap_stop()
}

function on_snap_stop() {
	if (snap_view) {
		view = snap_view
		snap_view = null
		on_update_header()
		on_update_roles()
		on_update()
		on_update_log(game_log.length, game_log.length)
	}
}

/* SHIFT KEY CSS TOGGLE */

window.addEventListener("keydown", (evt) => {
	if (document.activeElement === document.getElementById("chat_input"))
		return
	if (document.activeElement === document.getElementById("notepad_input"))
		return
	if (evt.key === "Shift")
		document.body.classList.add("shift")
})

window.addEventListener("keyup", (evt) => {
	if (evt.key === "Shift")
		document.body.classList.remove("shift")
})

window.addEventListener("blur", function (evt) {
	document.body.classList.remove("shift")
})

/* TOGGLE ZOOM MAP TO FIT */

function toggle_log() {
	document.querySelector("aside").classList.toggle("hide")
	update_zoom()
}

var toggle_zoom = function () {}
var update_zoom = function () {}

/* PAN & ZOOM GAME BOARD */

;(function () {
	var PAN_SPEED = Number(document.querySelector("main").dataset.panSpeed) || 1
	var MIN_ZOOM = Number(document.querySelector("main").dataset.minZoom) || 0.5
	var MAX_ZOOM = Number(document.querySelector("main").dataset.maxZoom) || 1.5

	scroll_with_middle_mouse("main", PAN_SPEED)

	const THRESHOLD = 0.0625
	const DECELERATION = 125

	const e_scroll = document.querySelector("main")
	e_scroll.style.touchAction = "none"
	e_scroll.tabIndex = 1 // enable keyboard scrolling

	const e_inner = document.createElement("div")
	e_inner.id = "pan_zoom_main"
	e_inner.style.transformOrigin = "0 0"
	e_inner.style.height = "120px"
	while (e_scroll.firstChild)
		e_inner.appendChild(e_scroll.firstChild)

	const e_outer = document.createElement("div")
	e_outer.id = "pan_zoom_wrap"
	e_outer.style.height = "120px"
	e_outer.appendChild(e_inner)

	e_scroll.appendChild(e_outer)

	const mapwrap = document.getElementById("mapwrap")
	if (mapwrap) {
		mapwrap.dataset.fit = "none"
		mapwrap.dataset.scale = 1
	}

	const map = document.getElementById("map") || e_inner.querySelector("div")
	var map_w = mapwrap ? mapwrap.clientWidth : map.clientWidth
	var map_h = mapwrap ? mapwrap.clientHeight : map.clientHeight

	if (e_scroll.dataset.mapHeight)
		map_h = Number(e_scroll.dataset.mapHeight)
	if (e_scroll.dataset.mapWidth)
		map_w = Number(e_scroll.dataset.mapWidth)

	console.log("INIT MAP SIZE", map_w, map_h)

	var transform0 = { x: 0, y: 0, scale: 1 }
	var transform1 = { x: 0, y: 0, scale: 1 }
	var old_scale = 1

	// touch finger tracking
	var last_touch_x = {}
	var last_touch_y = {}
	var last_touch_length = 0

	// momentum velocity tracking
	var mom_last_t = null
	var mom_last_x = null
	var mom_last_y = null

	// momentum auto-scroll
	var timer = 0
	var mom_time = 0
	var mom_vx = 0
	var mom_vy = 0

	function clamp_scale(scale) {
		let win_w = e_scroll.clientWidth
		let win_h = e_scroll.clientHeight
		let real_min_zoom = Math.min(MIN_ZOOM, win_w / map_w, win_h / map_h)
		if (scale * transform0.scale > MAX_ZOOM)
			scale = MAX_ZOOM / transform0.scale
		if (scale * transform0.scale < real_min_zoom)
			scale = real_min_zoom / transform0.scale
		return scale
	}

	function anchor_transform(touches) {
		// in case it changed from outside
		transform1.x = -e_scroll.scrollLeft
		transform1.y = -e_scroll.scrollTop

		transform0.scale = transform1.scale
		transform0.x = transform1.x
		transform0.y = transform1.y
		if (touches) {
			for (let touch of touches) {
				last_touch_x[touch.identifier] = touch.clientX
				last_touch_y[touch.identifier] = touch.clientY
			}
			last_touch_length = touches.length
		} else {
			last_touch_length = 0
		}
	}

	function should_fit_width(old) {
		return (map_w <= map_h) && (e_scroll.clientWidth / map_w < old)
	}

	function should_fit_both(old) {
		return (e_scroll.clientWidth / map_w < old) || (e_scroll.offsetHeight / map_h < old)
	}

	// export function
	toggle_zoom = function () {
		if (transform1.scale === 1) {
			if (mapwrap && window.innerWidth > 800) {
				cycle_map_fit()
				return
			}
		}

		if (transform1.scale > 1)
			zoom_to(1)
		else if (should_fit_width(transform1.scale))
			zoom_to(e_scroll.clientWidth / map_w)
		else if (should_fit_both(transform1.scale))
			zoom_to(Math.min(e_scroll.clientWidth / map_w, e_scroll.offsetHeight / map_h))
		else
			zoom_to(1)
	}

	// export function
	update_zoom = function () {
		update_map_fit()
		update_transform_on_resize()
		scroll_log_to_end()
	}

	function disable_map_fit() {
		if (mapwrap) {
			let scale = Number(mapwrap.dataset.scale)
			if (scale !== 1) {
				transform1.x = -e_scroll.scrollLeft
				transform1.y = -e_scroll.scrollTop
				transform1.scale = scale
			}

			mapwrap.dataset.fit = "none"
			mapwrap.dataset.scale = 1
			mapwrap.style.width = null
			mapwrap.style.height = null
			map.style.transform = null

			if (scale !== 1)
				update_transform()
		}
	}

	function cycle_map_fit() {
		switch (mapwrap.dataset.fit) {
			default:
			case "none":
				if (should_fit_width(1)) {
					mapwrap.dataset.fit = "width"
					break
				}
				// fall through
			case "width":
				if (should_fit_both(1)) {
					mapwrap.dataset.fit = "both"
					break
				}
				// fall through
			case "both":
				mapwrap.dataset.fit = "none"
		}
		update_map_fit()
	}

	function update_map_fit() {
		if (mapwrap) {
			let map = document.getElementById("map")
			map.style.transform = null
			mapwrap.style.width = null
			mapwrap.style.height = null

			let sx = e_scroll.clientWidth / map_w
			let sy = e_scroll.offsetHeight / map_h

			let scale = 1
			switch (mapwrap.dataset.fit) {
				case "width":
					scale = sx
					break
				case "both":
					scale = Math.min(sx, sy)
					break
			}

			if (scale < 1) {
				map.style.transform = "scale(" + scale + ")"
				mapwrap.style.width = (map.clientWidth * scale) + "px"
				mapwrap.style.height = (map.clientHeight * scale) + "px"
				mapwrap.dataset.scale = scale
			} else {
				mapwrap.dataset.scale = 1
			}

			update_transform_on_resize()
		}
	}

	function zoom_to(new_scale) {
		let cx = e_scroll.clientWidth / 2
		let cy = 0

		// in case changed from outside
		transform1.x = -e_scroll.scrollLeft
		transform1.y = -e_scroll.scrollTop

		transform1.x -= cx
		transform1.y -= cy
		transform1.x *= new_scale / transform1.scale
		transform1.y *= new_scale / transform1.scale
		transform1.scale = new_scale
		transform1.x += cx
		transform1.y += cy

		update_transform()
	}

	function update_transform() {
		let win_w = e_scroll.clientWidth
		let win_h = e_scroll.clientHeight

		// clamp zoom
		let real_min_zoom = Math.min(MIN_ZOOM, win_w / map_w, win_h / map_h)
		transform1.scale = Math.max(real_min_zoom, Math.min(MAX_ZOOM, transform1.scale))

		e_scroll.scrollLeft = -transform1.x
		e_scroll.scrollTop = -transform1.y

		if (transform1.scale !== old_scale) {
			if (transform1.scale === 1) {
				e_inner.style.transform = null
			} else {
				e_inner.style.transform = `scale(${transform1.scale})`
			}
			e_inner.style.width = (win_w / transform1.scale) + "px"
			e_outer.style.width = (e_inner.clientWidth * transform1.scale) + "px"
			old_scale = transform1.scale
		}
	}

	function update_transform_on_resize() {
		old_scale = 0
		anchor_transform()
		update_transform()
	}

	function start_measure(time) {
		mom_last_t = [ time, time, time ]
		mom_last_x = [ transform1.x, transform1.x, transform1.x ]
		mom_last_y = [ transform1.y, transform1.y, transform1.y ]
	}

	function abort_measure() {
		mom_last_t = mom_last_x = mom_last_y = null
	}

	function move_measure(time) {
		if (mom_last_t) {
			mom_last_t[0] = time
			mom_last_x[0] = transform1.x
			mom_last_y[0] = transform1.y
			if (mom_last_t[0] - mom_last_t[1] > 15) {
				mom_last_t[2] = mom_last_t[1]
				mom_last_x[2] = mom_last_x[1]
				mom_last_y[2] = mom_last_y[1]
				mom_last_t[1] = mom_last_t[0]
				mom_last_x[1] = mom_last_x[0]
				mom_last_y[1] = mom_last_y[0]
			}
		}
	}

	function start_momentum() {
		if (mom_last_t) {
			let dt = mom_last_t[0] - mom_last_t[2]
			if (dt > 5) {
				mom_time = Date.now()
				mom_vx = (mom_last_x[0] - mom_last_x[2]) / dt
				mom_vy = (mom_last_y[0] - mom_last_y[2]) / dt
				if (Math.hypot(mom_vx, mom_vy) < THRESHOLD)
					mom_vx = mom_vy = 0
				if (mom_vx || mom_vy)
					timer = requestAnimationFrame(update_momentum)
			}
		}
	}

	function stop_momentum() {
		cancelAnimationFrame(timer)
		timer = 0
	}

	function update_momentum() {
		var now = Date.now()
		var dt = now - mom_time
		mom_time = now

		transform1.x = transform1.x + mom_vx * dt
		transform1.y = transform1.y + mom_vy * dt
		update_transform()

		var decay = Math.pow(0.5, dt / DECELERATION)
		mom_vx *= decay
		mom_vy *= decay

		if (Math.hypot(mom_vx, mom_vy) < THRESHOLD)
			mom_vx = mom_vy = 0

		if (mom_vx || mom_vy)
			timer = requestAnimationFrame(update_momentum)
	}

	e_scroll.ontouchstart = function (evt) {
		if (evt.touches.length === 2)
			disable_map_fit()
		anchor_transform(evt.touches)
		stop_momentum()
		start_measure(evt.timeStamp)
	}

	e_scroll.ontouchend = function (evt) {
		anchor_transform(evt.touches)
		if (evt.touches.length === 0)
			start_momentum()
	}

	e_scroll.ontouchmove = function (evt) {
		if (evt.touches.length !== last_touch_length)
			anchor_transform(evt.touches)

		if (evt.touches.length === 1 || evt.touches.length === 2) {
			let a = evt.touches[0]

			let dx = a.clientX - last_touch_x[a.identifier]
			let dy = a.clientY - last_touch_y[a.identifier]

			transform1.scale = transform0.scale
			transform1.x = transform0.x + dx
			transform1.y = transform0.y + dy

			if (evt.touches.length === 1)
				move_measure(evt.timeStamp)
			else
				abort_measure()

			// zoom
			if (evt.touches.length === 2) {
				let b = evt.touches[1]

				let old_x = last_touch_x[a.identifier] - last_touch_x[b.identifier]
				let old_y = last_touch_y[a.identifier] - last_touch_y[b.identifier]
				let old = Math.sqrt(old_x * old_x + old_y * old_y)

				let cur_x = a.clientX - b.clientX
				let cur_y = a.clientY - b.clientY
				let cur = Math.sqrt(cur_x * cur_x + cur_y * cur_y)

				let scale = clamp_scale(cur / old)

				let cx = a.clientX
				let cy = a.clientY

				transform1.x -= cx
				transform1.y -= cy

				transform1.scale *= scale
				transform1.x *= scale
				transform1.y *= scale

				transform1.x += cx
				transform1.y += cy
			}

			update_transform()
		}
	}

	e_scroll.addEventListener(
		"wheel",
		function (evt) {
			if (evt.ctrlKey) {
				disable_map_fit()
				anchor_transform(evt.touches)

				let win_w = e_scroll.clientWidth
				let win_h = e_scroll.clientHeight
				let real_min_zoom = Math.min(MIN_ZOOM, win_w / map_w, win_h / map_h)

				// one "click" of 120 units -> 10% change
				let new_scale = Math.max(real_min_zoom, Math.min(MAX_ZOOM, transform1.scale + event.wheelDeltaY / 1200))

				// snap to 1 if close
				if (Math.abs(1 - new_scale) < Math.abs(event.wheelDeltaY / 2400))
					new_scale = 1

				transform1.x -= event.clientX
				transform1.y -= event.clientY

				transform1.x *= new_scale / transform1.scale
				transform1.y *= new_scale / transform1.scale
				transform1.scale = new_scale

				transform1.x += event.clientX
				transform1.y += event.clientY

				update_transform()
				evt.preventDefault()
			}
		},
		{ passive: false }
	)

	window.addEventListener("keydown", function (event) {
		if (event.ctrlKey || event.metaKey) {
			switch (event.keyCode) {
			// '=' / '+' on various keyboards
			case 61:
			case 107:
			case 187:
			case 171:
				disable_map_fit()
				zoom_to(Math.min(MAX_ZOOM, transform1.scale + 0.1))
				event.preventDefault()
				break
			// '-'
			case 173:
			case 109:
			case 189:
				disable_map_fit()
				{
					let win_w = e_scroll.clientWidth
					let win_h = e_scroll.clientHeight
					let real_min_zoom = Math.min(MIN_ZOOM, win_w / map_w, win_h / map_h)
					zoom_to(Math.max(real_min_zoom, transform1.scale - 0.1))
					event.preventDefault()
				}
				break
			// '0'
			case 48:
			case 96:
				disable_map_fit()
				zoom_to(1)
				event.preventDefault()
				break
			}
		}
	})

	window.addEventListener("resize", update_zoom)
})()

/* INITIALIZE */

if (window.innerWidth <= 800)
	document.querySelector("aside").classList.add("hide")

window.addEventListener("load", function () {
	if (params.mode === "debug")
		init_replay()
	else if (params.mode === "replay")
		init_replay()
	else if (params.mode === "play")
		connect_play()
	else
		document.getElementById("prompt").textContent = "Invalid mode: " + params.mode
})
