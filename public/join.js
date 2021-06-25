"use strict";

let evtsrc = null;
let timer = 0;

function confirm_delete(status) {
	let warning = "Are you sure you want to DELETE this game?";
	if (window.confirm(warning))
		window.location.href = "/delete/" + game.game_id;
}

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

function update() {
	window.game_status.textContent = ["Open","Active","Finished","Abandoned"][game.status];
	window.game_result.textContent = game.result || "\u2014";

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
				if (game.active === role || game.active === "Both" || game.active === "All")
					element.className = "your_turn";
				else
					element.className = "";
				if (player.user_id === user_id)
					element.innerHTML = `<a href="/play/${game.game_id}/${role}">Play</a>`;
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
				//element.innerHTML = `<a class="join" href="javascript:send('/join/${game.game_id}/${role}')">Join</a>`;
				element.innerHTML = `<a class="join" onclick="send('/join/${game.game_id}/${role}')" href="javascript:void 0">Join</a>`;
			else
				element.innerHTML = "<i>Empty</i>";
		}
	}

	let message = window.message;
	if (game.status === 0) {
		if (ready && (game.owner_id === user_id))
			message.innerHTML = "Ready to start...";
		else if (ready)
			message.innerHTML = "Waiting for game to start...";
		else
			message.innerHTML = "Waiting for players to join...";
	} else {
		message.innerHTML = `<a class="play" href="/play/${game.game_id}/Observer">Observe</a>`;
	}

	if (game.owner_id === user_id) {
		window.start_button.disabled = !ready;
		window.start_button.classList = (game.status === 0) ? "" : "hide";
		window.delete_button.classList = (game.status === 0 || solo) ? "" : "hide";
	}
}

window.onload = function () {
	update();
	if (game.status < 2) {
		start_event_source();
		timer = setInterval(start_event_source, 15000);
	}
}
