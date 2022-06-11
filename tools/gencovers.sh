for F in public/*/cover.jpg
do
	echo Processing: $F
	B=$(echo $F | sed s/.jpg//)
	D=$(dirname $F)

	convert -resize 200x200 $F $B.1x.png
	mozjpeg -q 95 -outfile $B.1x.jpg $B.1x.png
	rm -f $B.1x.png

	convert -resize 400x400 $F $B.2x.png
	mozjpeg -q 90 -outfile $B.2x.jpg $B.2x.png
	rm -f $B.2x.png

	convert -resize 108x144! $F $D/thumbnail.png
	mozjpeg -q 90 -outfile $D/thumbnail.jpg $D/thumbnail.png
	rm -f $D/thumbnail.png
done
