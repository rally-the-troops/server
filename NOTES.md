# Icons are sourced from various places:

* https://game-icons.net/
* https://commons.wikimedia.org/wiki/Main_Page

# Fonts:

* https://github.com/adobe-fonts/source-sans
* https://github.com/adobe-fonts/source-serif
* https://www.google.com/get/noto/

# Image processing software:

* https://github.com/google/guetzli/
* https://github.com/mozilla/mozjpeg
* https://github.com/svg/svgo
* http://optipng.sourceforge.net/
* http://potrace.sourceforge.net/

# Mobile responsive design:

* Image resolutions

	Map is 75dpi unless very small.
	Counters are same dpi as map.

	Cards are 100dpi if text is small.
	Cards are 75dpi if usually placed on map.
	If rarely placed on map, keep at 100dpi and scale(0.75).

	@media (min-resolution: 97dpi)
		Use 2x resolution map and card

	Counters always use @2x resolution if shift-zooming is available.

* Touch screen

	@media (pointer: coarse)
		increase tiny UI element sizes (for example the replay buttons)

* Screen size thresholds for layout triggers:

	@media (max-width: 400)
		one-column tabbed mode

	@media (max-width: 800)
		mobile phone layout
		two-column tabbed mode (notepad and chat window fill screen)
		horizontally scroll basic content; use full map width for hands etc

	@media (max-height: 600)
		mobile phone landscape layout
		start hiding player names behind tap/hover
		hide or reduce turn info, role info, and current card

	@media (max-height: 800)
		small laptop screen
