#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extrai as 7 referencias de loja (CATALOGO DE PRODUTOS).
Cada arquivo -> codigo, preco_varejo (R$), loja, tem_url_imagem, descricao.
Saida: referencias.json  ->  {codigo: {precos:{loja:valor}, lojas:[...],
                                       url_img:bool, nome_ref:str}}
"""
import fitz, re, json, os, glob
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRCDIR = os.path.join(BASE, "Referências")
OUT = os.path.join(BASE, "saida", "data", "referencias.json")

def parse_money(tok):
    # "1.090,00" -> 1090.00 ; "357,00" -> 357.0 ; "0,00" -> 0
    t = tok.replace(".", "").replace(",", ".")
    try: return float(t)
    except: return None

def store_name(path):
    b = os.path.basename(path).lower()
    b = b.replace("referências-","").replace("referencias-","").replace(".pdf","")
    return b.replace("-", " ").title()

def main():
    files = sorted(glob.glob(os.path.join(SRCDIR, "Refer*ncias-*.pdf")))
    data = defaultdict(lambda: {"precos": {}, "lojas": [], "url_img": False, "nome_ref": ""})
    url_re = re.compile(r"chianca\.net/imagens/\d+/(\d{2,14})\.jpg", re.I)
    for fp in files:
        loja = store_name(fp)
        doc = fitz.open(fp)
        codes_with_url = set()
        for pno in range(doc.page_count):
            pg = doc[pno]
            txt = pg.get_text("text")
            for m in url_re.finditer(txt):
                codes_with_url.add(m.group(1))
            words = pg.get_text("words")
            words = [w for w in words if 150 < w[1] < 790]
            # anchor on "R$" or price placeholder "[Pço"; codigo left, preco (money) right
            rs = [w for w in words if w[4] in ("R$", "[Pço")]
            for rw in rs:
                y = rw[1]; rx = rw[0]
                row = [w for w in words if abs(w[1]-y) <= 4]
                cods = [w for w in row if w[0] < rx and re.fullmatch(r"\d{3,14}", w[4])]
                if not cods:
                    continue
                cod = max(cods, key=lambda w: w[0])[4]   # nearest-left numeric
                money = [w for w in row if w[0] > rx and re.fullmatch(r"[\d.]*\d,\d{2}", w[4])]
                preco = parse_money(money[0][4]) if money else None
                d = data[cod]
                d["nome_ref"] = d["nome_ref"]
                if preco is not None:
                    d["precos"][loja] = preco
                if loja not in d["lojas"]:
                    d["lojas"].append(loja)
                # description words (188..410) same+next line
                desc = [w for w in words if 180 < w[0] < 415 and y-22 <= w[1] <= y+14]
                nm = re.sub(r"\s+"," "," ".join(w[4] for w in sorted(desc,key=lambda w:(round(w[1]),w[0]))))
                nm = re.sub(r"https?://\S+","",nm).strip()
                if len(nm) > len(d["nome_ref"]):
                    d["nome_ref"] = nm
        for c in codes_with_url:
            data[c]["url_img"] = True
        print(f"{loja:16s} paginas={doc.page_count:2d} codigos_url={len(codes_with_url)}")
    out = {k: v for k, v in data.items()}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT,"w",encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    n_url = sum(1 for v in out.values() if v["url_img"])
    n_price = sum(1 for v in out.values() if any(p>0 for p in v["precos"].values()))
    print(f"\nTOTAL codigos nas referencias: {len(out)}")
    print(f"  com URL de imagem confirmada: {n_url}")
    print(f"  com preco varejo > 0: {n_price}")

if __name__ == "__main__":
    main()
