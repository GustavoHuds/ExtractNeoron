#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera o site (HTML/CSS/JS responsivo) consumindo o dataset + image-book."""
import json, os, shutil
from PIL import Image as PImage

def web_img(src, dst, maxpx=760):
    try:
        im=PImage.open(src)
        if im.mode not in ("RGB","L"):
            bg=PImage.new("RGB",im.size,(255,255,255))
            bg.paste(im, mask=im.split()[-1] if im.mode in ("RGBA","LA") else None); im=bg
        else: im=im.convert("RGB")
        im.thumbnail((maxpx,maxpx), PImage.LANCZOS)
        im.save(dst,"JPEG",quality=82,optimize=True)
    except Exception:
        shutil.copy(src,dst)

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D=os.path.join(BASE,"saida","data"); OUT=os.path.join(BASE,"saida")
SITE=os.path.join(OUT,"site"); IMG=os.path.join(SITE,"img")
os.makedirs(IMG,exist_ok=True)
items=json.load(open(os.path.join(D,"catalogo-dados.json"),encoding="utf-8"))

# copy assets
shutil.copy(os.path.join(OUT,"assets","logo_belmont.png"),os.path.join(SITE,"logo.png"))
web_img(os.path.join(OUT,"assets","placeholder.jpg"),os.path.join(IMG,"_placeholder.jpg"))
for it in items:
    if it["imagem"]:
        src=os.path.join(OUT,it["imagem"])
        if os.path.exists(src): web_img(src,os.path.join(IMG,os.path.basename(it["imagem"])))

# dataset for JS
data=[{"codigo":it["codigo"],"nome":it["nome_exibicao"],"cat":it["categoria_label"],
       "preco":it["preco"],"cor":it["cor"],"med":it["medidas"],"desc":it["descricao"],
       "img":("img/"+os.path.basename(it["imagem"])) if it["imagem"] else "img/_placeholder.jpg",
       "temfoto":bool(it["imagem"])} for it in items]
open(os.path.join(SITE,"data.js"),"w",encoding="utf-8").write(
    "window.CATALOGO="+json.dumps(data,ensure_ascii=False)+";")

INDEX=r"""<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Catálogo de Produtos — Lojas Belmont</title>
<link rel="stylesheet" href="style.css">
</head><body>
<header class="top">
  <div class="brand"><img src="logo.png" alt="Belmont">
    <div><h1>LOJAS BELMONT</h1><span>Catálogo de Produtos • João Pessoa – PB</span></div></div>
  <div class="search"><input id="q" type="search" placeholder="Buscar produto ou código..."></div>
</header>
<nav id="cats" class="cats"></nav>
<main><div id="count" class="count"></div><section id="grid" class="grid"></section>
  <div id="empty" class="empty" hidden>Nenhum produto encontrado.</div></main>
<footer class="foot">Lojas Belmont • +38 anos de história • João Pessoa – PB<br>
  <small>Preços sujeitos a alteração sem aviso prévio.</small></footer>
<div id="modal" class="modal" hidden><div class="box">
  <button id="x" class="x">×</button><img id="mimg" src="" alt="">
  <div class="minfo"><h2 id="mname"></h2><div id="mcod" class="mcod"></div>
    <p id="mdesc"></p><div id="mprice" class="mprice"></div></div></div></div>
<script src="data.js"></script><script src="app.js"></script>
</body></html>"""
open(os.path.join(SITE,"index.html"),"w",encoding="utf-8").write(INDEX)

CSS=r""":root{--navy:#12243b;--navy2:#1c3352;--gold:#c1912e;--cream:#f6f3ee;
--ink:#1b1b1b;--gray:#6b7280;--line:#e7e1d6}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:'Segoe UI',system-ui,Arial,sans-serif;background:var(--cream);color:var(--ink)}
.top{position:sticky;top:0;z-index:20;background:var(--navy);color:#fff;display:flex;
 align-items:center;justify-content:space-between;gap:20px;padding:14px 26px;flex-wrap:wrap;
 box-shadow:0 2px 10px rgba(0,0,0,.15)}
.brand{display:flex;align-items:center;gap:14px}
.brand img{height:50px;border-radius:8px}
.brand h1{margin:0;font-size:18px;letter-spacing:.6px}
.brand span{font-size:12px;color:#c9d3e0}
.search{flex:1;min-width:220px;max-width:420px}
.search input{width:100%;padding:11px 15px;border:0;border-radius:24px;font-size:14px;
 background:#0d1b2e;color:#fff;outline:2px solid transparent}
.search input::placeholder{color:#7f8 da0}.search input:focus{outline:2px solid var(--gold)}
.cats{position:sticky;top:78px;z-index:15;display:flex;gap:8px;overflow-x:auto;padding:12px 26px;
 background:#fff;border-bottom:1px solid var(--line)}
.chip{white-space:nowrap;border:1px solid var(--line);background:#fff;color:#444;padding:7px 14px;
 border-radius:20px;font-size:13px;cursor:pointer;transition:.15s}
.chip:hover{border-color:var(--gold)}
.chip.on{background:var(--navy);color:#fff;border-color:var(--navy)}
main{max-width:1240px;margin:0 auto;padding:20px 26px 60px}
.count{color:var(--gray);font-size:13px;margin:6px 2px 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;cursor:pointer;
 display:flex;flex-direction:column;transition:.18s;box-shadow:0 1px 3px rgba(0,0,0,.04)}
.card:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(18,36,59,.13);border-color:var(--gold)}
.thumb{aspect-ratio:1;background:#faf8f4;display:flex;align-items:center;justify-content:center;position:relative}
.thumb img{width:100%;height:100%;object-fit:contain}
.nofoto{position:absolute;top:8px;right:8px;background:#e7e1d6;color:#8a7a5c;font-size:10px;
 padding:3px 8px;border-radius:12px}
.cbody{padding:12px 13px 14px;display:flex;flex-direction:column;gap:5px;flex:1}
.cname{font-size:13.5px;font-weight:700;line-height:1.25;min-height:34px}
.cmeta{font-size:11px;color:var(--gray)}
.cprice{margin-top:auto;font-size:16px;font-weight:800;color:var(--navy)}
.tag{display:inline-block;background:var(--cream);color:#8a7a5c;font-size:10px;padding:2px 7px;border-radius:10px;margin-right:4px}
.foot{background:var(--navy);color:#c9d3e0;text-align:center;padding:26px;font-size:13px}
.empty{padding:60px;text-align:center;color:var(--gray)}
.modal{position:fixed;inset:0;background:rgba(10,18,30,.72);display:flex;align-items:center;
 justify-content:center;z-index:50;padding:20px}
.box{background:#fff;border-radius:16px;max-width:760px;width:100%;display:flex;overflow:hidden;position:relative;max-height:90vh}
.box img{width:48%;object-fit:contain;background:#faf8f4;padding:18px}
.minfo{padding:26px 28px;flex:1}
.minfo h2{margin:0 0 6px;font-size:20px}
.mcod{color:var(--gold);font-weight:700;font-size:12px;letter-spacing:.5px;margin-bottom:14px}
.minfo p{color:#444;font-size:14px;line-height:1.5}
.mprice{margin-top:18px;font-size:26px;font-weight:800;color:var(--navy)}
.x{position:absolute;top:10px;right:14px;border:0;background:transparent;font-size:30px;
 line-height:1;cursor:pointer;color:#888}
@media(max-width:620px){.box{flex-direction:column}.box img{width:100%;height:240px}}
"""
open(os.path.join(SITE,"style.css"),"w",encoding="utf-8").write(CSS.replace("#7f8 da0","#7f8da0"))

APP=r"""const DATA=window.CATALOGO||[];
const grid=document.getElementById('grid'),catsEl=document.getElementById('cats'),
 q=document.getElementById('q'),countEl=document.getElementById('count'),empty=document.getElementById('empty');
let cat='Todos',term='';
const cats=['Todos',...Array.from(new Set(DATA.map(d=>d.cat)))];
const brl=v=>'R$ '+(Number(v||0).toFixed(2)).replace('.',',');
function norm(s){return (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')}
function renderChips(){catsEl.innerHTML=cats.map(c=>{
 const n=c==='Todos'?DATA.length:DATA.filter(d=>d.cat===c).length;
 return `<button class="chip ${c===cat?'on':''}" data-c="${c}">${c} <b>${n}</b></button>`}).join('');
 catsEl.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{cat=b.dataset.c;renderChips();render()});}
function render(){
 const t=norm(term);
 const list=DATA.filter(d=>(cat==='Todos'||d.cat===cat)&&
   (!t||norm(d.nome).includes(t)||d.codigo.includes(term.trim())));
 countEl.textContent=`${list.length} produto(s)`+(cat!=='Todos'?` em ${cat}`:'');
 empty.hidden=list.length>0;
 grid.innerHTML=list.map((d,i)=>`<article class="card" data-i="${DATA.indexOf(d)}">
   <div class="thumb"><img loading="lazy" src="${d.img}" alt="${d.nome}">
   ${d.temfoto?'':'<span class="nofoto">sem foto</span>'}</div>
   <div class="cbody"><div class="cname">${d.nome}</div>
   <div class="cmeta"><span class="tag">Cód. ${d.codigo}</span>${d.cor?'<span class="tag">'+d.cor+'</span>':''}${d.med?'<span class="tag">'+d.med.replace(/X/g,'×')+'</span>':''}</div>
   <div class="cprice">${brl(d.preco)}</div></div></article>`).join('');
 grid.querySelectorAll('.card').forEach(c=>c.onclick=()=>openModal(DATA[c.dataset.i]));}
const modal=document.getElementById('modal');
function openModal(d){document.getElementById('mimg').src=d.img;
 document.getElementById('mname').textContent=d.nome;
 document.getElementById('mcod').textContent='Código '+d.codigo+'  •  '+d.cat;
 document.getElementById('mdesc').textContent=d.desc||'';
 document.getElementById('mprice').textContent=brl(d.preco);modal.hidden=false;}
document.getElementById('x').onclick=()=>modal.hidden=true;
modal.onclick=e=>{if(e.target===modal)modal.hidden=true};
q.addEventListener('input',()=>{term=q.value;render()});
renderChips();render();"""
open(os.path.join(SITE,"app.js"),"w",encoding="utf-8").write(APP)

n_img=len([f for f in os.listdir(IMG)])
print(f"site gerado: index.html, style.css, app.js, data.js  | imagens copiadas={n_img}")
