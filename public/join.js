"use strict"

/* global game, roles, players, blacklist, user_id */

const PACE_THRESHOLD = [
	14,
	3,
	5,
	10
]

const PACE_TEXT = [
	"No time control",
	 "7+ moves per day",
	 "3+ moves per day",
	 "1+ moves per day",
]

let start_status = 0
let evtsrc = null
let invite_role = null

function is_game_ready() {
	if (game.player_count !== players.length)
		return false
	for (let p of players)
		if (p.is_invite)
			return false
	return true
}

function is_blacklist(p) {
	return blacklist && blacklist.includes(p.user_id)
}

function has_already_joined() {
	for (let p of players)
		if (p.user_id === user_id)
			return true
	return false
}

function has_other_players() {
	for (let p of players)
		if (p.user_id !== user_id)
			return true
	return false
}

function may_join() {
	if (game.is_match || game.status > 1)
		return false
	if (has_already_joined()) {
		if (user_id !== game.owner_id)
			return false
		if (has_other_players())
			return false
	}
	return true
}

function may_part() {
	if (game.is_match || game.status > 1)
		return false
	if (game.status > 0) {
		if (!game.is_private)
			return false
	}
	return true
}

function may_kick() {
	if (game.owner_id !== user_id)
		return false
	return may_part()
}

function may_start() {
	if (game.owner_id !== user_id || game.is_match || game.status !== 0)
		return false
	if (!is_game_ready())
		return false
	return true
}

function may_delete() {
	if (game.owner_id !== user_id || game.is_match)
		return false
	if (game.status > 0 && game.user_count > 1)
		return false
	return true
}

function may_rewind() {
	if (game.owner_id !== user_id || game.is_match || game.status !== 1)
		return false
	if (!game.is_private)
		return false
	return true
}

function option_to_english(k) {
	if (k === true || k === 1)
		return "yes"
	if (k === false)
		return "no"
	if (typeof k === "string")
		return k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
	return k
}

function format_options(options) {
	if (options === "{}")
		return ""
	return Object.entries(JSON.parse(options))
		.map(([ k, v ]) => {
			if (k === "players")
				return v + " Player"
			if (v === true || v === 1)
				return option_to_english(k)
			return option_to_english(k) + "=" + option_to_english(v)
		})
		.join(", ")
}

function format_time_left(time) {
	if (time <= 0)
		return "no time left"
	if (time <= 0.125)
		return Math.floor(time * 24 * 60) + " minutes left"
	if (time <= 3)
		return Math.floor(time * 24) + " hours left"
	return Math.floor(time) + " days left"
}

function epoch_from_julianday(x) {
	return (x - 2440587.5) * 86400000
}

function julianday_from_epoch(x) {
	return x / 86400000 + 2440587.5
}

function human_date(date) {
	if (typeof date === "string")
		date = julianday_from_epoch(Date.parse(date + "Z"))
	if (typeof date !== "number")
		return "never"
	var days = julianday_from_epoch(Date.now()) - date
	var seconds = days * 86400
	if (days < 1) {
		if (seconds < 60) return "now"
		if (seconds < 120) return "1 minute ago"
		if (seconds < 3600) return Math.floor(seconds / 60) + " minutes ago"
		if (seconds < 7200) return "1 hour ago"
		if (seconds < 86400) return Math.floor(seconds / 3600) + " hours ago"
	}
	if (days < 2) return "yesterday"
	if (days < 14) return Math.floor(days) + " days ago"
	if (days < 31) return Math.floor(days / 7) + " weeks ago"
	return new Date(epoch_from_julianday(date)).toISOString().substring(0,10)
}

function confirm_delete() {
	let warning = "Are you sure you want to DELETE this game?"
	if (window.confirm(warning))
		post("/api/delete/" + game.game_id)
}

function confirm_rewind() {
	let warning = "Are you sure you want to REWIND this game to the last move?\n\nMake sure you have the consent of all the players."
	if (window.confirm(warning))
		post("/api/rewind/" + game.game_id)
}

async function post(url) {
	window.error.textContent = ""
	let res = await fetch(url, { method: "POST" })
	if (!res.ok) {
		window.error.textContent = res.status + " " + res.statusText
		return
	}
	let text = await res.text()
	if (text !== "SUCCESS") {
		window.error.textContent = text
		return
	}
	start_event_source()
}

function start() {
	post(`/api/start/${game.game_id}`)
}

function join(role) {
	post(`/api/join/${game.game_id}/${encodeURIComponent(role)}`)
}

function accept(role) {
	post(`/api/accept/${game.game_id}/${encodeURIComponent(role)}`)
}

function decline(role) {
	post(`/api/part/${game.game_id}/${encodeURIComponent(role)}`)
}

function part(role) {
	let warning = "Are you sure you want to LEAVE this game?"
	if (game.status === 0 || window.confirm(warning))
		post(`/api/part/${game.game_id}/${encodeURIComponent(role)}`)
}

function kick(role) {
	let player = players.find(p => p.role === role)
	let warning = `Are you sure you want to KICK player ${player.name} (${role}) from this game?`
	if (game.status === 0 || window.confirm(warning))
		post(`/api/part/${game.game_id}/${encodeURIComponent(role)}`)
}

function invite(role) {
	invite_role = role
	document.getElementById("invite").showModal()
}

function hide_invite() {
	document.getElementById("invite").close()
}

function send_invite() {
	let invite_user = document.getElementById("invite_user").value
	if (invite_user) {
		document.getElementById("invite").close()
		post(`/api/invite/${game.game_id}/${encodeURIComponent(invite_role)}/${encodeURIComponent(invite_user)}`)
	}
}

function start_event_source() {
	if (!game)
		return
	if (!evtsrc || evtsrc.readyState === 2) {
		console.log("STARTING EVENT SOURCE")
		evtsrc = new EventSource("/join-events/" + game.game_id)
		evtsrc.addEventListener("hello", function (evt) {
			console.log("HELLO", evt.data)
			window.disconnected.textContent = ""
		})
		evtsrc.addEventListener("updated", function (evt) {
			console.log("UPDATED", evt.data)
			let data = JSON.parse(evt.data)
			game = data.game
			roles = data.roles
			players = data.players
			update()
		})
		evtsrc.addEventListener("deleted", function (evt) {
			console.log("DELETED", evt.data)
			game = null
			roles = null
			players = null
			update()
			evtsrc.close()
		})
		evtsrc.onerror = function (evt) {
			console.log("ERROR", evt)
			window.disconnected.textContent = "Disconnected from server..."
		}
		window.addEventListener('beforeunload', function (_evt) {
			evtsrc.close()
		})
	}
}

function user_link(user_name) {
	return `<a class="black" href="/user/${user_name}">${user_name}</a>`
}

function player_link(player) {
	if (!player.name)
		return "null"
	let link = user_link(player.name)
	if (player.is_invite)
		link = "<i>" + link + "</i> ?"
	if (player.user_id === user_id)
		link = "\xbb " + link
	return link
}

function play_link(parent, player) {
	let e = document.createElement("a")
	e.setAttribute("href", `/${game.title_id}/play.html?game=${game.game_id}&role=${encodeURIComponent(player.role)}`)
	e.textContent = "Play"
	parent.appendChild(e)
}

function action_link(parent, text, action, arg) {
	let e = document.createElement("a")
	e.setAttribute("href", `javascript:${action.name}('${arg}')`)
	e.textContent = text
	parent.appendChild(e)
}

function create_element(parent, tag, classList) {
	let e = document.createElement(tag)
	if (classList)
		e.classList = classList
	parent.appendChild(e)
	return e
}

function create_button(text, action) {
	let e = create_element(window.game_actions, "button")
	e.textContent = text
	e.onclick = action
}

function create_game_list_item(parent, key, val) {
	if (val) {
		let tr = create_element(parent, "tr")
		let e_key = create_element(tr, "td")
		let e_val = create_element(tr, "td")
		e_key.innerHTML = key
		e_val.innerHTML = val
	}
}

function create_game_list() {
	let table = create_element(window.game_info, "table")
	let list = create_element(table, "tbody")

	if (game.pool_name) {
		create_game_list_item(list, "Tournament", `<a href="/tm/pool/${game.pool_name}">${game.pool_name}</a>`)
		if (game.scenario !== "Standard")
			create_game_list_item(list, "Scenario", game.scenario)
	} else {
		if (game.scenario !== "Standard")
			create_game_list_item(list, "Scenario", game.scenario)
		create_game_list_item(list, "Options", format_options(game.options))
	}

	if (game.pace > 0)
		create_game_list_item(list, "Pace", PACE_TEXT[game.pace])

	if (!game.pool_name)
		create_game_list_item(list, "Notice", game.notice)

	if (game.status === 0) {
		if (game.owner_id)
			create_game_list_item(list, "Created", human_date(game.ctime) + " by " + user_link(game.owner_name))
		else
			create_game_list_item(list, "Created", human_date(game.ctime))
	} else {
		if (game.owner_id)
			create_game_list_item(list, "Started", human_date(game.ctime) + " by " + user_link(game.owner_name))
		else
			create_game_list_item(list, "Started", human_date(game.ctime))
	}

	create_game_list_item(list, "Moves", game.moves)

	if (game.status === 1) {
		create_game_list_item(list, "Last move", human_date(game.mtime))
	}

	if (game.status > 1) {
		create_game_list_item(list, "Finished", human_date(game.mtime))
		create_game_list_item(list, "Result", game.result)
	}
}

function create_player_box(role, player) {
	let box = create_element(window.game_players, "table")
	let thead = create_element(box, "thead")
	let tbody = create_element(box, "tbody")
	let tr_role = create_element(thead, "tr")
	let tr_player = create_element(tbody, "tr", "p")
	let tr_actions = create_element(tbody, "tr", "a")

	let td_role_name = create_element(tr_role, "td")
	let td_role_time = create_element(tr_role, "td", "r")
	let td_player_name = create_element(tr_player, "td")
	let td_player_seen = create_element(tr_player, "td", "r")
	let td_actions = create_element(tr_actions, "td", "a r")
	td_actions.setAttribute("colspan", 2)
	td_actions.textContent = "\u200b"

	td_role_name.textContent = role

	if (player) {
		if (player.is_active && game.status === 1)
			box.classList = "active"
		if (player.is_invite)
			box.classList = "invite"

		if (game.status === 1 && (player.time_left < PACE_THRESHOLD[game.pace]))
			td_role_time.textContent = format_time_left(player.time_left)

		td_player_name.innerHTML = player_link(player)
		if (player.user_id !== user_id && game.status <= 1)
			td_player_seen.innerHTML = "<i>seen " + human_date(player.atime) + "</i>"

		if (user_id) {
			if (is_blacklist(player))
				td_player_name.classList.add("blacklist")

			if (player.user_id === user_id) {
				if (player.is_invite) {
					action_link(td_actions, "Decline", decline, role)
					action_link(td_actions, "Accept", accept, role)
				} else {
					if (may_part())
						action_link(td_actions, "Leave", part, role)
					if (game.status === 1 || game.status === 2)
						play_link(td_actions, player)
				}
			} else {
				if (may_kick())
					action_link(td_actions, "Kick", kick, role)
			}
		}
	} else {
		td_player_name.innerHTML = "<i>Empty</i>"

		if (user_id) {
			if (!game.is_match) {
				if (game.owner_id === user_id)
					action_link(td_actions, "Invite", invite, role)
				if (may_join())
					action_link(td_actions, "Join", join, role)
			}
		}
	}
}

function update() {
	window.error.textContent = ""
	window.game_info.replaceChildren()
	window.game_players.replaceChildren()
	window.game_actions.replaceChildren()

	if (!game) {
		window.game_enter.textContent = "Game deleted!"
		return
	}

	if (game.status === 0) {
		if (game.is_ready)
			window.game_enter.textContent = "Waiting to start."
		else if (user_id)
			window.game_enter.textContent = "Waiting for players to join."
		else
			window.game_enter.innerHTML = `<a href="/login">Login</a> or <a href="/signup">sign up</a> to join.`
	} else if (game.status === 1)
		window.game_enter.innerHTML = `<a href="/${game.title_id}/play.html?game=${game.game_id}">Watch</a>`
	else if (game.status === 2)
		window.game_enter.innerHTML = `<a href="/${game.title_id}/play.html?game=${game.game_id}">Review</a>`
	else
		window.game_enter.innerHTML = "Archived."

	create_game_list()

	for (let i = 0; i < roles.length; ++i) {
		let role = roles[i]
		if (game.is_random && game.status === 0)
			role = "Random " + (i+1)
		create_player_box(role, players.find(p => p.role === role))
	}

	if (user_id) {
		if (may_rewind())
			create_button("Rewind", confirm_rewind)
		if (may_delete())
			create_button("Delete", confirm_delete)
		if (may_start())
			create_button("Start", start)
	}
}

window.onload = function () {
	update()
	if (user_id && game.status <= 1) {
		start_event_source()
		setInterval(start_event_source, 15000)
		setInterval(update, 60000)
	}
}
