#!/bin/bash
#
# Create CircledNumbers webfont by subsetting the circled numbers from NotoSansJP.
#

pyftsubset NotoSansJP-Regular.otf --verbose --output-file=CircledNumbers.woff2 --flavor=woff2 --unicodes=U+2776-277b,U+2460-2465 --xml
