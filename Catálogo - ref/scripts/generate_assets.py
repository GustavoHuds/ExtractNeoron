#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera placeholder, manifest.csv e image-book/index.html (grid navegavel)."""
import json, os, csv, html
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(BASE,"saida","data")
IMG = os.path.join(BASE,"saida","image-book")
ASSETS = os.path.join(BASE,"saida","assets")
os.makedirs(ASSETS, exist_ok=True)
items = json.load(open(os.path.join(D,"catalogo-dados.json"),encoding="utf-8"))

NAVY=(18,36,59); GOLD=(193,145,46); CREAM=(246,243,238); GRAY=(150,150,150)

# ---- placeholder image
def make_placeholder():
    w=h=600
    im=Image.new("RGB",(w,h),CREAM)
    d=ImageDraw.Draw(im)
    d.rectangle([12,12,w-12,h-12],outline=GOLD,width=3)
    # simple sofa/box glyph
    d.rounded_rectangle([160,250,440,360],radius=18,outline=NAVY,width=6)
    d.rectangle([180,300,420,360],outline=NAVY,width=6)
    try: f=ImageFont.truetype("arialbd.ttf",34); f2=ImageFont.truetype("arial.ttf",24)
    except: f=ImageFont.load_default(); f2=f
    t="BELMONT"
    tw=d.textlength(t,font=f); d.text(((w-tw)/2,170),t,fill=NAVY,font=f)
    t2="Imagem sob consulta"
    tw2=d.textlength(t2,font=f2); d.text(((w-tw2)/2,410),t2,fill=GRAY,font=f2)
    im.save(os.path.join(ASSETS,"placeholder.jpg"),quality=88)
make_placeholder()

# ---- manifest
with open(os.path.join(IMG,"manifest.csv"),"w",newline="",encoding="utf-8-sig") as f:
    w=csv.writer(f); w.writerow(["codigo","nome","arquivo","tem_foto","origem"])
    for it in items:
        w.writerow([it["codigo"],it["nome_exibicao"],
                    it["imagem"].split("/")[-1] if it["imagem"] else "(placeholder)",
                    "sim" if it["imagem"] else "nao",
                    "s9.chianca.net" if it["imagem"] else "-"])

# ---- image-book index.html
com=sum(1 for i in items if i["imagem"])
cards=[]
for it in items:
    src = os.path.basename(it["imagem"]) if it["imagem"] else "../assets/placeholder.jpg"
    badge = "" if it["imagem"] else '<span class="ph">sem foto</span>'
    cards.append(f'''<figure><div class="imgwrap"><img loading="lazy" src="{src}" alt="{html.escape(it['nome_exibicao'])}">{badge}</div>
<figcaption><b>{html.escape(it['nome_exibicao'])}</b><span>Cód. {it['codigo']}</span></figcaption></figure>''')
htmlpage=f'''<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Image Book — Lojas Belmont</title>
<style>
:root{{--navy:#12243b;--gold:#c1912e;--cream:#f6f3ee}}
*{{box-sizing:border-box}}body{{margin:0;font-family:'Segoe UI',Arial,sans-serif;background:var(--cream);color:#1b1b1b}}
header{{background:var(--navy);color:#fff;padding:22px 28px;display:flex;align-items:center;gap:18px}}
header img{{height:54px;border-radius:8px}} header h1{{font-size:20px;margin:0;letter-spacing:.5px}}
header p{{margin:2px 0 0;color:#c9d3e0;font-size:13px}}
.bar{{padding:14px 28px;background:#fff;border-bottom:1px solid #e7e1d6;font-size:14px;color:#555}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;padding:24px 28px}}
figure{{margin:0;background:#fff;border:1px solid #e7e1d6;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04)}}
.imgwrap{{position:relative;aspect-ratio:1;background:#faf8f4;display:flex;align-items:center;justify-content:center}}
.imgwrap img{{width:100%;height:100%;object-fit:contain}}
.ph{{position:absolute;top:8px;right:8px;background:#e7e1d6;color:#8a7a5c;font-size:11px;padding:3px 7px;border-radius:20px}}
figcaption{{padding:10px 12px;font-size:13px;display:flex;flex-direction:column;gap:3px}}
figcaption span{{color:var(--gold);font-size:11px;font-weight:600;letter-spacing:.4px}}
</style></head><body>
<header><img src="../assets/logo_belmont.png" alt="Belmont">
<div><h1>IMAGE BOOK — LOJAS BELMONT</h1><p>Banco de imagens dos produtos • uso em site, redes e materiais</p></div></header>
<div class="bar">{len(items)} produtos • {com} com foto de catálogo • {len(items)-com} sem foto (placeholder)</div>
<div class="grid">{''.join(cards)}</div>
</body></html>'''
open(os.path.join(IMG,"index.html"),"w",encoding="utf-8").write(htmlpage)
print(f"placeholder.jpg + manifest.csv + image-book/index.html  ({com}/{len(items)} com foto)")
