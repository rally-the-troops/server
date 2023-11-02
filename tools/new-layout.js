const print = console.log

if (process.argv.length < 4) {
	print("usage: node new-layout.js <width> <height> [image.jpg]")
	process.exit(1)
}

var w = Number(process.argv[2])
var h = Number(process.argv[3])
var m = process.argv[4] || "../map75.jpg"

print(`<?xml version="1.0" encoding="UTF-8"?>
<svg
	xmlns="http://www.w3.org/2000/svg"
	xmlns:xlink="http://www.w3.org/1999/xlink"
	xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
	width="${w}"
	height="${h}"
>
<image xlink:href="${m}" x="0" y="0" width="${w}" height="${h}" image-rendering="pixelated" sodipodi:insensitive="true" />
</svg>
`)
