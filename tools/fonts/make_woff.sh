#!/bin/bash

# The latin character set as used by google fonts:
# UNICODE=U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+FEFF,U+FFFD

# Extended with some extra symbols we want:
UNICODE=U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+2500-25ff,U+2600-26ff,U+FEFF,U+FFFD

for F in $*
do
	OUT=$(basename $(basename $F .ttf) .otf).woff2
	pyftsubset $F --verbose --output-file=$OUT --flavor=woff2 --unicodes=$UNICODE
done
