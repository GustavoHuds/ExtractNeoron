#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ESCOPO COMPLETO: todos os 1.486 itens da RELACAO (uniao com codigos das referencias).
Preco: varejo(refs) -> Preco Base(relacao) -> 0 (zero = fora de estoque).
Baixa image-book do CDN para TODOS os codigos (download paralelo)."""
import json, os, csv, requests
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(BASE, "saida", "data")
IMG = os.path.join(BASE, "saida", "image-book")
os.makedirs(IMG, exist_ok=True)

rel_list = json.load(open(os.path.join(D,"relacao.json"),encoding="utf-8"))
rel = {r["codigo"]: r for r in rel_list}
refs = json.load(open(os.path.join(D,"referencias.json"),encoding="utf-8"))

def retail(v):
    ps = [p for p in v["precos"].values() if p and p > 0]
    return max(ps) if ps else 0.0

# escopo = uniao (relacao + codigos de referencia nao presentes na relacao)
codigos = list(rel.keys())
for c in refs:
    if c not in rel: codigos.append(c)

sess = requests.Session(); sess.headers.update({"User-Agent":"Mozilla/5.0"})
def download(cod):
    fp = os.path.join(IMG, f"{cod}.jpg")
    if os.path.exists(fp) and os.path.getsize(fp) > 1500:
        return cod, "cache"
    try:
        r = sess.get(f"https://s9.chianca.net/imagens/383/{cod}.jpg", timeout=20)
        if r.status_code==200 and r.headers.get("content-type","").startswith("image") and len(r.content)>1500:
            open(fp,"wb").write(r.content); return cod, "ok"
    except Exception:
        return cod, "err"
    return cod, "miss"

print(f"baixando imagens de {len(codigos)} codigos (paralelo)...")
status = {}
with ThreadPoolExecutor(max_workers=24) as ex:
    for i,(cod,st) in enumerate(ex.map(download, codigos)):
        status[cod]=st
        if (i+1)%200==0: print(f"  {i+1}/{len(codigos)}")

items=[]; got=0
for cod in codigos:
    r = rel.get(cod); rv = refs.get(cod)
    nome = (r["nome"] if r and r["nome"] else (rv.get("nome_ref","") if rv else "")).strip()
    categoria = r["categoria"] if r else "OUTROS"
    estoque = r["estoque"] if r else 0
    preco = (retail(rv) if rv else 0.0) or (r["preco_base"] if r else 0.0) or 0.0
    st = status.get(cod,"miss")
    if st in ("ok","cache"):
        got+=1; img=f"image-book/{cod}.jpg"
    else: img=""
    items.append({"codigo":cod,"nome":nome,"categoria":categoria,
                  "preco":round(preco,2),"estoque":estoque,"imagem":img,
                  "img_status":st,"lojas":rv["lojas"] if rv else [],
                  "precos_loja":rv["precos"] if rv else {},"descricao":""})

items.sort(key=lambda i:(i["categoria"], i["nome"]))
json.dump(items, open(os.path.join(D,"catalogo-dados.json"),"w",encoding="utf-8"),
          ensure_ascii=False, indent=1)
with open(os.path.join(D,"catalogo-dados.csv"),"w",newline="",encoding="utf-8-sig") as f:
    w=csv.writer(f); w.writerow(["codigo","nome","categoria","preco","estoque","imagem","lojas"])
    for i in items:
        w.writerow([i["codigo"],i["nome"],i["categoria"],f'{i["preco"]:.2f}',
                    i["estoque"],i["imagem"],"|".join(i["lojas"])])

from collections import Counter
print(f"\nitens={len(items)}  com_imagem={got}  ({100*got//len(items)}%)")
print("com_preco>0:", sum(1 for i in items if i['preco']>0))
print("por categoria:", dict(Counter(i["categoria"] for i in items)))
