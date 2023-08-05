"use strict"

let params = {
	mode: "play",
	title_id: window.location.pathname.split("/")[1],
	game_id: 0,
	role: "Observer",
}

function init_params() {
	let search = new URLSearchParams(window.location.search)
	params.game_id = search.get("game")
	params.role = search.get("role") || "Observer"
	params.mode = search.get("mode") || "play"
}

init_params()

let roles = Array.from(document.querySelectorAll(".role")).map(x=>({id:x.id,role:x.id.replace(/^role_/,"").replace(/_/g," ")}))

let view = null
let player = "Observer"
let socket = null
let chat = null

let game_log = []
let game_cookie = 0

let snap_active = []
let snap_cache = []
let snap_count = 0
let snap_this = 0
let snap_view = null

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

function init_chat() {
	// only fetch new messages when we reconnect!
	if (chat !== null) {
		send_message("getchat", chat.log)
		return
	}

	let chat_window = document.createElement("div")
	chat_window.id = "chat_window"
	chat_window.innerHTML = `
		<div id="chat_x" onclick="toggle_chat()">\u274c</div>
		<div id="chat_header">Chat</div>
		<div id="chat_text"></div>
		<form id="chat_form" action=""><input id="chat_input" autocomplete="off"></form>
		`
	document.querySelector("body").appendChild(chat_window)

	let chat_button = document.createElement("div")
	chat_button.id = "chat_button"
	chat_button.className = "icon_button"
	chat_button.innerHTML = '<img src="/images/chat-bubble.svg">'
	chat_button.addEventListener("click", toggle_chat)
	document.querySelector("#toolbar").appendChild(chat_button)

	chat = {
		is_visible: false,
		text_element: document.getElementById("chat_text"),
		key: "chat/" + params.game_id,
		last_day: null,
		log: 0
	}

	chat.seen = window.localStorage.getItem(chat.key) | 0

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

	document.querySelector("body").addEventListener("keydown", e => {
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

	send_message("getchat", 0)
}

function save_chat() {
	window.localStorage.setItem(chat.key, chat.log)
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
		line.textContent = "[" + time + "] " + user + " \xbb " + message
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
	if (chat_id > chat.seen) {
		let button = document.getElementById("chat_button")
		start_blinker("NEW MESSAGE")
		if (!chat.is_visible)
			button.classList.add("new")
		else
			save_chat()
	}
}

function show_chat() {
	if (!chat.is_visible) {
		document.getElementById("chat_button").classList.remove("new")
		document.getElementById("chat_window").classList.add("show")
		document.getElementById("chat_input").focus()
		chat.is_visible = true
		save_chat()
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
		<div id="notepad_x" onclick="toggle_notepad()">\u274c</div>
		<div id="notepad_header">Notepad: ${player}</div>
		<textarea id="notepad_input" cols="55" rows="20" maxlength="16000" oninput="dirty_notepad()"></textarea>
		<div id="notepad_footer"><button id="notepad_save" onclick="save_notepad()" disabled>Save</button></div>
		`
	document.querySelector("body").appendChild(notepad_window)

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

function add_icon_button(parent, id, img, title, fn) {
	let button = document.getElementById(id)
	if (!button) {
		button = document.createElement("div")
		button.id = id
		button.title = title
		button.className = "icon_button"
		button.innerHTML = '<img src="/images/' + img + '.svg">'
		button.addEventListener("click", fn)
		parent.appendChild(button)
	}
	return button
}

/* REMATCH BUTTON */

function remove_resign_menu() {
	document.querySelectorAll(".resign").forEach(x => x.remove())
}

function goto_rematch() {
	window.location = "/rematch/" + params.game_id
}

function goto_replay() {
	let search = new URLSearchParams(window.location.search)
	search.delete("role")
	search.set("mode", "replay")
	window.location.search = search
}

function on_game_over() {
	add_icon_button(document.querySelector("header"), "replay_button", "sherlock-holmes-mirror", "Watch replay", goto_replay)
	if (player !== "Observer")
		add_icon_button(document.querySelector("header"), "rematch_button", "cycle", "Propose a rematch!", goto_rematch)
	remove_resign_menu()
}

/* CONNECT TO GAME SERVER */

function init_player_names(players) {
	for (let i = 0; i < roles.length; ++i) {
		let p = players.find(p => p.role === roles[i].role)
		document.getElementById(roles[i].id).querySelector(".role_user").textContent = p ? p.name : "NONE"
	}
}

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
		case "error":
			document.getElementById("prompt").textContent = arg
			if (view) {
				view.actions = null
				on_update()
			}
			break

		case "chat":
			update_chat(arg[0], arg[1], arg[2], arg[3])
			break

		case "note":
			update_notepad(arg)
			break

		case "players":
			player = arg[0]
			document.querySelector("body").classList.add(player.replace(/ /g, "_"))
			if (player !== "Observer") {
				init_chat()
				init_notepad()
			} else {
				remove_resign_menu()
			}
			init_player_names(arg[1])
			break

		case "presence":
			{
				let list = Array.isArray(arg) ? arg : Object.keys(arg)
				for (let i = 0; i < roles.length; ++i) {
					let elt = document.getElementById(roles[i].id)
					elt.classList.toggle("present", list.includes(roles[i].role))
				}
			}
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
				document.querySelector("aside").appendChild(replay_panel)
			console.log("SNAPSIZE", snap_count)
			break

		case "snap":
			console.log("SNAP", arg[0])
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
			div.appendChild(on_log(text))
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

/* MAP ZOOM */

function toggle_log() {
	document.querySelector("aside").classList.toggle("hide")
	zoom_map()
}

function toggle_zoom() {
	let mapwrap = document.getElementById("mapwrap")
	if (mapwrap) {
		mapwrap.classList.toggle("fit")
		zoom_map()
	}
}

function zoom_map() {
	let mapwrap = document.getElementById("mapwrap")
	if (mapwrap) {
		let main = document.querySelector("main")
		let map = document.getElementById("map")
		map.style.transform = null
		mapwrap.style.width = null
		mapwrap.style.height = null
		if (mapwrap.classList.contains("fit")) {
			let { width: gw, height: gh } = main.getBoundingClientRect()
			let { width: ww, height: wh } = mapwrap.getBoundingClientRect()
			let { width: cw, height: ch } = map.getBoundingClientRect()
			let scale = Math.min(ww / cw, gh / ch)
			if (scale < 1) {
				map.style.transform = "scale(" + scale + ")"
				mapwrap.style.width = (cw * scale) + "px"
				mapwrap.style.height = (ch * scale) + "px"
			}
		}
	}
}

window.addEventListener("resize", zoom_map)

window.addEventListener("keydown", (evt) => {
	if (document.activeElement === document.getElementById("chat_input"))
		return
	if (document.activeElement === document.getElementById("notepad_input"))
		return
	if (evt.key === "Shift")
		document.querySelector("body").classList.add("shift")
})

window.addEventListener("keyup", (evt) => {
	if (evt.key === "Shift")
		document.querySelector("body").classList.remove("shift")
})

/* ACTIONS */

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
		document.getElementById("actions").appendChild(button)
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

function confirm_resign() {
	if (window.confirm("Are you sure that you want to resign?"))
		send_message("resign")
}

function send_save() {
	send_message("save")
}

function send_restore() {
	send_message("restore", window.localStorage[params.title_id + "/save"])
}

/* MOBILE PHONE LAYOUT */

let mobile_scroll_header = document.querySelector("header")
let mobile_scroll_last_y = 0

window.addEventListener("scroll", function scroll_mobile_fix (evt) {
	if (mobile_scroll_header.clientWidth <= 640) {
		if (window.scrollY > 40) {
			if (mobile_scroll_last_y <= 40)
				mobile_scroll_header.classList.add("mobilefix")
		} else {
			if (mobile_scroll_last_y > 40)
				mobile_scroll_header.classList.remove("mobilefix")
		}
		mobile_scroll_last_y = window.scrollY
	}
})

/* REPLAY */

function init_replay() {
	let script = document.createElement("script")
	script.src = "/common/replay.js"
	document.body.appendChild(script)
}

window.addEventListener("load", function () {
	zoom_map()
	if (params.mode === "debug")
		init_replay()
	else if (params.mode === "replay")
		init_replay()
	else if (params.mode === "play")
		connect_play()
	else
		document.getElementById("prompt").textContent = "Invalid mode: " + params.mode
})

/* MAIN MENU */

function init_main_menu() {
	let popup = document.querySelector(".menu_popup")
	let sep = document.createElement("div")
	sep.className = "menu_separator"
	sep.id = "main_menu_separator"
	popup.insertBefore(sep, popup.firstChild)
}

function add_main_menu_item(text, onclick) {
	let popup = document.querySelector(".menu_popup")
	let sep = document.getElementById("main_menu_separator")
	let item = document.createElement("div")
	item.className = "menu_item"
	item.onclick = onclick
	item.textContent = text
	popup.insertBefore(item, sep)
}

function add_main_menu_item_link(text, url) {
	let popup = document.querySelector(".menu_popup")
	let sep = document.getElementById("main_menu_separator")
	let item = document.createElement("a")
	item.className = "menu_item"
	item.href = url
	item.textContent = text
	popup.insertBefore(item, sep)
}

init_main_menu()
if (params.mode === "play" && params.role !== "Observer") {
	add_main_menu_item_link("Go home", "/games/active")
	add_main_menu_item_link("Go to next game", "/games/next")
} else {
	add_main_menu_item_link("Go home", "/")
}

/* SNAPSHOT VIEW */

var replay_panel = null

function add_replay_button(parent, id, callback) {
	let button = document.createElement("div")
	button.className = "replay_button"
	button.id = id
	button.onclick = callback
	parent.appendChild(button)
	return button
}

function init_snap() {
	replay_panel = document.createElement("div")
	replay_panel.id = "replay_panel"
	add_replay_button(replay_panel, "replay_first", on_snap_first)
	add_replay_button(replay_panel, "replay_prev", on_snap_prev)
	add_replay_button(replay_panel, "replay_step_prev", null).classList.add("hide")
	add_replay_button(replay_panel, "replay_step_next", null).classList.add("hide")
	add_replay_button(replay_panel, "replay_next", on_snap_next)
	add_replay_button(replay_panel, "replay_last", null).classList.add("hide")
	add_replay_button(replay_panel, "replay_play", on_snap_stop)
	add_replay_button(replay_panel, "replay_stop", null).classList.add("hide")
}

init_snap()

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
		on_update()
		on_update_log(game_log.length, game_log.length)
	}
}
