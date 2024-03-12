"use strict"

let start_status = game.status
let evtsrc = null
let timer = 0
let invite_role = null

function confirm_delete() {
	let warning = `Are you sure you want to DELETE this game?`
	if (window.confirm(warning))
		window.location.href = "/delete/" + game.game_id
}

function post(url) {
	fetch(url, { method: "POST" })
		.then(r => r.text())
		.then(t => window.error.textContent = (t === "SUCCESS") ? "" : t)
		.catch(e => window.error.textContent = e)
	start_event_source()
}

function start() {
	post(`/start/${game.game_id}`)
}

function join(role) {
	post(`/join/${game.game_id}/${encodeURIComponent(role)}`)
}

function part(role) {
	let warning = "Are you sure you want to LEAVE this game?"
	if (game.status === 0 || window.confirm(warning))
		post(`/part/${game.game_id}/${encodeURIComponent(role)}`)
}

function kick(role) {
	let player = players.find(p => p.role === role)
	let warning = `Are you sure you want to KICK player ${player.name} (${role}) from this game?`
	if (game.status === 0 || window.confirm(warning))
		post(`/part/${game.game_id}/${encodeURIComponent(role)}`)
}

function accept(role) {
	post(`/accept/${game.game_id}/${encodeURIComponent(role)}`)
}

function send_invite() {
	let invite_user = document.getElementById("invite_user").value
	if (invite_user) {
		post(`/invite/${game.game_id}/${encodeURIComponent(invite_role)}/${encodeURIComponent(invite_user)}`)
		document.getElementById("invite").close()
	}
}

function show_invite(role) {
	invite_role = role
	document.getElementById("invite").showModal()
}

function hide_invite() {
	document.getElementById("invite").close()
}

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

function start_event_source() {
	if (!evtsrc || evtsrc.readyState === 2) {
		console.log("STARTING EVENT SOURCE")
		evtsrc = new EventSource("/join-events/" + game.game_id)
		evtsrc.addEventListener("players", function (evt) {
			console.log("PLAYERS:", evt.data)
			players = JSON.parse(evt.data)
			update()
		})
		evtsrc.addEventListener("ready", function (evt) {
			console.log("READY:", evt.data)
			ready = JSON.parse(evt.data)
			update()
		})
		evtsrc.addEventListener("game", function (evt) {
			console.log("GAME:", evt.data)
			game = JSON.parse(evt.data)
			if (game.status > 1) {
				console.log("CLOSED EVENT SOURCE")
				clearInterval(timer)
				evtsrc.close()
			}
			update()
		})
		evtsrc.addEventListener("deleted", function (evt) {
			console.log("DELETED")
			window.location.href = '/' + game.title_id
		})
		evtsrc.onerror = function (err) {
			window.message.innerHTML = "Disconnected from server..."
		}
		window.addEventListener('beforeunload', function (evt) {
			evtsrc.close()
		})
	}
}

function is_friend(p) {
	return whitelist && whitelist.includes(p.user_id)
}

function is_enemy(p) {
	return blacklist && blacklist.includes(p.user_id)
}

function user_link(player) {
	return `<a class="black" href="/user/${player.name}">${player.name}</a>`
}

function play_link(player) {
	return `\xbb <a href="/${game.title_id}/play.html?game=${game.game_id}&role=${encodeURIComponent(player.role)}">${player.name}</a>`
}

function action_link(player, action, color, text) {
	return `<a class="${color}" href="javascript:${action}('${player.role}')">${text}</a>`
}

function update() {
	update_common()
	if (user_id)
		update_login()
	else
		update_no_login()
}

function update_common() {
	if (game.scenario !== "Standard")
		document.querySelector("h1").textContent = "#" + game.game_id + " - " + game.title_name + " - " + game.scenario
	else
		document.querySelector("h1").textContent = "#" + game.game_id + " - " + game.title_name

	let message = window.message
	if (game.status === 0) {
		if (ready)
			message.innerHTML = "Waiting to start..."
		else
			message.innerHTML = "Waiting for players to join..."
	} else if (game.status === 1) {
		message.innerHTML = `<a href="/${game.title_id}/play.html?game=${game.game_id}">Observe</a>`
	} else if (game.status === 2) {
		message.innerHTML = `<a href="/${game.title_id}/play.html?game=${game.game_id}">Review</a>`
	} else if (game.status === 3) {
		message.innerHTML = "Archived"
	}
}

function update_no_login() {
	for (let i = 0; i < roles.length; ++i) {
		let role = roles[i]
		let role_id = "role_" + role.replace(/ /g, "_")
		if (game.is_random && game.status === 0)
			role = "Random " + (i+1)
		document.getElementById(role_id + "_name").textContent = role
		let player = players.find(p => p.role === role)
		let element = document.getElementById(role_id)

		if (game.is_match) {
			if (player) {
				if (game.status === 1)
					element.classList.toggle("is_active", player.is_active)
				element.innerHTML = user_link(player)
			} else {
				element.innerHTML = `<i>Empty</i>`
			}
			continue
		}

		if (player) {
			element.classList.remove("is_invite")
			switch (game.status) {
			case 3:
				element.innerHTML = player.name
				break
			case 2:
				element.innerHTML = user_link(player)
				break
			case 1:
				if (player.is_invite) {
					element.classList.add("is_invite")
					element.innerHTML = user_link(player) + " ?"
				} else {
					element.classList.toggle("is_active", player.is_active)
					element.innerHTML = user_link(player)
				}
				break
			case 0:
				if (player.is_invite) {
					element.classList.add("is_invite")
					element.innerHTML = user_link(player) + " ?"
				} else {
					element.innerHTML = user_link(player)
				}
				break
			}
		} else {
			element.classList.remove("is_invite")
			element.innerHTML = `<i>Empty</i>`
		}
	}
}

function update_login() {
	for (let i = 0; i < roles.length; ++i) {
		let role = roles[i]
		let role_id = "role_" + role.replace(/ /g, "_")
		if (game.is_random && game.status === 0)
			role = "Random " + (i+1)
		document.getElementById(role_id + "_name").textContent = role
		let player = players.find(p => p.role === role)
		let element = document.getElementById(role_id)

		if (game.is_match) {
			if (player) {
				if (game.status === 1)
					element.classList.toggle("is_active", player.is_active)
				if (player.user_id === user_id && (game.status === 1 || game.status === 2))
					element.innerHTML = play_link(player)
				else
					element.innerHTML = user_link(player)
			} else {
				element.innerHTML = `<i>Empty</i>`
			}
			continue
		}

		if (player) {
			element.classList.remove("is_invite")
			switch (game.status) {
			case 3:
				element.innerHTML = player.name
				break
			case 2:
				if (player.user_id === user_id)
					element.innerHTML = play_link(player)
				else
					element.innerHTML = user_link(player)
				break
			case 1:
				if (player.is_invite) {
					element.classList.add("is_invite")
					if (player.user_id === user_id)
						element.innerHTML = player.name + " ?" +
							action_link(player, "part", "red", "\u274c") +
							action_link(player, "accept", "green", "\u2714")
					else if (game.owner_id === user_id)
						element.innerHTML = user_link(player) + " ?" + action_link(player, "kick", "red", "\u274c")
					else
						element.innerHTML = user_link(player) + " ?"
				} else {
					element.classList.toggle("is_active", player.is_active)
					if (player.user_id === user_id)
						element.innerHTML = play_link(player) + action_link(player, "part", "red", "\u274c")
					else if (game.owner_id === user_id)
						element.innerHTML = user_link(player) + action_link(player, "kick", "red", "\u274c")
					else
						element.innerHTML = user_link(player)
				}
				break
			case 0:
				if (player.is_invite) {
					element.classList.add("is_invite")
					if (player.user_id === user_id)
						element.innerHTML = player.name + " ?" +
							action_link(player, "part", "red", "\u274c") +
							action_link(player, "accept", "green", "\u2714")
					else if (game.owner_id === user_id)
						element.innerHTML = user_link(player) + " ?" + action_link(player, "kick", "red", "\u274c")
					else
						element.innerHTML = user_link(player) + " ?"
				} else {
					if (player.user_id === user_id)
						element.innerHTML = player.name + action_link(player, "part", "red", "\u274c")
					else if (game.owner_id === user_id)
						element.innerHTML = user_link(player) + action_link(player, "kick", "red", "\u274c")
					else
						element.innerHTML = user_link(player)
				}
				break
			}
			element.classList.toggle("friend", is_friend(player))
			element.classList.toggle("enemy", is_enemy(player))
			if (is_enemy(player))
				element.title = "You have blacklisted this user!"
			else
				element.title = ""
		} else {
			element.classList.remove("is_invite")
			switch (game.status) {
			case 2:
				element.innerHTML = `<i>Empty</i>`
				break
			case 1:
			case 0:
				if (limit)
					element.innerHTML = `<i>Empty</i>`
				else if (game.owner_id === user_id)
					element.innerHTML = `\xbb <a class="join" href="javascript:join('${role}')">Join</a><a class="green" href="javascript:show_invite('${role}')">\u{2795}</a>`
				else
					element.innerHTML = `\xbb <a class="join" href="javascript:join('${role}')">Join</a>`
				break
			}
			element.classList.remove("friend")
			element.classList.remove("enemy")
			element.title = ""
		}
	}

	if (game.owner_id === user_id) {
		window.start_button.disabled = !ready
		window.start_button.classList = (game.status === 0) ? "" : "hide"
		window.delete_button.classList = (game.status === 0 || game.user_count <= 1) ? "" : "hide"
		if (game.status === 0 && ready)
			start_blinker("READY TO START")
		else
			stop_blinker()
	} else {
		if (start_status === 0 && game.status === 1)
			start_blinker("STARTED")
		else
			stop_blinker()
	}
}

window.onload = function () {
	update()
	if (user_id && game.status <= 1 && !game.is_match) {
		start_event_source()
		timer = setInterval(start_event_source, 15000)
	}
}
