"use strict";

function sort_table_column(table, column) {
	const minute = 60000;
	const hour = 60 * minute;
	const day = 24 * hour;
	const week = 7 * day;

	function is_date(s) {
		if (s.match(/^\d{4}-\d{2}-\d{2}$/))
			return true;
		if (s.match(/^\d+ (minutes?|hours?|days|weeks) ago$/))
			return true;
		if (s.match(/^(Yesterday|now)$/))
			return true;
		return false;
	}

	function parse_date(s) {
		if (s.match(/^\d{4}-\d{2}-\d{2}$/)) return new Date(s).valueOf();
		if (s === 'now') return Date.now();
		if (s === 'Yesterday') return Date.now() - day;
		let [ _, value, unit ] = s.match(/^(\d+) (minutes?|hours?|days|weeks) ago$/);
		switch (unit) {
		default: unit = 0; break;
		case 'minute': case 'minutes': unit = minute; break;
		case 'hours': case 'hours': unit = hour; break;
		case 'days': unit = day; break;
		case 'weeks': unit = week; break;
		}
		return Date.now() - Number(value) * unit;
	}

	let tbody = table.querySelector("tbody");
	let rows = Array.from(tbody.querySelectorAll("tr"));
	rows.sort((row_a, row_b) => {
		let cell_a = row_a.querySelectorAll("td")[column].textContent;
		let cell_b = row_b.querySelectorAll("td")[column].textContent;
		if (is_date(cell_a) && is_date(cell_b)) {
			let age_a = parse_date(cell_a);
			let age_b = parse_date(cell_b);
			if (age_a > age_b) return -1;
			if (age_a < age_b) return 1;
			return 0;
		} else if (cell_a.match(/^\d+$/) && cell_b.match(/^\d+$/)) {
			cell_a = Number(cell_a);
			cell_b = Number(cell_b);
			if (cell_a > cell_b) return -1;
			if (cell_a < cell_b) return 1;
			return 0;
		} else {
			if (cell_a > cell_b) return 1;
			if (cell_a < cell_b) return -1;
			return 0;
		}
	});
	rows.forEach(row => tbody.appendChild(row));
}

document.querySelectorAll("table.sort").forEach(table => {
	table.querySelectorAll("th").forEach((th, column) => {
		if (th.textContent !== "") {
			th.addEventListener("click", evt => sort_table_column(table, column));
			th.style.cursor = "pointer";
		}
	});
});
