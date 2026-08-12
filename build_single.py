#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 index.html / style.css / data_multi.js / app.js 合併成單一 HTML。

為什麼需要這個：用 file:// 直接開本機檔案時，瀏覽器把每個檔案視為獨立的
安全來源，某些路徑（例如被 Windows 應用程式沙箱虛擬化的目錄）會讀不到
同目錄的 .js，出現 net::ERR_FILE_NOT_FOUND。單檔版沒有任何外部引用，
不受這個限制，適合本機使用或複製到別台電腦。

GitHub Pages 走的是 https，沒有這個問題，用多檔版即可。

用法:
    python3 build_single.py [--out NIKKE_UR分析器_單檔版.html]
"""
import argparse, os, re

ap = argparse.ArgumentParser()
ap.add_argument('--out', default='NIKKE_UR分析器_單檔版.html')
args = ap.parse_args()

html = open('index.html', encoding='utf-8').read()
css = open('style.css', encoding='utf-8').read()
data = open('data_multi.js', encoding='utf-8').read()
app = open('app.js', encoding='utf-8').read()

# 內容裡若出現 </script> 會提前結束區塊
def safe(js):
    return js.replace('</script>', '<\\/script>')

# 用 lambda 當替換函式，避免內容中的反斜線被當成 regex 跳脫序列
html = re.sub(r'<link rel="stylesheet" href="style\.css[^"]*">',
              lambda m: '<style>\n' + css + '\n</style>', html, count=1)
html = re.sub(r'<script src="data_multi\.js[^"]*"></script>',
              lambda m: '<script>\n' + safe(data) + '\n</script>', html, count=1)
html = re.sub(r'<script src="app\.js[^"]*"></script>',
              lambda m: '<script>\n' + safe(app) + '\n</script>', html, count=1)

left = re.findall(r'(?:src|href)="(?!https?:)([^"]+)"', html)
if left:
    raise SystemExit(f'仍有外部引用未內嵌：{left}')

open(args.out, 'w', encoding='utf-8').write(html)
print(f'✅ {args.out}  {os.path.getsize(args.out)/1048576:.1f} MB（無任何外部檔案相依）')
