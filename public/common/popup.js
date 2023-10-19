/*
	<menu id="popup">
		<li class="title">TITLE
		<li class="separator">
		<li data-action="foo"> Foo!
		<li data-action="bar"> Bar?
	</menu>

	<main onclick="hide_popup_menu()">
/*

function is_action(action, card) {
	return view.actions && view.actions[action] && view.actions[action].includes(card)
}

function show_popup_menu(evt, menu_id, card, title) {
	let menu = document.getElementById(menu_id)

	let show = false
	for (let item of menu.querySelectorAll("li")) {
		let action = item.dataset.action
		if (action) {
			if (is_action(action, card)) {
				show = true
				item.classList.add("action")
				item.classList.remove("disabled")
				item.onclick = function () {
					send_action(action, card)
					hide_popup_menu()
					evt.stopPropagation()
				}
			} else {
				item.classList.remove("action")
				item.classList.add("disabled")
				item.onclick = null
			}
		}
	}

	if (show) {
		menu.onmouseleave = hide_popup_menu
		menu.style.display = "block"
		if (title) {
			let item = menu.querySelector("li.title")
			if (item) {
				item.onclick = hide_popup_menu
				item.textContent = title
			}
		}

		let w = menu.clientWidth
		let h = menu.clientHeight
		let x = Math.max(5, Math.min(evt.clientX - w / 2, window.innerWidth - w - 5))
		let y = Math.max(5, Math.min(evt.clientY - 12, window.innerHeight - h - 40))
		menu.style.left = x + "px"
		menu.style.top = y + "px"

		evt.stopPropagation()
	} else {
		menu.style.display = "none"
	}
}

function hide_popup_menu() {
	document.getElementById("popup").style.display = "none"
}

function on_click_card(evt) {
	if (view.actions) {
		let card = evt.target.my_id
		if (is_action("card", card))
			send_action("card", card)
		else
			show_popup_menu(evt, "popup", card, data.cards[card].title)
	}
}
