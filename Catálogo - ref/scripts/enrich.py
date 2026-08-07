#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Enriquece catalogo-dados.json: nome de exibicao limpo, atributos (medidas/cor),
descricao comercial, categoria corrigida. Reescreve catalogo-dados.json."""
import json, os, re

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(BASE, "saida", "data")
items = json.load(open(os.path.join(D,"catalogo-dados.json"),encoding="utf-8"))

# ---- abreviacoes -> forma legivel
ABBR = {
    "BIC.":"Bicicleta","BIC":"Bicicleta","JG":"Jogo","JOGO":"Jogo","CJ":"Conjunto",
    "CONJ":"Conjunto","G":"Guarda","ROUPA":"Roupa","PROT":"Protetor","TRAV.":"Travesseiro",
    "TRAV":"Travesseiro","COL":"Colchão","COLCH":"Colchão","ACP":"ACP","P/":"para",
    "C/":"com","S/":"sem","UN":"un","PCS":"peças","PÇS":"peças","PECAS":"peças",
    "PEÇAS":"peças","LUG":"lugares","CM":"cm","MTS":"m","IMPE.":"Impermeável",
    "IMPER":"Impermeável","ALG":"Algodão","BC":"Branco","PT":"Preto","BG":"Bege",
    "MASC":"Masculino","NEON":"Neon",
}
COLORS = {"BRANCO":"Branco","PRETO":"Preto","PRETA":"Preto","BEGE":"Bege","CINZA":"Cinza",
    "MARROM":"Marrom","AZUL":"Azul","VERMELHA":"Vermelho","VERMELHO":"Vermelho","VERDE":"Verde",
    "GRAFITE":"Grafite","CARAMELO":"Caramelo","CHINCHILA":"Chinchila","PAVEMONT":"Pavemont",
    "TOBACCO":"Tobacco","TOBACO":"Tobacco","ERMINE":"Ermine","SAFARI":"Safari","ROSE":"Rosé",
    "MARFIM":"Marfim","PALOMA":"Cinza Paloma","KAKI":"Cáqui","AMARELO":"Amarelo",
    "CAMELO":"Camelo","LINHO":"Linho","VELUDO":"Veludo","NEON":"Neon","CAFE":"Café",
    "OCRE":"Ocre","VINHO":"Vinho","STEEL":"Steel","TURQUESA":"Turquesa","CACAU":"Cacau"}

DIM_RE = re.compile(r"\b\d{1,4}\s?[.,]?\d{0,3}\s?(?:X|x)\s?\d{1,4}[.,]?\d{0,3}(?:\s?(?:X|x)\s?\d{1,4}[.,]?\d{0,3})?(?:\s?(?:CM|M|MM|MX|CMX))?\b")

def title_pt(s):
    small={"de","da","do","com","sem","para","e","a","o","x"}
    out=[]
    for i,w in enumerate(s.split()):
        lw=w.lower()
        if w.isupper() and len(w)<=3 and not w.isalpha():
            out.append(w)  # codes like D20, A.20
        elif lw in small and i>0:
            out.append(lw)
        else:
            out.append(w.capitalize() if w.isalpha() else w)
    return " ".join(out)

def extract_dims(name):
    dims=[]
    for m in DIM_RE.finditer(name.replace("MX","X").replace("CMX","X")):
        d=m.group(0).strip()
        if re.search(r"[Xx]", d) and len(d)>=5:
            dims.append(re.sub(r"\s+","",d))
    return dims

def extract_color(name):
    up=name.upper()
    found=[]
    for k,v in COLORS.items():
        if re.search(r"\b"+re.escape(k)+r"\b", up) and v not in found:
            found.append(v)
    return found[:2]

# palavras que costumam quebrar de linha no PDF (religar fragmentos)
KNOWN_JOIN={w.upper() for w in list(COLORS)+[
    "BEGE","MARROM","PRETO","PRETA","BRANCO","BRANCA","CINZA","GRAFITE","CARAMELO",
    "CHINCHILA","PAVEMONT","TOBACCO","ERMINE","SAFARI","MARFIM","PALOMA","AMARELO",
    "CAMELO","LINHO","VELUDO","TEKSHINE","RECAMIER","CABECEIRA","CAPTONE","ALGODAO",
    "IMPERMEAVEL","SOLTEIRO","SOLTEIRAO","CASAL","QUEEN","QUEEM","KING","SANTANA",
    "TOPAZIO","STYLUS","ESPELHO","ELASTICO","FRONHA","ALUMINIO","ARTELASSE","CORDONE",
    "ALMOFADA","PLOOMA","PERCAL","MATELASSE","CORTTEX","MICROTEC","PREMIUM","DUPLO",
    "ESTAMPADO","VARAL","PANELUX","LUCENA","WANESSA","HELENA","DOHLER","KACYUMARA"]}
STANDALONE={"DE","UN","CM","PT","BG","BC","LT","KG","MM","M","X","C","S","P","A.20","A.16"}
def fix_splits(name):
    toks=name.split(); out=[]; i=0
    while i<len(toks):
        if i+1<len(toks):
            merged=toks[i]+toks[i+1]
            if merged.upper() in KNOWN_JOIN and toks[i].upper() not in STANDALONE:
                out.append(merged); i+=2; continue
        out.append(toks[i]); i+=1
    return " ".join(out)

def clean_name(name):
    # remove trailing store noise tokens & normalize spaces
    n=fix_splits(re.sub(r"\s+"," ",name).strip().rstrip("."))
    # expand leading abbreviations token-wise for readability
    toks=n.split()
    exp=[]
    for t in toks:
        key=t.upper()
        if key in ABBR and ABBR[key] not in ("cm","m","un"):
            exp.append(ABBR[key])
        else:
            exp.append(t)
    n=" ".join(exp)
    n=title_pt(n)
    n=re.sub(r"^[%\s]+","",n)                      # tira '%' inicial
    n=re.sub(r"\b(\w+)\s+\1\b","\\1",n,flags=re.I) # remove palavra repetida consecutiva
    return n.strip()

CATMAP={"ACESSORIOS":"Acessórios & Cama Mesa Banho","BASE":"Bases Box",
    "BELICHE":"Beliches","BERÇO":"Berços","CABECEIRA":"Cabeceiras","CAMA":"Camas",
    "COLCHAO":"Colchões","COMODA":"Cômodas","COZINHA":"Cozinhas","ELETRO":"Eletro",
    "MESA":"Mesas & Cadeiras","PAINEL":"Painéis","RACK":"Racks","ROUPEIRO":"Guarda-Roupas",
    "SOFA":"Sofás","TERRAÇO":"Terraço & Varanda","TRAVESSEIRO":"Travesseiros",
    "UNIBOX":"Conjuntos Box","ZDIVERSOS":"Diversos","OUTROS":"Diversos"}

def classify(name):
    up=name.upper()
    if "BOX" in up or up.startswith("BASE"): return "BASE"
    if "RECAMIER" in up: return "ACESSORIOS"
    if "CABECEIRA" in up: return "CABECEIRA"
    if "COLCHAO" in up or "COLCHÃO" in up: return "COLCHAO"
    return "ACESSORIOS"

for it in items:
    if it["categoria"] in ("OUTROS",""):
        it["categoria"]=classify(it["nome"])
    it["categoria_label"]=CATMAP.get(it["categoria"], it["categoria"].title())
    it["nome_exibicao"]=clean_name(it["nome"])
    dims=extract_dims(it["nome"]); cor=extract_color(it["nome"])
    it["medidas"]=dims[0] if dims else ""
    it["cor"]=", ".join(cor)
    # descricao comercial (lidera pelo nome do produto)
    partes=[it["nome_exibicao"]]
    if it["cor"] and it["cor"].lower() not in it["nome_exibicao"].lower():
        partes.append(f"na cor {it['cor'].lower()}")
    if it["medidas"]: partes.append(f"({it['medidas'].replace('X',' x ')})")
    it["descricao"]=" ".join(partes).strip()+". Disponível nas Lojas Belmont."

items.sort(key=lambda i:(i["categoria_label"], i["nome_exibicao"]))
json.dump(items, open(os.path.join(D,"catalogo-dados.json"),"w",encoding="utf-8"),
          ensure_ascii=False, indent=1)
from collections import Counter
print("itens:",len(items))
print("categorias:",dict(Counter(i["categoria_label"] for i in items)))
print("\nEXEMPLOS:")
for it in items[:6]:
    print(f"  [{it['codigo']}] {it['nome_exibicao']}")
    print(f"      cat={it['categoria_label']} | cor={it['cor']} | med={it['medidas']} | R${it['preco']:.2f} | img={'sim' if it['imagem'] else 'nao'}")
    print(f"      desc: {it['descricao']}")
