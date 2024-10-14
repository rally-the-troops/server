"use strict"

const designs = module.exports = {}

// Coin-change knapsack problem: sort players into pools.

const knapsacks = {}

function make_coin_change_table(frobenius_number, min, max) {
	let start = frobenius_number + 1
	let min_sack = knapsacks[min + "/" + max] = { start, add: min, min, max }
	let max_sack = knapsacks[max + "/" + min] = { start, add: max, min, max }
	for (let target = start; target < start + max; ++target) {
		found_target:
		for (let a = 0; a <= target/min; ++a) {
			for (let b = 0; b <= target/max; ++b) {
				if (a * min + b * max === target) {
					let min_p = min_sack[target] = []
					let max_p = max_sack[target] = []
					for (let i = 0; i < b; ++i)
						max_p.push(max)
					for (let i = 0; i < a; ++i) {
						min_p.push(min)
						max_p.push(min)
					}
					for (let i = 0; i < b; ++i)
						min_p.push(max)
					break found_target
				}
			}
		}
	}
}

make_coin_change_table(5, 3, 4)
make_coin_change_table(7, 3, 5)
make_coin_change_table(11, 4, 5)
make_coin_change_table(17, 4, 7)
make_coin_change_table(31, 5, 9)

knapsacks["3/4/5"] = {
	start: 3,
	add: 4,
	min: 3,
	max: 5,
	3: [ 3 ],
	4: [ 4 ],
	5: [ 5 ],
	6: [ 3, 3 ],
	7: [ 4, 3 ],
}

designs.pool_players_using_knapsack = function (players, sack_name, zig) {
	let sack = knapsacks[sack_name]
	if (!sack)
		throw new Error("invalid knapsack configuration: " + sack_name)

	let n = players.length
	if (n < sack.start)
		throw Error("not enough players!")

	// allocate pools
	let pools = []
	while (n >= sack.start + sack.max) {
		pools.push(new Array(sack.add))
		n -= sack.add
	}
	for (let size of sack[n])
		pools.push(new Array(size))

	// seed pools with players
	if (zig) {
		for (let i = 0; players.length > 0; ++i)
			for (let pool of pools)
				if (i < pool.length)
					pool[i] = players.shift()
	} else {
		for (let pool of pools)
			for (let i = 0; i < pool.length; ++i)
				pool[i] = players.shift()
	}

	return pools
}

designs.pool_players = function (players, max_size, zig) {
	let n = players.length
	if (n < 2)
		throw Error("not enough players!")

	let pool_count = Math.ceil(n / max_size)
	let pool_size = Math.floor(n / pool_count)
	let odd_count = n - pool_size * pool_count;

	// allocate pools
	let pools = []
	for (let i = 0; i < odd_count; ++i)
		pools.push(new Array(pool_size + 1))
	for (let i = odd_count; i < pool_count; ++i)
		pools.push(new Array(pool_size))

	// seed pools with players
	if (zig) {
		for (let i = 0; players.length > 0; ++i)
			for (let pool of pools)
				if (i < pool.length)
					pool[i] = players.shift()
	} else {
		for (let pool of pools)
			for (let i = 0; i < pool.length; ++i)
				pool[i] = players.shift()
	}

	return pools
}

// Various block designs suitable for tournament scheduling.

designs.concurrent_round_robin = function (v) {
	// Compute simple pairings for an odd number of players.
	// Each player meets every other player.
	// Each player plays both sides every round.
	if ((v & 1) === 0)
		throw new Error("invalid number of players for concurrent round robin (must be odd)")
	let n = (v - 1) / 2
	let table = []
	for (let r = 1; r <= n; ++r) {
		let round = []
		for (let x = 0; x < v; ++x) {
			let y = (x + r) % v
			round.push( [ x, y ] )
		}
		table.push(round)
	}
	return table
}

designs.berger_table = function (v) {
	// Compute Berger tables using Richard Schurig's algorithm.
	// Note: We skip the byes for odd player counts.
	const odd = v & 1,
		n = odd ? v + 1 : v,
		n1 = n - 1,
		n2 = n / 2
	let table = []
	let x = 0
	for (let round = 0; round < n1; ++round) {
		let pairs = []
		for (let i = odd; i < n2; ++i) {
			let a = (x + i) % n1
			let b = (x + n1 - i) % n1
			if (i === 0) {
				if (round & 1)
					a = n1
				else
					b = n1
			}
			pairs.push([ a, b ])
		}
		x += n2
		table.push(pairs)
	}
	return table
}

designs.double_berger_table = function (v) {
	let table = designs.berger_table(v)

	let n = table.length
	for (let i = 0; i < n; ++i)
		table.push(table[i].map(([a,b])=>[b,a]))

	// Reverse the order of the last two rounds in the first cycle to avoid
	// three consecutive games with the same color.
	let swap = table[n-2]
	table[n-2] = table[n-1]
	table[n-1] = swap

	return table
}

designs.double_berger_table_flat = function (v) {
	let one = designs.berger_table(v)
	let two = one.map(row => row.map(([a,b])=>[b,a]))

	// Reverse the order of the last two rounds in the first cycle to avoid
	// three consecutive games with the same color.
	let n = one.length
	let swap = one[n-2]
	one[n-2] = one[n-1]
	one[n-1] = swap

	return [ one.flat(), two.flat() ]
}

designs.resolvable_bibd = function (v, k) {
	switch (k) {
		case 3:
			switch (v) {
				case 9: return designs.resolvable_bibd_9_3_1
				case 12: return designs.social_golfer_12_3_1
				case 15: return designs.resolvable_bibd_15_3_1
				case 21: return designs.resolvable_bibd_21_3_1
				case 27: return designs.resolvable_bibd_27_3_1
				case 33: return designs.resolvable_bibd_33_3_1
				case 39: return designs.resolvable_bibd_39_3_1
				case 45: return designs.resolvable_bibd_45_3_1
				case 51: return designs.resolvable_bibd_51_3_1
			}
			break
		case 4:
			switch (v) {
				case 8: return designs.social_golfer_8_4_2
				case 16: return designs.resolvable_bibd_16_4_1
				case 28: return designs.resolvable_bibd_28_4_1
				case 40: return designs.resolvable_bibd_40_4_1
				case 52: return designs.resolvable_bibd_52_4_1
			}
			break
		case 5:
			switch (v) {
				case 25: return designs.resolvable_bibd_25_5_1
			}
			break
	}
	return null
}

designs.youden_square = function (v, k) {
	switch (k) {
		case 3:
			switch (v) {
			case 3: return designs.youden_square_3_3_3
			case 4: return designs.youden_square_4_3_2
			case 7: return designs.youden_square_7_3_1
			}
			break
		case 4:
			switch (v) {
			case 4: return designs.youden_square_4_4_4
			case 5: return designs.youden_square_5_4_3
			case 7: return designs.youden_square_7_4_2
			case 13: return designs.youden_square_13_4_1
			}
			break
		case 5:
			switch (v) {
			case 5: return designs.youden_square_5_5_5
			case 6: return designs.youden_square_6_5_4
			case 11: return designs.youden_square_11_5_2
			case 21: return designs.youden_square_21_5_1
			}
			break
		case 6:
			switch (v) {
			case 6: return designs.youden_square_6_6_6
			case 7: return designs.youden_square_7_6_5
			case 11: return designs.youden_square_11_6_3
			case 16: return designs.bibd_16_6_2
			case 31: return designs.youden_square_31_6_1
			}
			break
	}
	return null
}

// Resolvabled balanced incomplete block designs RBIBD(V,K,lambda).
//
// The 3-player designs are Kirkman Triple Systems where v = 3 (mod 6)).
// The 4-player designs are resolvable Steiner Quadruple Systems where v = 4 (mod 12).
//
// These have been arranged so that within each set of K rows, each player sits
// in each position once. Play K rounds to sit in each position once, 2K rounds to
// sit twice in each position, etc.
//
// The final row is needed to meet every player, but then everyone will sit in
// one position an extra time.

designs.resolvable_bibd_9_3_1 = [
	[[0,1,5],[2,7,6],[3,8,4]],
	[[8,6,1],[7,5,3],[4,0,2]],
	[[1,4,7],[6,3,0],[5,2,8]],
	[[4,5,6],[0,7,8],[1,2,3]]
]

designs.resolvable_bibd_15_3_1 = [
	[[0,14,7],[9,3,1],[11,6,2],[4,5,8],[10,12,13]],
	[[8,1,14],[2,4,10],[12,0,3],[5,9,6],[13,7,11]],
	[[14,2,9],[3,11,5],[1,13,4],[6,10,0],[7,8,12]],
	[[14,10,3],[12,4,6],[7,2,5],[0,1,11],[8,9,13]],
	[[4,11,14],[13,5,0],[6,3,8],[2,12,1],[10,7,9]],
	[[5,14,12],[1,6,7],[9,0,4],[3,13,2],[11,8,10]],
	[[6,13,14],[0,2,8],[1,5,10],[3,4,7],[9,11,12]]
]

designs.resolvable_bibd_21_3_1 = [
	[[14,7,0],[1,4,2],[9,8,11],[15,18,16],[3,13,19],[17,12,6],[20,10,5]],
	[[8,1,15],[2,5,3],[12,9,10],[19,16,17],[4,20,7],[13,0,18],[11,6,14]],
	[[16,2,9],[6,3,4],[10,11,13],[18,17,20],[5,14,8],[7,19,1],[0,15,12]],
	[[10,17,3],[0,4,5],[12,11,7],[18,14,19],[15,9,6],[2,20,8],[1,13,16]],
	[[11,18,4],[5,6,1],[8,12,13],[20,19,15],[16,10,0],[9,3,14],[7,2,17]],
	[[19,5,12],[6,0,2],[13,7,9],[14,16,20],[17,1,11],[4,15,10],[3,8,18]],
	[[20,13,6],[0,3,1],[7,8,10],[15,14,17],[12,2,18],[11,16,5],[19,9,4]],
	[[18,1,9],[10,19,2],[3,11,20],[14,4,12],[13,5,15],[6,7,16],[17,0,8]],
	[[2,15,11],[16,12,3],[4,17,13],[5,18,7],[8,6,19],[9,20,0],[1,10,14]],
	[[4,8,16],[5,9,17],[6,10,18],[0,11,19],[1,12,20],[2,13,14],[3,7,15]]
]

designs.resolvable_bibd_27_3_1 = [
	[[13,0,26],[4,1,22],[2,18,8],[12,14,3],[15,6,11],[9,10,16],[7,5,19],[25,23,17],[20,24,21]],
	[[14,26,1],[5,2,23],[3,19,9],[0,4,15],[16,7,12],[17,11,10],[6,8,20],[18,13,24],[22,21,25]],
	[[26,15,2],[24,3,6],[10,20,4],[1,16,5],[8,17,0],[11,12,18],[21,9,7],[19,25,14],[23,22,13]],
	[[26,3,16],[4,25,7],[11,21,5],[2,6,17],[9,18,1],[12,0,19],[8,22,10],[13,20,15],[14,24,23]],
	[[17,26,4],[5,8,13],[22,12,6],[3,7,18],[10,19,2],[0,1,20],[23,9,11],[21,16,14],[25,15,24]],
	[[18,5,26],[6,14,9],[7,23,0],[19,4,8],[20,11,3],[1,2,21],[24,10,12],[15,17,22],[16,13,25]],
	[[19,26,6],[10,15,7],[24,1,8],[5,9,20],[21,4,12],[2,3,22],[11,0,25],[16,18,23],[14,13,17]],
	[[20,7,26],[8,11,16],[9,25,2],[6,21,10],[22,5,0],[3,23,4],[1,12,13],[17,19,24],[18,14,15]],
	[[26,8,21],[12,17,9],[13,10,3],[7,22,11],[23,6,1],[4,24,5],[0,2,14],[25,20,18],[15,16,19]],
	[[26,22,9],[0,18,10],[11,14,4],[8,23,12],[2,7,24],[25,5,6],[1,15,3],[21,13,19],[20,16,17]],
	[[23,10,26],[19,11,1],[5,12,15],[9,24,0],[3,25,8],[13,6,7],[16,4,2],[14,20,22],[18,17,21]],
	[[24,26,11],[12,2,20],[6,0,16],[10,1,25],[4,9,13],[7,8,14],[17,3,5],[15,21,23],[22,19,18]],
	[[12,25,26],[0,3,21],[1,7,17],[2,11,13],[5,10,14],[8,9,15],[4,6,18],[16,22,24],[19,20,23]]
]

designs.resolvable_bibd_33_3_1 = [
	[[3,5,7],[6,2,4],[17,9,25],[8,24,16],[31,11,21],[30,10,20],[27,13,23],[26,12,22],[29,15,19],[28,18,14],[32,0,1]],
	[[1,6,5],[4,7,0],[9,23,29],[22,28,8],[11,19,27],[10,26,18],[13,17,31],[16,30,12],[25,21,15],[20,14,24],[2,32,3]],
	[[7,1,2],[0,3,6],[19,31,9],[18,8,30],[23,25,11],[24,22,10],[21,29,13],[12,20,28],[15,27,17],[14,16,26],[5,4,32]],
	[[2,5,0],[3,1,4],[9,27,21],[26,20,8],[29,17,11],[28,10,16],[25,13,19],[24,12,18],[15,31,23],[14,22,30],[6,7,32]],
	[[1,24,17],[0,16,25],[23,3,28],[22,2,29],[30,19,5],[18,4,31],[7,21,26],[20,6,27],[11,15,13],[10,14,12],[8,32,9]],
	[[21,30,1],[31,0,20],[19,26,3],[27,18,2],[5,23,24],[4,25,22],[17,28,7],[16,29,6],[13,9,14],[12,8,15],[32,11,10]],
	[[26,1,23],[0,27,22],[30,3,17],[16,2,31],[21,28,5],[20,4,29],[19,7,24],[6,25,18],[9,15,10],[14,11,8],[12,13,32]],
	[[1,19,28],[29,18,0],[3,24,21],[2,20,25],[17,5,26],[27,16,4],[7,23,30],[22,31,6],[8,10,13],[11,9,12],[15,32,14]],
	[[25,8,1],[24,0,9],[31,12,3],[13,30,2],[5,14,27],[4,26,15],[10,29,7],[28,6,11],[23,21,19],[18,22,20],[32,17,16]],
	[[14,29,1],[0,15,28],[10,3,27],[11,2,26],[8,31,5],[4,9,30],[12,25,7],[6,13,24],[17,21,22],[16,23,20],[32,18,19]],
	[[1,10,31],[30,0,11],[3,14,25],[2,24,15],[5,12,29],[28,4,13],[7,27,8],[26,6,9],[23,17,18],[19,22,16],[21,20,32]],
	[[27,1,12],[13,26,0],[29,8,3],[9,28,2],[25,5,10],[24,11,4],[31,7,14],[15,30,6],[18,16,21],[20,19,17],[22,32,23]],
	[[0,8,17],[1,16,9],[21,2,14],[15,20,3],[10,4,23],[22,5,11],[12,19,6],[7,18,13],[31,27,29],[26,28,30],[24,25,32]],
	[[23,0,12],[13,22,1],[2,10,19],[3,11,18],[14,17,4],[16,15,5],[6,21,8],[20,9,7],[29,30,25],[28,31,24],[27,32,26]],
	[[19,14,0],[18,1,15],[8,23,2],[9,3,22],[4,12,21],[5,13,20],[17,6,10],[11,7,16],[25,26,31],[30,24,27],[32,29,28]],
	[[0,10,21],[1,11,20],[2,12,17],[3,13,16],[4,8,19],[5,9,18],[6,14,23],[7,15,22],[24,26,29],[25,27,28],[30,31,32]]
]

designs.resolvable_bibd_39_3_1 = [
	[[38,0,19],[33,1,8],[28,2,16],[37,4,13],[18,22,7],[25,14,17],[15,31,9],[11,21,12],[3,5,23],[27,10,6],[35,36,24],[32,29,34],[20,26,30]],
	[[1,20,38],[34,9,2],[29,17,3],[14,19,5],[23,8,0],[26,18,15],[16,32,10],[12,13,22],[24,6,4],[7,11,28],[36,25,37],[30,35,33],[21,27,31]],
	[[2,38,21],[10,3,35],[4,30,18],[6,15,20],[9,24,1],[0,16,27],[17,33,11],[13,23,14],[5,7,25],[8,12,29],[19,37,26],[31,34,36],[22,28,32]],
	[[22,38,3],[11,36,4],[5,0,31],[16,7,21],[10,2,25],[1,28,17],[34,12,18],[15,24,14],[26,8,6],[30,13,9],[27,20,19],[35,32,37],[29,23,33]],
	[[23,4,38],[12,37,5],[6,1,32],[8,17,22],[3,26,11],[18,29,2],[13,35,0],[25,15,16],[7,9,27],[14,31,10],[20,21,28],[33,19,36],[24,30,34]],
	[[38,5,24],[19,6,13],[2,33,7],[9,18,23],[4,27,12],[0,3,30],[36,14,1],[17,16,26],[28,10,8],[32,11,15],[21,22,29],[37,34,20],[31,25,35]],
	[[6,38,25],[20,14,7],[3,8,34],[0,24,10],[5,13,28],[1,4,31],[37,2,15],[18,17,27],[9,29,11],[12,33,16],[22,30,23],[21,19,35],[32,36,26]],
	[[7,26,38],[8,15,21],[4,35,9],[25,11,1],[14,6,29],[2,32,5],[19,16,3],[28,0,18],[30,10,12],[13,34,17],[31,23,24],[36,22,20],[27,37,33]],
	[[38,27,8],[16,9,22],[10,5,36],[26,12,2],[15,7,30],[33,3,6],[17,20,4],[29,1,0],[11,31,13],[35,18,14],[24,25,32],[23,21,37],[34,28,19]],
	[[38,9,28],[10,17,23],[6,11,37],[27,13,3],[16,31,8],[4,34,7],[5,18,21],[1,2,30],[32,14,12],[0,36,15],[33,26,25],[19,22,24],[20,29,35]],
	[[29,10,38],[11,24,18],[7,12,19],[14,28,4],[9,32,17],[35,8,5],[22,0,6],[2,3,31],[13,15,33],[37,1,16],[26,27,34],[25,23,20],[21,30,36]],
	[[30,38,11],[12,25,0],[8,20,13],[15,5,29],[18,33,10],[36,6,9],[23,7,1],[3,4,32],[34,16,14],[17,19,2],[28,35,27],[24,21,26],[31,37,22]],
	[[38,12,31],[1,26,13],[21,9,14],[6,16,30],[11,34,0],[7,37,10],[8,2,24],[33,5,4],[17,15,35],[3,18,20],[28,29,36],[27,25,22],[32,19,23]],
	[[13,38,32],[2,14,27],[10,22,15],[31,17,7],[12,35,1],[19,8,11],[25,3,9],[5,6,34],[16,36,18],[0,4,21],[29,30,37],[26,23,28],[20,24,33]],
	[[14,33,38],[15,28,3],[23,11,16],[18,32,8],[36,13,2],[9,20,12],[4,10,26],[35,7,6],[37,0,17],[22,1,5],[30,31,19],[24,27,29],[34,21,25]],
	[[38,34,15],[4,16,29],[24,12,17],[0,33,9],[3,37,14],[10,21,13],[11,27,5],[36,7,8],[19,1,18],[6,23,2],[32,20,31],[30,25,28],[22,26,35]],
	[[16,35,38],[5,17,30],[13,18,25],[1,10,34],[15,4,19],[14,11,22],[28,6,12],[8,9,37],[2,0,20],[7,24,3],[33,32,21],[31,29,26],[23,36,27]],
	[[17,38,36],[18,31,6],[26,14,0],[35,2,11],[20,5,16],[12,15,23],[29,13,7],[9,19,10],[21,3,1],[25,8,4],[34,22,33],[27,30,32],[37,28,24]],
	[[18,37,38],[0,7,32],[1,15,27],[3,12,36],[6,17,21],[13,16,24],[8,14,30],[10,11,20],[2,4,22],[5,9,26],[23,34,35],[28,31,33],[19,25,29]]
]

designs.resolvable_bibd_45_3_1 = [
	[[23,37,3],[22,2,36],[17,43,5],[4,16,42],[25,7,33],[24,32,6],[9,19,41],[18,40,8],[27,39,11],[26,38,10],[21,13,35],[34,20,12],[31,29,15],[14,30,28],[0,1,44]],
	[[1,36,23],[37,22,0],[39,5,25],[38,4,24],[7,31,19],[6,18,30],[35,9,27],[8,26,34],[43,11,21],[10,42,20],[15,41,13],[12,14,40],[29,33,17],[32,28,16],[44,3,2]],
	[[42,17,1],[16,0,43],[3,25,38],[2,24,39],[41,27,7],[40,6,26],[33,21,9],[20,8,32],[11,15,37],[36,10,14],[13,23,31],[30,12,22],[19,35,29],[28,34,18],[5,44,4]],
	[[25,32,1],[24,0,33],[30,3,19],[18,31,2],[27,40,5],[4,26,41],[43,15,9],[8,14,42],[23,11,35],[22,34,10],[39,13,17],[16,38,12],[21,37,29],[20,28,36],[7,44,6]],
	[[1,19,40],[0,41,18],[3,27,34],[35,2,26],[32,5,21],[33,20,4],[15,42,7],[14,6,43],[11,17,31],[10,30,16],[13,25,37],[36,12,24],[29,23,39],[28,22,38],[9,8,44]],
	[[38,1,27],[26,39,0],[42,21,3],[2,43,20],[5,36,15],[37,4,14],[34,7,23],[6,35,22],[17,9,30],[31,16,8],[19,33,13],[12,18,32],[41,29,25],[40,24,28],[44,10,11]],
	[[21,1,34],[20,35,0],[3,40,15],[14,41,2],[30,23,5],[4,31,22],[17,38,7],[6,16,39],[25,9,36],[8,24,37],[32,19,11],[10,18,33],[27,29,43],[42,28,26],[13,12,44]],
	[[1,30,29],[28,0,31],[12,3,41],[2,13,40],[5,37,10],[36,11,4],[7,43,8],[9,42,6],[35,25,17],[16,34,24],[19,39,21],[18,20,38],[23,33,27],[22,26,32],[15,44,14]],
	[[43,4,1],[0,5,42],[29,32,3],[33,2,28],[39,7,12],[38,6,13],[31,10,9],[11,8,30],[34,15,25],[24,14,35],[37,27,19],[26,36,18],[41,21,23],[40,22,20],[44,17,16]],
	[[1,41,8],[9,0,40],[6,3,31],[7,2,30],[29,5,34],[28,4,35],[11,12,33],[32,13,10],[21,15,38],[14,20,39],[17,27,36],[26,37,16],[43,23,25],[24,42,22],[44,18,19]],
	[[12,35,1],[0,34,13],[10,43,3],[42,11,2],[8,33,5],[4,9,32],[36,7,29],[37,28,6],[15,39,18],[19,38,14],[23,40,17],[16,22,41],[31,25,27],[30,26,24],[20,21,44]],
	[[2,1,37],[3,36,0],[5,31,12],[13,30,4],[35,10,7],[34,6,11],[38,29,9],[39,8,28],[27,32,15],[33,14,26],[41,17,20],[40,16,21],[25,19,42],[18,24,43],[22,44,23]],
	[[6,1,33],[32,0,7],[3,4,39],[2,38,5],[9,37,12],[13,36,8],[29,40,11],[41,10,28],[16,35,15],[14,17,34],[22,43,19],[18,23,42],[27,21,30],[31,26,20],[25,44,24]],
	[[10,39,1],[0,11,38],[8,3,35],[34,9,2],[5,41,6],[4,7,40],[42,29,13],[28,12,43],[15,33,22],[23,32,14],[37,18,17],[36,19,16],[24,31,21],[20,30,25],[26,27,44]],
	[[1,14,31],[30,15,0],[33,16,3],[17,2,32],[35,5,18],[19,34,4],[7,20,37],[21,6,36],[39,22,9],[38,8,23],[11,24,41],[40,25,10],[43,13,26],[12,42,27],[44,28,29]],
	[[0,14,29],[1,28,15],[19,6,2],[18,3,7],[4,23,12],[13,5,22],[17,8,10],[16,11,9],[27,20,24],[26,25,21],[32,35,36],[39,42,34],[38,33,40],[41,43,37],[30,44,31]],
	[[25,0,6],[24,7,1],[2,29,16],[3,17,28],[21,4,8],[5,9,20],[10,12,19],[11,13,18],[22,27,14],[23,15,26],[34,37,38],[36,41,30],[42,40,35],[31,39,43],[44,32,33]],
	[[12,21,0],[20,1,13],[8,2,27],[9,26,3],[29,18,4],[28,19,5],[6,10,23],[7,22,11],[14,16,25],[15,24,17],[40,36,39],[43,38,32],[37,30,42],[33,31,41],[35,34,44]],
	[[0,23,2],[22,3,1],[4,10,15],[5,11,14],[6,20,29],[28,21,7],[8,12,25],[9,13,24],[18,27,16],[17,26,19],[41,38,42],[40,31,34],[30,32,39],[35,43,33],[36,37,44]],
	[[10,0,27],[26,1,11],[25,2,4],[3,24,5],[12,6,17],[16,7,13],[29,22,8],[23,28,9],[14,18,21],[15,19,20],[43,40,30],[42,33,36],[32,34,41],[37,35,31],[39,44,38]],
	[[19,8,0],[1,9,18],[2,15,12],[13,14,3],[27,4,6],[7,5,26],[24,29,10],[11,25,28],[20,16,23],[21,17,22],[31,42,32],[38,30,35],[34,36,43],[33,39,37],[44,41,40]],
	[[0,4,17],[1,5,16],[2,10,21],[3,11,20],[6,8,15],[7,9,14],[12,26,29],[13,27,28],[18,22,25],[19,23,24],[30,33,34],[32,37,40],[31,36,38],[35,39,41],[42,43,44]]
]

designs.resolvable_bibd_51_3_1 = [
	[[25,0,50],[24,42,4],[43,1,5],[6,44,2],[7,45,3],[26,8,12],[9,27,13],[28,14,10],[15,11,29],[20,34,16],[35,17,21],[22,18,36],[19,23,37],[30,38,46],[47,39,31],[32,40,48],[49,41,33]],
	[[50,26,1],[11,46,22],[27,24,7],[38,15,23],[18,35,19],[17,9,32],[5,48,0],[12,43,6],[4,36,14],[3,10,30],[37,21,20],[8,2,39],[16,13,42],[45,49,25],[33,31,40],[44,29,41],[34,47,28]],
	[[2,50,27],[29,19,17],[23,12,47],[1,28,8],[39,16,24],[48,20,15],[10,33,18],[0,6,49],[13,7,44],[14,5,35],[31,4,11],[21,22,38],[40,3,9],[36,37,43],[46,25,26],[41,32,34],[42,30,45]],
	[[50,3,28],[1,10,31],[30,18,20],[48,13,24],[2,29,9],[43,17,14],[16,49,21],[11,19,34],[26,0,7],[8,46,4],[15,6,36],[12,5,32],[39,22,23],[41,45,40],[38,37,44],[25,27,47],[33,42,35]],
	[[29,4,50],[23,34,10],[32,11,2],[21,31,19],[49,14,1],[36,8,3],[18,44,15],[22,26,17],[35,20,12],[0,24,43],[9,47,5],[37,7,16],[6,33,13],[40,30,27],[42,41,46],[45,39,38],[28,25,48]],
	[[5,50,30],[14,2,25],[24,35,11],[3,12,33],[20,32,22],[13,15,49],[4,9,37],[19,16,45],[27,23,18],[7,21,29],[44,1,0],[10,48,6],[17,38,8],[34,36,26],[31,28,41],[47,43,42],[46,40,39]],
	[[50,31,6],[18,47,21],[25,3,15],[36,1,12],[4,34,13],[24,23,40],[14,26,16],[5,10,38],[46,17,20],[9,19,41],[22,8,30],[0,2,45],[49,11,7],[39,33,28],[35,27,37],[29,32,42],[43,48,44]],
	[[32,7,50],[8,45,14],[19,22,48],[16,25,4],[13,37,2],[21,44,5],[1,41,24],[27,15,17],[6,39,11],[12,18,49],[42,20,10],[23,9,31],[3,0,46],[47,35,26],[34,40,29],[38,28,36],[30,43,33]],
	[[33,50,8],[44,4,3],[15,46,9],[20,49,23],[17,5,25],[7,14,34],[45,6,22],[2,42,1],[28,16,18],[31,12,0],[26,13,19],[11,21,43],[10,24,32],[40,38,47],[48,36,27],[41,30,35],[37,29,39]],
	[[50,34,9],[11,38,18],[45,5,4],[10,47,16],[26,21,24],[30,6,19],[15,35,8],[7,23,46],[2,3,43],[40,1,17],[0,13,32],[27,14,20],[12,22,44],[33,29,25],[48,39,41],[28,49,37],[42,36,31]],
	[[35,10,50],[22,43,13],[39,19,12],[6,46,5],[17,11,48],[3,37,1],[20,31,7],[9,16,36],[24,8,47],[32,4,23],[41,18,2],[14,33,0],[21,15,28],[44,45,27],[25,30,34],[49,40,42],[38,26,29]],
	[[36,50,11],[16,12,30],[23,44,14],[13,20,40],[47,7,6],[18,9,39],[4,2,38],[8,32,21],[37,17,10],[1,27,22],[5,24,33],[19,42,3],[34,0,15],[29,48,49],[46,28,45],[31,25,35],[43,41,26]],
	[[50,12,37],[8,0,27],[13,31,17],[45,15,24],[21,41,14],[7,18,42],[10,40,19],[39,3,5],[9,33,22],[44,16,11],[23,28,2],[34,6,1],[4,20,43],[35,48,38],[49,26,30],[29,46,47],[32,25,36]],
	[[38,50,13],[37,5,15],[28,9,0],[18,14,32],[16,1,46],[25,22,10],[19,43,8],[41,11,20],[40,4,6],[33,21,23],[17,45,12],[24,29,3],[2,7,35],[42,34,44],[36,49,39],[31,27,26],[30,47,48]],
	[[14,39,50],[3,17,49],[6,38,16],[0,10,29],[15,19,33],[5,2,31],[11,23,25],[20,44,9],[12,42,21],[48,8,7],[22,24,34],[46,13,18],[1,30,4],[47,36,41],[43,35,45],[26,37,40],[27,32,28]],
	[[50,15,40],[2,33,20],[18,4,26],[39,17,7],[11,0,30],[29,16,22],[32,6,3],[24,12,25],[45,10,21],[5,13,28],[8,49,9],[23,1,35],[19,47,14],[43,34,31],[42,48,37],[44,46,36],[38,41,27]],
	[[41,50,16],[0,20,39],[3,21,34],[27,19,5],[40,8,18],[28,11,12],[30,23,17],[4,7,33],[13,25,1],[15,22,42],[6,14,29],[9,26,10],[36,24,2],[48,31,46],[35,44,32],[49,38,43],[37,45,47]],
	[[17,42,50],[1,9,48],[21,40,0],[22,35,4],[20,28,6],[46,2,19],[12,29,13],[31,18,24],[34,5,8],[14,3,38],[16,43,23],[7,30,15],[10,27,11],[25,37,41],[47,32,49],[33,36,45],[26,39,44]],
	[[18,43,50],[7,40,12],[49,10,2],[0,22,41],[36,23,5],[21,6,27],[20,3,47],[13,14,30],[32,19,1],[11,45,9],[39,4,15],[44,17,24],[8,31,16],[28,35,29],[42,25,38],[26,33,48],[34,37,46]],
	[[19,50,44],[6,9,35],[41,13,8],[3,26,11],[23,0,42],[38,24,20],[22,7,28],[4,48,21],[14,15,31],[2,47,17],[46,12,10],[16,5,40],[45,1,18],[37,32,33],[30,29,36],[25,39,43],[27,34,49]],
	[[50,20,45],[24,28,19],[10,36,7],[9,42,14],[12,27,4],[35,16,0],[1,21,39],[29,8,23],[5,49,22],[15,2,26],[48,18,3],[47,11,13],[17,41,6],[43,46,32],[33,38,34],[31,30,37],[40,44,25]],
	[[21,50,46],[5,7,41],[29,1,20],[37,8,11],[43,15,10],[45,23,13],[17,0,36],[40,2,22],[30,24,9],[6,25,18],[16,27,3],[49,4,19],[48,12,14],[28,42,26],[47,44,33],[39,35,34],[32,31,38]],
	[[50,22,47],[15,16,32],[8,6,42],[2,21,30],[38,9,12],[11,33,1],[46,14,24],[0,18,37],[3,41,23],[10,13,39],[7,19,25],[4,28,17],[20,26,5],[31,49,44],[27,29,43],[34,45,48],[36,40,35]],
	[[23,48,50],[13,36,21],[33,17,16],[9,43,7],[22,3,31],[41,10,4],[12,34,2],[1,47,15],[19,38,0],[24,37,6],[14,11,40],[25,20,8],[18,5,29],[42,39,27],[26,32,45],[44,30,28],[35,46,49]],
	[[24,49,50],[6,23,26],[14,22,37],[17,18,34],[8,10,44],[0,4,47],[5,11,42],[3,13,35],[2,16,48],[19,20,36],[1,7,38],[12,15,41],[9,21,25],[30,32,39],[28,40,43],[27,33,46],[29,31,45]]
]

designs.resolvable_bibd_16_4_1 = [
	[[1,4,7,8],[12,13,6,9],[2,3,14,11],[0,5,10,15]],
	[[8,2,9,0],[13,7,5,14],[3,12,4,10],[6,11,15,1]],
	[[5,9,1,3],[10,14,8,6],[11,0,13,4],[7,15,12,2]],
	[[4,6,2,5],[9,10,11,7],[14,1,0,12],[15,8,3,13]],
	[[0,3,6,7],[5,8,11,12],[1,2,10,13],[4,9,14,15]]
]

designs.resolvable_bibd_28_4_1 = [
	[[15,11,8,4],[17,20,13,24],[26,2,22,6],[16,12,1,5],[21,14,25,10],[3,23,7,19],[9,0,18,27]],
	[[12,13,2,7],[22,16,11,21],[20,4,3,25],[5,17,0,15],[24,26,9,14],[8,6,23,18],[19,10,27,1]],
	[[7,1,15,9],[10,18,24,16],[25,19,6,0],[13,8,14,3],[23,22,12,17],[4,21,5,26],[11,27,20,2]],
	[[6,5,10,13],[14,15,19,22],[1,24,4,23],[2,9,16,8],[18,25,17,11],[0,7,26,20],[27,3,21,12]],
	[[0,8,12,10],[19,9,21,17],[1,3,18,26],[14,7,11,6],[15,23,20,16],[2,5,24,25],[4,27,13,22]],
	[[6,16,17,3],[25,12,26,15],[8,24,7,21],[11,13,0,1],[10,22,9,20],[18,4,19,2],[27,14,5,23]],
	[[5,11,3,9],[12,20,14,18],[23,21,2,0],[7,17,10,4],[13,26,16,19],[22,1,25,8],[24,15,6,27]],
	[[17,2,1,14],[26,10,23,11],[20,19,8,5],[9,6,4,12],[21,18,15,13],[3,0,22,24],[16,25,27,7]],
	[[0,4,14,16],[9,13,23,25],[5,7,18,22],[2,3,10,15],[11,12,19,24],[1,6,20,21],[8,17,26,27]]
]

designs.resolvable_bibd_40_4_1 = [
	[[1,12,21,18],[14,25,34,31],[8,5,27,38],[2,16,23,11],[15,24,29,36],[3,10,28,37],[4,19,20,9],[22,17,32,33],[35,7,30,6],[26,0,39,13]],
	[[0,2,22,19],[32,13,35,15],[9,6,26,28],[24,3,17,12],[30,37,25,16],[38,11,4,29],[5,21,10,20],[34,33,18,23],[36,31,8,7],[27,14,1,39]],
	[[23,20,3,1],[16,36,33,14],[10,29,7,27],[25,18,0,4],[31,38,13,17],[12,26,5,30],[11,22,6,21],[19,34,24,35],[37,8,9,32],[39,28,15,2]],
	[[21,4,2,24],[17,15,37,34],[28,30,11,8],[13,1,19,5],[18,32,14,26],[6,27,31,0],[7,23,12,22],[20,35,36,25],[33,9,38,10],[29,39,16,3]],
	[[3,5,25,22],[18,38,35,16],[29,12,9,31],[2,20,6,14],[15,27,33,19],[7,1,32,28],[8,0,23,24],[13,21,37,36],[10,26,11,34],[4,17,39,30]],
	[[23,6,13,4],[19,36,26,17],[30,10,0,32],[21,3,15,7],[34,16,28,20],[33,8,29,2],[1,9,24,25],[38,14,22,37],[12,35,27,11],[5,31,18,39]],
	[[24,7,14,5],[37,18,20,27],[11,33,31,1],[16,22,4,8],[35,29,17,21],[9,34,30,3],[25,13,2,10],[26,15,38,23],[36,28,12,0],[39,32,19,6]],
	[[6,25,8,15],[28,19,21,38],[32,2,34,12],[17,23,5,9],[22,30,36,18],[31,4,10,35],[14,11,3,13],[27,24,16,26],[0,37,1,29],[20,39,7,33]],
	[[16,13,7,9],[22,20,26,29],[33,3,35,0],[24,6,18,10],[19,37,31,23],[11,32,36,5],[14,15,4,12],[28,17,25,27],[2,1,30,38],[34,39,21,8]],
	[[10,8,14,17],[27,21,23,30],[1,4,34,36],[7,19,11,25],[32,24,38,20],[37,33,12,6],[15,0,5,16],[18,29,13,28],[26,2,3,31],[35,9,39,22]],
	[[9,18,15,11],[31,28,22,24],[5,35,37,2],[20,12,8,13],[21,25,33,26],[38,34,0,7],[6,16,17,1],[29,30,19,14],[3,27,32,4],[23,36,10,39]],
	[[12,10,16,19],[25,23,29,32],[36,38,6,3],[0,14,9,21],[13,22,27,34],[8,26,1,35],[17,7,2,18],[30,31,20,15],[4,5,28,33],[39,11,24,37]],
	[[0,11,17,20],[13,24,30,33],[4,7,26,37],[1,10,15,22],[14,23,28,35],[2,9,27,36],[3,8,18,19],[16,21,31,32],[5,6,29,34],[12,25,38,39]]
]

designs.resolvable_bibd_52_4_1 = [
	[[30,16,1,21],[47,38,33,18],[50,4,35,13],[22,3,14,29],[20,39,31,46],[12,48,5,37],[19,32,9,8],[36,26,25,49],[43,15,42,2],[28,23,7,10],[27,24,40,45],[6,41,11,44],[0,34,17,51]],
	[[2,0,22,31],[17,19,39,48],[14,5,36,34],[4,30,15,23],[40,21,32,47],[13,49,6,38],[33,10,20,9],[26,37,27,50],[16,43,44,3],[11,29,8,24],[25,46,28,41],[42,7,45,12],[35,18,51,1]],
	[[3,1,23,32],[49,20,18,40],[15,6,37,35],[5,31,24,16],[41,22,48,33],[7,14,50,39],[10,17,21,11],[34,28,38,27],[45,44,4,0],[9,12,30,25],[29,47,26,42],[46,8,13,43],[51,2,19,36]],
	[[24,33,2,4],[21,50,41,19],[38,36,16,7],[32,25,0,6],[23,42,49,17],[8,40,34,15],[18,11,12,22],[39,35,29,28],[1,45,46,5],[31,13,10,26],[48,27,43,30],[44,9,47,14],[37,51,3,20]],
	[[5,25,17,3],[20,22,34,42],[39,8,37,0],[1,7,33,26],[18,24,50,43],[16,41,35,9],[13,12,19,23],[36,40,30,29],[2,47,6,46],[11,27,32,14],[28,44,49,31],[45,15,10,48],[21,4,51,38]],
	[[6,26,18,4],[23,35,43,21],[38,9,40,1],[27,17,8,2],[19,34,25,44],[10,42,0,36],[14,13,24,20],[30,37,31,41],[48,3,7,47],[12,33,15,28],[50,32,29,45],[49,46,16,11],[51,5,22,39]],
	[[7,19,27,5],[22,36,44,24],[41,39,2,10],[3,28,9,18],[26,45,20,35],[43,1,11,37],[25,14,21,15],[31,38,42,32],[4,49,48,8],[17,29,13,16],[33,30,46,34],[47,0,12,50],[40,6,23,51]],
	[[8,20,28,6],[37,23,45,25],[42,11,3,40],[29,10,4,19],[46,21,36,27],[44,2,38,12],[15,16,26,22],[32,43,39,33],[9,50,5,49],[0,18,14,30],[35,31,47,17],[34,48,1,13],[24,51,41,7]],
	[[21,7,9,29],[26,46,24,38],[12,4,43,41],[11,20,5,30],[37,47,28,22],[45,13,3,39],[23,16,27,0],[44,17,33,40],[50,34,6,10],[19,31,1,15],[32,48,18,36],[35,2,49,14],[25,51,8,42]],
	[[10,30,22,8],[39,27,25,47],[13,5,42,44],[6,21,12,31],[38,29,23,48],[14,40,46,4],[1,24,0,28],[41,18,17,45],[34,11,35,7],[16,32,20,2],[49,33,37,19],[3,36,15,50],[9,43,26,51]],
	[[31,23,11,9],[48,28,40,26],[43,14,45,6],[7,22,32,13],[30,49,39,24],[47,15,41,5],[29,25,2,1],[46,42,19,18],[8,35,36,12],[0,3,21,33],[17,38,50,20],[4,37,16,34],[51,10,44,27]],
	[[24,12,10,32],[27,41,29,49],[15,44,7,46],[33,8,14,23],[40,50,31,25],[42,6,48,16],[2,26,30,3],[20,19,47,43],[36,9,13,37],[22,1,4,17],[18,39,34,21],[5,0,38,35],[28,45,51,11]],
	[[11,13,25,33],[30,50,28,42],[16,47,8,45],[24,15,9,17],[32,26,41,34],[0,49,7,43],[4,27,31,3],[44,21,20,48],[10,14,37,38],[5,23,2,18],[22,19,35,40],[36,6,1,39],[51,12,46,29]],
	[[12,17,14,26],[34,43,29,31],[48,46,0,9],[25,16,18,10],[42,35,33,27],[1,44,50,8],[28,4,5,32],[49,45,21,22],[38,39,11,15],[19,24,3,6],[41,20,36,23],[37,2,40,7],[13,30,47,51]],
	[[27,18,15,13],[35,32,30,44],[47,10,49,1],[26,0,19,11],[17,36,43,28],[45,9,34,2],[29,33,6,5],[50,22,23,46],[39,40,12,16],[7,25,4,20],[21,37,42,24],[3,8,38,41],[31,48,51,14]],
	[[14,28,16,19],[33,31,45,36],[2,11,48,50],[20,1,27,12],[18,29,44,37],[46,3,10,35],[6,7,17,30],[23,34,24,47],[40,41,13,0],[8,5,26,21],[43,38,22,25],[9,42,39,4],[15,51,32,49]],
	[[0,15,20,29],[17,32,37,46],[3,12,34,49],[2,13,21,28],[19,30,38,45],[4,11,36,47],[7,8,18,31],[24,25,35,48],[1,14,41,42],[6,9,22,27],[23,26,39,44],[5,10,40,43],[16,33,50,51]]
]

// TODO: balance the order of sitting (players 17 and 22 sit wrong in positions 0 and 1)
designs.resolvable_bibd_25_5_1 =
[[[15,0,20,10,5],[21,16,11,1,6],[12,22,17,2,7],[8,23,13,3,18],[4,9,14,19,24]],[[16,24,0,17,3],[10,2,1,13,9],[5,21,4,8,22],[6,14,7,18,15],[23,20,12,11,19]],[[9,6,23,22,0],[17,1,18,20,4],[11,3,2,5,14],[7,19,10,16,8],[24,15,21,12,13]],[[0,18,19,21,2],[1,5,24,7,23],[3,10,6,4,12],[17,8,9,15,11],[13,22,16,14,20]],[[14,12,8,0,1],[2,4,15,23,16],[20,7,3,9,21],[19,13,5,6,17],[18,11,22,24,10]],
[[0, 4, 7, 11, 13], [22, 3, 15, 19, 1], [2, 6, 8, 20, 24], [5, 9, 12, 16, 18], [10, 17, 14, 21, 23]]
]


// Youden square designs.
//
// Each player will sit in each position once and meet every other player lambda times.
//

designs.youden_square_3_3_3 = [
	[0,1,2],
	[1,2,0],
	[2,0,1],
]

designs.youden_square_4_3_2 = [
	[0,1,2],
	[1,2,3],
	[2,3,0],
	[3,0,1],
]

designs.youden_square_7_3_1 = [
	[0,1,3],
	[1,2,4],
	[2,3,5],
	[3,4,6],
	[4,5,0],
	[5,6,1],
	[6,0,2],
]

designs.youden_square_4_4_4 = [
	[0,1,2,3],
	[1,2,3,0],
	[2,3,0,1],
	[3,0,1,2],
]

designs.youden_square_5_4_3 = [
	[0,1,2,3],
	[1,2,3,4],
	[2,3,4,0],
	[3,4,0,1],
	[4,0,1,2],
]

designs.youden_square_7_4_2 = [
	[0,1,3,6],
	[1,2,4,0],
	[2,3,5,1],
	[3,4,6,2],
	[4,5,0,3],
	[5,6,1,4],
	[6,0,2,5],
]

designs.youden_square_13_4_1 = [
	[0,1,3,9],
	[1,2,4,10],
	[2,3,5,11],
	[3,4,6,12],
	[4,5,7,0],
	[5,6,8,1],
	[6,7,9,2],
	[7,8,10,3],
	[8,9,11,4],
	[9,10,12,5],
	[10,11,0,6],
	[11,12,1,7],
	[12,0,2,8],
]

designs.youden_square_5_5_5 = [
	[0,1,2,3,4],
	[1,2,3,4,0],
	[2,3,4,0,1],
	[3,4,0,1,2],
	[4,0,1,2,3],
]

designs.youden_square_6_5_4 = [
	[0,1,2,3,4],
	[1,2,3,4,5],
	[2,3,4,5,0],
	[3,4,5,0,1],
	[4,5,0,1,2],
	[5,0,1,2,3],
]

designs.youden_square_11_5_2 = [
	[0,1,2,4,7],
	[1,2,3,5,8],
	[2,3,4,6,9],
	[3,4,5,7,10],
	[4,5,6,8,0],
	[5,6,7,9,1],
	[6,7,8,10,2],
	[7,8,9,0,3],
	[8,9,10,1,4],
	[9,10,0,2,5],
	[10,0,1,3,6],
]

designs.youden_square_21_5_1 = [
	[0,1,4,14,16],
	[1,2,5,15,17],
	[2,3,6,16,18],
	[3,4,7,17,19],
	[4,5,8,18,20],
	[5,6,9,19,0],
	[6,7,10,20,1],
	[7,8,11,0,2],
	[8,9,12,1,3],
	[9,10,13,2,4],
	[10,11,14,3,5],
	[11,12,15,4,6],
	[12,13,16,5,7],
	[13,14,17,6,8],
	[14,15,18,7,9],
	[15,16,19,8,10],
	[16,17,20,9,11],
	[17,18,0,10,12],
	[18,19,1,11,13],
	[19,20,2,12,14],
	[20,0,3,13,15],
]

designs.youden_square_6_6_6 = [
	[0,1,2,3,4,5],
	[1,2,3,4,5,0],
	[2,3,4,5,0,1],
	[3,4,5,0,1,2],
	[4,5,0,1,2,3],
	[5,0,1,2,3,4],
]

designs.youden_square_7_6_5 = [
	[0,1,2,3,4,5],
	[1,2,3,4,5,6],
	[2,3,4,5,6,0],
	[3,4,5,6,0,1],
	[4,5,6,0,1,2],
	[5,6,0,1,2,3],
	[6,0,1,2,3,4],
]

designs.youden_square_11_6_3 = [
	[0,1,2,4,5,7],
	[1,2,3,5,6,8],
	[2,3,4,6,7,9],
	[3,4,5,7,8,10],
	[4,5,6,8,9,0],
	[5,6,7,9,10,1],
	[6,7,8,10,0,2],
	[7,8,9,0,1,3],
	[8,9,10,1,2,4],
	[9,10,0,2,3,5],
	[10,0,1,3,4,6],
]

designs.youden_square_31_6_1 = [
	[0,1,3,8,12,18],
	[1,2,4,9,13,19],
	[2,3,5,10,14,20],
	[3,4,6,11,15,21],
	[4,5,7,12,16,22],
	[5,6,8,13,17,23],
	[6,7,9,14,18,24],
	[7,8,10,15,19,25],
	[8,9,11,16,20,26],
	[9,10,12,17,21,27],
	[10,11,13,18,22,28],
	[11,12,14,19,23,29],
	[12,13,15,20,24,30],
	[13,14,16,21,25,0],
	[14,15,17,22,26,1],
	[15,16,18,23,27,2],
	[16,17,19,24,28,3],
	[17,18,20,25,29,4],
	[18,19,21,26,30,5],
	[19,20,22,27,0,6],
	[20,21,23,28,1,7],
	[21,22,24,29,2,8],
	[22,23,25,30,3,9],
	[23,24,26,0,4,10],
	[24,25,27,1,5,11],
	[25,26,28,2,6,12],
	[26,27,29,3,7,13],
	[27,28,30,4,8,14],
	[28,29,0,5,9,15],
	[29,30,1,6,10,16],
	[30,0,2,7,11,17],
]

designs.youden_square_7_7_7 = [
	[0,1,2,3,4,5,6],
	[1,2,3,4,5,6,0],
	[2,3,4,5,6,0,1],
	[3,4,5,6,0,1,2],
	[4,5,6,0,1,2,3],
	[5,6,0,1,2,3,4],
	[6,0,1,2,3,4,5],
]

designs.youden_square_8_7_6 = [
	[0,1,2,3,4,5,6],
	[1,2,3,4,5,6,7],
	[2,3,4,5,6,7,0],
	[3,4,5,6,7,0,1],
	[4,5,6,7,0,1,2],
	[5,6,7,0,1,2,3],
	[6,7,0,1,2,3,4],
	[7,0,1,2,3,4,5],
]

designs.youden_square_15_7_3 = [
	[0,1,2,4,5,8,10],
	[1,2,3,5,6,9,11],
	[2,3,4,6,7,10,12],
	[3,4,5,7,8,11,13],
	[4,5,6,8,9,12,14],
	[5,6,7,9,10,13,0],
	[6,7,8,10,11,14,1],
	[7,8,9,11,12,0,2],
	[8,9,10,12,13,1,3],
	[9,10,11,13,14,2,4],
	[10,11,12,14,0,3,5],
	[11,12,13,0,1,4,6],
	[12,13,14,1,2,5,7],
	[13,14,0,2,3,6,8],
	[14,0,1,3,4,7,9],
]

// Other designs.

// sit 1x - meet 1x - missed pairings
designs.social_golfer_12_3_1 = [
	[[2,0,1],[5,4,3],[6,8,7],[11,9,10]],
	[[3,6,0],[9,1,4],[7,10,2],[8,11,5]],
	[[0,7,9],[1,3,11],[4,2,8],[10,5,6]],
	[[0,8,10],[1,5,7],[2,3,9],[4,6,11]]
]

// sit 1x - meet 2x - missed pairings
designs.social_golfer_8_4_2 = [
	[[1,2,3,4],[5,6,7,0]],
	[[0,1,2,7],[4,5,6,3]],
	[[7,4,1,6],[3,0,5,2]],
	[[6,3,0,1],[2,7,4,5]],
]

// sit 2x - meet 1x
designs.bibd_13_3_1 = [
	[0,1,6],
	[0,3,7],
	[1,3,4],
	[1,10,8],
	[2,6,3],
	[2,7,1],
	[3,9,10],
	[3,12,5],
	[4,0,8],
	[4,5,10],
	[5,2,0],
	[5,6,11],
	[6,4,9],
	[6,8,12],
	[7,10,6],
	[7,11,4],
	[8,7,5],
	[8,11,3],
	[9,5,1],
	[9,8,2],
	[10,2,11],
	[10,12,0],
	[11,0,9],
	[11,1,12],
	[12,4,2],
	[12,9,7],
]

// sit 2x - meet 3x
designs.bibd_9_4_3 = [
	[0,2,8,7],
	[0,6,2,5],
	[1,2,3,5],
	[1,6,4,3],
	[2,1,6,7],
	[2,1,8,4],
	[3,5,0,8],
	[3,8,2,6],
	[4,0,3,2],
	[4,7,6,0],
	[5,0,1,4],
	[5,4,7,2],
	[6,5,7,3],
	[6,8,1,0],
	[7,3,0,1],
	[7,3,4,8],
	[8,4,5,6],
	[8,7,5,1],
]

// sit 1x - meet 2x
designs.bibd_16_6_2 = [
	[0,12,15,5,8,7],
	[1,2,0,15,11,10],
	[2,6,7,9,5,11],
	[3,13,9,1,15,5],
	[4,3,5,12,10,2],
	[5,14,6,0,4,1],
	[6,8,2,4,13,15],
	[7,11,4,8,1,3],
	[8,9,1,10,6,12],
	[9,0,8,3,2,14],
	[10,7,13,6,3,0],
	[11,15,3,14,12,6],
	[12,4,11,13,0,9],
	[13,5,10,11,14,8],
	[14,1,12,2,7,13],
	[15,10,14,7,9,4],
]

// vim:set nowrap:
