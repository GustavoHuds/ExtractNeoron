#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extrai a base de produtos da RELACAO DE PRODUTOS.pdf (tabela de precos).
Saida: relacao.json  -> [{codigo, nome, preco_base, estoque, categoria}]
"""
import fitz, re, json, os, sys

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(BASE, "Referências", "RELAÇÃO DE PRODUTOS.pdf")
OUT = os.path.join(BASE, "saida", "data", "relacao.json")

CATS = {"ACESSORIOS","BASE","BELICHE","BERÇO","BERCO","CABECEIRA","CAMA","COLCHAO",
        "COLCHÃO","COMODA","CÔMODA","COZINHA","ELETRO","MESA","PAINEL","RACK",
        "ROUPEIRO","SOFA","SOFÁ","TERRAÇO","TERRACO","TERRAÇO","TRAVESSEIRO",
        "UNIBOX","ZDIVERSOS"}

def is_codigo(tok):
    return bool(re.fullmatch(r"\d{2,14}", tok))

def is_price(tok):
    return bool(re.fullmatch(r"\d{1,6}\.\d{2}", tok))

def main():
    doc = fitz.open(SRC)
    rows = []
    current_cat = "OUTROS"
    for pno in range(doc.page_count):
        pg = doc[pno]
        words = pg.get_text("words")
        # keep only content area (skip page header ~y<100 and footer ~y>760)
        words = [w for w in words if 100 < w[1] < 770]
        # --- detect category headers (x~117, endswith ':', uppercase, no price on row)
        # --- detect codigo anchors (x<60 numeric)
        anchors = []   # (y, codigo)
        headers = []   # (y, catname)
        # group words by rounded y to find header rows / price rows
        for w in words:
            x0, y0, x1, y1, txt = w[0], w[1], w[2], w[3], w[4]
            if x0 < 60 and is_codigo(txt):
                anchors.append((y0, txt))
            elif 70 < x0 < 200 and txt.endswith(":"):
                name = txt[:-1].upper()
                if name in CATS or name.replace("Ç","C") in {c.replace("Ç","C") for c in CATS}:
                    headers.append((y0, name))
        anchors.sort(); headers.sort()
        if not anchors:
            continue
        anchor_ys = [y for y,_ in anchors]
        # per anchor: pair price & estoque on the SAME row (same y +-3)
        prod = {}  # y -> dict
        for y,cod in anchors:
            row = [w for w in words if abs(w[1]-y) <= 3]
            price_words = [w for w in row if 398 < w[0] < 472 and is_price(w[4])]
            est_words = [w for w in row if w[0] > 475 and re.fullmatch(r"-?\d+", w[4])]
            prod[y] = {"codigo": cod,
                       "preco_base": float(price_words[0][4]) if price_words else 0.0,
                       "estoque": int(est_words[0][4]) if est_words else 0,
                       "name_parts": []}
        # category per anchor: walk headers+anchors in y-order using running current_cat
        anchor_cat = {}
        events = sorted([(y,0,name) for y,name in headers] +
                        [(y,1,cod) for y,cod in anchors], key=lambda e:(e[0],e[1]))
        for y,typ,val in events:
            if typ == 0:
                current_cat = val
            else:
                anchor_cat[y] = current_cat
        def cat_for_y(wy):
            return anchor_cat.get(wy, current_cat)
        header_word_ids = {id(w) for w in words
                           if 70 < w[0] < 200 and w[4].endswith(":")}
        for w in words:
            if id(w) in header_word_ids:
                continue
            if not (76 < w[0] < 398):
                continue
            wy = w[1]
            # nearest anchor
            ny = min(anchor_ys, key=lambda ay: abs(ay-wy))
            prod[ny]["name_parts"].append((wy, w[0], w[4]))
        for y,cod in anchors:
            p = prod[y]
            parts = sorted(p["name_parts"], key=lambda t:(round(t[0]), t[1]))
            name = re.sub(r"\s+"," "," ".join(t[2] for t in parts)).strip()
            rows.append({"codigo": cod, "nome": name,
                         "preco_base": p["preco_base"], "estoque": p["estoque"],
                         "categoria": cat_for_y(y)})
    # dedupe exact codigo keeping first
    seen = {}
    for r in rows:
        if r["codigo"] not in seen:
            seen[r["codigo"]] = r
    out = list(seen.values())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    # report
    from collections import Counter
    c = Counter(r["categoria"] for r in out)
    print(f"linhas brutas={len(rows)}  unicos={len(out)}")
    print("categorias:", dict(c))
    print("exemplos:")
    for r in out[:3] + out[-3:]:
        print("  ", r)

if __name__ == "__main__":
    main()
