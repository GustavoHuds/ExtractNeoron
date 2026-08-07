#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Roda todo o pipeline do catalogo Belmont, na ordem correta."""
import subprocess, sys, os
HERE=os.path.dirname(os.path.abspath(__file__))
STEPS=["extract_relacao.py","extract_referencias.py","build_dataset.py",
       "enrich.py","generate_assets.py","generate_pdf.py","generate_site.py"]
for s in STEPS:
    print(f"\n===== {s} =====")
    r=subprocess.run([sys.executable, os.path.join(HERE,s)],
                     env={**os.environ,"PYTHONIOENCODING":"utf-8"})
    if r.returncode!=0:
        print("FALHOU em",s); sys.exit(1)
print("\n✔ pipeline concluido. Saidas em ../ (PDFs, site/, image-book/, data/)")
