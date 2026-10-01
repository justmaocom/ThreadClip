#!/bin/sh
# 打包上架 Chrome 線上應用程式商店用的 zip（只含擴充功能執行所需檔案）
set -e
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
out="threadclip-${version}.zip"

rm -f "$out"
zip -r -X -q "$out" manifest.json src icons -x 'icons/*.svg' '*.DS_Store'
echo "已產生 $out"
unzip -l "$out"
