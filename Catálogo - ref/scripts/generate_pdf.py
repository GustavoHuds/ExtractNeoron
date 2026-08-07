#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gera os 2 catalogos PDF: Lista (fotos pequenas) e Visual (fotos grandes)."""
import json, os, datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
    Spacer, Table, TableStyle, Image, KeepInFrame, NextPageTemplate, PageBreak)

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
D = os.path.join(BASE,"saida","data")
OUT = os.path.join(BASE,"saida")
ASSETS = os.path.join(BASE,"saida","assets")
LOGO = os.path.join(ASSETS,"logo_belmont.png")
PLACE = os.path.join(ASSETS,"placeholder.jpg")
items = json.load(open(os.path.join(D,"catalogo-dados.json"),encoding="utf-8"))

NAVY=colors.HexColor("#12243B"); GOLD=colors.HexColor("#C1912E")
CREAM=colors.HexColor("#F6F3EE"); INK=colors.HexColor("#1B1B1B")
GRAY=colors.HexColor("#6B7280"); LINE=colors.HexColor("#E7E1D6")
NAVY2=colors.HexColor("#1c3352")
TODAY=datetime.date(2026,8,1).strftime("%d/%m/%Y")

def img_path(it): return os.path.join(OUT,it["imagem"]) if it["imagem"] else PLACE
def brl(v): return ("R$ %0.2f"%(v or 0)).replace(".",",")

from PIL import Image as PImage
CACHE=os.path.join(ASSETS,"_pdfcache"); os.makedirs(CACHE,exist_ok=True)
def scaled(path, maxpx):
    """retorna caminho de uma versao reduzida (JPEG) cacheada."""
    key=f"{os.path.splitext(os.path.basename(path))[0]}_{maxpx}.jpg"
    out=os.path.join(CACHE,key)
    if os.path.exists(out): return out
    try:
        im=PImage.open(path)
        if im.mode not in ("RGB","L"):
            bg=PImage.new("RGB",im.size,(255,255,255))
            bg.paste(im, mask=im.split()[-1] if im.mode in ("RGBA","LA") else None)
            im=bg
        else: im=im.convert("RGB")
        im.thumbnail((maxpx,maxpx), PImage.LANCZOS)
        im.save(out,"JPEG",quality=82,optimize=True)
        return out
    except Exception:
        return path

def fit(path, boxw, boxh, maxpx=600):
    p=scaled(path, maxpx)
    try:
        iw,ih=ImageReader(p).getSize()
        r=min(boxw/iw, boxh/ih); return Image(p, iw*r, ih*r)
    except Exception:
        return Spacer(boxw,boxh)

# group by category label preserving order
from collections import OrderedDict
cats=OrderedDict()
for it in items: cats.setdefault(it["categoria_label"],[]).append(it)

styles=getSampleStyleSheet()
def S(name,**kw):
    base=dict(fontName="Helvetica",fontSize=9,leading=11,textColor=INK)
    base.update(kw); return ParagraphStyle(name,**base)
st_name=S("nm",fontName="Helvetica-Bold",fontSize=8.5,leading=10)
st_cod=S("cod",fontSize=7.5,textColor=GRAY)
st_attr=S("at",fontSize=7.5,textColor=GRAY,leading=9)
st_price=S("pr",fontName="Helvetica-Bold",fontSize=9,textColor=NAVY,alignment=TA_RIGHT)
st_cardname=S("cn",fontName="Helvetica-Bold",fontSize=8.5,leading=10.5,alignment=TA_CENTER)
st_cardcod=S("cc",fontSize=7,textColor=GRAY,alignment=TA_CENTER)
st_cardprice=S("cp",fontName="Helvetica-Bold",fontSize=11,textColor=GOLD,alignment=TA_CENTER)
st_cathead=S("ch",fontName="Helvetica-Bold",fontSize=13,textColor=colors.white)

# ---------- canvas decorations ----------
def draw_cover(c,doc,subtitle):
    w,h=A4
    c.setFillColor(NAVY); c.rect(0,0,w,h,fill=1,stroke=0)
    c.setFillColor(NAVY2); c.rect(0,h*0.60,w,2,fill=1,stroke=0)
    # logo
    try:
        iw,ih=ImageReader(LOGO).getSize(); lw=4.6*cm; lh=lw*ih/iw
        c.drawImage(LOGO,(w-lw)/2,h*0.66,lw,lh,mask='auto')
    except Exception: pass
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold",30); c.drawCentredString(w/2,h*0.52,"CATÁLOGO DE PRODUTOS")
    c.setFillColor(GOLD); c.setLineWidth(2)
    c.line(w/2-3.2*cm,h*0.50,w/2+3.2*cm,h*0.50)
    c.setFillColor(colors.HexColor("#C9D3E0")); c.setFont("Helvetica",13)
    c.drawCentredString(w/2,h*0.465,subtitle)
    c.setFont("Helvetica",10.5)
    c.drawCentredString(w/2,h*0.30,"Lojas Belmont • +38 anos de história")
    c.drawCentredString(w/2,h*0.275,"João Pessoa – PB")
    c.setFillColor(GOLD); c.setFont("Helvetica-Bold",10)
    c.drawCentredString(w/2,h*0.235,f"{len(items)} produtos selecionados")
    c.setFillColor(colors.HexColor("#8fa0b6")); c.setFont("Helvetica",8.5)
    c.drawCentredString(w/2,1.4*cm,f"Emitido em {TODAY}  •  Preços sujeitos a alteração sem aviso prévio")

def header_footer(c,doc):
    w,h=A4
    c.setFillColor(NAVY); c.rect(0,h-1.15*cm,w,1.15*cm,fill=1,stroke=0)
    try:
        iw,ih=ImageReader(LOGO).getSize(); lh=0.8*cm; lw=lh*iw/ih
        c.drawImage(LOGO,1.2*cm,h-1.02*cm,lw,lh,mask='auto')
    except Exception: pass
    c.setFillColor(colors.white); c.setFont("Helvetica-Bold",9)
    c.drawString(2.5*cm,h-0.75*cm,"LOJAS BELMONT")
    c.setFillColor(colors.HexColor("#C9D3E0")); c.setFont("Helvetica",8)
    c.drawRightString(w-1.2*cm,h-0.75*cm,"Catálogo de Produtos "+str(datetime.date(2026,8,1).year))
    c.setFillColor(GRAY); c.setFont("Helvetica",8)
    c.drawCentredString(w/2,0.8*cm,f"Lojas Belmont  •  João Pessoa – PB  •  página {doc.page-1}")
    c.setStrokeColor(LINE); c.setLineWidth(.5); c.line(1.2*cm,1.1*cm,w-1.2*cm,1.1*cm)

def cathead_flow(label,n):
    t=Table([[Paragraph(label.upper(),st_cathead),
              Paragraph(f'<font color="#f0e6cf">{n} itens</font>',
                        S("x",fontName="Helvetica",fontSize=9,alignment=TA_RIGHT,textColor=colors.white))]],
            colWidths=[13*cm,4.6*cm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),NAVY),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6),
        ("LINEBELOW",(0,0),(-1,-1),2,GOLD),("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
    return t

# ---------- LISTA ----------
def build_lista(path):
    doc=BaseDocTemplate(path,pagesize=A4,leftMargin=1.2*cm,rightMargin=1.2*cm,
        topMargin=1.5*cm,bottomMargin=1.4*cm,title="Catálogo Belmont — Lista")
    frame=Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='f')
    doc.addPageTemplates([
        PageTemplate(id='cover',frames=[frame],
                     onPage=lambda c,d:draw_cover(c,d,"Lista de Preços & Relação de Produtos")),
        PageTemplate(id='body',frames=[frame],onPage=header_footer)])
    story=[NextPageTemplate('body'),PageBreak()]
    for label,its in cats.items():
        rows=[[Paragraph("<b>Foto</b>",S("h",textColor=colors.white,fontSize=7.5)),
               Paragraph("<b>Cód.</b>",S("h",textColor=colors.white,fontSize=7.5)),
               Paragraph("<b>Produto</b>",S("h",textColor=colors.white,fontSize=7.5)),
               Paragraph("<b>Detalhes</b>",S("h",textColor=colors.white,fontSize=7.5)),
               Paragraph("<b>Preço</b>",S("h",textColor=colors.white,fontSize=7.5,alignment=TA_RIGHT))]]
        sty=[("BACKGROUND",(0,0),(-1,0),NAVY),("VALIGN",(0,0),(-1,-1),"MIDDLE"),
             ("LINEBELOW",(0,0),(-1,0),1,GOLD),
             ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
             ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
             ("LINEBELOW",(0,1),(-1,-1),.4,LINE)]
        r=1
        for it in its:
            thumb=fit(img_path(it),1.0*cm,1.0*cm,150)
            attr=[]
            if it["cor"]: attr.append(it["cor"])
            if it["medidas"]: attr.append(it["medidas"].replace("X","×"))
            rows.append([thumb,Paragraph(it["codigo"],st_cod),
                         Paragraph(it["nome_exibicao"],st_name),
                         Paragraph(" • ".join(attr) or "—",st_attr),
                         Paragraph(brl(it["preco"]),st_price)])
            if r%2==0: sty.append(("BACKGROUND",(0,r),(-1,r),colors.HexColor("#FBFAF7")))
            r+=1
        t=Table(rows,colWidths=[1.2*cm,1.7*cm,8.5*cm,3.6*cm,2.4*cm],repeatRows=1)
        t.setStyle(TableStyle(sty))
        story+=[cathead_flow(label,len(its)),Spacer(1,3),t,Spacer(1,14)]
    doc.build(story)
    print("OK  Catalogo-Belmont-Lista.pdf")

# ---------- VISUAL ----------
def build_visual(path):
    doc=BaseDocTemplate(path,pagesize=A4,leftMargin=1.2*cm,rightMargin=1.2*cm,
        topMargin=1.5*cm,bottomMargin=1.4*cm,title="Catálogo Belmont — Visual")
    frame=Frame(doc.leftMargin,doc.bottomMargin,doc.width,doc.height,id='f')
    doc.addPageTemplates([
        PageTemplate(id='cover',frames=[frame],
                     onPage=lambda c,d:draw_cover(c,d,"Catálogo Visual de Produtos")),
        PageTemplate(id='body',frames=[frame],onPage=header_footer)])
    story=[NextPageTemplate('body'),PageBreak()]
    CW=5.6*cm; IMGH=4.3*cm
    def card(it):
        img=fit(img_path(it),CW-0.5*cm,IMGH,560)
        inner=Table([[img]],colWidths=[CW-0.3*cm],rowHeights=[IMGH+0.2*cm])
        inner.setStyle(TableStyle([("ALIGN",(0,0),(-1,-1),"CENTER"),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),("BACKGROUND",(0,0),(-1,-1),colors.white)]))
        attr=[]
        if it["cor"]: attr.append(it["cor"])
        if it["medidas"]: attr.append(it["medidas"].replace("X","×"))
        body=[[inner],
              [Paragraph(it["nome_exibicao"],st_cardname)],
              [Paragraph("Cód. "+it["codigo"]+(("  •  "+" • ".join(attr)) if attr else ""),st_cardcod)],
              [Paragraph(brl(it["preco"]),st_cardprice)]]
        c=Table(body,colWidths=[CW])
        c.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,-1),colors.white),
            ("BOX",(0,0),(-1,-1),.8,LINE),("LINEBELOW",(0,0),(-1,0),.8,LINE),
            ("TOPPADDING",(0,1),(-1,1),6),("TOPPADDING",(0,0),(-1,0),6),
            ("BOTTOMPADDING",(0,-1),(-1,-1),8),("TOPPADDING",(0,-1),(-1,-1),2),
            ("BOTTOMPADDING",(0,1),(-1,2),1),
            ("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE")]))
        return KeepInFrame(CW,7.9*cm,[c],mode="shrink")
    for label,its in cats.items():
        story+=[cathead_flow(label,len(its)),Spacer(1,8)]
        row=[]; grid=[]
        for it in its:
            row.append(card(it))
            if len(row)==3:
                grid.append(row); row=[]
        if row:
            while len(row)<3: row.append("")
            grid.append(row)
        gt=Table(grid,colWidths=[CW+0.15*cm]*3,hAlign="CENTER")
        gt.setStyle(TableStyle([("VALIGN",(0,0),(-1,-1),"TOP"),
            ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
            ("ALIGN",(0,0),(-1,-1),"CENTER")]))
        story+=[gt,Spacer(1,12)]
    doc.build(story)
    print("OK  Catalogo-Belmont-Visual.pdf")

if __name__=="__main__":
    build_lista(os.path.join(OUT,"Catalogo-Belmont-Lista.pdf"))
    build_visual(os.path.join(OUT,"Catalogo-Belmont-Visual.pdf"))
