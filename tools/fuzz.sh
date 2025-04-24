#!/bin/bash

TITLE=$1
shift

if [ ! -f ./public/$TITLE/rules.js ]
then
	echo usage: bash tools/fuzz.sh title_id
	exit 1
fi

mkdir -p fuzzer/corpus-$TITLE

RULES=../public/$TITLE/rules.js \
	npx jazzer tools/rtt-fuzz.js --sync fuzzer/corpus-$TITLE "$@" -- -exact_artifact_path=/dev/null | \
		tee fuzzer/log-$TITLE.txt
