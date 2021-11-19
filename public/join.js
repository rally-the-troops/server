"use strict";

let start_status = game.status;
let evtsrc = null;
let timer = 0;

function confirm_delete(status) {
	let warning = "Are you sure you want to DELETE this game?";
	if (window.confirm(warning))
		window.location.href = "/delete/" + game.game_id;
}

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

function send(url) {
	fetch(url)
		.then(r => r.text())
		.then(t => window.error.textContent = (t === "SUCCESS") ? "" : t)
		.catch(e => window.error.textContent = e );
	start_event_source();
	return void 0;
}

function start_event_source() {
	if (!evtsrc || evtsrc.readyState === 2) {
		console.log("STARTING EVENT SOURCE");
		evtsrc = new EventSource("/join-events/" + game.game_id);
		evtsrc.addEventListener("players", function (evt) {
			console.log("PLAYERS:", evt.data);
			players = JSON.parse(evt.data);
			update();
		});
		evtsrc.addEventListener("ready", function (evt) {
			console.log("READY:", evt.data);
			ready = JSON.parse(evt.data);
			update();
		});
		evtsrc.addEventListener("game", function (evt) {
			console.log("GAME:", evt.data);
			game = JSON.parse(evt.data);
			if (game.status > 1) {
				clearInterval(timer);
				evtsrc.close();
			}
			update();
		});
		evtsrc.addEventListener("deleted", function (evt) {
			console.log("DELETED");
			window.location.href = '/info/' + game.title_id;
		});
		evtsrc.onerror = function (err) {
			window.message.innerHTML = "Disconnected from server...";
		};
	}
}

function is_active(player, role) {
	return (game.active === role || game.active === "Both" || game.active === "All");
}

function is_solo() {
	return players.every(p => p.user_id === players[0].user_id);
}

function update() {
	for (let i = 0; i < roles.length; ++i) {
		let role = roles[i];
		let role_id = "role_" + role.replace(/ /g, "_");
		if (game.random && game.status === 0)
			role = "Random " + (i+1);
		document.getElementById(role_id + "_name").textContent = role;
		let player = players.find(p => p.role === role);
		let element = document.getElementById(role_id);
		if (player) {
			if (game.status > 0) {
				if (is_active(player, role))
					element.classList.add("is_active");
				else
					element.classList.remove("is_active");
				if (player.user_id === user_id)
					element.innerHTML = `<a href="/${game.title_id}/play:${game.game_id}:${role}">Play</a>`;
				else
					element.innerHTML = player.name;
			} else {
				if ((player.user_id === user_id) || (game.owner_id === user_id))
					element.innerHTML = `<a class="red" href="javascript:send('/part/${game.game_id}/${role}')">\u274c</a> ${player.name}`;
				else
					element.innerHTML = player.name;
			}
		} else {
			if (game.status === 0)
				element.innerHTML = `<a class="join" href="javascript:send('/join/${game.game_id}/${role}')">Join</a>`;
			else
				element.innerHTML = "<i>Empty</i>";
		}
	}

	let message = window.message;
	if (game.status === 0) {
		if (ready && (game.owner_id === user_id))
			message.innerHTML = "Ready to start...";
		else if (ready)
			message.innerHTML = `Waiting for ${game.owner_name} to start the game...`;
		else
			message.innerHTML = "Waiting for players to join...";
	} else {
		message.innerHTML = `<a href="/${game.title_id}/play:${game.game_id}">Observe</a>`;
	}

	if (game.owner_id === user_id) {
		window.start_button.disabled = !ready;
		window.start_button.classList = (game.status === 0) ? "" : "hide";
		window.delete_button.classList = (game.status === 0 || is_solo()) ? "" : "hide";
		if (game.status === 0 && ready)
			start_blinker("READY TO START");
		else
			stop_blinker();
	} else {
		if (start_status === 0 && game.status === 1)
			start_blinker("STARTED");
		else
			stop_blinker();
	}
}

window.onload = function () {
	update();
	if (game.status < 2) {
		start_event_source();
		timer = setInterval(start_event_source, 15000);
	}
}
