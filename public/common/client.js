"use strict";

/* global io, on_update */

/* URL: /$title_id/play:$game_id:$role */
if (!/\/[\w-]+\/play:\d+(:[\w-]+)?/.test(window.location.pathname)) {
	document.getElementById("prompt").textContent = "Invalid game ID.";
	throw Error("Invalid game ID.");
}

const param_title_id = window.location.pathname.split("/")[1];
const param_game_id = decodeURIComponent(window.location.pathname.split("/")[2]).split(":")[1] | 0;
const param_role = decodeURIComponent(window.location.pathname.split("/")[2]).split(":")[2] || "Observer";

let game = null;
let game_over = false;
let player = null;
let socket = null;

let chat_is_visible = false;
let chat_text = null;
let chat_key = null;
let chat_last_day = null;
let chat_log = 0;
let chat_seen = 0;

function scroll_with_middle_mouse(panel_sel, multiplier) {
	let panel = document.querySelector(panel_sel);
	let down_x, down_y, scroll_x, scroll_y;
	if (!multiplier)
		multiplier = 1;
	function md(e) {
		if (e.button === 1) {
			down_x = e.clientX;
			down_y = e.clientY;
			scroll_x = panel.scrollLeft;
			scroll_y = panel.scrollTop;
			window.addEventListener('mousemove', mm);
			window.addEventListener('mouseup', mu);
			e.preventDefault();
		}
	}
	function mm(e) {
		let dx = down_x - e.clientX;
		let dy = down_y - e.clientY;
		panel.scrollLeft = scroll_x + dx * multiplier;
		panel.scrollTop = scroll_y + dy * multiplier;
		e.preventDefault();
	}
	function mu(e) {
		if (e.button === 1) {
			window.removeEventListener('mousemove', mm);
			window.removeEventListener('mouseup', mu);
			e.preventDefault();
		}
	}
	panel.addEventListener('mousedown', md);
}

function drag_element_with_mouse(element_sel, grabber_sel) {
	let element = document.querySelector(element_sel);
	let grabber = document.querySelector(grabber_sel) || element;
	let save_x, save_y;
	function md(e) {
		if (e.button === 0) {
			save_x = e.clientX;
			save_y = e.clientY;
			window.addEventListener('mousemove', mm);
			window.addEventListener('mouseup', mu);
			e.preventDefault();
		}
	}
	function mm(e) {
		let dx = save_x - e.clientX;
		let dy = save_y - e.clientY;
		save_x = e.clientX;
		save_y = e.clientY;
		element.style.left = (element.offsetLeft - dx) + "px";
		element.style.top = (element.offsetTop - dy) + "px";
		e.preventDefault();
	}
	function mu(e) {
		if (e.button === 0) {
			window.removeEventListener('mousemove', mm);
			window.removeEventListener('mouseup', mu);
			e.preventDefault();
		}
	}
	grabber.addEventListener('mousedown', md);
}

/* TITLE BLINKER */

let blink_title = document.title;
let blink_timer = 0;

function start_blinker(message) {
	let tick = false;
	if (blink_timer)
		stop_blinker();
	if (!document.hasFocus()) {
		document.title = message;
		blink_timer = setInterval(function () {
			document.title = tick ? message : blink_title;
			tick = !tick;
		}, 1000);
	}
}

function stop_blinker() {
	document.title = blink_title;
	clearInterval(blink_timer);
	blink_timer = 0;
}

window.addEventListener("focus", stop_blinker);

function load_chat() {
	chat_key = "chat/" + param_game_id;
	chat_text = document.querySelector(".chat_text");
	chat_last_day = null;
	chat_log = 0;
	chat_seen = window.localStorage.getItem(chat_key) | 0;
}

function save_chat() {
	window.localStorage.setItem(chat_key, chat_log);
}

function update_chat(chat_id, utc_date, user, message) {
	function format_time(date) {
		let mm = date.getMinutes();
		let hh = date.getHours();
		if (mm < 10) mm = "0" + mm;
		if (hh < 10) hh = "0" + hh;
		return hh + ":" + mm;
	}
	function add_date_line(date) {
		let line = document.createElement("div");
		line.className = "date";
		line.textContent = "~ " + date + " ~";
		chat_text.appendChild(line);
	}
	function add_chat_line(time, user, message) {
		let line = document.createElement("div");
		line.textContent = "[" + time + "] " + user + " \xbb " + message;
		chat_text.appendChild(line);
		chat_text.scrollTop = chat_text.scrollHeight;
	}
	if (chat_id > chat_log) {
		chat_log = chat_id;
		let date = new Date(utc_date + "Z");
		let day = date.toDateString();
		if (day !== chat_last_day) {
			add_date_line(day);
			chat_last_day = day;
		}
		add_chat_line(format_time(date), user, message);
	}
	if (chat_id > chat_seen) {
		let button = document.querySelector(".chat_button");
		start_blinker("NEW MESSAGE");
		if (!chat_is_visible)
			button.classList.add("new");
		else
			save_chat();
	}
}

function init_client(roles) {
	game = null;
	player = null;

	const ROLE_SEL = [
		".role.one",
		".role.two",
		".role.three",
		".role.four",
		".role.five",
		".role.six",
		".role.seven",
	];

	const USER_SEL = [
		".role.one .role_user",
		".role.two .role_user",
		".role.three .role_user",
		".role.four .role_user",
		".role.five .role_user",
		".role.six .role_user",
		".role.seven .role_user",
	];

	load_chat();

	console.log("JOINING", param_title_id + "/" + param_game_id + "/" + param_role);

	socket = io({
		transports: ['websocket'],
		query: { title: param_title_id, game: param_game_id, role: param_role },
	});

	socket.on('connect', () => {
		console.log("CONNECTED");
		document.getElementById("grid_top").classList.remove('disconnected');
		socket.emit('getchat', chat_log); // only send new messages when we reconnect!
	});

	socket.on('disconnect', () => {
		console.log("DISCONNECTED");
		document.getElementById("prompt").textContent = "Disconnected from server!";
		document.getElementById("grid_top").classList.add('disconnected');
	});

	socket.on('roles', (me, players) => {
		console.log("ROLES", me, JSON.stringify(players));
		player = me.replace(/ /g, '_');
		if (player === "Observer")
			document.querySelector(".chat_button").style.display = "none";
		document.querySelector("body").classList.add(player);
		for (let i = 0; i < roles.length; ++i) {
			let pr = players.find(p => p.role === roles[i]);
			document.querySelector(USER_SEL[i]).textContent = pr ? pr.name : "NONE";
		}
	});

	socket.on('presence', (presence) => {
		console.log("PRESENCE", JSON.stringify(presence));
		for (let i = 0; i < roles.length; ++i) {
			let elt = document.querySelector(ROLE_SEL[i]);
			if (roles[i] in presence)
				elt.classList.add('present');
			else
				elt.classList.remove('present');
		}
	});

	socket.on('state', (new_game, new_game_over) => {
		console.log("STATE", !!new_game.actions, new_game_over);
		game = new_game;
		game_over = new_game_over;
		on_update_bar();
		on_update();
		on_game_over();
		on_update_log();
	});

	socket.on('save', (msg) => {
		console.log("SAVE");
		window.localStorage[param_title_id + '/save'] = msg;
	});

	socket.on('error', (msg) => {
		console.log("ERROR", msg);
		document.getElementById("prompt").textContent = msg;
	});

	socket.on('chat', function (item) {
		console.log("CHAT", JSON.stringify(item));
		update_chat(item[0], item[1], item[2], item[3]);
	});

	document.querySelector(".chat_form").addEventListener("submit", e => {
		let input = document.getElementById("chat_input");
		e.preventDefault();
		if (input.value) {
			socket.emit('chat', input.value);
			input.value = '';
		} else {
			hide_chat();
		}
	});

	document.querySelector("body").addEventListener("keydown", e => {
		if (player && player !== "Observer") {
			if (e.key === "Escape") {
				if (chat_is_visible) {
					e.preventDefault();
					hide_chat();
				}
			}
			if (e.key === "Enter") {
				let input = document.getElementById("chat_input");
				if (document.activeElement !== input) {
					e.preventDefault();
					show_chat();
				}
			}
		}
	});

	drag_element_with_mouse(".chat_window", ".chat_header");
}

let is_your_turn = false;
let old_active = null;

function on_update_bar() {
	document.getElementById("prompt").textContent = game.prompt;
	if (game.actions) {
		document.getElementById("grid_top").classList.add("your_turn");
		if (!is_your_turn || old_active !== game.active)
			start_blinker("YOUR TURN");
		is_your_turn = true;
	} else {
		document.getElementById("grid_top").classList.remove("your_turn");
		is_your_turn = false;
	}
	old_active = game.active;
}

let create_log_entry = function (text) {
	let p = document.createElement("div");
	p.textContent = text;
	return p;
}

let log_scroller = document.getElementById("log");

function on_update_log() {
	let parent = document.getElementById("log");
	let to_delete = parent.children.length - game.log_start;
	while (to_delete-- > 0)
		parent.removeChild(parent.lastChild);
	for (let entry of game.log)
		parent.appendChild(create_log_entry(entry));
	log_scroller.scrollTop = log_scroller.scrollHeight;
}

try {
	new ResizeObserver(entries => {
		log_scroller.scrollTop = log_scroller.scrollHeight;
	}).observe(log_scroller);
} catch (err) {
	window.addEventListener("resize", evt => {
		log_scroller.scrollTop = log_scroller.scrollHeight;
	});
}

function toggle_fullscreen() {
	if (document.fullscreen)
		document.exitFullscreen();
	else
		document.documentElement.requestFullscreen();
}

function show_chat() {
	if (!chat_is_visible) {
		document.querySelector(".chat_button").classList.remove("new");
		document.querySelector(".chat_window").classList.add("show");
		document.getElementById("chat_input").focus();
		chat_is_visible = true;
		save_chat();
	}
}

function hide_chat() {
	if (chat_is_visible) {
		document.querySelector(".chat_window").classList.remove("show");
		document.getElementById("chat_input").blur();
		chat_is_visible = false;
	}
}

function toggle_chat() {
	if (chat_is_visible)
		hide_chat();
	else
		show_chat();
}

function zoom_map() {
	let grid = document.getElementById("grid_center");
	let mapwrap = document.querySelector(".mapwrap");
	let map = document.querySelector(".map");
	map.style.transform = null;
	mapwrap.style.width = null;
	mapwrap.style.height = null;
	if (mapwrap.classList.contains("fit")) {
		let { width: gw, height: gh } = grid.getBoundingClientRect();
		let { width: ww, height: wh } = mapwrap.getBoundingClientRect();
		let { width: cw, height: ch } = map.getBoundingClientRect();
		let scale = Math.min(ww / cw, gh / ch);
		if (scale < 1) {
			map.style.transform = "scale(" + scale + ")";
			mapwrap.style.width = (cw * scale) + "px";
			mapwrap.style.height = (ch * scale) + "px";
		}
	}
}

function toggle_zoom() {
	document.querySelector(".mapwrap").classList.toggle('fit');
	zoom_map();
}

function init_map_zoom() {
	window.addEventListener('resize', zoom_map);
	zoom_map();
}

function init_shift_zoom() {
	window.addEventListener("keydown", (evt) => {
		if (evt.key === "Shift")
			document.querySelector("body").classList.add("shift");
	});
	window.addEventListener("keyup", (evt) => {
		if (evt.key === "Shift")
			document.querySelector("body").classList.remove("shift");
	});
}

function toggle_log() {
	document.getElementById("grid_window").classList.toggle("hide_log");
	zoom_map();
}

function show_action_button(sel, action, use_label = false) {
	let button = document.querySelector(sel);
	if (game.actions && action in game.actions) {
		button.classList.remove("hide");
		if (game.actions[action]) {
			if (use_label)
				button.textContent = game.actions[action];
			button.disabled = false;
		} else {
			button.disabled = true;
		}
	} else {
		button.classList.add("hide");
	}
}

function confirm_resign() {
	if (window.confirm("Are you sure that you want to resign?"))
		socket.emit('resign');
}

function send_action(verb, noun) {
	// Reset action list here so we don't send more than one action per server prompt!
	if (noun !== undefined) {
		if (game.actions && game.actions[verb] && game.actions[verb].includes(noun)) {
			game.actions = null;
			console.log("ACTION", verb, JSON.stringify(noun));
			socket.emit('action', verb, noun);
			return true;
		}
	} else {
		if (game.actions && game.actions[verb]) {
			game.actions = null;
			console.log("ACTION", verb);
			socket.emit('action', verb);
			return true;
		}
	}
	return false;
}

function send_save() {
	socket.emit('save');
}

function send_restore() {
	socket.emit('restore', window.localStorage[param_title_id + '/save']);
}

function send_restart(scenario) {
	socket.emit('restart', scenario);
}

function on_game_over() {
	if (player) {
		let exit_button = document.getElementById("exit_button");
		if (exit_button) {
			if (game_over || player === "Observer")
				exit_button.classList.remove("hide");
			else
				exit_button.classList.add("hide");
		}
		let rematch_button = document.getElementById("rematch_button");
		if (rematch_button) {
			if (game_over && player !== "Observer")
				rematch_button.classList.remove("hide");
			else
				rematch_button.classList.add("hide");
		}
	}
}

function send_rematch() {
	window.location = '/rematch/' + param_game_id + '/' + param_role;
}

function send_exit() {
	window.location = '/info/' + param_title_id;
}
