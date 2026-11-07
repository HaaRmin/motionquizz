#!/bin/sh
# Small pictures of the logos and backgrounds for the page's pickers (macOS sips), in assets/thumbs/.
# Run it after adding or replacing a logo or background; a picture without a thumbnail shows in full size.
set -e
cd "$(dirname "$0")/.."
mkdir -p assets/thumbs
for f in assets/logos/*; do
  sips -s format jpeg -s formatOptions 80 -Z 160 "$f" --out "assets/thumbs/$(basename "${f%.*}").jpg" >/dev/null
done
for f in assets/backgrounds/*; do
  sips -s format jpeg -s formatOptions 78 --resampleHeight 320 "$f" --out "assets/thumbs/$(basename "${f%.*}").jpg" >/dev/null
done
ls assets/thumbs | wc -l | xargs echo "thumbnails:"
