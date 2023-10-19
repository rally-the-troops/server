for FILE in $*
do
	V=$RANDOM
	sed -i -e '/<link/s/client.css.*"/client.css?v='$V'"/' "$FILE"
	sed -i -e '/<link/s/play.css.*"/play.css?v='$V'"/' "$FILE"
	sed -i -e '/<script/s/client.js.*"/client.js?v='$V'"/' "$FILE"
	sed -i -e '/<script/s/play.js.*"/play.js?v='$V'"/' "$FILE"
done
