for F in public/*/cover.jpg public/*/cover.png
do
	echo Processing: $F
	B=$(echo $F | sed s/.jpg// | sed s/.png//)
	D=$(dirname $F)

	if [ $F -nt $D/thumbnail.jpg ]
	then

	PORTRAIT=$(convert $F -format '%[fx:w<h]' info:)
	SQUARE=$(convert $F -format '%[fx:w=h]' info:)

	SIZE_1X=170x200
	SIZE_2X=340x400
	SIZE_TH=120x144

	if test $PORTRAIT = 1
	then
		echo - portrait
		SIZE_1X=150x200!
		SIZE_2X=300x400!
		SIZE_TH=108x144!
	fi

	if test $SQUARE = 1
	then
		echo - square
		SIZE_1X=170x170!
		SIZE_2X=170x170!
		SIZE_TH=120x120!
	fi

	convert -colorspace RGB -resize $SIZE_1X -colorspace sRGB $F $B.1x.png
	pngtopnm $B.1x.png | cjpeg -progressive -optimize -sample 1x1 -quality 95 > $B.1x.jpg
	rm -f $B.1x.png

	convert -colorspace RGB -resize $SIZE_2X $F -colorspace sRGB $B.2x.png
	pngtopnm $B.2x.png | cjpeg -progressive -optimize -sample 1x1 -quality 95 > $B.2x.jpg
	rm -f $B.2x.png

	convert -colorspace RGB -resize $SIZE_TH $F -colorspace sRGB $D/thumbnail.png
	pngtopnm $D/thumbnail.png | cjpeg -progressive -optimize -sample 1x1 -quality 95 > $D/thumbnail.jpg
	rm -f $D/thumbnail.png

	fi
done
