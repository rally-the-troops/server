mogrify -resize 300x300 -format ppm */cover.jpg
for F in tools/*/cover.jpg
do
	OUT=public/*$(dirname $F | sed 's,tools/,,;s/-.*//')*
	echo Thumbnail $OUT/cover.jpg $F
	djpeg $F | pnmscale -xysize 400 400 | mozjpeg -q 90 > $OUT/cover.jpg
done
